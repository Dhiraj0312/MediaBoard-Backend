/**
 * Centralized error handling middleware
 */

/**
 * Async error wrapper to catch async route handler errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error handler middleware
 */
const errorHandler = (error, req, res, next) => {
  let err = { ...error };
  err.message = error.message;

  // Log error details
  console.error('API Error:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Mongoose bad ObjectId
  if (error.name === 'CastError') {
    const message = 'Resource not found';
    err = new ApiError(message, 404, 'RESOURCE_NOT_FOUND');
  }

  // Mongoose duplicate key
  if (error.code === 11000) {
    const message = 'Duplicate field value entered';
    err = new ApiError(message, 400, 'DUPLICATE_FIELD');
  }

  // Mongoose validation error
  if (error.name === 'ValidationError') {
    const message = Object.values(error.errors).map(val => val.message).join(', ');
    err = new ApiError(message, 400, 'VALIDATION_ERROR');
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    err = new ApiError(message, 401, 'INVALID_TOKEN');
  }

  if (error.name === 'TokenExpiredError') {
    const message = 'Token expired';
    err = new ApiError(message, 401, 'TOKEN_EXPIRED');
  }

  // Supabase errors
  if (error.code && error.code.startsWith('PGRST')) {
    let message = 'Database error';
    let statusCode = 500;
    let code = 'DATABASE_ERROR';

    switch (error.code) {
      case 'PGRST116':
        message = 'Resource not found';
        statusCode = 404;
        code = 'RESOURCE_NOT_FOUND';
        break;
      case 'PGRST301':
        message = 'Insufficient permissions';
        statusCode = 403;
        code = 'INSUFFICIENT_PERMISSIONS';
        break;
      default:
        message = error.message || 'Database operation failed';
    }

    err = new ApiError(message, statusCode, code);
  }

  // File upload errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    err = new ApiError(message, 400, 'FILE_TOO_LARGE');
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    const message = 'Unexpected file field';
    err = new ApiError(message, 400, 'UNEXPECTED_FILE');
  }

  // Network/timeout errors
  if (error.code === 'ECONNREFUSED') {
    const message = 'Service unavailable';
    err = new ApiError(message, 503, 'SERVICE_UNAVAILABLE');
  }

  if (error.code === 'ETIMEDOUT') {
    const message = 'Request timeout';
    err = new ApiError(message, 408, 'REQUEST_TIMEOUT');
  }

  // Default to 500 server error
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(statusCode).json({
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    code,
    ...(isDevelopment && { 
      stack: err.stack,
      details: err 
    }),
    timestamp: new Date().toISOString()
  });
};

/**
 * 404 handler for undefined routes
 */
const notFound = (req, res, next) => {
  const error = new ApiError(
    `Route ${req.originalUrl} not found`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(error);
};

module.exports = {
  asyncHandler,
  ApiError,
  errorHandler,
  notFound
};