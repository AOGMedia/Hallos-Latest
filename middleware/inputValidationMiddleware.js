const Joi = require('joi');

/**
 * Input Validation Middleware
 * 
 * Provides comprehensive input validation for all financial operations using Joi schemas.
 * Validates amounts, currencies, user inputs, and enforces currency-specific limits.
 */

// Currency-specific amount limits (in smallest currency unit)
const AMOUNT_LIMITS = {
  NGN: {
    min: 100, // ₦1.00 minimum
    max: 50000000, // ₦500,000.00 maximum
    precision: 2
  },
  USD: {
    min: 100, // $1.00 minimum (in cents)
    max: 100000, // $100,000.00 maximum (in cents)
    precision: 2
  }
};

// Supported currencies whitelist
const SUPPORTED_CURRENCIES = ['NGN', 'USD'];

// Base schemas for reusable components
const baseSchemas = {
  currency: Joi.string()
    .valid(...SUPPORTED_CURRENCIES)
    .required()
    .messages({
      'any.only': 'Currency must be one of: {#valids}',
      'any.required': 'Currency is required'
    }),

  amount: Joi.number()
    .positive()
    .precision(2)
    .required()
    .messages({
      'number.positive': 'Amount must be positive',
      'number.precision': 'Amount cannot have more than 2 decimal places',
      'any.required': 'Amount is required'
    }),

  uuid: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.guid': 'Must be a valid UUID',
      'any.required': 'ID is required'
    }),

  idempotencyKey: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.guid': 'Idempotency key must be a valid UUID',
      'any.required': 'Idempotency key is required'
    }),

  twoFactorCode: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.length': 'Two-factor code must be exactly 6 digits',
      'string.pattern.base': 'Two-factor code must contain only numbers',
      'any.required': 'Two-factor authentication code is required'
    }),

  email: Joi.string()
    .email()
    .max(255)
    .required()
    .messages({
      'string.email': 'Must be a valid email address',
      'string.max': 'Email cannot exceed 255 characters',
      'any.required': 'Email is required'
    }),

  phoneNumber: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .optional()
    .messages({
      'string.pattern.base': 'Phone number must be in international format'
    }),

  bankAccountNumber: Joi.string()
    .pattern(/^[0-9]{10,12}$/)
    .required()
    .messages({
      'string.pattern.base': 'Bank account number must be 10-12 digits',
      'any.required': 'Bank account number is required'
    }),

  bankCode: Joi.string()
    .pattern(/^[0-9]{3,6}$/)
    .required()
    .messages({
      'string.pattern.base': 'Bank code must be 3-6 digits',
      'any.required': 'Bank code is required'
    }),

  routingNumber: Joi.string()
    .pattern(/^[0-9]{9}$/)
    .required()
    .messages({
      'string.pattern.base': 'Routing number must be exactly 9 digits',
      'any.required': 'Routing number is required'
    }),

  swiftCode: Joi.string()
    .pattern(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/)
    .optional()
    .messages({
      'string.pattern.base': 'SWIFT code must be in valid format (8 or 11 characters)'
    })
};

// Nigerian bank details schema
const nigerianBankDetailsSchema = Joi.object({
  accountNumber: baseSchemas.bankAccountNumber,
  bankCode: baseSchemas.bankCode,
  accountName: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z\s\-'\.]+$/)
    .required()
    .messages({
      'string.min': 'Account name must be at least 2 characters',
      'string.max': 'Account name cannot exceed 100 characters',
      'string.pattern.base': 'Account name can only contain letters, spaces, hyphens, apostrophes, and periods',
      'any.required': 'Account name is required'
    })
});

// International bank details schema
const internationalBankDetailsSchema = Joi.object({
  accountNumber: Joi.string()
    .min(8)
    .max(34)
    .pattern(/^[A-Z0-9]+$/)
    .required()
    .messages({
      'string.min': 'International account number must be at least 8 characters',
      'string.max': 'International account number cannot exceed 34 characters',
      'string.pattern.base': 'International account number can only contain letters and numbers',
      'any.required': 'Account number is required'
    }),
  routingNumber: baseSchemas.routingNumber,
  swiftCode: baseSchemas.swiftCode,
  accountHolderName: Joi.string()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z\s\-'\.]+$/)
    .required()
    .messages({
      'string.min': 'Account holder name must be at least 2 characters',
      'string.max': 'Account holder name cannot exceed 100 characters',
      'string.pattern.base': 'Account holder name can only contain letters, spaces, hyphens, apostrophes, and periods',
      'any.required': 'Account holder name is required'
    }),
  bankName: Joi.string()
    .min(2)
    .max(100)
    .required()
    .messages({
      'string.min': 'Bank name must be at least 2 characters',
      'string.max': 'Bank name cannot exceed 100 characters',
      'any.required': 'Bank name is required'
    }),
  bankAddress: Joi.string()
    .min(10)
    .max(200)
    .required()
    .messages({
      'string.min': 'Bank address must be at least 10 characters',
      'string.max': 'Bank address cannot exceed 200 characters',
      'any.required': 'Bank address is required'
    })
});

// Financial operation schemas
const schemas = {
  // Payment processing schema
  paymentRequest: Joi.object({
    amount: baseSchemas.amount.custom((value, helpers) => {
      const currency = helpers.state.ancestors[0].currency;
      if (!currency) return value;
      
      const limits = AMOUNT_LIMITS[currency];
      if (!limits) return value;
      
      // Convert to smallest currency unit for validation
      const amountInSmallestUnit = Math.round(value * Math.pow(10, limits.precision));
      
      if (amountInSmallestUnit < limits.min) {
        return helpers.error('amount.min', { 
          min: limits.min / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      if (amountInSmallestUnit > limits.max) {
        return helpers.error('amount.max', { 
          max: limits.max / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      return value;
    }).messages({
      'amount.min': 'Amount must be at least {#min} {#currency}',
      'amount.max': 'Amount cannot exceed {#max} {#currency}'
    }),
    currency: baseSchemas.currency,
    contentId: baseSchemas.uuid,
    buyerId: baseSchemas.uuid,
    creatorId: baseSchemas.uuid,
    idempotencyKey: baseSchemas.idempotencyKey,
    metadata: Joi.object().optional()
  }),

  // Wallet credit/debit schema
  walletOperation: Joi.object({
    amount: baseSchemas.amount.custom((value, helpers) => {
      const currency = helpers.state.ancestors[0].currency;
      if (!currency) return value;
      
      const limits = AMOUNT_LIMITS[currency];
      if (!limits) return value;
      
      const amountInSmallestUnit = Math.round(value * Math.pow(10, limits.precision));
      
      if (amountInSmallestUnit < limits.min) {
        return helpers.error('amount.min', { 
          min: limits.min / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      if (amountInSmallestUnit > limits.max) {
        return helpers.error('amount.max', { 
          max: limits.max / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      return value;
    }).messages({
      'amount.min': 'Amount must be at least {#min} {#currency}',
      'amount.max': 'Amount cannot exceed {#max} {#currency}'
    }),
    currency: baseSchemas.currency,
    userId: baseSchemas.uuid,
    reference: Joi.string()
      .min(3)
      .max(100)
      .pattern(/^[a-zA-Z0-9\-_]+$/)
      .required()
      .messages({
        'string.min': 'Reference must be at least 3 characters',
        'string.max': 'Reference cannot exceed 100 characters',
        'string.pattern.base': 'Reference can only contain letters, numbers, hyphens, and underscores',
        'any.required': 'Transaction reference is required'
      }),
    description: Joi.string()
      .max(500)
      .optional()
      .messages({
        'string.max': 'Description cannot exceed 500 characters'
      }),
    idempotencyKey: baseSchemas.idempotencyKey
  }),

  // Withdrawal request schema
  withdrawalRequest: Joi.object({
    amount: baseSchemas.amount.custom((value, helpers) => {
      const currency = helpers.state.ancestors[0].currency;
      if (!currency) return value;
      
      const limits = AMOUNT_LIMITS[currency];
      if (!limits) return value;
      
      const amountInSmallestUnit = Math.round(value * Math.pow(10, limits.precision));
      
      if (amountInSmallestUnit < limits.min) {
        return helpers.error('amount.min', { 
          min: limits.min / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      if (amountInSmallestUnit > limits.max) {
        return helpers.error('amount.max', { 
          max: limits.max / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      return value;
    }).messages({
      'amount.min': 'Amount must be at least {#min} {#currency}',
      'amount.max': 'Amount cannot exceed {#max} {#currency}'
    }),
    currency: baseSchemas.currency,
    bankDetails: Joi.object().when('currency', {
      is: 'NGN',
      then: nigerianBankDetailsSchema,
      otherwise: internationalBankDetailsSchema
    }),
    twoFactorCode: baseSchemas.twoFactorCode,
    idempotencyKey: baseSchemas.idempotencyKey
  }),

  // Balance query schema
  balanceQuery: Joi.object({
    currency: Joi.string()
      .valid(...SUPPORTED_CURRENCIES)
      .optional()
      .messages({
        'any.only': 'Currency must be one of: {#valids}'
      }),
    includeHistory: Joi.boolean().optional().default(false)
  }),

  // Transaction history query schema
  transactionHistory: Joi.object({
    currency: Joi.string()
      .valid(...SUPPORTED_CURRENCIES)
      .optional()
      .messages({
        'any.only': 'Currency must be one of: {#valids}'
      }),
    startDate: Joi.date()
      .iso()
      .optional()
      .messages({
        'date.format': 'Start date must be in ISO format (YYYY-MM-DD)'
      }),
    endDate: Joi.date()
      .iso()
      .when('startDate', {
        is: Joi.exist(),
        then: Joi.date().min(Joi.ref('startDate')),
        otherwise: Joi.date()
      })
      .optional()
      .messages({
        'date.format': 'End date must be in ISO format (YYYY-MM-DD)',
        'date.min': 'End date must be after start date'
      }),
    operationType: Joi.string()
      .valid('credit', 'debit', 'payment', 'withdrawal', 'transfer')
      .optional()
      .messages({
        'any.only': 'Operation type must be one of: {#valids}'
      }),
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .messages({
        'number.integer': 'Limit must be an integer',
        'number.min': 'Limit must be at least 1',
        'number.max': 'Limit cannot exceed 100'
      }),
    offset: Joi.number()
      .integer()
      .min(0)
      .optional()
      .default(0)
      .messages({
        'number.integer': 'Offset must be an integer',
        'number.min': 'Offset cannot be negative'
      })
  }),

  // Transfer request schema
  transferRequest: Joi.object({
    amount: baseSchemas.amount.custom((value, helpers) => {
      const currency = helpers.state.ancestors[0].currency;
      if (!currency) return value;
      
      const limits = AMOUNT_LIMITS[currency];
      if (!limits) return value;
      
      const amountInSmallestUnit = Math.round(value * Math.pow(10, limits.precision));
      
      if (amountInSmallestUnit < limits.min) {
        return helpers.error('amount.min', { 
          min: limits.min / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      if (amountInSmallestUnit > limits.max) {
        return helpers.error('amount.max', { 
          max: limits.max / Math.pow(10, limits.precision),
          currency 
        });
      }
      
      return value;
    }).messages({
      'amount.min': 'Amount must be at least {#min} {#currency}',
      'amount.max': 'Amount cannot exceed {#max} {#currency}'
    }),
    currency: baseSchemas.currency,
    recipientId: baseSchemas.uuid,
    description: Joi.string()
      .max(500)
      .optional()
      .messages({
        'string.max': 'Description cannot exceed 500 characters'
      }),
    idempotencyKey: baseSchemas.idempotencyKey
  })
};

/**
 * Create validation middleware for a specific schema
 * @param {string} schemaName - Name of the schema to use
 * @param {string} source - Where to find the data ('body', 'query', 'params')
 * @param {object} options - Validation options
 */
function createValidationMiddleware(schemaName, source = 'body', options = {}) {
  const { 
    allowUnknown = false, 
    stripUnknown = true,
    abortEarly = false 
  } = options;

  return (req, res, next) => {
    const schema = schemas[schemaName];
    
    if (!schema) {
      console.error(`[Input Validation] Schema '${schemaName}' not found`);
      return res.status(500).json({
        error: {
          code: 'VALIDATION_SCHEMA_ERROR',
          message: 'Internal validation configuration error'
        }
      });
    }

    const dataToValidate = req[source];
    
    const { error, value } = schema.validate(dataToValidate, {
      allowUnknown,
      stripUnknown,
      abortEarly
    });

    if (error) {
      console.log(`[Input Validation] Validation failed for ${schemaName}:`, error.details);
      
      const validationErrors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
        type: detail.type
      }));

      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          details: {
            errors: validationErrors,
            schema: schemaName,
            source: source
          }
        }
      });
    }

    // Replace the original data with validated and sanitized data
    req[source] = value;
    
    console.log(`[Input Validation] Validation passed for ${schemaName}`);
    next();
  };
}

/**
 * Sanitize string inputs to prevent injection attacks
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove potentially dangerous characters and patterns
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .replace(/script/gi, '') // Remove script tags
    .replace(/drop\s+table/gi, '') // Remove SQL DROP TABLE
    .replace(/delete\s+from/gi, '') // Remove SQL DELETE
    .replace(/insert\s+into/gi, '') // Remove SQL INSERT
    .replace(/update\s+set/gi, '') // Remove SQL UPDATE
    .replace(/union\s+select/gi, '') // Remove SQL UNION
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove SQL block comments start
    .replace(/\*\//g, '') // Remove SQL block comments end
    .trim();
}

/**
 * Recursive sanitization for objects
 * @param {any} obj - Object to sanitize
 * @returns {any} Sanitized object
 */
function sanitizeObject(obj) {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[sanitizeString(key)] = sanitizeObject(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * General sanitization middleware
 */
function sanitizationMiddleware(req, res, next) {
  try {
    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    
    // Sanitize query parameters - must mutate in-place (Express 5 req.query is a getter)
    if (req.query) {
      const sanitizedQuery = sanitizeObject(req.query);
      Object.keys(req.query).forEach(key => delete req.query[key]);
      Object.assign(req.query, sanitizedQuery);
    }
    
    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }
    
    next();
  } catch (error) {
    console.error('[Sanitization] Error during sanitization:', error);
    return res.status(400).json({
      error: {
        code: 'SANITIZATION_ERROR',
        message: 'Input sanitization failed'
      }
    });
  }
}

/**
 * Validation error handler
 */
function validationErrorHandler(error, req, res, next) {
  if (error.isJoi) {
    const validationErrors = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value,
      type: detail.type
    }));

    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Input validation failed',
        details: {
          errors: validationErrors
        }
      }
    });
  }
  
  next(error);
}

// Export validation middleware functions for different operations
const validationMiddleware = {
  // Payment operations
  validatePaymentRequest: createValidationMiddleware('paymentRequest'),
  
  // Wallet operations
  validateWalletOperation: createValidationMiddleware('walletOperation'),
  
  // Withdrawal operations
  validateWithdrawalRequest: createValidationMiddleware('withdrawalRequest'),
  
  // Query operations
  validateBalanceQuery: createValidationMiddleware('balanceQuery', 'query'),
  validateTransactionHistory: createValidationMiddleware('transactionHistory', 'query'),
  
  // Transfer operations
  validateTransferRequest: createValidationMiddleware('transferRequest'),
  
  // General middleware
  sanitization: sanitizationMiddleware,
  errorHandler: validationErrorHandler,
  
  // Utility functions
  createCustomValidation: createValidationMiddleware,
  sanitizeString,
  sanitizeObject,
  
  // Schema access for testing
  schemas,
  baseSchemas,
  AMOUNT_LIMITS,
  SUPPORTED_CURRENCIES
};

module.exports = validationMiddleware;