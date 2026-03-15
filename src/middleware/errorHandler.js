const ApiError = require('../utils/apiError');
const { logger } = require('../utils/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // 1. Operational errors (ApiError instances)
  if (err && err.isOperational) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: {
        code: statusCode,
        message: err.message,
        errors: err.errors || [],
      },
    });
  }

  // 2. JWT errors
  if (err && (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 401,
        message: 'Invalid or expired token',
      },
    });
  }

  // 3. PostgreSQL unique violation
  if (err && err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: {
        code: 409,
        message: 'Resource already exists',
      },
    });
  }

  // 4. PostgreSQL foreign key violation
  if (err && err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: {
        code: 400,
        message: 'Referenced resource not found',
      },
    });
  }

  // 5. Everything else → log full stack, generic 500
  logger.error('Unhandled error', {
    message: err && err.message,
    stack: err && err.stack,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: 500,
      message: 'Internal server error',
    },
  });
}

module.exports = errorHandler;
