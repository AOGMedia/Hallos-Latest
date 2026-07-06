/**
 * Course Pricing Service
 * 
 * Handles all course pricing logic including:
 * - Individual course pricing
 * - Monthly all-access pricing
 * - Yearly all-access pricing
 * - Coupon validation and discount application
 * - Expiry date calculation
 * 
 * Pricing is configured via environment variables for easy updates
 */

class CoursePricingService {
  constructor() {
    // Load pricing from environment variables
    this.PRICES = {
      individual: {
        NGN: parseInt(process.env.COURSE_PRICE_INDIVIDUAL_NGN) || 25000,
        USD: parseInt(process.env.COURSE_PRICE_INDIVIDUAL_USD) || 30
      },
      monthly: {
        NGN: parseInt(process.env.COURSE_PRICE_MONTHLY_NGN) || 35000,
        USD: parseInt(process.env.COURSE_PRICE_MONTHLY_USD) || 42
      },
      yearly: {
        NGN: parseInt(process.env.COURSE_PRICE_YEARLY_NGN) || 280000,
        USD: parseInt(process.env.COURSE_PRICE_YEARLY_USD) || 336
      }
    };

    this.PROMO_PRICES = {
      individual: {
        NGN: parseInt(process.env.PROMO_PRICE_INDIVIDUAL_NGN) || 20000,
        USD: parseInt(process.env.PROMO_PRICE_INDIVIDUAL_USD) || 24
      },
      monthly: {
        NGN: parseInt(process.env.PROMO_PRICE_MONTHLY_NGN) || 25000,
        USD: parseInt(process.env.PROMO_PRICE_MONTHLY_USD) || 30
      },
      yearly: {
        NGN: parseInt(process.env.PROMO_PRICE_YEARLY_NGN) || 250000,
        USD: parseInt(process.env.PROMO_PRICE_YEARLY_USD) || 300
      }
    };

    // Coupon configuration
    this.COUPON_CODE = process.env.VALENTINE_PROMO_CODE || 'VALENTINE2025';
    this.COUPON_END_DATE = new Date(process.env.VALENTINE_PROMO_END || '2025-02-28T23:59:59');
  }

  /**
   * Get price for access type and currency
   * @param {string} accessType - 'individual', 'monthly', or 'yearly'
   * @param {string} currency - 'NGN' or 'USD'
   * @param {string} couponCode - Optional coupon code
   * @returns {number} Price amount
   */
  getPrice(accessType, currency, couponCode = null) {
    // Validate access type
    if (!['individual', 'monthly', 'yearly'].includes(accessType)) {
      throw new Error(`Invalid access type: ${accessType}`);
    }

    // Validate currency
    const currencyUpper = currency.toUpperCase();
    if (!['NGN', 'USD'].includes(currencyUpper)) {
      throw new Error(`Invalid currency: ${currency}`);
    }

    // Check if coupon is valid
    if (couponCode && this.isValidCoupon(couponCode)) {
      return this.PROMO_PRICES[accessType][currencyUpper];
    }

    return this.PRICES[accessType][currencyUpper];
  }

  /**
   * Validate coupon code
   * @param {string} code - Coupon code to validate
   * @returns {boolean} True if valid
   */
  isValidCoupon(code) {
    if (!code) return false;

    // Case-insensitive comparison
    const codeUpper = code.toString().trim().toUpperCase();
    const validCodeUpper = this.COUPON_CODE.toUpperCase();

    // Check code matches
    if (codeUpper !== validCodeUpper) {
      return false;
    }

    // Check promo hasn't expired
    const now = new Date();
    if (now > this.COUPON_END_DATE) {
      return false;
    }

    return true;
  }

  /**
   * Calculate discount information
   * @param {string} accessType - 'individual', 'monthly', or 'yearly'
   * @param {string} currency - 'NGN' or 'USD'
   * @param {string} couponCode - Optional coupon code
   * @returns {Object} Discount details
   */
  calculateDiscount(accessType, currency, couponCode = null) {
    const currencyUpper = currency.toUpperCase();
    const regularPrice = this.PRICES[accessType][currencyUpper];
    const promoPrice = this.PROMO_PRICES[accessType][currencyUpper];

    const isValid = couponCode && this.isValidCoupon(couponCode);
    const finalPrice = isValid ? promoPrice : regularPrice;
    const savings = isValid ? regularPrice - promoPrice : 0;
    const percentage = isValid ? ((savings / regularPrice) * 100).toFixed(2) : 0;

    return {
      accessType,
      currency: currencyUpper,
      regularPrice,
      promoPrice,
      finalPrice,
      savings,
      discountPercentage: parseFloat(percentage),
      couponApplied: isValid,
      couponCode: isValid ? couponCode : null
    };
  }

  /**
   * Calculate expiry date based on access type
   * @param {string} accessType - 'individual', 'monthly', or 'yearly'
   * @returns {Date|null} Expiry date or null for individual
   */
  calculateExpiryDate(accessType) {
    const now = new Date();

    if (accessType === 'monthly') {
      // Add 1 month
      const expiry = new Date(now);
      expiry.setMonth(expiry.getMonth() + 1);
      return expiry;
    } else if (accessType === 'yearly') {
      // Add 1 year
      const expiry = new Date(now);
      expiry.setFullYear(expiry.getFullYear() + 1);
      return expiry;
    }

    // Individual courses don't expire
    return null;
  }

  /**
   * Get pricing summary for all access types
   * @param {string} currency - 'NGN' or 'USD'
   * @param {string} couponCode - Optional coupon code
   * @returns {Object} Pricing summary
   */
  getPricingSummary(currency, couponCode = null) {
    const currencyUpper = currency.toUpperCase();
    const isCouponValid = couponCode && this.isValidCoupon(couponCode);

    return {
      currency: currencyUpper,
      couponValid: isCouponValid,
      couponCode: isCouponValid ? couponCode : null,
      couponExpiresAt: this.COUPON_END_DATE,
      pricing: {
        individual: this.calculateDiscount('individual', currencyUpper, couponCode),
        monthly: this.calculateDiscount('monthly', currencyUpper, couponCode),
        yearly: this.calculateDiscount('yearly', currencyUpper, couponCode)
      }
    };
  }

  /**
   * Validate purchase request
   * @param {Object} params - Purchase parameters
   * @returns {Object} Validation result
   */
  validatePurchaseRequest(params) {
    const { accessType, courseId, currency, couponCode } = params;
    const errors = [];

    // Validate access type
    if (!accessType || !['individual', 'monthly', 'yearly'].includes(accessType)) {
      errors.push('Invalid access type. Must be: individual, monthly, or yearly');
    }

    // Validate courseId for individual purchases
    if (accessType === 'individual' && !courseId) {
      errors.push('Course ID is required for individual course purchases');
    }

    // Validate courseId should NOT be provided for monthly/yearly
    if (['monthly', 'yearly'].includes(accessType) && courseId) {
      errors.push('Course ID should not be provided for monthly/yearly access');
    }

    // Validate currency
    if (!currency || !['NGN', 'USD'].includes(currency.toUpperCase())) {
      errors.push('Invalid currency. Must be: NGN or USD');
    }

    // Validate coupon if provided
    if (couponCode && !this.isValidCoupon(couponCode)) {
      errors.push('Invalid or expired coupon code');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get access type description
   * @param {string} accessType - 'individual', 'monthly', or 'yearly'
   * @returns {string} Human-readable description
   */
  getAccessTypeDescription(accessType) {
    const descriptions = {
      individual: 'Individual Course Access',
      monthly: 'Monthly All-Access Pass (30 days)',
      yearly: 'Yearly All-Access Pass (365 days)'
    };
    return descriptions[accessType] || accessType;
  }

  /**
   * Get service configuration
   * @returns {Object} Configuration details
   */
  getConfiguration() {
    return {
      prices: this.PRICES,
      promoprices: this.PROMO_PRICES,
      coupon: {
        code: this.COUPON_CODE,
        expiresAt: this.COUPON_END_DATE,
        isActive: new Date() <= this.COUPON_END_DATE
      }
    };
  }
}

module.exports = CoursePricingService;
