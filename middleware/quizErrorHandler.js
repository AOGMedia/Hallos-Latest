/**
 * Quiz Error Handler Middleware
 * 
 * Provides consistent error response format for quiz platform endpoints
 * Handles various error types with appropriate HTTP status codes
 */

/**
 * Error handler middleware
 * Should be added after all quiz routes
 */
const quizErrorHandler = (err, req, res, next) => {
  console.error('[Quiz Error Handler]', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Default error response
  let statusCode = 500;
  let message = 'Internal server error';
  let errorType = 'ServerError';

  // Validation errors (400)
  if (err.name === 'ValidationError' || err.name === 'SequelizeValidationError') {
    statusCode = 400;
    message = err.message || 'Validation error';
    errorType = 'ValidationError';
  }

  // Authentication errors (401)
  if (err.name === 'UnauthorizedError' || err.message.includes('authentication') || err.message.includes('token')) {
    statusCode = 401;
    message = 'Authentication required';
    errorType = 'AuthenticationError';
  }

  // Authorization errors (403)
  if (err.message.includes('permission') || err.message.includes('forbidden') || err.message.includes('admin')) {
    statusCode = 403;
    message = 'Insufficient permissions';
    errorType = 'AuthorizationError';
  }

  // Not found errors (404)
  if (err.message.includes('not found') || err.name === 'NotFoundError') {
    statusCode = 404;
    message = err.message || 'Resource not found';
    errorType = 'NotFoundError';
  }

  // Business logic errors (422)
  if (
    err.message.includes('Insufficient balance') ||
    err.message.includes('already registered') ||
    err.message.includes('deadline') ||
    err.message.includes('expired') ||
    err.message.includes('full') ||
    err.message.includes('minimum') ||
    err.message.includes('maximum')
  ) {
    statusCode = 422;
    message = err.message;
    errorType = 'BusinessLogicError';
  }

  // Rate limiting errors (429)
  if (err.name === 'TooManyRequestsError' || err.message.includes('rate limit')) {
    statusCode = 429;
    message = 'Too many requests. Please try again later.';
    errorType = 'RateLimitError';
  }

  // Multer file upload errors
  if (err.name === 'MulterError') {
    statusCode = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File too large. Maximum size is 5MB.';
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field.';
    } else {
      message = 'File upload error.';
    }
    errorType = 'FileUploadError';
  }

  // Database errors
  if (err.name === 'SequelizeDatabaseError' || err.name === 'SequelizeConnectionError') {
    statusCode = 500;
    message = 'Database error occurred';
    errorType = 'DatabaseError';
  }

  // Unique constraint errors
  if (err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 409;
    message = 'Resource already exists';
    errorType = 'ConflictError';
  }

  // Foreign key constraint errors
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    statusCode = 400;
    message = 'Invalid reference to related resource';
    errorType = 'ForeignKeyError';
  }

  // Send error response
  return res.status(statusCode).json({
    success: false,
    error: {
      type: errorType,
      message,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err.errors || err.details
      })
    }
  });
};

module.exports = quizErrorHandler;
