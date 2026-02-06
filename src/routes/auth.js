const express = require('express');
const { AuthService } = require('../services/authService');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { validateLogin } = require('../middleware/validation');

const router = express.Router();
const authService = new AuthService();

/**
 * POST /auth/login
 * Exchange Supabase token for API JWT token
 */
router.post('/login', validateLogin, asyncHandler(async (req, res) => {
  const { token } = req.body;

  // Verify Supabase token
  const user = await authService.verifySupabaseToken(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired Supabase token',
      code: 'INVALID_SUPABASE_TOKEN'
    });
  }

  // Create or update user profile
  const profileCreated = await authService.createOrUpdateProfile(user);
  if (!profileCreated) {
    return res.status(500).json({
      success: false,
      error: 'Failed to create user profile',
      code: 'PROFILE_CREATION_FAILED'
    });
  }

  // Generate API JWT token
  const apiToken = authService.generateToken(user);

  res.json({
    success: true,
    message: 'Login successful',
    token: apiToken,
    user: {
      id: user.id,
      email: user.email
    },
    expiresIn: '24h'
  });
}));

/**
 * POST /auth/logout
 * Logout user (client-side token removal)
 */
router.post('/logout', authenticateToken, asyncHandler(async (req, res) => {
  // In a more complex setup, you might want to blacklist the token
  // For now, we just confirm the logout
  res.json({
    success: true,
    message: 'Logged out successfully',
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /auth/profile
 * Get current user profile
 */
router.get('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const profile = await authService.getUserProfile(req.user.id);
  
  if (!profile) {
    return res.status(404).json({
      success: false,
      error: 'Profile not found',
      code: 'PROFILE_NOT_FOUND'
    });
  }

  res.json({
    success: true,
    profile: {
      id: profile.id,
      email: profile.email,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at
    }
  });
}));

/**
 * PUT /auth/profile
 * Update user profile
 */
router.put('/profile', authenticateToken, asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  // Validate email if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format',
      code: 'INVALID_EMAIL'
    });
  }
  
  const updatedUser = {
    id: req.user.id,
    email: email || req.user.email
  };

  const success = await authService.createOrUpdateProfile(updatedUser);
  
  if (!success) {
    return res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      code: 'UPDATE_FAILED'
    });
  }

  const profile = await authService.getUserProfile(req.user.id);
  
  res.json({
    success: true,
    message: 'Profile updated successfully',
    profile: {
      id: profile.id,
      email: profile.email,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at
    }
  });
}));

/**
 * GET /auth/verify
 * Verify current token validity
 */
router.get('/verify', authenticateToken, asyncHandler(async (req, res) => {
  res.json({
    success: true,
    valid: true,
    user: {
      id: req.user.id,
      email: req.user.email
    },
    timestamp: new Date().toISOString()
  });
}));

/**
 * POST /auth/refresh
 * Refresh JWT token (extend expiration)
 */
router.post('/refresh', authenticateToken, asyncHandler(async (req, res) => {
  // Generate new token with extended expiration
  const newToken = authService.generateToken(req.user);
  
  res.json({
    success: true,
    message: 'Token refreshed successfully',
    token: newToken,
    user: {
      id: req.user.id,
      email: req.user.email
    },
    expiresIn: '24h'
  });
}));

module.exports = router;