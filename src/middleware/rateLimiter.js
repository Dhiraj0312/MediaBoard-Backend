/**
 * Simple in-memory rate limiting middleware
 * For production, consider using Redis-based rate limiting
 */

const rateLimitStore = new Map();

/**
 * EMERGENCY: Clear all rate limit cache
 */
const clearRateLimitCache = () => {
  rateLimitStore.clear();
  console.log('🧹 Rate limit cache cleared');
};

/**
 * Clean up old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.resetTime > 0) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

/**
 * Rate limiting middleware factory
 */
const createRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // limit each IP to 100 requests per windowMs
    message = 'Too many requests, please try again later',
    statusCode = 429,
    keyGenerator = (req) => req.ip,
    skip = () => false,
    onLimitReached = () => {}
  } = options;

  return (req, res, next) => {
    // DEVELOPMENT MODE: Skip rate limiting entirely if in development
    if (process.env.NODE_ENV === 'development' || process.env.DISABLE_RATE_LIMITING === 'true') {
      console.log('🚫 Rate limiting disabled for development');
      return next();
    }
    
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    
    let hitData = rateLimitStore.get(key);
    
    if (!hitData) {
      hitData = {
        count: 0,
        resetTime: now + windowMs
      };
    }
    
    // Reset if window has passed
    if (now > hitData.resetTime) {
      hitData = {
        count: 0,
        resetTime: now + windowMs
      };
    }
    
    hitData.count++;
    rateLimitStore.set(key, hitData);
    
    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': max,
      'X-RateLimit-Remaining': Math.max(0, max - hitData.count),
      'X-RateLimit-Reset': new Date(hitData.resetTime).toISOString()
    });
    
    if (hitData.count > max) {
      onLimitReached(req, res);
      return res.status(statusCode).json({
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((hitData.resetTime - now) / 1000)
      });
    }
    
    next();
  };
};

/**
 * Predefined rate limiters
 */

// General API rate limiter - EXTREMELY LENIENT for development
const apiLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10000, // Extremely high limit to prevent any blocking
  message: 'Too many API requests, please try again later'
});

// Strict rate limiter for auth endpoints
const authLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // More lenient for development
  message: 'Too many authentication attempts, please try again later',
  keyGenerator: (req) => `auth:${req.ip}:${req.body.email || 'unknown'}`
});

// Media upload rate limiter - EXTREMELY LENIENT for development
const uploadLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50000, // Extremely high limit
  message: 'Too many upload requests, please try again later'
});

// Player heartbeat rate limiter (more lenient)
const heartbeatLimiter = createRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 2000, // Very lenient
  message: 'Too many heartbeat requests',
  keyGenerator: (req) => `heartbeat:${req.params.deviceCode}`
});

// Dashboard rate limiter - EXTREMELY LENIENT during development
const dashboardLimiter = createRateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 5000, // Extremely high limit
  message: 'Too many dashboard requests, please try again later'
});

module.exports = {
  createRateLimit,
  apiLimiter,
  authLimiter,
  uploadLimiter,
  heartbeatLimiter,
  dashboardLimiter,
  clearRateLimitCache
};