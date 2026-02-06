const { supabase } = require('../config/supabase');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

class MonitoringService {
  constructor() {
    this.metrics = {
      requests: new Map(),
      errors: new Map(),
      performance: new Map(),
      system: new Map()
    };
    
    this.startTime = Date.now();
    this.healthChecks = new Map();
    this.alertThresholds = {
      responseTime: 5000, // 5 seconds
      errorRate: 0.1, // 10%
      memoryUsage: 0.9, // 90%
      diskUsage: 0.9, // 90%
      cpuUsage: 0.8 // 80%
    };

    this.initializeHealthChecks();
    this.startPeriodicCollection();
  }

  /**
   * Initialize health check functions
   */
  initializeHealthChecks() {
    this.healthChecks.set('database', this.checkDatabaseHealth.bind(this));
    this.healthChecks.set('storage', this.checkStorageHealth.bind(this));
    this.healthChecks.set('memory', this.checkMemoryHealth.bind(this));
    this.healthChecks.set('disk', this.checkDiskHealth.bind(this));
    this.healthChecks.set('cpu', this.checkCpuHealth.bind(this));
    this.healthChecks.set('network', this.checkNetworkHealth.bind(this));
  }

  /**
   * Start periodic metric collection
   */
  startPeriodicCollection() {
    // Collect system metrics every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Clean old metrics every 5 minutes
    setInterval(() => {
      this.cleanOldMetrics();
    }, 300000);
  }

  /**
   * Record API request metrics
   */
  recordRequest(endpoint, method, statusCode, responseTime, userId = null) {
    const timestamp = Date.now();
    const key = `${method}:${endpoint}`;
    
    if (!this.metrics.requests.has(key)) {
      this.metrics.requests.set(key, []);
    }

    this.metrics.requests.get(key).push({
      timestamp,
      statusCode,
      responseTime,
      userId,
      success: statusCode >= 200 && statusCode < 400
    });

    // Keep only last 1000 requests per endpoint
    const requests = this.metrics.requests.get(key);
    if (requests.length > 1000) {
      requests.splice(0, requests.length - 1000);
    }
  }

  /**
   * Record error
   */
  recordError(error, context = {}) {
    const timestamp = Date.now();
    const errorKey = error.name || 'UnknownError';
    
    if (!this.metrics.errors.has(errorKey)) {
      this.metrics.errors.set(errorKey, []);
    }

    this.metrics.errors.get(errorKey).push({
      timestamp,
      message: error.message,
      stack: error.stack,
      context,
      severity: this.getErrorSeverity(error)
    });

    // Log to console for immediate visibility
    console.error('🚨 Error recorded:', {
      type: errorKey,
      message: error.message,
      context,
      timestamp: new Date(timestamp).toISOString()
    });

    // Keep only last 500 errors per type
    const errors = this.metrics.errors.get(errorKey);
    if (errors.length > 500) {
      errors.splice(0, errors.length - 500);
    }
  }

  /**
   * Get error severity level
   */
  getErrorSeverity(error) {
    if (error.name === 'ValidationError') return 'low';
    if (error.name === 'AuthenticationError') return 'medium';
    if (error.name === 'DatabaseError') return 'high';
    if (error.name === 'SystemError') return 'critical';
    return 'medium';
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    const timestamp = Date.now();
    
    try {
      const metrics = {
        timestamp,
        memory: this.getMemoryMetrics(),
        cpu: await this.getCpuMetrics(),
        disk: await this.getDiskMetrics(),
        network: this.getNetworkMetrics(),
        process: this.getProcessMetrics()
      };

      this.metrics.system.set(timestamp, metrics);

      // Keep only last 100 system metric snapshots
      if (this.metrics.system.size > 100) {
        const oldestKey = Math.min(...this.metrics.system.keys());
        this.metrics.system.delete(oldestKey);
      }

    } catch (error) {
      this.recordError(error, { context: 'system_metrics_collection' });
    }
  }

  /**
   * Get memory metrics
   */
  getMemoryMetrics() {
    const processMemory = process.memoryUsage();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem()
    };

    return {
      process: {
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external,
        rss: processMemory.rss,
        usagePercent: (processMemory.heapUsed / processMemory.heapTotal) * 100
      },
      system: {
        total: systemMemory.total,
        free: systemMemory.free,
        used: systemMemory.total - systemMemory.free,
        usagePercent: ((systemMemory.total - systemMemory.free) / systemMemory.total) * 100
      }
    };
  }

  /**
   * Get CPU metrics
   */
  async getCpuMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        const totalTime = 1000000; // 1 second in microseconds
        const usagePercent = (totalUsage / totalTime) * 100;

        resolve({
          cores: cpus.length,
          loadAverage: {
            '1min': loadAvg[0],
            '5min': loadAvg[1],
            '15min': loadAvg[2]
          },
          process: {
            user: endUsage.user,
            system: endUsage.system,
            usagePercent: Math.min(usagePercent, 100)
          }
        });
      }, 100);
    });
  }

  /**
   * Get disk metrics
   */
  async getDiskMetrics() {
    try {
      const stats = await fs.stat(process.cwd());
      // Note: Getting actual disk usage requires platform-specific commands
      // This is a simplified version
      return {
        available: true,
        path: process.cwd(),
        // Would need platform-specific implementation for actual disk usage
        usagePercent: 0
      };
    } catch (error) {
      return {
        available: false,
        error: error.message
      };
    }
  }

  /**
   * Get network metrics
   */
  getNetworkMetrics() {
    const networkInterfaces = os.networkInterfaces();
    const interfaces = [];

    for (const [name, addresses] of Object.entries(networkInterfaces)) {
      const ipv4 = addresses.find(addr => addr.family === 'IPv4' && !addr.internal);
      if (ipv4) {
        interfaces.push({
          name,
          address: ipv4.address,
          netmask: ipv4.netmask
        });
      }
    }

    return {
      interfaces,
      hostname: os.hostname()
    };
  }

  /**
   * Get process metrics
   */
  getProcessMetrics() {
    return {
      pid: process.pid,
      uptime: process.uptime(),
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.versions.node,
      v8Version: process.versions.v8
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const results = {
      timestamp: new Date().toISOString(),
      overall: 'healthy',
      components: {},
      metrics: {},
      alerts: []
    };

    // Run all health checks
    for (const [name, checkFunction] of this.healthChecks) {
      try {
        const result = await checkFunction();
        results.components[name] = result;
        
        // Check for alerts
        if (result.status === 'critical' || result.status === 'error') {
          results.alerts.push({
            component: name,
            severity: 'critical',
            message: result.message || `${name} health check failed`
          });
          results.overall = 'critical';
        } else if (result.status === 'warning' && results.overall === 'healthy') {
          results.alerts.push({
            component: name,
            severity: 'warning',
            message: result.message || `${name} health check warning`
          });
          results.overall = 'warning';
        }
      } catch (error) {
        results.components[name] = {
          status: 'error',
          message: error.message,
          error: true
        };
        results.alerts.push({
          component: name,
          severity: 'critical',
          message: `Health check failed: ${error.message}`
        });
        results.overall = 'critical';
      }
    }

    // Add current metrics
    results.metrics = await this.getCurrentMetrics();

    return results;
  }

  /**
   * Database health check
   */
  async checkDatabaseHealth() {
    const startTime = Date.now();
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('count')
        .limit(1);

      const responseTime = Date.now() - startTime;
      
      if (error) {
        return {
          status: 'error',
          message: `Database error: ${error.message}`,
          responseTime,
          error: true
        };
      }

      const status = responseTime > this.alertThresholds.responseTime ? 'warning' : 'healthy';
      
      return {
        status,
        message: status === 'warning' ? `Slow response: ${responseTime}ms` : 'Database responsive',
        responseTime,
        connected: true
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `Database connection failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        connected: false,
        error: true
      };
    }
  }

  /**
   * Storage health check
   */
  async checkStorageHealth() {
    const startTime = Date.now();
    
    try {
      const { data: buckets, error } = await supabase.storage.listBuckets();
      const responseTime = Date.now() - startTime;
      
      if (error) {
        return {
          status: 'error',
          message: `Storage error: ${error.message}`,
          responseTime,
          error: true
        };
      }

      const mediaBucket = buckets?.find(b => b.name === 'media');
      const status = mediaBucket ? 'healthy' : 'warning';
      
      return {
        status,
        message: mediaBucket ? 'Storage accessible' : 'Media bucket not found',
        responseTime,
        bucketsCount: buckets?.length || 0,
        mediaBucketExists: !!mediaBucket
      };
    } catch (error) {
      return {
        status: 'critical',
        message: `Storage connection failed: ${error.message}`,
        responseTime: Date.now() - startTime,
        error: true
      };
    }
  }

  /**
   * Memory health check
   */
  async checkMemoryHealth() {
    const memory = this.getMemoryMetrics();
    const processUsage = memory.process.usagePercent;
    const systemUsage = memory.system.usagePercent;
    
    let status = 'healthy';
    let message = 'Memory usage normal';
    
    if (processUsage > this.alertThresholds.memoryUsage * 100) {
      status = 'critical';
      message = `High process memory usage: ${processUsage.toFixed(1)}%`;
    } else if (systemUsage > this.alertThresholds.memoryUsage * 100) {
      status = 'warning';
      message = `High system memory usage: ${systemUsage.toFixed(1)}%`;
    } else if (processUsage > 75) {
      status = 'warning';
      message = `Elevated process memory usage: ${processUsage.toFixed(1)}%`;
    }

    return {
      status,
      message,
      processUsage: processUsage.toFixed(1),
      systemUsage: systemUsage.toFixed(1),
      processMemory: memory.process,
      systemMemory: memory.system
    };
  }

  /**
   * Disk health check
   */
  async checkDiskHealth() {
    const disk = await this.getDiskMetrics();
    
    if (!disk.available) {
      return {
        status: 'error',
        message: `Disk check failed: ${disk.error}`,
        error: true
      };
    }

    // Simplified disk check - would need platform-specific implementation
    return {
      status: 'healthy',
      message: 'Disk accessible',
      path: disk.path
    };
  }

  /**
   * CPU health check
   */
  async checkCpuHealth() {
    const cpu = await this.getCpuMetrics();
    const usage = cpu.process.usagePercent;
    const loadAvg = cpu.loadAverage['1min'];
    
    let status = 'healthy';
    let message = 'CPU usage normal';
    
    if (usage > this.alertThresholds.cpuUsage * 100) {
      status = 'warning';
      message = `High CPU usage: ${usage.toFixed(1)}%`;
    }
    
    if (loadAvg > cpu.cores * 0.8) {
      status = 'warning';
      message = `High load average: ${loadAvg.toFixed(2)}`;
    }

    return {
      status,
      message,
      usage: usage.toFixed(1),
      loadAverage: cpu.loadAverage,
      cores: cpu.cores
    };
  }

  /**
   * Network health check
   */
  async checkNetworkHealth() {
    const network = this.getNetworkMetrics();
    
    return {
      status: 'healthy',
      message: 'Network interfaces available',
      hostname: network.hostname,
      interfaces: network.interfaces.length
    };
  }

  /**
   * Get current metrics summary
   */
  async getCurrentMetrics() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    // Request metrics
    const requestMetrics = this.getRequestMetrics(oneHourAgo);
    
    // Error metrics
    const errorMetrics = this.getErrorMetrics(oneHourAgo);
    
    // System metrics
    const systemMetrics = this.getLatestSystemMetrics();

    return {
      requests: requestMetrics,
      errors: errorMetrics,
      system: systemMetrics,
      uptime: now - this.startTime
    };
  }

  /**
   * Get request metrics for time period
   */
  getRequestMetrics(since) {
    const metrics = {
      total: 0,
      successful: 0,
      failed: 0,
      averageResponseTime: 0,
      endpoints: {}
    };

    let totalResponseTime = 0;
    let requestCount = 0;

    for (const [endpoint, requests] of this.metrics.requests) {
      const recentRequests = requests.filter(r => r.timestamp >= since);
      
      if (recentRequests.length > 0) {
        const successful = recentRequests.filter(r => r.success).length;
        const failed = recentRequests.length - successful;
        const avgResponseTime = recentRequests.reduce((sum, r) => sum + r.responseTime, 0) / recentRequests.length;

        metrics.endpoints[endpoint] = {
          total: recentRequests.length,
          successful,
          failed,
          averageResponseTime: Math.round(avgResponseTime),
          errorRate: failed / recentRequests.length
        };

        metrics.total += recentRequests.length;
        metrics.successful += successful;
        metrics.failed += failed;
        
        totalResponseTime += recentRequests.reduce((sum, r) => sum + r.responseTime, 0);
        requestCount += recentRequests.length;
      }
    }

    if (requestCount > 0) {
      metrics.averageResponseTime = Math.round(totalResponseTime / requestCount);
      metrics.errorRate = metrics.failed / metrics.total;
    }

    return metrics;
  }

  /**
   * Get error metrics for time period
   */
  getErrorMetrics(since) {
    const metrics = {
      total: 0,
      byType: {},
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      recent: []
    };

    for (const [errorType, errors] of this.metrics.errors) {
      const recentErrors = errors.filter(e => e.timestamp >= since);
      
      if (recentErrors.length > 0) {
        metrics.byType[errorType] = recentErrors.length;
        metrics.total += recentErrors.length;

        // Count by severity
        recentErrors.forEach(error => {
          metrics.bySeverity[error.severity]++;
        });

        // Add recent errors (last 10)
        metrics.recent.push(...recentErrors.slice(-10).map(error => ({
          type: errorType,
          message: error.message,
          timestamp: error.timestamp,
          severity: error.severity
        })));
      }
    }

    // Sort recent errors by timestamp
    metrics.recent.sort((a, b) => b.timestamp - a.timestamp);
    metrics.recent = metrics.recent.slice(0, 20); // Keep only 20 most recent

    return metrics;
  }

  /**
   * Get latest system metrics
   */
  getLatestSystemMetrics() {
    if (this.metrics.system.size === 0) {
      return null;
    }

    const latestTimestamp = Math.max(...this.metrics.system.keys());
    return this.metrics.system.get(latestTimestamp);
  }

  /**
   * Clean old metrics
   */
  cleanOldMetrics() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    // Clean old request metrics
    for (const [endpoint, requests] of this.metrics.requests) {
      const recentRequests = requests.filter(r => r.timestamp >= oneHourAgo);
      this.metrics.requests.set(endpoint, recentRequests);
    }

    // Clean old error metrics
    for (const [errorType, errors] of this.metrics.errors) {
      const recentErrors = errors.filter(e => e.timestamp >= oneHourAgo);
      this.metrics.errors.set(errorType, recentErrors);
    }

    console.log('🧹 Cleaned old metrics');
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      requests: this.metrics.requests.size,
      errors: this.metrics.errors.size,
      systemSnapshots: this.metrics.system.size,
      uptime: Date.now() - this.startTime,
      memoryUsage: process.memoryUsage(),
      healthChecks: Array.from(this.healthChecks.keys())
    };
  }
}

// Create singleton instance
const monitoringService = new MonitoringService();

module.exports = { MonitoringService, monitoringService };