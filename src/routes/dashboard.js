const express = require('express');
const { supabase } = require('../config/supabase');
const { MediaService } = require('../services/mediaService');

const router = express.Router();
const mediaService = new MediaService();

/**
 * GET /dashboard/stats
 * Get comprehensive dashboard statistics and overview data
 */
router.get('/stats', async (req, res) => {
  try {
    // Get comprehensive screen statistics
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('status, last_heartbeat, created_at, location');

    if (screensError) {
      throw new Error(`Screens query failed: ${screensError.message}`);
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const screenStats = {
      total: screens.length,
      online: screens.filter(s => s.status === 'online').length,
      offline: screens.filter(s => s.status === 'offline').length,
      recentlyActive: screens.filter(s => 
        s.last_heartbeat && new Date(s.last_heartbeat) > oneHourAgo
      ).length,
      activeToday: screens.filter(s => 
        s.last_heartbeat && new Date(s.last_heartbeat) > oneDayAgo
      ).length,
      newThisWeek: screens.filter(s => 
        new Date(s.created_at) > oneWeekAgo
      ).length,
      byLocation: screens.reduce((acc, screen) => {
        const location = screen.location || 'Unknown';
        acc[location] = (acc[location] || 0) + 1;
        return acc;
      }, {})
    };

    // Get enhanced media statistics
    const mediaStats = await mediaService.getMediaStats();
    
    // Get media by type and recent uploads
    const { data: mediaDetails, error: mediaError } = await supabase
      .from('media')
      .select('type, created_at, file_size');

    if (!mediaError) {
      mediaStats.recentUploads = mediaDetails.filter(m => 
        new Date(m.created_at) > oneWeekAgo
      ).length;
      
      mediaStats.uploadTrend = {
        thisWeek: mediaDetails.filter(m => new Date(m.created_at) > oneWeekAgo).length,
        lastWeek: mediaDetails.filter(m => {
          const created = new Date(m.created_at);
          return created > new Date(oneWeekAgo.getTime() - 7 * 24 * 60 * 60 * 1000) && created <= oneWeekAgo;
        }).length
      };
    }

    // Get playlist statistics with usage data
    const { data: playlists, error: playlistsError } = await supabase
      .from('playlists')
      .select(`
        id,
        created_at,
        updated_at,
        playlist_items (
          id
        )
      `);

    if (playlistsError) {
      throw new Error(`Playlists query failed: ${playlistsError.message}`);
    }

    const playlistStats = {
      total: playlists.length,
      empty: playlists.filter(p => !p.playlist_items || p.playlist_items.length === 0).length,
      averageItems: playlists.length > 0 ? 
        Math.round(playlists.reduce((sum, p) => sum + (p.playlist_items?.length || 0), 0) / playlists.length) : 0,
      recentlyUpdated: playlists.filter(p => 
        new Date(p.updated_at) > oneWeekAgo
      ).length,
      newThisWeek: playlists.filter(p => 
        new Date(p.created_at) > oneWeekAgo
      ).length
    };

    // Get assignment statistics with detailed analysis
    const { data: assignments, error: assignmentsError } = await supabase
      .from('screen_assignments')
      .select(`
        id,
        assigned_at,
        screens (
          id,
          name,
          status
        ),
        playlists (
          id,
          name
        )
      `);

    if (assignmentsError) {
      throw new Error(`Assignments query failed: ${assignmentsError.message}`);
    }

    const assignmentStats = {
      total: assignments.length,
      unassigned: screenStats.total - assignments.length,
      activeAssignments: assignments.filter(a => a.screens?.status === 'online').length,
      recentAssignments: assignments.filter(a => 
        new Date(a.assigned_at) > oneWeekAgo
      ).length,
      assignmentRate: screenStats.total > 0 ? 
        Math.round((assignments.length / screenStats.total) * 100) : 0
    };

    // Calculate comprehensive system health metrics
    const healthMetrics = {
      screenConnectivity: screenStats.total > 0 ? 
        Math.round((screenStats.online / screenStats.total) * 100) : 0,
      contentCoverage: screenStats.total > 0 ? 
        Math.round((assignments.length / screenStats.total) * 100) : 0,
      systemUtilization: Math.round(
        ((screenStats.online + mediaStats.total + playlistStats.total) / 
         Math.max(screenStats.total * 3, 1)) * 100
      ),
      dataQuality: Math.round(
        ((screenStats.total - screenStats.offline) + 
         (playlistStats.total - playlistStats.empty) + 
         mediaStats.total) / 
        Math.max((screenStats.total + playlistStats.total + mediaStats.total), 1) * 100
      )
    };

    const overallHealth = Math.round(
      (healthMetrics.screenConnectivity + 
       healthMetrics.contentCoverage + 
       healthMetrics.systemUtilization + 
       healthMetrics.dataQuality) / 4
    );

    // Get recent activity with enhanced details
    const { data: recentActivity, error: activityError } = await supabase
      .from('screens')
      .select('name, status, last_heartbeat, location, updated_at')
      .order('last_heartbeat', { ascending: false, nullsLast: true })
      .limit(10);

    if (activityError) {
      throw new Error(`Recent activity query failed: ${activityError.message}`);
    }

    res.json({
      success: true,
      stats: {
        screens: screenStats,
        media: mediaStats,
        playlists: playlistStats,
        assignments: assignmentStats,
        system: {
          healthScore: overallHealth,
          status: overallHealth >= 80 ? 'healthy' : overallHealth >= 60 ? 'warning' : 'critical',
          metrics: healthMetrics,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        }
      },
      recentActivity: recentActivity.map(screen => ({
        name: screen.name,
        status: screen.status,
        location: screen.location,
        lastSeen: screen.last_heartbeat,
        lastUpdated: screen.updated_at,
        type: 'screen_status',
        isRecent: screen.last_heartbeat && new Date(screen.last_heartbeat) > oneHourAgo
      })),
      trends: {
        screens: {
          newThisWeek: screenStats.newThisWeek,
          activeToday: screenStats.activeToday
        },
        media: mediaStats.uploadTrend,
        playlists: {
          newThisWeek: playlistStats.newThisWeek,
          updatedThisWeek: playlistStats.recentlyUpdated
        },
        assignments: {
          newThisWeek: assignmentStats.recentAssignments
        }
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard statistics',
      code: 'DASHBOARD_ERROR'
    });
  }
});

/**
 * GET /dashboard/activity
 * Get comprehensive recent system activity with filtering and categorization
 */
router.get('/activity', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const type = req.query.type; // Filter by activity type
    const hours = parseInt(req.query.hours) || 24; // Time range in hours

    const timeThreshold = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Get recent screen updates with enhanced details
    const { data: screenActivity, error: screenError } = await supabase
      .from('screens')
      .select('name, status, last_heartbeat, updated_at, location, created_at')
      .gte('updated_at', timeThreshold.toISOString())
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (screenError) {
      throw new Error(`Screen activity query failed: ${screenError.message}`);
    }

    // Get recent media uploads with user info
    const { data: mediaActivity, error: mediaError } = await supabase
      .from('media')
      .select(`
        name,
        type,
        file_size,
        created_at,
        updated_at,
        profiles:created_by (
          email
        )
      `)
      .gte('created_at', timeThreshold.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (mediaError) {
      throw new Error(`Media activity query failed: ${mediaError.message}`);
    }

    // Get recent playlist updates with item counts
    const { data: playlistActivity, error: playlistError } = await supabase
      .from('playlists')
      .select(`
        name,
        created_at,
        updated_at,
        profiles:created_by (
          email
        ),
        playlist_items (
          id
        )
      `)
      .gte('updated_at', timeThreshold.toISOString())
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (playlistError) {
      throw new Error(`Playlist activity query failed: ${playlistError.message}`);
    }

    // Get recent assignments with screen and playlist details
    const { data: assignmentActivity, error: assignmentError } = await supabase
      .from('screen_assignments')
      .select(`
        assigned_at,
        screens (
          name,
          location
        ),
        playlists (
          name
        )
      `)
      .gte('assigned_at', timeThreshold.toISOString())
      .order('assigned_at', { ascending: false })
      .limit(limit);

    if (assignmentError) {
      throw new Error(`Assignment activity query failed: ${assignmentError.message}`);
    }

    // Combine and categorize all activities
    const allActivity = [];

    // Screen activities
    if (!type || type === 'screen') {
      screenActivity.forEach(item => {
        // Screen status changes
        allActivity.push({
          type: 'screen',
          subtype: 'status_update',
          title: `Screen "${item.name}" ${item.status}`,
          timestamp: item.last_heartbeat || item.updated_at,
          details: `Status: ${item.status}${item.location ? `, Location: ${item.location}` : ''}`,
          metadata: {
            screenName: item.name,
            status: item.status,
            location: item.location,
            isNew: new Date(item.created_at) > timeThreshold
          }
        });
      });
    }

    // Media activities
    if (!type || type === 'media') {
      mediaActivity.forEach(item => {
        allActivity.push({
          type: 'media',
          subtype: 'upload',
          title: `Media "${item.name}" uploaded`,
          timestamp: item.created_at,
          details: `Type: ${item.type}, Size: ${formatFileSize(item.file_size)}, By: ${item.profiles?.email || 'Unknown'}`,
          metadata: {
            mediaName: item.name,
            mediaType: item.type,
            fileSize: item.file_size,
            uploadedBy: item.profiles?.email
          }
        });
      });
    }

    // Playlist activities
    if (!type || type === 'playlist') {
      playlistActivity.forEach(item => {
        const isNew = new Date(item.created_at) > timeThreshold;
        allActivity.push({
          type: 'playlist',
          subtype: isNew ? 'created' : 'updated',
          title: `Playlist "${item.name}" ${isNew ? 'created' : 'updated'}`,
          timestamp: isNew ? item.created_at : item.updated_at,
          details: `Items: ${item.playlist_items?.length || 0}, By: ${item.profiles?.email || 'Unknown'}`,
          metadata: {
            playlistName: item.name,
            itemCount: item.playlist_items?.length || 0,
            modifiedBy: item.profiles?.email,
            isNew: isNew
          }
        });
      });
    }

    // Assignment activities
    if (!type || type === 'assignment') {
      assignmentActivity.forEach(item => {
        allActivity.push({
          type: 'assignment',
          subtype: 'created',
          title: `Screen "${item.screens?.name}" assigned to playlist "${item.playlists?.name}"`,
          timestamp: item.assigned_at,
          details: `Screen: ${item.screens?.name}${item.screens?.location ? ` (${item.screens.location})` : ''}, Playlist: ${item.playlists?.name}`,
          metadata: {
            screenName: item.screens?.name,
            screenLocation: item.screens?.location,
            playlistName: item.playlists?.name
          }
        });
      });
    }

    // Sort by timestamp and limit
    const sortedActivity = allActivity
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Calculate activity statistics
    const activityStats = {
      total: sortedActivity.length,
      byType: sortedActivity.reduce((acc, activity) => {
        acc[activity.type] = (acc[activity.type] || 0) + 1;
        return acc;
      }, {}),
      byHour: sortedActivity.reduce((acc, activity) => {
        const hour = new Date(activity.timestamp).getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      }, {}),
      recentCount: sortedActivity.filter(a => 
        new Date(a.timestamp) > new Date(Date.now() - 60 * 60 * 1000)
      ).length
    };

    res.json({
      success: true,
      activity: sortedActivity,
      stats: activityStats,
      filters: {
        timeRange: `${hours} hours`,
        type: type || 'all',
        limit: limit
      }
    });

    // Helper function for file size formatting
    function formatFileSize(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
  } catch (error) {
    console.error('Dashboard activity error:', error);
    res.status(500).json({
      error: 'Failed to fetch system activity',
      code: 'ACTIVITY_ERROR'
    });
  }
});

/**
 * GET /dashboard/health
 * Get comprehensive system health information with detailed diagnostics
 */
router.get('/health', async (req, res) => {
  try {
    const healthCheck = {
      timestamp: new Date().toISOString(),
      overall: 'healthy',
      components: {},
      metrics: {},
      alerts: []
    };

    // Database connectivity and performance check
    const dbStartTime = Date.now();
    try {
      const { data: dbTest, error: dbError } = await supabase
        .from('profiles')
        .select('count')
        .limit(1);

      const dbResponseTime = Date.now() - dbStartTime;
      
      healthCheck.components.database = {
        status: dbError ? 'error' : 'healthy',
        responseTime: dbResponseTime,
        error: dbError?.message || null
      };

      if (dbResponseTime > 1000) {
        healthCheck.alerts.push({
          type: 'warning',
          component: 'database',
          message: `Slow database response: ${dbResponseTime}ms`
        });
      }
    } catch (error) {
      healthCheck.components.database = {
        status: 'error',
        error: error.message
      };
      healthCheck.overall = 'error';
    }

    // Storage connectivity and capacity check
    const storageStartTime = Date.now();
    try {
      const { data: buckets, error: storageError } = await supabase.storage.listBuckets();
      const storageResponseTime = Date.now() - storageStartTime;
      
      const mediaBucket = buckets?.find(b => b.name === 'media');
      
      healthCheck.components.storage = {
        status: storageError ? 'error' : (mediaBucket ? 'healthy' : 'warning'),
        responseTime: storageResponseTime,
        bucketsFound: buckets?.length || 0,
        mediaBucketExists: !!mediaBucket,
        error: storageError?.message || null
      };

      if (!mediaBucket) {
        healthCheck.alerts.push({
          type: 'error',
          component: 'storage',
          message: 'Media storage bucket not found'
        });
        healthCheck.overall = 'degraded';
      }
    } catch (error) {
      healthCheck.components.storage = {
        status: 'error',
        error: error.message
      };
      healthCheck.overall = 'error';
    }

    // Screen connectivity and health analysis
    const { data: screens, error: screensError } = await supabase
      .from('screens')
      .select('status, last_heartbeat, created_at, name, location');

    if (!screensError && screens) {
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const screenMetrics = {
        total: screens.length,
        online: screens.filter(s => s.status === 'online').length,
        offline: screens.filter(s => s.status === 'offline').length,
        recentlyActive: screens.filter(s => 
          s.last_heartbeat && new Date(s.last_heartbeat) > fiveMinutesAgo
        ).length,
        activeLastHour: screens.filter(s => 
          s.last_heartbeat && new Date(s.last_heartbeat) > oneHourAgo
        ).length,
        staleConnections: screens.filter(s => 
          s.status === 'online' && (!s.last_heartbeat || new Date(s.last_heartbeat) < fiveMinutesAgo)
        ).length
      };

      const connectivityRate = screenMetrics.total > 0 ? 
        (screenMetrics.recentlyActive / screenMetrics.total) * 100 : 100;

      healthCheck.components.screens = {
        status: connectivityRate >= 80 ? 'healthy' : connectivityRate >= 50 ? 'warning' : 'critical',
        metrics: screenMetrics,
        connectivityRate: Math.round(connectivityRate)
      };

      healthCheck.metrics.screens = screenMetrics;

      // Generate screen-related alerts
      if (screenMetrics.staleConnections > 0) {
        healthCheck.alerts.push({
          type: 'warning',
          component: 'screens',
          message: `${screenMetrics.staleConnections} screens show online but haven't sent heartbeat recently`
        });
      }

      if (connectivityRate < 50) {
        healthCheck.alerts.push({
          type: 'critical',
          component: 'screens',
          message: `Low screen connectivity: ${Math.round(connectivityRate)}%`
        });
        healthCheck.overall = 'critical';
      } else if (connectivityRate < 80) {
        healthCheck.alerts.push({
          type: 'warning',
          component: 'screens',
          message: `Moderate screen connectivity: ${Math.round(connectivityRate)}%`
        });
        if (healthCheck.overall === 'healthy') {
          healthCheck.overall = 'warning';
        }
      }
    }

    // Content and assignment health check
    const { data: assignments } = await supabase
      .from('screen_assignments')
      .select(`
        id,
        screens (
          id,
          status
        ),
        playlists (
          id,
          playlist_items (
            id
          )
        )
      `);

    if (assignments) {
      const contentMetrics = {
        totalAssignments: assignments.length,
        activeAssignments: assignments.filter(a => a.screens?.status === 'online').length,
        emptyPlaylists: assignments.filter(a => 
          !a.playlists?.playlist_items || a.playlists.playlist_items.length === 0
        ).length
      };

      const assignmentRate = healthCheck.metrics.screens?.total > 0 ? 
        (assignments.length / healthCheck.metrics.screens.total) * 100 : 0;

      healthCheck.components.content = {
        status: assignmentRate >= 80 ? 'healthy' : assignmentRate >= 50 ? 'warning' : 'critical',
        metrics: contentMetrics,
        assignmentRate: Math.round(assignmentRate)
      };

      if (contentMetrics.emptyPlaylists > 0) {
        healthCheck.alerts.push({
          type: 'warning',
          component: 'content',
          message: `${contentMetrics.emptyPlaylists} screens assigned to empty playlists`
        });
      }

      if (assignmentRate < 50) {
        healthCheck.alerts.push({
          type: 'warning',
          component: 'content',
          message: `Low content assignment rate: ${Math.round(assignmentRate)}%`
        });
      }
    }

    // System performance metrics
    const systemMetrics = {
      uptime: Math.round(process.uptime()),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };

    healthCheck.components.system = {
      status: 'healthy',
      metrics: systemMetrics
    };

    healthCheck.metrics.system = systemMetrics;

    // Memory usage check
    const memoryUsagePercent = (systemMetrics.memoryUsage.heapUsed / systemMetrics.memoryUsage.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      healthCheck.alerts.push({
        type: 'critical',
        component: 'system',
        message: `High memory usage: ${Math.round(memoryUsagePercent)}%`
      });
      healthCheck.overall = 'critical';
    } else if (memoryUsagePercent > 75) {
      healthCheck.alerts.push({
        type: 'warning',
        component: 'system',
        message: `Elevated memory usage: ${Math.round(memoryUsagePercent)}%`
      });
    }

    // API performance check (response time aggregate)
    const avgResponseTime = [
      healthCheck.components.database?.responseTime,
      healthCheck.components.storage?.responseTime
    ].filter(Boolean).reduce((sum, time, _, arr) => sum + time / arr.length, 0);

    healthCheck.metrics.performance = {
      averageResponseTime: Math.round(avgResponseTime),
      databaseResponseTime: healthCheck.components.database?.responseTime,
      storageResponseTime: healthCheck.components.storage?.responseTime
    };

    // Final overall status determination
    const componentStatuses = Object.values(healthCheck.components).map(c => c.status);
    if (componentStatuses.includes('error')) {
      healthCheck.overall = 'error';
    } else if (componentStatuses.includes('critical')) {
      healthCheck.overall = 'critical';
    } else if (componentStatuses.includes('warning')) {
      healthCheck.overall = 'warning';
    }

    res.json({
      success: true,
      health: healthCheck
    });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      error: 'Health check failed',
      code: 'HEALTH_CHECK_ERROR',
      health: {
        overall: 'error',
        timestamp: new Date().toISOString(),
        components: {
          system: {
            status: 'error',
            error: error.message
          }
        },
        alerts: [{
          type: 'critical',
          component: 'system',
          message: `Health check failed: ${error.message}`
        }]
      }
    });
  }
});

/**
 * GET /dashboard/metrics
 * Get real-time system metrics and performance data
 */
router.get('/metrics', async (req, res) => {
  try {
    const timeRange = req.query.range || '1h'; // 1h, 6h, 24h, 7d
    const includeHistory = req.query.history === 'true';

    // Calculate time threshold based on range
    const now = new Date();
    let timeThreshold;
    switch (timeRange) {
      case '6h':
        timeThreshold = new Date(now.getTime() - 6 * 60 * 60 * 1000);
        break;
      case '24h':
        timeThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        timeThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default: // 1h
        timeThreshold = new Date(now.getTime() - 60 * 60 * 1000);
    }

    // Get screen activity metrics
    const { data: screenMetrics } = await supabase
      .from('screens')
      .select('status, last_heartbeat, created_at, updated_at');

    // Get media upload metrics
    const { data: mediaMetrics } = await supabase
      .from('media')
      .select('created_at, file_size, type')
      .gte('created_at', timeThreshold.toISOString());

    // Get playlist activity metrics
    const { data: playlistMetrics } = await supabase
      .from('playlists')
      .select('created_at, updated_at')
      .gte('updated_at', timeThreshold.toISOString());

    // Calculate real-time metrics
    const metrics = {
      timestamp: now.toISOString(),
      timeRange: timeRange,
      screens: {
        total: screenMetrics?.length || 0,
        online: screenMetrics?.filter(s => s.status === 'online').length || 0,
        offline: screenMetrics?.filter(s => s.status === 'offline').length || 0,
        connectivityRate: screenMetrics?.length > 0 ? 
          Math.round((screenMetrics.filter(s => s.status === 'online').length / screenMetrics.length) * 100) : 0
      },
      content: {
        mediaUploads: mediaMetrics?.length || 0,
        totalMediaSize: mediaMetrics?.reduce((sum, m) => sum + (m.file_size || 0), 0) || 0,
        playlistUpdates: playlistMetrics?.length || 0,
        uploadsByType: mediaMetrics?.reduce((acc, m) => {
          acc[m.type] = (acc[m.type] || 0) + 1;
          return acc;
        }, {}) || {}
      },
      system: {
        uptime: Math.round(process.uptime()),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
        activeConnections: screenMetrics?.filter(s => 
          s.last_heartbeat && new Date(s.last_heartbeat) > new Date(now.getTime() - 5 * 60 * 1000)
        ).length || 0
      }
    };

    // Add historical data if requested
    if (includeHistory) {
      // Generate hourly buckets for the time range
      const buckets = [];
      const bucketSize = timeRange === '7d' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000; // 1 day or 1 hour
      const bucketCount = timeRange === '7d' ? 7 : (timeRange === '24h' ? 24 : 6);

      for (let i = 0; i < bucketCount; i++) {
        const bucketStart = new Date(now.getTime() - (i + 1) * bucketSize);
        const bucketEnd = new Date(now.getTime() - i * bucketSize);
        
        buckets.unshift({
          timestamp: bucketStart.toISOString(),
          mediaUploads: mediaMetrics?.filter(m => {
            const created = new Date(m.created_at);
            return created >= bucketStart && created < bucketEnd;
          }).length || 0,
          playlistUpdates: playlistMetrics?.filter(p => {
            const updated = new Date(p.updated_at);
            return updated >= bucketStart && updated < bucketEnd;
          }).length || 0
        });
      }

      metrics.history = buckets;
    }

    res.json({
      success: true,
      metrics: metrics
    });
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({
      error: 'Failed to fetch metrics',
      code: 'METRICS_ERROR'
    });
  }
});

/**
 * GET /dashboard/alerts
 * Get system alerts and notifications
 */
router.get('/alerts', async (req, res) => {
  try {
    const severity = req.query.severity; // critical, warning, info
    const limit = parseInt(req.query.limit) || 50;

    const alerts = [];
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Check for offline screens
    const { data: screens } = await supabase
      .from('screens')
      .select('name, status, last_heartbeat, location');

    if (screens) {
      screens.forEach(screen => {
        if (screen.status === 'offline') {
          alerts.push({
            id: `screen-offline-${screen.name}`,
            type: 'screen',
            severity: 'warning',
            title: `Screen "${screen.name}" is offline`,
            message: `Screen has been offline${screen.location ? ` at ${screen.location}` : ''}`,
            timestamp: screen.last_heartbeat || now.toISOString(),
            metadata: {
              screenName: screen.name,
              location: screen.location,
              lastSeen: screen.last_heartbeat
            }
          });
        } else if (screen.status === 'online' && (!screen.last_heartbeat || new Date(screen.last_heartbeat) < fiveMinutesAgo)) {
          alerts.push({
            id: `screen-stale-${screen.name}`,
            type: 'screen',
            severity: 'warning',
            title: `Screen "${screen.name}" connection is stale`,
            message: `Screen shows online but hasn't sent heartbeat recently${screen.location ? ` at ${screen.location}` : ''}`,
            timestamp: screen.last_heartbeat || now.toISOString(),
            metadata: {
              screenName: screen.name,
              location: screen.location,
              lastHeartbeat: screen.last_heartbeat
            }
          });
        }
      });
    }

    // Check for unassigned screens
    const { data: unassignedScreens } = await supabase
      .from('screens')
      .select(`
        name,
        location,
        created_at,
        screen_assignments (
          id
        )
      `)
      .is('screen_assignments.id', null);

    if (unassignedScreens) {
      unassignedScreens.forEach(screen => {
        alerts.push({
          id: `screen-unassigned-${screen.name}`,
          type: 'content',
          severity: 'info',
          title: `Screen "${screen.name}" has no playlist assigned`,
          message: `Screen is not displaying any content${screen.location ? ` at ${screen.location}` : ''}`,
          timestamp: screen.created_at,
          metadata: {
            screenName: screen.name,
            location: screen.location
          }
        });
      });
    }

    // Check for empty playlists
    const { data: emptyPlaylists } = await supabase
      .from('playlists')
      .select(`
        name,
        created_at,
        playlist_items (
          id
        )
      `)
      .is('playlist_items.id', null);

    if (emptyPlaylists) {
      emptyPlaylists.forEach(playlist => {
        alerts.push({
          id: `playlist-empty-${playlist.name}`,
          type: 'content',
          severity: 'warning',
          title: `Playlist "${playlist.name}" is empty`,
          message: 'Playlist contains no media items',
          timestamp: playlist.created_at,
          metadata: {
            playlistName: playlist.name
          }
        });
      });
    }

    // Filter by severity if specified
    let filteredAlerts = alerts;
    if (severity) {
      filteredAlerts = alerts.filter(alert => alert.severity === severity);
    }

    // Sort by timestamp (newest first) and limit
    const sortedAlerts = filteredAlerts
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Calculate alert statistics
    const alertStats = {
      total: sortedAlerts.length,
      bySeverity: sortedAlerts.reduce((acc, alert) => {
        acc[alert.severity] = (acc[alert.severity] || 0) + 1;
        return acc;
      }, {}),
      byType: sortedAlerts.reduce((acc, alert) => {
        acc[alert.type] = (acc[alert.type] || 0) + 1;
        return acc;
      }, {}),
      recent: sortedAlerts.filter(a => 
        new Date(a.timestamp) > oneHourAgo
      ).length
    };

    res.json({
      success: true,
      alerts: sortedAlerts,
      stats: alertStats,
      filters: {
        severity: severity || 'all',
        limit: limit
      }
    });
  } catch (error) {
    console.error('Alerts error:', error);
    res.status(500).json({
      error: 'Failed to fetch alerts',
      code: 'ALERTS_ERROR'
    });
  }
});

module.exports = router;