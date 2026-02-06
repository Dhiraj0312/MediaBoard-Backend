const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

console.log('='.repeat(60));
console.log('🚀 Digital Signage API - Server Initialization');
console.log('='.repeat(60));
console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`📦 Node Version: ${process.version}`);
console.log('');

// Import middleware
console.log('📥 Loading middleware...');
const { authenticateToken, optionalAuth } = require('./middleware/auth');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { 
  apiLimiter, 
  authLimiter, 
  uploadLimiter, 
  heartbeatLimiter, 
  dashboardLimiter,
  clearRateLimitCache
} = require('./middleware/rateLimiter');
const { requestMonitoring, errorMonitoring } = require('./middleware/monitoring');
console.log('✅ Middleware loaded successfully');
console.log('');

// Import routes
console.log('📥 Loading routes...');
const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const screenRoutes = require('./routes/screens');
const playlistRoutes = require('./routes/playlists');
const assignmentRoutes = require('./routes/assignments');
const playerRoutes = require('./routes/player');
const dashboardRoutes = require('./routes/dashboard');
const monitoringRoutes = require('./routes/monitoring');
console.log('✅ Routes loaded successfully');
console.log('');

// Verify Supabase configuration
console.log('🔍 Verifying Supabase configuration...');
try {
  const { supabase } = require('./config/supabase');
  console.log('✅ Supabase client initialized successfully');
  console.log(`   URL: ${process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing'}`);
  console.log(`   Service Role Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Configured' : '✗ Missing'}`);
} catch (error) {
  console.error('❌ Supabase initialization failed:', error.message);
  console.error('   Please check your .env file and ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
}
console.log('');

const app = express();
const PORT = process.env.PORT || 3001;

console.log('⚙️  Configuring Express application...');

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'http://localhost:3000',
      'http://localhost:3001',
      // Production frontend URL
      'https://media-board-frontend.vercel.app',
      // Allow player to access API from same origin
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Logging middleware
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate limiting middleware
app.use('/api/', apiLimiter);

// Request monitoring middleware (before routes)
app.use(requestMonitoring);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve player static files
app.use('/player', express.static(path.join(__dirname, '../../player')));

// Request timeout middleware
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    res.status(408).json({
      error: 'Request timeout',
      code: 'REQUEST_TIMEOUT'
    });
  });
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'digital-signage-api',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    database: 'unknown',
    supabase: 'unknown'
  };

  // Check database connectivity
  try {
    const { supabase } = require('./config/supabase');
    const { data, error } = await supabase.from('screens').select('count', { count: 'exact', head: true });
    
    if (error) {
      healthStatus.database = 'error';
      healthStatus.databaseError = error.message;
    } else {
      healthStatus.database = 'connected';
    }
  } catch (error) {
    healthStatus.database = 'error';
    healthStatus.databaseError = error.message;
  }

  // Check Supabase connectivity
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      healthStatus.supabase = 'configured';
      
      // Verify Supabase is actually reachable
      const { supabase } = require('./config/supabase');
      const { error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
      
      if (error) {
        healthStatus.supabase = 'error';
        healthStatus.supabaseError = error.message;
      } else {
        healthStatus.supabase = 'connected';
      }
    } else {
      healthStatus.supabase = 'not_configured';
    }
  } catch (error) {
    healthStatus.supabase = 'error';
    healthStatus.supabaseError = error.message;
  }

  // Set overall status based on connectivity
  if (healthStatus.database === 'error' || healthStatus.supabase === 'error') {
    healthStatus.status = 'DEGRADED';
    res.status(503);
  }

  res.json(healthStatus);
});

// EMERGENCY: Clear rate limit cache endpoint
app.post('/api/clear-cache', (req, res) => {
  try {
    clearRateLimitCache();
    
    // Also temporarily disable rate limiting for 5 minutes
    process.env.DISABLE_RATE_LIMITING = 'true';
    setTimeout(() => {
      delete process.env.DISABLE_RATE_LIMITING;
      console.log('🔄 Rate limiting re-enabled after 5 minutes');
    }, 5 * 60 * 1000);
    
    res.json({ 
      success: true, 
      message: 'Rate limit cache cleared successfully and rate limiting temporarily disabled',
      timestamp: new Date().toISOString(),
      disabledFor: '5 minutes'
    });
    
    console.log('🧹 Rate limit cache cleared via API call');
    console.log('🚫 Rate limiting temporarily disabled for 5 minutes');
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Failed to clear cache',
      error: error.message 
    });
  }
});

// Player application endpoint
app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, '../../player/index.html'));
});

// API routes with specific rate limiting
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/media', uploadLimiter, authenticateToken, mediaRoutes);
app.use('/api/screens', authenticateToken, screenRoutes);
app.use('/api/playlists', authenticateToken, playlistRoutes);
app.use('/api/assignments', authenticateToken, assignmentRoutes);
app.use('/api/player', heartbeatLimiter, playerRoutes); // No auth required for player endpoints
app.use('/api/dashboard', dashboardLimiter, authenticateToken, dashboardRoutes);
app.use('/api/monitoring', authenticateToken, monitoringRoutes); // Monitoring endpoints

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Digital Signage Platform API',
    version: '1.0.0',
    description: 'Backend API for digital signage management system',
    endpoints: {
      health: '/health',
      player: '/player',
      auth: '/api/auth',
      media: '/api/media',
      screens: '/api/screens',
      playlists: '/api/playlists',
      assignments: '/api/assignments',
      playerApi: '/api/player',
      dashboard: '/api/dashboard',
      monitoring: '/api/monitoring'
    }
  });
});

// 404 handler for undefined routes
app.use(notFound);

// Error monitoring middleware (before error handler)
app.use(errorMonitoring);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const server = app.listen(PORT, async () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('✅ Server Started Successfully');
  console.log('='.repeat(60));
  
  // EMERGENCY: Clear rate limit cache on startup
  clearRateLimitCache();
  console.log('🧹 Rate limit cache cleared');
  
  // Set development environment variable if not set
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
    console.log('🔧 NODE_ENV set to development');
  }
  
  // Disable rate limiting for development
  if (process.env.NODE_ENV === 'development') {
    console.log('🚫 Rate limiting disabled for development environment');
  }
  
  console.log('');
  console.log('📡 Server Information:');
  console.log(`   Port: ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Base URL: http://localhost:${PORT}`);
  console.log('');
  
  console.log('🔗 Available Endpoints:');
  console.log(`   Health Check:    GET  http://localhost:${PORT}/health`);
  console.log(`   API Info:        GET  http://localhost:${PORT}/api`);
  console.log(`   Player App:      GET  http://localhost:${PORT}/player`);
  console.log('');
  
  console.log('🔐 API Routes:');
  console.log(`   Auth:            POST http://localhost:${PORT}/api/auth/login`);
  console.log(`                    POST http://localhost:${PORT}/api/auth/register`);
  console.log(`   Media:           GET  http://localhost:${PORT}/api/media`);
  console.log(`                    POST http://localhost:${PORT}/api/media`);
  console.log(`   Screens:         GET  http://localhost:${PORT}/api/screens`);
  console.log(`                    POST http://localhost:${PORT}/api/screens`);
  console.log(`   Playlists:       GET  http://localhost:${PORT}/api/playlists`);
  console.log(`                    POST http://localhost:${PORT}/api/playlists`);
  console.log(`   Assignments:     GET  http://localhost:${PORT}/api/assignments`);
  console.log(`                    POST http://localhost:${PORT}/api/assignments`);
  console.log(`   Player API:      GET  http://localhost:${PORT}/api/player/:screenId/content`);
  console.log(`                    POST http://localhost:${PORT}/api/player/:screenId/heartbeat`);
  console.log(`   Dashboard:       GET  http://localhost:${PORT}/api/dashboard/stats`);
  console.log(`   Monitoring:      GET  http://localhost:${PORT}/api/monitoring/metrics`);
  console.log('');
  
  // Verify database connectivity
  console.log('🔍 Verifying database connectivity...');
  try {
    const { supabase } = require('./config/supabase');
    const { data, error } = await supabase.from('screens').select('count', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Database connectivity check failed:', error.message);
      console.error('   Please verify your Supabase configuration and database setup');
    } else {
      console.log('✅ Database connection verified successfully');
    }
  } catch (error) {
    console.error('❌ Database connectivity check failed:', error.message);
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('🎉 Server is ready to accept connections');
  console.log('='.repeat(60));
  console.log('');
});

module.exports = app;