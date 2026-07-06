const { idempotencyService, IdempotencyConflictError } = require('../services/idempotencyService');

/**
 * Idempotency Middleware
 * 
 * Ensures financial operations are idempotent by checking and managing idempotency keys.
 * Should be applied to all financial endpoints (payments, withdrawals, transfers).
 */

/**
 * Middleware to enforce idempotency for financial operations
 * @param {object} options - Configuration options
 * @param {boolean} options.required - Whether idempotency key is required (default: true)
 * @param {string} options.operationType - Type of operation for logging
 */
function idempotencyMiddleware(options = {}) {
  const { required = true, operationType = 'financial_operation' } = options;
  
  return async (req, res, next) => {
    try {
      // Extract idempotency key from headers
      const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
      
      // Check if idempotency key is required
      if (required && !idempotencyKey) {
        return res.status(400).json({
          error: {
            code: 'IDEMPOTENCY_KEY_REQUIRED',
            message: 'Idempotency-Key header is required for this operation',
            details: {
              header: 'Idempotency-Key',
              format: 'UUID v4',
              example: '550e8400-e29b-41d4-a716-446655440000'
            }
          }
        });
      }
      
      // Skip idempotency check if no key provided and not required
      if (!idempotencyKey) {
        return next();
      }
      
      // Validate idempotency key format
      if (!idempotencyService.isValidUUID(idempotencyKey)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_IDEMPOTENCY_KEY',
            message: 'Idempotency key must be a valid UUID v4',
            details: {
              provided: idempotencyKey,
              format: 'UUID v4',
              example: '550e8400-e29b-41d4-a716-446655440000'
            }
          }
        });
      }
      
      // Get user ID from authenticated request
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'User authentication required for idempotent operations'
          }
        });
      }
      
      // Prepare operation data (exclude sensitive fields)
      const operationData = {
        method: req.method,
        path: req.path,
        body: sanitizeOperationData(req.body),
        query: req.query,
        timestamp: new Date().toISOString()
      };
      
      // Check idempotency
      const idempotencyResult = await idempotencyService.checkAndStore(
        idempotencyKey,
        userId,
        operationType,
        operationData
      );
      
      // If operation already exists and completed, return cached result
      if (!idempotencyResult.isNew && idempotencyResult.status === 'completed') {
        console.log(`[Idempotency] Returning cached result for key: ${idempotencyKey}`);
        
        return res.status(200).json({
          ...idempotencyResult.storedResult,
          _idempotency: {
            cached: true,
            key: idempotencyKey,
            originalTimestamp: idempotencyResult.storedResult?.timestamp
          }
        });
      }
      
      // If operation is still processing, return conflict
      if (!idempotencyResult.isNew && idempotencyResult.status === 'processing') {
        return res.status(409).json({
          error: {
            code: 'OPERATION_IN_PROGRESS',
            message: 'Operation with this idempotency key is already in progress',
            details: {
              idempotencyKey,
              status: 'processing',
              suggestion: 'Wait for the operation to complete or use a different idempotency key'
            }
          }
        });
      }
      
      // If operation failed previously, allow retry with same key
      if (!idempotencyResult.isNew && idempotencyResult.status === 'failed') {
        console.log(`[Idempotency] Allowing retry for failed operation: ${idempotencyKey}`);
        // Invalidate the failed key to allow fresh attempt
        await idempotencyService.invalidateKey(idempotencyKey);
      }
      
      // Store idempotency info in request for use by route handlers
      req.idempotency = {
        key: idempotencyKey,
        isNew: idempotencyResult.isNew,
        operationType,
        storeResult: async (result, status = 'completed') => {
          await idempotencyService.storeResult(idempotencyKey, result, status);
        },
        markFailed: async (error) => {
          await idempotencyService.storeResult(idempotencyKey, {
            error: error.message,
            timestamp: new Date().toISOString()
          }, 'failed');
        }
      };
      
      console.log(`[Idempotency] Processing new operation: ${idempotencyKey}`);
      next();
      
    } catch (error) {
      console.error('[Idempotency Middleware] Error:', error);
      
      if (error instanceof IdempotencyConflictError) {
        return res.status(409).json({
          error: {
            code: 'IDEMPOTENCY_CONFLICT',
            message: error.message,
            details: {
              idempotencyKey: req.headers['idempotency-key'],
              suggestion: 'Use a different idempotency key or check operation parameters'
            }
          }
        });
      }
      
      // For other errors, allow the operation to proceed without idempotency
      console.warn('[Idempotency] Proceeding without idempotency due to error:', error.message);
      next();
    }
  };
}

/**
 * Sanitize operation data by removing sensitive fields
 * @param {object} data - Raw operation data
 * @returns {object} Sanitized data
 */
function sanitizeOperationData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'twoFactorCode',
    'otp',
    'pin'
  ];
  
  const sanitized = { ...data };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

/**
 * Express error handler for idempotency-related errors
 */
function idempotencyErrorHandler(error, req, res, next) {
  if (error instanceof IdempotencyConflictError) {
    return res.status(409).json({
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: error.message,
        details: {
          idempotencyKey: req.headers['idempotency-key'],
          timestamp: new Date().toISOString()
        }
      }
    });
  }
  
  next(error);
}

/**
 * Utility function to generate idempotency key for client use
 */
function generateIdempotencyKey() {
  return idempotencyService.generateKey();
}

module.exports = {
  idempotencyMiddleware,
  idempotencyErrorHandler,
  generateIdempotencyKey
};