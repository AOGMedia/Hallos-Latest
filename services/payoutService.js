const { paystackClient } = require('../config/paystack');
const { stripeClient } = require('../config/stripe');
const Payout = require('../models/Payout');
const { lockAmountForWithdrawal } = require('../services/walletService');

const PLATFORM_FEE_PERCENTAGE = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.10;

/**
 * Calculate payout fees
 * @param {number} amount - Withdrawal amount
 * @param {string} gateway - Payment gateway (paystack or stripe)
 * @returns {object} - Fee breakdown
 */
function calculatePayoutFees(amount, gateway = 'paystack') {
  const platformFee = amount * PLATFORM_FEE_PERCENTAGE;
  
  let gatewayFee = 0;
  
  if (gateway === 'paystack') {
    // Paystack transfer fees for NGN
    // Free for transfers above NGN 5,000
    // NGN 10 + 0.5% for transfers below NGN 5,000
    if (amount < 5000) {
      gatewayFee = 10 + (amount * 0.005);
    } else {
      gatewayFee = 0; // Free for amounts >= 5000
    }
  } else if (gateway === 'stripe') {
    // Stripe payout fees (approximate)
    // Varies by country, using a conservative estimate
    gatewayFee = amount * 0.0025; // 0.25%
  }
  
  const netAmount = amount - platformFee - gatewayFee;
  
  return {
    amount: parseFloat(amount.toFixed(2)),
    platformFee: parseFloat(platformFee.toFixed(2)),
    gatewayFee: parseFloat(gatewayFee.toFixed(2)),
    netAmount: parseFloat(netAmount.toFixed(2))
  };
}

/**
 * Initiate withdrawal request
 * @param {object} params - Withdrawal parameters
 * @returns {object} - Payout record
 */
async function initiateWithdrawal({ userId, amount, currency = 'NGN', bankDetails, gateway = 'paystack' }) {
  try {
    const { bankName, bankCode, accountNumber, accountName } = bankDetails;

    // Validate bank details - accept either bankCode (for NGN) or bankName (for USD)
    if (!accountNumber || !accountName) {
      throw new Error('Account number and account name are required');
    }

    if (!bankCode && !bankName) {
      throw new Error('Either bank code or bank name is required');
    }

    // Calculate fees
    const fees = calculatePayoutFees(amount, gateway);

    if (fees.netAmount <= 0) {
      throw new Error('Amount too small after fees');
    }

    // Lock amount in wallet with currency
    await lockAmountForWithdrawal(userId, amount, currency);

    // Determine final bankName for storage
    let finalBankName = bankName;
    let finalBankCode = bankCode;
    
    // If we have bankCode but no bankName (NGN case), try to get bank name
    if (bankCode && !bankName) {
      try {
        const banks = await getNigerianBanks();
        const bank = banks.find(b => b.code === bankCode);
        finalBankName = bank ? bank.name : `Bank Code: ${bankCode}`;
      } catch (error) {
        console.warn('Could not fetch bank name, using bank code:', error.message);
        finalBankName = `Bank Code: ${bankCode}`;
      }
    }

    // Create payout record
    const payout = await Payout.create({
      userId,
      amount: fees.amount,
      platformFee: fees.platformFee,
      gatewayFee: fees.gatewayFee,
      netAmount: fees.netAmount,
      currency: currency.toUpperCase(),
      paymentGateway: gateway,
      bankName: finalBankName,
      accountNumber,
      accountName,
      status: 'pending'
    });

    // Store bankCode as a property for later use (not persisted to DB)
    payout.bankCode = finalBankCode;

    return payout;
  } catch (error) {
    console.error('Initiate withdrawal error:', error);
    throw error;
  }
}

/**
 * Process payout via Paystack
 * @param {string} payoutId - Payout record ID
 * @returns {object} - Transfer result
 */
async function processPaystackPayout(payoutId) {
  try {
    const payout = await Payout.findByPk(payoutId);

    if (!payout) {
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error('Payout already processed');
    }

    // Get bankCode - either from the payout object (if just created) or derive from bankName
    let bankCode = payout.bankCode;
    
    if (!bankCode) {
      // Fallback: try to get bank code from bank name
      bankCode = await getBankCode(payout.bankName);
    }

    console.log(`[Paystack Payout] Processing withdrawal for user ${payout.userId}: ${payout.netAmount} NGN`);

    // Step 1: Create transfer recipient
    console.log(`[Paystack Payout] Creating transfer recipient for account ${payout.accountNumber}`);
    const recipientResponse = await paystackClient.post('/transferrecipient', {
      type: 'nuban',
      name: payout.accountName,
      account_number: payout.accountNumber,
      bank_code: bankCode,
      currency: 'NGN'
    });

    if (!recipientResponse.data.status) {
      throw new Error(recipientResponse.data.message || 'Failed to create transfer recipient');
    }

    const recipientCode = recipientResponse.data.data.recipient_code;
    console.log(`[Paystack Payout] Recipient created: ${recipientCode}`);

    // Step 2: Initiate transfer
    console.log(`[Paystack Payout] Initiating transfer of ${payout.netAmount} NGN`);
    const transferResponse = await paystackClient.post('/transfer', {
      source: 'balance',
      amount: Math.round(payout.netAmount * 100), // Convert to kobo
      recipient: recipientCode,
      reason: `Withdrawal for user ${payout.userId}`,
      reference: `payout_${payout.id}_${Date.now()}`
    });

    console.log('[Paystack Payout] Transfer response:', JSON.stringify(transferResponse.data, null, 2));

    if (!transferResponse.data.status) {
      throw new Error(transferResponse.data.message || 'Transfer request failed');
    }

    const transferData = transferResponse.data.data;

    // Check transfer status
    if (transferData.status === 'failed') {
      throw new Error(`Transfer failed: ${transferData.message || 'Unknown reason'}`);
    }

    // Log important transfer details
    console.log(`[Paystack Payout] Transfer status: ${transferData.status}`);
    console.log(`[Paystack Payout] Transfer code: ${transferData.transfer_code}`);
    console.log(`[Paystack Payout] Transfer reference: ${transferData.reference}`);

    // Update payout with transfer reference
    payout.transferReference = transferData.transfer_code || transferData.reference;
    payout.status = 'processing';
    await payout.save();

    console.log(`[Paystack Payout] Payout ${payout.id} updated to processing status`);

    return {
      success: true,
      payout,
      transferData
    };
  } catch (error) {
    console.error('[Paystack Payout] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    
    // Update payout status to failed
    const payout = await Payout.findByPk(payoutId);
    if (payout) {
      payout.status = 'failed';
      payout.failureReason = error.response?.data?.message || error.message;
      await payout.save();
      
      console.error(`[Paystack Payout] Payout ${payout.id} marked as failed: ${payout.failureReason}`);
    }

    throw new Error(error.response?.data?.message || error.message || 'Failed to process Paystack payout');
  }
}

/**
 * Process payout via Stripe
 * @param {string} payoutId - Payout record ID
 * @returns {object} - Transfer result
 */
async function processStripePayout(payoutId) {
  try {
    const payout = await Payout.findByPk(payoutId);

    if (!payout) {
      throw new Error('Payout not found');
    }

    if (payout.status !== 'pending') {
      throw new Error('Payout already processed');
    }


    const transfer = await stripeClient.transfers.create({
      amount: Math.round(payout.netAmount * 100), // I Converted to cents
      currency: 'usd', 
      destination: 'connected_account_id', 
      description: `Withdrawal for user ${payout.userId}`,
      metadata: {
        payoutId: payout.id,
        userId: payout.userId.toString()
      }
    });

    // Update payout with transfer reference
    payout.transferReference = transfer.id;
    payout.status = 'processing';
    await payout.save();

    return {
      success: true,
      payout,
      transfer
    };
  } catch (error) {
    console.error('Stripe payout error:', error.message);
    
    // Update payout status to failed
    const payout = await Payout.findByPk(payoutId);
    if (payout) {
      payout.status = 'failed';
      payout.failureReason = error.message;
      await payout.save();
    }

    throw new Error(error.message || 'Failed to process Stripe payout');
  }
}

/**
 * Cache for Nigerian banks list to avoid repeated API calls
 */
let banksCache = null;
let banksCacheTimestamp = null;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Get list of Nigerian banks from Paystack (with caching)
 */
async function getNigerianBanks() {
  try {
    // Check if cache is valid
    const now = Date.now();
    if (banksCache && banksCacheTimestamp && (now - banksCacheTimestamp < CACHE_DURATION)) {
      console.log('[Paystack] Using cached banks list');
      return banksCache;
    }

    // Fetch fresh data from Paystack
    console.log('[Paystack] Fetching banks list from API');
    const response = await paystackClient.get('/bank?currency=NGN');
    banksCache = response.data.data;
    banksCacheTimestamp = now;
    
    return banksCache;
  } catch (error) {
    console.error('Error fetching banks:', error);
    
    // If we have stale cache, return it as fallback
    if (banksCache) {
      console.warn('[Paystack] API failed, using stale cache');
      return banksCache;
    }
    
    throw new Error('Failed to fetch bank list');
  }
}

/**
 * Helper function to get Paystack bank code from bank name
 * Fetches dynamically from Paystack API with caching
 */
async function getBankCode(bankName) {
  try {
    // Fetch banks list (uses cache if available)
    const banks = await getNigerianBanks();
    
    // Try exact match first
    let bank = banks.find(b => b.name.toLowerCase() === bankName.toLowerCase());
    
    // If no exact match, try partial match
    if (!bank) {
      bank = banks.find(b => b.name.toLowerCase().includes(bankName.toLowerCase()));
    }
    
    // If still no match, try reverse (bankName includes bank.name)
    if (!bank) {
      bank = banks.find(b => bankName.toLowerCase().includes(b.name.toLowerCase()));
    }
    
    if (bank) {
      console.log(`[Paystack] Found bank code ${bank.code} for "${bankName}"`);
      return bank.code;
    }
    
    // No match found
    console.warn(`[Paystack] No bank found matching "${bankName}"`);
    throw new Error(`Bank not found: ${bankName}`);
    
  } catch (error) {
    console.error('[Paystack] Error getting bank code:', error.message);
    
    // Emergency fallback: hardcoded common banks (only if API completely fails)
    const emergencyFallback = {
      'access bank': '044',
      'gtbank': '058',
      'guaranty trust bank': '058',
      'first bank': '011',
      'first bank of nigeria': '011',
      'zenith bank': '057',
      'uba': '033',
      'united bank for africa': '033',
      'fidelity bank': '070',
      'union bank': '032',
      'sterling bank': '232',
      'stanbic ibtc': '221',
      'polaris bank': '076',
      'wema bank': '035',
      'ecobank': '050'
    };
    
    const fallbackCode = emergencyFallback[bankName.toLowerCase()];
    if (fallbackCode) {
      console.warn(`[Paystack] Using emergency fallback code ${fallbackCode} for "${bankName}"`);
      return fallbackCode;
    }
    
    // If all else fails, throw error
    throw new Error(`Could not resolve bank code for: ${bankName}`);
  }
}

/**
 * Resolve account number to get account name
 * @param {string} accountNumber - 10-digit account number
 * @param {string} bankCode - Bank code from Paystack
 * @returns {object} - Account details
 */
async function resolveAccountNumber(accountNumber, bankCode) {
  try {
    console.log(`Resolving account: ${accountNumber} for bank code: ${bankCode}`);
    
    const response = await paystackClient.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
    
    console.log('Paystack response:', JSON.stringify(response.data, null, 2));
    
    if (!response.data.status) {
      console.error('Paystack returned status false:', response.data.message);
      throw new Error(response.data.message || 'Could not resolve account name');
    }

    // Try to get bank name dynamically from banks API
    let bankName = null;
    try {
      const banksResponse = await getNigerianBanks();
      const bank = banksResponse.find(b => b.code === bankCode);
      bankName = bank ? bank.name : null;
      console.log(`Found bank name: ${bankName} for code: ${bankCode}`);
    } catch (bankError) {
      console.warn('Could not fetch bank name dynamically:', bankError.message);
      // Fallback to null - the account name is what matters most
    }

    const result = {
      accountNumber,
      accountName: response.data.data.account_name,
      bankCode,
      bankName
    };

    console.log('Final result:', result);
    return result;

  } catch (error) {
    console.error('Account resolution error details:');
    console.error('Error message:', error.message);
    console.error('Error response:', error.response?.data);
    console.error('Error status:', error.response?.status);
    console.error('Full error:', error);
    
    if (error.response?.status === 422) {
      throw new Error('Could not resolve account name. Please check the account number and bank code.');
    }
    
    if (error.response?.status === 400) {
      throw new Error('Invalid bank code or account number format');
    }

    // Return the actual Paystack error message if available
    const paystackMessage = error.response?.data?.message || error.response?.data?.error;
    throw new Error(paystackMessage || error.message || 'Failed to resolve account details');
  }
}

module.exports = {
  calculatePayoutFees,
  initiateWithdrawal,
  processPaystackPayout,
  processStripePayout,
  getNigerianBanks,
  resolveAccountNumber
};
