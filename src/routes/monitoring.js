const express = require('express');
const { monitoringService } = require('../services/monitoringService');
const { 
  healthCheckMiddleware, 
  metricsMiddleware, 
  systemStatusMiddleware 
} = require('../middleware/monitoring');

const router = express.Router();

/**
 * GET /monitoring/health
 * Comprehensive health check endpoint
 */
router.get('/health', healthCheckMiddleware, (req, res) => {
  const healthCheck = req.healthCheck;
  
  // Set appropriate status code based on health
  let statusCode = 200;
  if (healthCheck.overall === 'warning') {
    statusCode = 200; // Still OK, but with warnings
  } else if (healthCheck.overall === 'critical' || healthCheck.overall === 'error') {
    statusCode = 503; // Service Unavailable
  }

  res.status(statusCode).json({
    success: healthCheck.overall !== 'error',
    health: healthCheck
  });
});

/**
 * GET /monitoring/metrics
 * Current system metrics
 */
router.get('/metrics', metricsMiddleware, (req, res) => {
  res.json({
    success: true,
    metrics: req.metrics
  });
});

/**
 * GET /monitoring/status
 * System status and statistics
 */
router.get('/status', systemStatusMiddleware, (req, res) => {
  res.json({
    success: true,
    status: req.systemStatus
  });
});

/**
 * GET /monitoring/performance
 * Performance metrics and analysis
 */
router.get('/performance', async (req, res) => {
  try {
    const timeRange = req.query.range || '1h'; // 1h, 6h, 24h
    const since = getTimeSince(timeRange);
    
    const metrics = await monitoringService.getCurrentMetrics();
    const requestMetrics = monitoringService.getRequestMetrics(since);
    const errorMetrics = monitoringService.getErrorMetrics(since);
    
    const performance = {
      timeRange,
      requests: requestMetrics,
      errors: errorMetrics,
      system: metrics.system,
      analysis: analyzePerformance(requestMetrics, errorMetrics)
    };

    res.json({
      success: true,
      performance
    });
  } catch (error) {
    monitoringService.recordError(error, { context: 'performance_endpoint' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance metrics',
      code: 'PERFORMANCE_ERROR'
    });
  }
});

/**
 * GET /monitoring/errors
 * Error logs and analysis
 */
router.get('/errors', (req, res) => {
  try {
    const timeRange = req.query.range || '1h';
    const severity = req.query.severity; // low, medium, high, critical
    const limit = parseInt(req.query.limit) || 50;
    
    const since = getTimeSince(timeRange);
    const errorMetrics = monitoringService.getErrorMetrics(since);
    
    // Filter by severity if specified
    if (severity) {
      errorMetrics.recent = errorMetrics.recent.filter(error => error.severity === severity);
    }
    
    // Limit results
    errorMetrics.recent = errorMetrics.recent.slice(0, limit);

    res.json({
      success: true,
      errors: errorMetrics,
      filters: {
        timeRange,
        severity: severity || 'all',
        limit
      }
    });
  } catch (error) {
    monitoringService.recordError(error, { context: 'errors_endpoint' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error metrics',
      code: 'ERROR_METRICS_ERROR'
    });
  }
});

/**
 * GET /monitoring/alerts
 * System alerts and warnings
 */
router.get('/alerts', healthCheckMiddleware, (req, res) => {
  try {
    const healthCheck = req.healthCheck;
    const severity = req.query.severity; // warning, critical
    
    let alerts = healthCheck.alerts || [];
    
    // Filter by severity if specified
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity);
    }
    
    // Add performance-based alerts
    const performanceAlerts = generatePerformanceAlerts();
    alerts = [...alerts, ...performanceAlerts];
    
    // Sort by severity (critical first)
    alerts.sort((a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
    });

    res.json({
      success: true,
      alerts: {
        total: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length,
        warning: alerts.filter(a => a.severity === 'warning').length,
        info: alerts.filter(a => a.severity === 'info').length,
        items: alerts
      }
    });
  } catch (error) {
    monitoringService.recordError(error, { context: 'alerts_endpoint' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerts',
      code: 'ALERTS_ERROR'
    });
  }
});

/**
 * POST /monitoring/test-error
 * Test endpoint for error monitoring (development only)
 */
router.post('/test-error', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      success: false,
      error: 'Test endpoints not available in production',
      code: 'FORBIDDEN'
    });
  }

  const { type = 'TestError', message = 'This is a test error' } = req.body;
  
  const error = new Error(message);
  error.name = type;
  
  monitoringService.recordError(error, {
    context: 'test_error',
    userTriggered: true,
    userId: req.user?.id
  });

  res.json({
    success: true,
    message: 'Test error recorded',
    error: {
      type,
      message,
      timestamp: new Date().toISOString()
    }
  });
});

/**
 * GET /monitoring/diagnostics
 * Detailed system diagnostics
 */
router.get('/diagnostics', async (req, res) => {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        pid: process.pid
      },
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      monitoring: monitoringService.getStats(),
      health: await monitoringService.performHealthCheck()
    };

    res.json({
      success: true,
      diagnostics
    });
  } catch (error) {
    monitoringService.recordError(error, { context: 'diagnostics_endpoint' });
    res.status(500).json({
      success: false,
      error: 'Failed to generate diagnostics',
      code: 'DIAGNOSTICS_ERROR'
    });
  }
});

/**
 * Helper function to get timestamp for time range
 */
function getTimeSince(range) {
  const now = Date.now();
  switch (range) {
    case '15m':
      return now - (15 * 60 * 1000);
    case '1h':
      return now - (60 * 60 * 1000);
    case '6h':
      return now - (6 * 60 * 60 * 1000);
    case '24h':
      return now - (24 * 60 * 60 * 1000);
    case '7d':
      return now - (7 * 24 * 60 * 60 * 1000);
    default:
      return now - (60 * 60 * 1000); // Default to 1 hour
  }
}

/**
 * Analyze performance metrics
 */
function analyzePerformance(requestMetrics, errorMetrics) {
  const analysis = {
    status: 'good',
    issues: [],
    recommendations: []
  };

  // Check error rate
  if (requestMetrics.errorRate > 0.1) {
    analysis.status = 'poor';
    analysis.issues.push(`High error rate: ${(requestMetrics.errorRate * 100).toFixed(1)}%`);
    analysis.recommendations.push('Investigate error causes and implement fixes');
  } else if (requestMetrics.errorRate > 0.05) {
    analysis.status = 'fair';
    analysis.issues.push(`Elevated error rate: ${(requestMetrics.errorRate * 100).toFixed(1)}%`);
  }

  // Check response time
  if (requestMetrics.averageResponseTime > 2000) {
    analysis.status = 'poor';
    analysis.issues.push(`Slow response time: ${requestMetrics.averageResponseTime}ms`);
    analysis.recommendations.push('Optimize database queries and API endpoints');
  } else if (requestMetrics.averageResponseTime > 1000) {
    if (analysis.status === 'good') analysis.status = 'fair';
    analysis.issues.push(`Elevated response time: ${requestMetrics.averageResponseTime}ms`);
  }

  // Check critical errors
  if (errorMetrics.bySeverity.critical > 0) {
    analysis.status = 'poor';
    analysis.issues.push(`${errorMetrics.bySeverity.critical} critical errors`);
    analysis.recommendations.push('Address critical errors immediately');
  }

  return analysis;
}

/**
 * Generate performance-based alerts
 */
function generatePerformanceAlerts() {
  const alerts = [];
  const metrics = monitoringService.getStats();
  
  // Memory usage alert
  const memoryUsage = (metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal) * 100;
  if (memoryUsage > 90) {
    alerts.push({
      component: 'memory',
      severity: 'critical',
      message: `High memory usage: ${memoryUsage.toFixed(1)}%`
    });
  } else if (memoryUsage > 75) {
    alerts.push({
      component: 'memory',
      severity: 'warning',
      message: `Elevated memory usage: ${memoryUsage.toFixed(1)}%`
    });
  }

  // Uptime alert (if recently restarted)
  if (metrics.uptime < 300000) { // Less than 5 minutes
    alerts.push({
      component: 'system',
      severity: 'info',
      message: `System recently restarted (uptime: ${Math.round(metrics.uptime / 1000)}s)`
    });
  }

  return alerts;
}

module.exports = router;