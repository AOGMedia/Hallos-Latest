const axios = require('axios');

/**
 * Currency-Specific Withdrawal Processing Service
 * 
 * Handles currency-specific withdrawal processing:
 * - NGN withdrawals through Paystack to Nigerian banks
 * - USD withdrawals through Stripe to international banks
 * - Proper fee calculation and bank validation
 * - Gateway-specific error handling
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

class CurrencyWithdrawalService {
  constructor() {
    // Gateway configuration
    this.config = {
      // Platform commission (applied to all withdrawals)
      platform: {
        commission: parseFloat(process.env.PLATFORM_FEE_PERCENTAGE) || 0.10,
        description: 'Platform operational fee'
      },
      
      // Paystack configuration for NGN
      paystack: {
        baseURL: 'https://api.paystack.co',
        secretKey: process.env.PAYSTACK_SECRET_KEY,
        publicKey: process.env.PAYSTACK_PUBLIC_KEY,
        currency: 'NGN',
        supportedBanks: [], // Will be loaded dynamically
        fees: {
          percentage: 0.015, // 1.5%
          cap: 2000,         // ₦2,000 cap
          minimum: 50        // ₦50 minimum
        }
      },
      
      // Stripe configuration for USD
      stripe: {
        baseURL: 'https://api.stripe.com/v1',
        secretKey: process.env.STRIPE_SECRET_KEY,
        publicKey: process.env.STRIPE_PUBLISHABLE_KEY,
        currency: 'USD',
        fees: {
          percentage: 0.029, // 2.9%
          fixed: 30,         // $0.30 fixed fee
          minimum: 50        // $0.50 minimum
        }
      },
      
      // Withdrawal limits per currency
      limits: {
        NGN: {
          minimum: 1000,      // ₦1,000
          maximum: 10000000   // ₦10M
        },
        USD: {
          minimum: 10,        // $10
          maximum: 50000      // $50,000
        }
      }
    };

    // Initialize gateway clients
    this.initializeGateways();
  }

  /**
   * Initialize payment gateway clients
   */
  initializeGateways() {
    // Paystack client
    this.paystackClient = axios.create({
      baseURL: this.config.paystack.baseURL,
      headers: {
        'Authorization': `Bearer ${this.config.paystack.secretKey}`,
        'Content-Type': 'application/json'
      }
    });

    // Stripe client
    this.stripeClient = axios.create({
      baseURL: this.config.stripe.baseURL,
      headers: {
        'Authorization': `Bearer ${this.config.stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
  }

  /**
   * Process withdrawal based on currency
   * @param {Object} withdrawalData - Withdrawal details
   * @returns {Promise<Object>} Withdrawal result
   */
  async processWithdrawal(withdrawalData) {
    try {
      const { amount, currency, bankAccount, userId, reference } = withdrawalData;

      console.log(`[Currency Withdrawal] Processing ${currency} withdrawal: ${amount} for user ${userId}`);

      // Validate withdrawal data
      const validation = this.validateWithdrawal(withdrawalData);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
          error: 'validation_failed'
        };
      }

      // Calculate fees
      const feeCalculation = this.calculateFees(amount, currency);

      // Route to appropriate gateway
      let result;
      if (currency === 'NGN') {
        result = await this.processNGNWithdrawal({
          ...withdrawalData,
          fees: feeCalculation
        });
      } else if (currency === 'USD') {
        result = await this.processUSDWithdrawal({
          ...withdrawalData,
          fees: feeCalculation
        });
      } else {
        return {
          success: false,
          message: `Unsupported currency: ${currency}`,
          error: 'unsupported_currency'
        };
      }

      console.log(`[Currency Withdrawal] ${currency} withdrawal result:`, result.success ? 'SUCCESS' : 'FAILED');

      return result;
    } catch (error) {
      console.error('[Currency Withdrawal] Processing error:', error);
      return {
        success: false,
        message: 'Withdrawal processing failed',
        error: 'processing_error',
        details: error.message
      };
    }
  }

  /**
   * Process NGN withdrawal through Paystack
   * @param {Object} withdrawalData - Withdrawal details with fees
   * @returns {Promise<Object>} Withdrawal result
   */
  async processNGNWithdrawal(withdrawalData) {
    try {
      const { amount, bankAccount, userId, reference, fees } = withdrawalData;

      console.log(`[NGN Withdrawal] Processing Paystack withdrawal: ₦${amount}`);

      // Validate bank account for Nigerian banks
      const bankValidation = await this.validateNigerianBankAccount(bankAccount);
      if (!bankValidation.valid) {
        return {
          success: false,
          message: bankValidation.message,
          error: 'invalid_bank_account'
        };
      }

      // Create transfer recipient
      const recipient = await this.createPaystackRecipient(bankAccount, userId);
      if (!recipient.success) {
        return recipient;
      }

      // Calculate net amount (amount - fees)
      const netAmount = amount - fees.totalFee;

      // Initiate transfer
      const transferData = {
        source: 'balance',
        amount: netAmount * 100, // Paystack uses kobo
        recipient: recipient.recipientCode,
        reason: `Withdrawal - ${reference}`,
        reference: reference,
        currency: 'NGN'
      };

      const response = await this.paystackClient.post('/transfer', transferData);

      if (response.data.status && response.data.data) {
        return {
          success: true,
          message: 'NGN withdrawal initiated successfully',
          gatewayResponse: response.data.data,
          transferCode: response.data.data.transfer_code,
          recipientCode: recipient.recipientCode,
          fees: fees,
          netAmount: netAmount,
          currency: 'NGN'
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Paystack transfer failed',
          error: 'paystack_transfer_failed',
          gatewayResponse: response.data
        };
      }
    } catch (error) {
      console.error('[NGN Withdrawal] Paystack error:', error);
      return {
        success: false,
        message: this.parsePaystackError(error),
        error: 'paystack_error',
        details: error.response?.data || error.message
      };
    }
  }

  /**
   * Process USD withdrawal through Stripe
   * @param {Object} withdrawalData - Withdrawal details with fees
   * @returns {Promise<Object>} Withdrawal result
   */
  async processUSDWithdrawal(withdrawalData) {
    try {
      const { amount, bankAccount, userId, reference, fees } = withdrawalData;

      console.log(`[USD Withdrawal] Processing Stripe withdrawal: $${amount}`);

      // Validate international bank account
      const bankValidation = this.validateInternationalBankAccount(bankAccount);
      if (!bankValidation.valid) {
        return {
          success: false,
          message: bankValidation.message,
          error: 'invalid_bank_account'
        };
      }

      // Create Stripe external account
      const externalAccount = await this.createStripeExternalAccount(bankAccount, userId);
      if (!externalAccount.success) {
        return externalAccount;
      }

      // Calculate net amount (amount - fees)
      const netAmount = amount - fees.totalFee;

      // Create transfer to connected account
      const transferData = new URLSearchParams({
        amount: Math.round(netAmount * 100), // Stripe uses cents
        currency: 'usd',
        destination: externalAccount.accountId,
        description: `Withdrawal - ${reference}`,
        metadata: JSON.stringify({
          userId: userId,
          reference: reference,
          originalAmount: amount,
          fees: fees.totalFee,
          bankAccountId: externalAccount.bankAccountId
        })
      });

      const response = await this.stripeClient.post('/transfers', transferData);

      if (response.data && response.data.id) {
        return {
          success: true,
          message: 'USD withdrawal initiated successfully',
          gatewayResponse: response.data,
          transferId: response.data.id,
          accountId: externalAccount.accountId,
          bankAccountId: externalAccount.bankAccountId,
          fees: fees,
          netAmount: netAmount,
          currency: 'USD',
          estimatedArrival: '1-3 business days',
          accountDetails: externalAccount.accountDetails
        };
      } else {
        return {
          success: false,
          message: 'Stripe transfer failed',
          error: 'stripe_transfer_failed',
          gatewayResponse: response.data
        };
      }
    } catch (error) {
      console.error('[USD Withdrawal] Stripe error:', error);
      return {
        success: false,
        message: this.parseStripeError(error),
        error: 'stripe_error',
        details: error.response?.data || error.message
      };
    }
  }

  /**
   * Calculate withdrawal fees based on currency
   * @param {number} amount - Withdrawal amount
   * @param {string} currency - Currency code
   * @returns {Object} Fee calculation
   */
  calculateFees(amount, currency) {
    const config = currency === 'NGN' ? this.config.paystack : this.config.stripe;
    
    // Calculate platform commission (20% of withdrawal amount)
    const platformCommission = amount * this.config.platform.commission;
    
    // Calculate gateway fees on the remaining amount after platform commission
    const amountAfterCommission = amount - platformCommission;
    let gatewayFee = 0;
    
    if (currency === 'NGN') {
      // Paystack: percentage with cap and minimum
      gatewayFee = Math.max(
        config.fees.minimum,
        Math.min(
          amountAfterCommission * config.fees.percentage,
          config.fees.cap
        )
      );
    } else if (currency === 'USD') {
      // Stripe: percentage + fixed fee with minimum
      gatewayFee = Math.max(
        config.fees.minimum,
        (amountAfterCommission * config.fees.percentage) + config.fees.fixed
      );
    }

    const totalFees = platformCommission + gatewayFee;
    const netAmount = amount - totalFees;

    return {
      amount: amount,
      currency: currency,
      platformCommission: Math.round(platformCommission * 100) / 100,
      platformCommissionPercentage: this.config.platform.commission,
      gatewayFee: Math.round(gatewayFee * 100) / 100,
      gatewayFeePercentage: config.fees.percentage,
      gatewayFeeFixed: config.fees.fixed || 0,
      totalFee: Math.round(totalFees * 100) / 100,
      netAmount: Math.round(netAmount * 100) / 100,
      breakdown: {
        platformCommission: Math.round(platformCommission * 100) / 100,
        platformCommissionPercentage: this.config.platform.commission,
        gatewayPercentageFee: Math.round((amountAfterCommission * config.fees.percentage) * 100) / 100,
        gatewayFixedFee: config.fees.fixed || 0,
        gatewayMinimum: config.fees.minimum,
        gatewayCap: config.fees.cap || null,
        description: `Platform fee (${this.config.platform.commission * 100}%) + ${currency === 'NGN' ? 'Paystack' : 'Stripe'} fees`
      }
    };
  }

  /**
   * Validate withdrawal data
   * @param {Object} withdrawalData - Withdrawal details
   * @returns {Object} Validation result
   */
  validateWithdrawal(withdrawalData) {
    const { amount, currency, bankAccount } = withdrawalData;

    // Check required fields
    if (!amount || !currency || !bankAccount) {
      return {
        valid: false,
        message: 'Missing required fields: amount, currency, or bank account'
      };
    }

    // Check currency support
    if (!['NGN', 'USD'].includes(currency)) {
      return {
        valid: false,
        message: `Unsupported currency: ${currency}`
      };
    }

    // Check amount limits
    const limits = this.config.limits[currency];
    if (amount < limits.minimum) {
      return {
        valid: false,
        message: `Minimum withdrawal amount is ${currency} ${limits.minimum}`
      };
    }

    if (amount > limits.maximum) {
      return {
        valid: false,
        message: `Maximum withdrawal amount is ${currency} ${limits.maximum.toLocaleString()}`
      };
    }

    return { valid: true };
  }

  /**
   * Validate Nigerian bank account for Paystack
   * @param {Object} bankAccount - Bank account details
   * @returns {Promise<Object>} Validation result
   */
  async validateNigerianBankAccount(bankAccount) {
    try {
      const { accountNumber, bankCode, accountName } = bankAccount;

      if (!accountNumber || !bankCode) {
        return {
          valid: false,
          message: 'Account number and bank code are required for NGN withdrawals'
        };
      }

      // Verify account with Paystack
      const response = await this.paystackClient.get(
        `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
      );

      if (response.data.status && response.data.data) {
        return {
          valid: true,
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number
        };
      } else {
        return {
          valid: false,
          message: 'Invalid Nigerian bank account details'
        };
      }
    } catch (error) {
      console.error('[Bank Validation] Paystack error:', error);
      return {
        valid: false,
        message: 'Unable to verify Nigerian bank account'
      };
    }
  }

  /**
   * Validate international bank account for Stripe
   * @param {Object} bankAccount - Bank account details
   * @returns {Object} Validation result
   */
  validateInternationalBankAccount(bankAccount) {
    const { accountNumber, routingNumber, country, currency } = bankAccount;

    if (!accountNumber || !routingNumber || !country) {
      return {
        valid: false,
        message: 'Account number, routing number, and country are required for USD withdrawals'
      };
    }

    // Basic validation for US accounts
    if (country === 'US') {
      if (!/^\d{9}$/.test(routingNumber)) {
        return {
          valid: false,
          message: 'Invalid US routing number format'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Create Paystack transfer recipient
   * @param {Object} bankAccount - Bank account details
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Recipient creation result
   */
  async createPaystackRecipient(bankAccount, userId) {
    try {
      const recipientData = {
        type: 'nuban',
        name: bankAccount.accountName || `User ${userId}`,
        account_number: bankAccount.accountNumber,
        bank_code: bankAccount.bankCode,
        currency: 'NGN'
      };

      const response = await this.paystackClient.post('/transferrecipient', recipientData);

      if (response.data.status && response.data.data) {
        return {
          success: true,
          recipientCode: response.data.data.recipient_code,
          recipientId: response.data.data.id
        };
      } else {
        return {
          success: false,
          message: response.data.message || 'Failed to create Paystack recipient',
          error: 'recipient_creation_failed'
        };
      }
    } catch (error) {
      console.error('[Paystack Recipient] Creation error:', error);
      return {
        success: false,
        message: this.parsePaystackError(error),
        error: 'paystack_recipient_error'
      };
    }
  }

  /**
   * Create Stripe external account (bank account for payouts)
   * @param {Object} bankAccount - Bank account details
   * @param {number} userId - User ID
   * @returns {Promise<Object>} External account creation result
   */
  async createStripeExternalAccount(bankAccount, userId) {
    try {
      console.log(`[Stripe External Account] Creating account for user ${userId}`);

      // Determine account type based on provided fields
      let accountData;
      
      if (bankAccount.routingNumber && bankAccount.accountNumber) {
        // US Bank Account
        accountData = {
          object: 'bank_account',
          country: 'US',
          currency: 'usd',
          account_number: bankAccount.accountNumber,
          routing_number: bankAccount.routingNumber,
          account_holder_name: bankAccount.accountHolderName || 'Account Holder',
          account_holder_type: bankAccount.accountType || 'individual'
        };
      } else if (bankAccount.iban) {
        // International Bank Account (IBAN)
        accountData = {
          object: 'bank_account',
          country: bankAccount.country || 'GB',
          currency: 'usd',
          account_number: bankAccount.iban,
          account_holder_name: bankAccount.accountHolderName || 'Account Holder',
          account_holder_type: 'individual'
        };
      } else {
        throw new Error('Invalid bank account details. Provide either US routing/account number or IBAN.');
      }

      // For production, you would create this through Stripe Connect
      // For now, we'll create a direct external account
      const response = await this.stripeClient.post('/accounts', new URLSearchParams({
        type: 'express',
        country: accountData.country,
        email: `user${userId}@example.com`, // In production, use real user email
        capabilities: JSON.stringify({
          transfers: { requested: true }
        })
      }));

      if (response.data && response.data.id) {
        // Add bank account to the created account
        const bankResponse = await this.stripeClient.post(
          `/accounts/${response.data.id}/external_accounts`,
          new URLSearchParams(accountData)
        );

        if (bankResponse.data && bankResponse.data.id) {
          return {
            success: true,
            accountId: response.data.id,
            bankAccountId: bankResponse.data.id,
            message: 'External account created successfully',
            accountDetails: {
              country: accountData.country,
              currency: accountData.currency,
              last4: bankResponse.data.last4 || 'XXXX'
            }
          };
        }
      }

      throw new Error('Failed to create Stripe external account');

    } catch (error) {
      console.error('[Stripe External Account] Creation error:', error);
      
      // Handle specific Stripe errors
      if (error.response?.data?.error) {
        const stripeError = error.response.data.error;
        return {
          success: false,
          message: stripeError.message || 'Failed to create bank account',
          error: 'stripe_account_error',
          code: stripeError.code
        };
      }

      return {
        success: false,
        message: error.message || 'Failed to create external account',
        error: 'stripe_account_error'
      };
    }
  }

  /**
   * Get supported banks for currency
   * @param {string} currency - Currency code
   * @returns {Promise<Array>} List of supported banks
   */
  async getSupportedBanks(currency) {
    try {
      if (currency === 'NGN') {
        const response = await this.paystackClient.get('/bank');
        if (response.data.status && response.data.data) {
          return response.data.data.map(bank => ({
            name: bank.name,
            code: bank.code,
            slug: bank.slug,
            currency: 'NGN'
          }));
        }
      } else if (currency === 'USD') {
        // Stripe doesn't have a "banks list" - it uses direct bank account details
        return {
          message: 'USD withdrawals use direct bank account information',
          supportedMethods: [
            {
              type: 'us_bank_account',
              name: 'US Bank Account',
              description: 'Direct deposit to US bank accounts',
              requiredFields: ['routing_number', 'account_number', 'account_holder_name', 'account_type']
            },
            {
              type: 'international_bank',
              name: 'International Bank Transfer',
              description: 'SWIFT wire transfer to international banks',
              requiredFields: ['iban_or_account_number', 'swift_code', 'account_holder_name', 'bank_name', 'bank_address']
            },
            {
              type: 'debit_card',
              name: 'Instant Payout to Debit Card',
              description: 'Instant transfer to Visa/Mastercard debit cards',
              requiredFields: ['card_number', 'exp_month', 'exp_year', 'cardholder_name'],
              note: 'Available in select countries, instant but with fees'
            }
          ],
          note: 'Choose the method that matches your bank location and preferences'
        };
      }

      return [];
    } catch (error) {
      console.error('[Supported Banks] Error:', error);
      return [];
    }
  }

  /**
   * Parse Paystack error messages
   * @param {Error} error - Error object
   * @returns {string} User-friendly error message
   */
  parsePaystackError(error) {
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    
    if (error.response?.status === 401) {
      return 'Invalid Paystack credentials';
    }
    
    if (error.response?.status === 400) {
      return 'Invalid request to Paystack';
    }
    
    return 'Paystack service error';
  }

  /**
   * Parse Stripe error messages
   * @param {Error} error - Error object
   * @returns {string} User-friendly error message
   */
  parseStripeError(error) {
    if (error.response?.data?.error) {
      const stripeError = error.response.data.error;
      
      // Handle specific Stripe error codes
      switch (stripeError.code) {
        case 'account_invalid':
          return 'Invalid bank account details provided';
        case 'bank_account_declined':
          return 'Bank account was declined by your bank';
        case 'insufficient_funds':
          return 'Insufficient funds in your account';
        case 'invalid_request_error':
          return 'Invalid withdrawal request';
        case 'authentication_required':
          return 'Additional authentication required';
        case 'card_declined':
          return 'Card was declined';
        case 'processing_error':
          return 'Processing error occurred, please try again';
        default:
          return stripeError.message || 'Stripe processing error';
      }
    }
    
    if (error.response?.data?.error?.message) {
      return error.response.data.error.message;
    }
    
    if (error.response?.status === 401) {
      return 'Invalid Stripe credentials';
    }
    
    if (error.response?.status === 400) {
      return 'Invalid request to Stripe';
    }
    
    if (error.response?.status === 402) {
      return 'Payment required or account has insufficient funds';
    }
    
    return error.message || 'Stripe service error';
  }

  /**
   * Get withdrawal processing status
   * @param {string} reference - Withdrawal reference
   * @param {string} currency - Currency code
   * @returns {Promise<Object>} Status result
   */
  async getWithdrawalStatus(reference, currency) {
    try {
      if (currency === 'NGN') {
        const response = await this.paystackClient.get(`/transfer/${reference}`);
        if (response.data.status && response.data.data) {
          return {
            success: true,
            status: response.data.data.status,
            gatewayResponse: response.data.data
          };
        }
      } else if (currency === 'USD') {
        // For Stripe, you'd query the payout by ID
        // This is a simplified implementation
        return {
          success: true,
          status: 'pending',
          message: 'USD withdrawal status check not fully implemented'
        };
      }

      return {
        success: false,
        message: 'Unable to check withdrawal status'
      };
    } catch (error) {
      console.error('[Withdrawal Status] Error:', error);
      return {
        success: false,
        message: 'Failed to check withdrawal status',
        error: error.message
      };
    }
  }
}

module.exports = CurrencyWithdrawalService;