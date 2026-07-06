/**
 * Currency Conversion Service
 * 
 * Handles currency conversion between NGN and USD at a fixed rate.
 * Uses environment variable for easy rate updates without code changes.
 * 
 * Fixed Rate: 1 USD = 1400 NGN (configurable via .env)
 */

class CurrencyConversionService {
  constructor() {
    // Load conversion rate from environment
    this.NGN_TO_USD_RATE = parseFloat(process.env.CURRENCY_CONVERSION_RATE_NGN_TO_USD);
  }

  /**
   * Convert NGN to USD
   * @param {number} ngnAmount - Amount in Nigerian Naira
   * @returns {number} Amount in US Dollars (rounded to 2 decimals)
   */
  convertNgnToUsd(ngnAmount) {
    if (!ngnAmount || ngnAmount <= 0) return 0;
    const usdAmount = ngnAmount / this.NGN_TO_USD_RATE;
    return Math.round(usdAmount * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert USD to NGN
   * @param {number} usdAmount - Amount in US Dollars
   * @returns {number} Amount in Nigerian Naira (rounded to 2 decimals)
   */
  convertUsdToNgn(usdAmount) {
    if (!usdAmount || usdAmount <= 0) return 0;
    const ngnAmount = usdAmount * this.NGN_TO_USD_RATE;
    return Math.round(ngnAmount * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert amount from one currency to another
   * @param {number} amount - Amount to convert
   * @param {string} fromCurrency - Source currency (NGN or USD)
   * @param {string} toCurrency - Target currency (NGN or USD)
   * @returns {number} Converted amount
   */
  convert(amount, fromCurrency, toCurrency) {
    if (!amount || amount <= 0) return 0;

    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    // Same currency, no conversion needed
    if (from === to) return amount;

    // Validate currencies
    if (!['NGN', 'USD'].includes(from) || !['NGN', 'USD'].includes(to)) {
      throw new Error(`Invalid currency. Supported: NGN, USD. Got: ${from} -> ${to}`);
    }

    // Convert
    if (from === 'NGN' && to === 'USD') {
      return this.convertNgnToUsd(amount);
    } else if (from === 'USD' && to === 'NGN') {
      return this.convertUsdToNgn(amount);
    }

    return amount;
  }

  /**
   * Get dual pricing (both NGN and USD) for any amount
   * @param {number} amount - Base amount
   * @param {string} baseCurrency - Base currency (NGN or USD)
   * @returns {Object} Object with both NGN and USD prices
   */
  getDualPricing(amount, baseCurrency) {
    if (!amount || amount <= 0) {
      return {
        base: { amount: 0, currency: baseCurrency.toUpperCase() },
        ngn: 0,
        usd: 0
      };
    }

    const currency = baseCurrency.toUpperCase();
    
    if (currency === 'NGN') {
      return {
        base: { amount: parseFloat(amount), currency: 'NGN' },
        ngn: parseFloat(amount),
        usd: this.convertNgnToUsd(amount)
      };
    } else if (currency === 'USD') {
      return {
        base: { amount: parseFloat(amount), currency: 'USD' },
        ngn: this.convertUsdToNgn(amount),
        usd: parseFloat(amount)
      };
    }

    throw new Error(`Invalid base currency: ${baseCurrency}. Supported: NGN, USD`);
  }

  /**
   * Get current conversion rate
   * @returns {Object} Conversion rate information
   */
  getConversionRate() {
    return {
      rate: this.NGN_TO_USD_RATE,
      description: `1 USD = ${this.NGN_TO_USD_RATE} NGN`,
      inverse: `1 NGN = ${(1 / this.NGN_TO_USD_RATE).toFixed(6)} USD`
    };
  }

  /**
   * Validate currency code
   * @param {string} currency - Currency code to validate
   * @returns {boolean} True if valid
   */
  isValidCurrency(currency) {
    return ['NGN', 'USD'].includes(currency.toUpperCase());
  }

  /**
   * Format amount with currency symbol
   * @param {number} amount - Amount to format
   * @param {string} currency - Currency code
   * @returns {string} Formatted amount with symbol
   */
  formatAmount(amount, currency) {
    const curr = currency.toUpperCase();
    const formatted = parseFloat(amount).toFixed(2);

    if (curr === 'NGN') {
      return `₦${formatted}`;
    } else if (curr === 'USD') {
      return `$${formatted}`;
    }

    return `${formatted} ${curr}`;
  }
}

module.exports = CurrencyConversionService;
