const { AuthService } = require('../services/authService');

const authService = new AuthService();

/**
 * Middleware to authenticate requests using JWT tokens
 */
const authenticateToken = async (req, res, next) => {
  const timestamp = new Date().toISOString();
  const endpoint = req.path;
  const method = req.method;

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      console.log('[Auth Middleware] Missing token', {
        endpoint,
        method,
        timestamp,
        code: 'MISSING_TOKEN'
      });

      return res.status(401).json({ 
        error: 'Access token required',
        code: 'MISSING_TOKEN',
        timestamp
      });
    }

    console.log('[Auth Middleware] Token verification attempt', {
      endpoint,
      method,
      timestamp,
      tokenPrefix: token.substring(0, 20) + '...'
    });

    // First try to verify as our JWT token
    let user = authService.verifyToken(token);
    let tokenType = null;
    
    if (user) {
      tokenType = 'API_TOKEN';
      console.log('[Auth Middleware] API token verification successful', {
        endpoint,
        method,
        tokenType,
        userId: user.id,
        email: user.email,
        timestamp
      });
    } else {
      // If that fails, try to verify as Supabase token
      console.log('[Auth Middleware] API token verification failed, trying Supabase token', {
        endpoint,
        method,
        timestamp
      });

      user = await authService.verifySupabaseToken(token);
      
      if (user) {
        tokenType = 'SUPABASE_TOKEN';
        console.log('[Auth Middleware] Supabase token verification successful', {
          endpoint,
          method,
          tokenType,
          userId: user.id,
          email: user.email,
          timestamp
        });
      }
    }

    if (!user) {
      console.error('[Auth Middleware] Token verification failed', {
        endpoint,
        method,
        timestamp,
        code: 'INVALID_TOKEN',
        reason: 'Both API and Supabase token verification failed'
      });

      return res.status(401).json({ 
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
        timestamp
      });
    }

    req.user = user;
    req.tokenType = tokenType; // Store token type for logging
    
    console.log('[Auth Middleware] Authentication successful', {
      endpoint,
      method,
      tokenType,
      userId: user.id,
      timestamp
    });

    next();
  } catch (error) {
    console.error('[Auth Middleware] Authentication error', {
      endpoint,
      method,
      error: error.message,
      stack: error.stack,
      timestamp,
      code: 'AUTH_SERVICE_ERROR'
    });

    res.status(500).json({ 
      error: 'Authentication service error',
      code: 'AUTH_SERVICE_ERROR',
      timestamp
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
  const timestamp = new Date().toISOString();
  const endpoint = req.path;
  const method = req.method;

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.log('[Optional Auth] No token provided', {
        endpoint,
        method,
        timestamp
      });
      next();
      return;
    }

    console.log('[Optional Auth] Token verification attempt', {
      endpoint,
      method,
      timestamp
    });

    // Try to verify token if provided
    let user = authService.verifyToken(token);
    let tokenType = null;
    
    if (user) {
      tokenType = 'API_TOKEN';
      console.log('[Optional Auth] API token verification successful', {
        endpoint,
        method,
        tokenType,
        userId: user.id,
        timestamp
      });
    } else {
      user = await authService.verifySupabaseToken(token);
      
      if (user) {
        tokenType = 'SUPABASE_TOKEN';
        console.log('[Optional Auth] Supabase token verification successful', {
          endpoint,
          method,
          tokenType,
          userId: user.id,
          timestamp
        });
      } else {
        console.log('[Optional Auth] Token verification failed, continuing without auth', {
          endpoint,
          method,
          timestamp
        });
      }
    }

    if (user) {
      req.user = user;
      req.tokenType = tokenType;
    }

    next();
  } catch (error) {
    console.error('[Optional Auth] Error during optional authentication', {
      endpoint,
      method,
      error: error.message,
      timestamp
    });
    // Continue without authentication
    next();
  }
};

module.exports = { authenticateToken, optionalAuth };