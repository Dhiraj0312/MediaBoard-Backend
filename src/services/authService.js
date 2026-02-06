const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

// Simple in-memory token blacklist (in production, use Redis)
const tokenBlacklist = new Set();

// Clean up expired tokens periodically
setInterval(() => {
  // In a real implementation, you'd check token expiration dates
  // For now, we'll just clear the set periodically
  if (tokenBlacklist.size > 1000) {
    tokenBlacklist.clear();
  }
}, 60 * 60 * 1000); // Clean up every hour

class AuthService {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key';
    if (!process.env.JWT_SECRET) {
      console.warn('JWT_SECRET not set, using fallback key');
    }
  }

  /**
   * Verify Supabase JWT token and extract user information
   */
  async verifySupabaseToken(token) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      
      if (error || !user) {
        console.error('Supabase token verification failed:', error?.message);
        return null;
      }

      return {
        id: user.id,
        email: user.email || ''
      };
    } catch (error) {
      console.error('Error verifying Supabase token:', error);
      return null;
    }
  }

  /**
   * Generate JWT token for API authentication
   */
  generateToken(user) {
    const payload = { 
      id: user.id, 
      email: user.email,
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(
      payload,
      this.jwtSecret,
      { 
        expiresIn: '24h',
        issuer: 'digital-signage-api',
        audience: 'digital-signage-client'
      }
    );
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      // Check if token is blacklisted
      if (tokenBlacklist.has(token)) {
        return null;
      }

      const decoded = jwt.verify(token, this.jwtSecret, {
        issuer: 'digital-signage-api',
        audience: 'digital-signage-client'
      });

      return {
        id: decoded.id,
        email: decoded.email
      };
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        console.log('Token expired');
      } else if (error.name === 'JsonWebTokenError') {
        console.log('Invalid token');
      }
      return null;
    }
  }

  /**
   * Invalidate a JWT token (add to blacklist)
   */
  invalidateToken(token) {
    tokenBlacklist.add(token);
    return true;
  }

  /**
   * Create or update user profile in database
   */
  async createOrUpdateProfile(user) {
    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'id'
        });

      if (error) {
        console.error('Error creating/updating profile:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in createOrUpdateProfile:', error);
      return false;
    }
  }

  /**
   * Get user profile from database
   */
  async getUserProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code !== 'PGRST116') { // Not found is ok
          console.error('Error fetching user profile:', error);
        }
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserProfile:', error);
      return null;
    }
  }

  /**
   * Check if user exists in database
   */
  async userExists(userId) {
    try {
      const profile = await this.getUserProfile(userId);
      return !!profile;
    } catch (error) {
      console.error('Error checking if user exists:', error);
      return false;
    }
  }

  /**
   * Delete user profile (for cleanup)
   */
  async deleteUserProfile(userId) {
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (error) {
        console.error('Error deleting user profile:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in deleteUserProfile:', error);
      return false;
    }
  }

  /**
   * Get token expiration time
   */
  getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded?.exp ? new Date(decoded.exp * 1000) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  isTokenExpired(token) {
    const expiration = this.getTokenExpiration(token);
    return expiration ? expiration < new Date() : true;
  }
}

module.exports = { AuthService };