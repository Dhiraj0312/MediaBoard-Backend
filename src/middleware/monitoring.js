const { monitoringService } = require('../services/monitoringService');

/**
 * Middleware to track API requests and performance
 */
const requestMonitoring = (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;

  // Extract user ID from request if available
  const userId = req.user?.id || null;

  // Override res.send to capture response
  res.send = function(data) {
    recordMetrics.call(this, data);
    return originalSend.call(this, data);
  };

  // Override res.json to capture response
  res.json = function(data) {
    recordMetrics.call(this, data);
    return originalJson.call(this, data);
  };

  function recordMetrics(data) {
    const responseTime = Date.now() - startTime;
    const endpoint = getEndpointPattern(req.route?.path || req.path);
    const method = req.method;
    const statusCode = res.statusCode;

    // Record the request metrics
    monitoringService.recordRequest(endpoint, method, statusCode, responseTime, userId);

    // Log slow requests
    if (responseTime > 5000) {
      console.warn(`🐌 Slow request: ${method} ${endpoint} - ${responseTime}ms`);
    }

    // Log errors
    if (statusCode >= 400) {
      const errorContext = {
        endpoint,
        method,
        statusCode,
        responseTime,
        userId,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        body: req.body,
        query: req.query,
        params: req.params
      };

      // Create error object based on response
      let error;
      if (typeof data === 'object' && data.error) {
        error = new Error(data.error);
        error.name = data.code || 'APIError';
      } else {
        error = new Error(`HTTP ${statusCode} Error`);
        error.name = 'HTTPError';
      }

      monitoringService.recordError(error, errorContext);
    }
  }

  next();
};

/**
 * Get standardized endpoint pattern for metrics
 */
function getEndpointPattern(path) {
  if (!path) return 'unknown';
  
  // Replace dynamic segments with placeholders
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id') // UUIDs
    .replace(/\/\d+/g, '/:id') // Numeric IDs
    .replace(/\/[a-zA-Z0-9]{8,}/g, '/:code') // Device codes, etc.
    .toLowerCase();
}

/**
 * Error handling middleware that records errors
 */
const errorMonitoring = (error, req, res, next) => {
  const context = {
    endpoint: getEndpointPattern(req.route?.path || req.path),
    method: req.method,
    userId: req.user?.id || null,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    body: req.body,
    query: req.query,
    params: req.params,
    stack: error.stack
  };

  // Record the error
  monitoringService.recordError(error, context);

  // Continue with normal error handling
  next(error);
};

/**
 * Health check middleware for monitoring endpoints
 */
const healthCheckMiddleware = async (req, res, next) => {
  try {
    const healthCheck = await monitoringService.performHealthCheck();
    req.healthCheck = healthCheck;
    next();
  } catch (error) {
    monitoringService.recordError(error, { context: 'health_check_middleware' });
    req.healthCheck = {
      timestamp: new Date().toISOString(),
      overall: 'error',
      error: error.message
    };
    next();
  }
};

/**
 * Metrics collection middleware
 */
const metricsMiddleware = async (req, res, next) => {
  try {
    const metrics = await monitoringService.getCurrentMetrics();
    req.metrics = metrics;
    next();
  } catch (error) {
    monitoringService.recordError(error, { context: 'metrics_middleware' });
    req.metrics = {
      error: error.message,
      timestamp: new Date().toISOString()
    };
    next();
  }
};

/**
 * System status middleware
 */
const systemStatusMiddleware = (req, res, next) => {
  try {
    const stats = monitoringService.getStats();
    req.systemStatus = {
      ...stats,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };
    next();
  } catch (error) {
    monitoringService.recordError(error, { context: 'system_status_middleware' });
    req.systemStatus = {
      error: error.message,
      timestamp: new Date().toISOString()
    };
    next();
  }
};

/**
 * Performance monitoring decorator for functions
 */
function monitorPerformance(name) {
  return function(target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args) {
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        // Record performance metric
        console.log(`⚡ ${name} completed in ${duration}ms`);
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        // Record error with performance context
        monitoringService.recordError(error, {
          context: 'performance_monitoring',
          function: name,
          duration,
          args: args.length
        });
        
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Async wrapper for monitoring function performance
 */
function monitorAsync(name, fn) {
  return async function(...args) {
    const startTime = Date.now();
    
    try {
      const result = await fn.apply(this, args);
      const duration = Date.now() - startTime;
      
      if (duration > 1000) {
        console.log(`⚡ ${name} completed in ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      monitoringService.recordError(error, {
        context: 'async_monitoring',
        function: name,
        duration,
        args: args.length
      });
      
      throw error;
    }
  };
}

module.exports = {
  requestMonitoring,
  errorMonitoring,
  healthCheckMiddleware,
  metricsMiddleware,
  systemStatusMiddleware,
  monitorPerformance,
  monitorAsync,
  getEndpointPattern
}