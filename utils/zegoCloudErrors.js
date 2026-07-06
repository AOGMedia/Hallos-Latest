/**
 * ZegoCloud Error Handling Utilities
 * Provides structured error handling for ZegoCloud operations
 */

/**
 * Custom error class for ZegoCloud operations
 */
class ZegoCloudError extends Error {
  constructor(message, code, details = {}, statusCode = 500) {
    super(message);
    this.name = 'ZegoCloudError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZegoCloudError);
    }
  }

  /**
   * Convert error to JSON format for API responses
   * @returns {Object} JSON representation of error
   */
  toJSON() {
    return {
      success: false,
      error: {
        name: this.name,
        message: this.message,
        code: this.code,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }

  /**
   * Get HTTP status code for this error
   * @returns {number} HTTP status code
   */
  getStatusCode() {
    return this.statusCode;
  }
}

/**
 * Predefined error codes and messages
 */
const ERROR_CODES = {
  // Room management errors
  ROOM_CREATION_FAILED: {
    message: 'Failed to create ZegoCloud room',
    statusCode: 500
  },
  ROOM_NOT_FOUND: {
    message: 'ZegoCloud room not found',
    statusCode: 404
  },
  ROOM_ALREADY_EXISTS: {
    message: 'Room already exists for this live class',
    statusCode: 409
  },
  ROOM_DELETION_FAILED: {
    message: 'Failed to delete ZegoCloud room',
    statusCode: 500
  },

  // Token and authentication errors
  TOKEN_GENERATION_FAILED: {
    message: 'Failed to generate access token',
    statusCode: 500
  },
  INVALID_TOKEN: {
    message: 'Invalid or expired access token',
    statusCode: 401
  },
  TOKEN_EXPIRED: {
    message: 'Access token has expired',
    statusCode: 401
  },

  // Participant management errors
  PARTICIPANT_ADD_FAILED: {
    message: 'Failed to add participant to room',
    statusCode: 500
  },
  PARTICIPANT_REMOVE_FAILED: {
    message: 'Failed to remove participant from room',
    statusCode: 500
  },
  PARTICIPANT_LIMIT_EXCEEDED: {
    message: 'Room has reached maximum participant limit',
    statusCode: 429
  },
  PARTICIPANT_NOT_FOUND: {
    message: 'Participant not found in room',
    statusCode: 404
  },

  // Access control errors
  ACCESS_DENIED: {
    message: 'Access denied to live class',
    statusCode: 403
  },
  PAYMENT_REQUIRED: {
    message: 'Payment required to access this live class',
    statusCode: 402
  },
  INVITATION_REQUIRED: {
    message: 'Invitation code required for private live class',
    statusCode: 403
  },
  INVALID_INVITATION: {
    message: 'Invalid invitation code',
    statusCode: 403
  },

  // Session management errors
  SESSION_START_FAILED: {
    message: 'Failed to start live session',
    statusCode: 500
  },
  SESSION_END_FAILED: {
    message: 'Failed to end live session',
    statusCode: 500
  },
  DUPLICATE_SESSION: {
    message: 'Creator already has an active live session',
    statusCode: 409
  },
  SESSION_NOT_ACTIVE: {
    message: 'Live session is not currently active',
    statusCode: 400
  },

  // Configuration errors
  INVALID_CONFIGURATION: {
    message: 'Invalid ZegoCloud configuration',
    statusCode: 500
  },
  MISSING_CREDENTIALS: {
    message: 'ZegoCloud credentials not configured',
    statusCode: 500
  },

  // Database errors
  DATABASE_ERROR: {
    message: 'Database operation failed',
    statusCode: 500
  },
  DATABASE_SYNC_FAILED: {
    message: 'Failed to sync room status with database',
    statusCode: 500
  },

  // Validation errors
  INVALID_INPUT: {
    message: 'Invalid input parameters',
    statusCode: 400
  },
  MISSING_REQUIRED_FIELD: {
    message: 'Required field is missing',
    statusCode: 400
  },

  // General errors
  INTERNAL_ERROR: {
    message: 'Internal server error',
    statusCode: 500
  },
  SERVICE_UNAVAILABLE: {
    message: 'ZegoCloud service is temporarily unavailable',
    statusCode: 503
  }
};

/**
 * Create a ZegoCloudError with predefined error code
 * @param {string} code - Error code from ERROR_CODES
 * @param {Object} details - Additional error details
 * @param {string} customMessage - Custom error message (optional)
 * @returns {ZegoCloudError} Structured error instance
 */
const createError = (code, details = {}, customMessage = null) => {
  const errorConfig = ERROR_CODES[code];
  if (!errorConfig) {
    return new ZegoCloudError(
      customMessage || 'Unknown error occurred',
      'UNKNOWN_ERROR',
      { originalCode: code, ...details },
      500
    );
  }

  return new ZegoCloudError(
    customMessage || errorConfig.message,
    code,
    details,
    errorConfig.statusCode
  );
};

/**
 * Wrap async functions with error handling
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function with error handling
 */
const withErrorHandling = (fn) => {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      // If it's already a ZegoCloudError, re-throw it
      if (error instanceof ZegoCloudError) {
        throw error;
      }

      // Convert generic errors to ZegoCloudError
      console.error('Unexpected error in ZegoCloud operation:', error);
      throw createError('INTERNAL_ERROR', {
        originalError: error.message,
        stack: error.stack
      });
    }
  };
};

/**
 * Express middleware for handling ZegoCloud errors
 * @param {Error} error - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (error, req, res, next) => {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  // Handle ZegoCloudError
  if (error instanceof ZegoCloudError) {
    console.error(`ZegoCloud Error [${error.code}]:`, error.message, error.details);
    
    return res.status(error.getStatusCode()).json(error.toJSON());
  }

  // Handle other errors
  console.error('Unhandled error in ZegoCloud endpoint:', error);
  
  const genericError = createError('INTERNAL_ERROR', {
    originalError: error.message
  });
  
  return res.status(genericError.getStatusCode()).json(genericError.toJSON());
};

/**
 * Validate required fields in request
 * @param {Object} data - Data object to validate
 * @param {Array} requiredFields - Array of required field names
 * @throws {ZegoCloudError} If validation fails
 */
const validateRequiredFields = (data, requiredFields) => {
  const missingFields = [];
  
  for (const field of requiredFields) {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      missingFields.push(field);
    }
  }
  
  if (missingFields.length > 0) {
    throw createError('MISSING_REQUIRED_FIELD', {
      missingFields,
      providedFields: Object.keys(data)
    }, `Missing required fields: ${missingFields.join(', ')}`);
  }
};

/**
 * Validate user permissions for live class operations
 * @param {Object} liveClass - Live class instance
 * @param {number} userId - User ID
 * @param {string} operation - Operation being performed
 * @throws {ZegoCloudError} If access denied
 */
const validateUserPermissions = (liveClass, userId, operation) => {
  const creatorOnlyOperations = ['create_room', 'end_room', 'remove_participant', 'get_invitation'];
  
  if (creatorOnlyOperations.includes(operation) && liveClass.userId !== userId) {
    throw createError('ACCESS_DENIED', {
      operation,
      userId,
      creatorId: liveClass.userId,
      liveClassId: liveClass.id
    }, `Only the creator can perform ${operation} operation`);
  }
};

/**
 * Log ZegoCloud operations for monitoring and debugging
 * @param {string} operation - Operation name
 * @param {Object} data - Operation data
 * @param {string} level - Log level (info, warn, error)
 */
const logOperation = (operation, data, level = 'info') => {
  const logData = {
    timestamp: new Date().toISOString(),
    operation,
    data,
    service: 'zegocloud'
  };

  switch (level) {
    case 'error':
      console.error(`[ZegoCloud Error] ${operation}:`, logData);
      break;
    case 'warn':
      console.warn(`[ZegoCloud Warning] ${operation}:`, logData);
      break;
    default:
      console.log(`[ZegoCloud Info] ${operation}:`, logData);
  }
};

module.exports = {
  ZegoCloudError,
  ERROR_CODES,
  createError,
  withErrorHandling,
  errorHandler,
  validateRequiredFields,
  validateUserPermissions,
  logOperation
};