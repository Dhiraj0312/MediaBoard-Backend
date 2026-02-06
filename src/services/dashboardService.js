const { supabase } = require('../config/supabase');
const { MediaService } = require('./mediaService');

class DashboardService {
  constructor() {
    this.mediaService = new MediaService();
  }

  /**
   * Get comprehensive system statistics with caching
   */
  async getSystemStats(useCache = true) {
    try {
      // Check cache first (implement simple in-memory cache)
      const cacheKey = 'system_stats';
      const cacheExpiry = 5 * 60 * 1000; // 5 minutes
      
      if (useCache && this.cache && this.cache[cacheKey]) {
        const cached = this.cache[cacheKey];
        if (Date.now() - cached.timestamp < cacheExpiry) {
          return cached.data;
        }
      }

      const stats = await this.calculateSystemStats();
      
      // Cache the results
      if (!this.cache) this.cache = {};
      this.cache[cacheKey] = {
        timestamp: Date.now(),
        data: stats
      };

      return stats;
    } catch (error) {
      console.error('Error in getSystemStats:', error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive system statistics
   */
  async calculateSystemStats() {
    const now = new Date();
    const timeRanges = {
      oneHour: new Date(now.getTime() - 60 * 60 * 1000),
      oneDay: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      oneWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      oneMonth: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    };

    // Parallel data fetching for better performance
    const [
      screensData,
      mediaData,
      playlistsData,
      assignmentsData
    ] = await Promise.all([
      this.getScreensData(timeRanges),
      this.getMediaData(timeRanges),
      this.getPlaylistsData(timeRanges),
      this.getAssignmentsData(timeRanges)
    ]);

    // Calculate derived metrics
    const healthMetrics = this.calculateHealthMetrics(screensData, mediaData, playlistsData, assignmentsData);
    const trends = this.calculateTrends(screensData, mediaData, playlistsData, assignmentsData, timeRanges);
    const performance = this.calculatePerformanceMetrics();

    return {
      screens: screensData.stats,
      media: mediaData.stats,
      playlists: playlistsData.stats,
      assignments: assignmentsData.stats,
      system: {
        health: healthMetrics,
        performance: performance,
        timestamp: now.toISOString()
      },
      trends: trends
    };
  }

  /**
   * Get comprehensive screen data and statistics
   */
  async getScreensData(timeRanges) {
    const { data: screens, error } = await supabase
      .from('screens')
      .select('id, name, status, last_heartbeat, created_at, updated_at, location');

    if (error) throw error;

    const now = new Date();
    const stats = {
      total: screens.length,
      online: screens.filter(s => s.status === 'online').length,
      offline: screens.filter(s => s.status === 'offline').length,
      recentlyActive: screens.filter(s => 
        s.last_heartbeat && new Date(s.last_heartbeat) > timeRanges.oneHour
      ).length,
      activeToday: screens.filter(s => 
        s.last_heartbeat && new Date(s.last_heartbeat) > timeRanges.oneDay
      ).length,
      newThisWeek: screens.filter(s => 
        new Date(s.created_at) > timeRanges.oneWeek
      ).length,
      newThisMonth: screens.filter(s => 
        new Date(s.created_at) > timeRanges.oneMonth
      ).length,
      staleConnections: screens.filter(s => 
        s.status === 'online' && (!s.last_heartbeat || new Date(s.last_heartbeat) < new Date(now.getTime() - 5 * 60 * 1000))
      ).length,
      byLocation: screens.reduce((acc, screen) => {
        const location = screen.location || 'Unknown';
        acc[location] = (acc[location] || 0) + 1;
        return acc;
      }, {}),
      connectivityRate: screens.length > 0 ? Math.round((screens.filter(s => s.status === 'online').length / screens.length) * 100) : 0
    };

    return { screens, stats };
  }

  /**
   * Get comprehensive media data and statistics
   */
  async getMediaData(timeRanges) {
    const { data: media, error } = await supabase
      .from('media')
      .select('id, name, type, file_size, created_at, updated_at');

    if (error) throw error;

    const stats = {
      total: media.length,
      images: media.filter(m => m.type === 'image').length,
      videos: media.filter(m => m.type === 'video').length,
      totalSize: media.reduce((sum, m) => sum + (m.file_size || 0), 0),
      averageSize: media.length > 0 ? Math.round(media.reduce((sum, m) => sum + (m.file_size || 0), 0) / media.length) : 0,
      uploadedThisWeek: media.filter(m => new Date(m.created_at) > timeRanges.oneWeek).length,
      uploadedThisMonth: media.filter(m => new Date(m.created_at) > timeRanges.oneMonth).length,
      uploadTrend: {
        thisWeek: media.filter(m => new Date(m.created_at) > timeRanges.oneWeek).length,
        lastWeek: media.filter(m => {
          const created = new Date(m.created_at);
          const lastWeekStart = new Date(timeRanges.oneWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
          return created > lastWeekStart && created <= timeRanges.oneWeek;
        }).length
      },
      sizeDistribution: this.calculateSizeDistribution(media)
    };

    // Format sizes
    stats.totalSizeFormatted = this.formatFileSize(stats.totalSize);
    stats.averageSizeFormatted = this.formatFileSize(stats.averageSize);

    return { media, stats };
  }

  /**
   * Get comprehensive playlist data and statistics
   */
  async getPlaylistsData(timeRanges) {
    const { data: playlists, error } = await supabase
      .from('playlists')
      .select(`
        id,
        name,
        created_at,
        updated_at,
        playlist_items (
          id,
          duration
        )
      `);

    if (error) throw error;

    const stats = {
      total: playlists.length,
      empty: playlists.filter(p => !p.playlist_items || p.playlist_items.length === 0).length,
      withContent: playlists.filter(p => p.playlist_items && p.playlist_items.length > 0).length,
      averageItems: playlists.length > 0 ? 
        Math.round(playlists.reduce((sum, p) => sum + (p.playlist_items?.length || 0), 0) / playlists.length) : 0,
      totalItems: playlists.reduce((sum, p) => sum + (p.playlist_items?.length || 0), 0),
      averageDuration: this.calculateAveragePlaylistDuration(playlists),
      createdThisWeek: playlists.filter(p => new Date(p.created_at) > timeRanges.oneWeek).length,
      updatedThisWeek: playlists.filter(p => new Date(p.updated_at) > timeRanges.oneWeek).length,
      createdThisMonth: playlists.filter(p => new Date(p.created_at) > timeRanges.oneMonth).length,
      itemDistribution: this.calculateItemDistribution(playlists)
    };

    return { playlists, stats };
  }

  /**
   * Get comprehensive assignment data and statistics
   */
  async getAssignmentsData(timeRanges) {
    const { data: assignments, error } = await supabase
      .from('screen_assignments')
      .select(`
        id,
        assigned_at,
        screens (
          id,
          name,
          status,
          location
        ),
        playlists (
          id,
          name,
          playlist_items (
            id
          )
        )
      `);

    if (error) throw error;

    const stats = {
      total: assignments.length,
      activeAssignments: assignments.filter(a => a.screens?.status === 'online').length,
      inactiveAssignments: assignments.filter(a => a.screens?.status === 'offline').length,
      emptyPlaylistAssignments: assignments.filter(a => 
        !a.playlists?.playlist_items || a.playlists.playlist_items.length === 0
      ).length,
      assignedThisWeek: assignments.filter(a => new Date(a.assigned_at) > timeRanges.oneWeek).length,
      assignedThisMonth: assignments.filter(a => new Date(a.assigned_at) > timeRanges.oneMonth).length,
      byLocation: assignments.reduce((acc, assignment) => {
        const location = assignment.screens?.location || 'Unknown';
        acc[location] = (acc[location] || 0) + 1;
        return acc;
      }, {})
    };

    return { assignments, stats };
  }

  /**
   * Calculate system health metrics
   */
  calculateHealthMetrics(screensData, mediaData, playlistsData, assignmentsData) {
    const screenHealth = screensData.stats.total > 0 ? 
      Math.round((screensData.stats.online / screensData.stats.total) * 100) : 100;
    
    const contentHealth = screensData.stats.total > 0 ? 
      Math.round((assignmentsData.stats.total / screensData.stats.total) * 100) : 100;
    
    const playlistHealth = playlistsData.stats.total > 0 ? 
      Math.round(((playlistsData.stats.total - playlistsData.stats.empty) / playlistsData.stats.total) * 100) : 100;
    
    const systemUtilization = Math.round(
      ((screensData.stats.online + mediaData.stats.total + playlistsData.stats.withContent) / 
       Math.max(screensData.stats.total * 3, 1)) * 100
    );

    const overallHealth = Math.round((screenHealth + contentHealth + playlistHealth + systemUtilization) / 4);

    return {
      overall: overallHealth,
      status: overallHealth >= 80 ? 'healthy' : overallHealth >= 60 ? 'warning' : 'critical',
      components: {
        screens: {
          score: screenHealth,
          status: screenHealth >= 80 ? 'healthy' : screenHealth >= 60 ? 'warning' : 'critical'
        },
        content: {
          score: contentHealth,
          status: contentHealth >= 80 ? 'healthy' : contentHealth >= 60 ? 'warning' : 'critical'
        },
        playlists: {
          score: playlistHealth,
          status: playlistHealth >= 80 ? 'healthy' : playlistHealth >= 60 ? 'warning' : 'critical'
        },
        utilization: {
          score: systemUtilization,
          status: systemUtilization >= 60 ? 'healthy' : systemUtilization >= 40 ? 'warning' : 'critical'
        }
      }
    };
  }

  /**
   * Calculate trend data
   */
  calculateTrends(screensData, mediaData, playlistsData, assignmentsData, timeRanges) {
    return {
      screens: {
        growth: {
          thisWeek: screensData.stats.newThisWeek,
          thisMonth: screensData.stats.newThisMonth
        },
        activity: {
          activeToday: screensData.stats.activeToday,
          recentlyActive: screensData.stats.recentlyActive
        }
      },
      media: {
        uploads: mediaData.stats.uploadTrend,
        growth: {
          thisWeek: mediaData.stats.uploadedThisWeek,
          thisMonth: mediaData.stats.uploadedThisMonth
        }
      },
      playlists: {
        creation: {
          thisWeek: playlistsData.stats.createdThisWeek,
          thisMonth: playlistsData.stats.createdThisMonth
        },
        updates: {
          thisWeek: playlistsData.stats.updatedThisWeek
        }
      },
      assignments: {
        growth: {
          thisWeek: assignmentsData.stats.assignedThisWeek,
          thisMonth: assignmentsData.stats.assignedThisMonth
        }
      }
    };
  }

  /**
   * Calculate performance metrics
   */
  calculatePerformanceMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      uptime: Math.round(process.uptime()),
      memory: {
        used: memoryUsage.heapUsed,
        total: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
        usagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      nodeVersion: process.version,
      platform: process.platform
    };
  }

  /**
   * Helper methods
   */
  calculateSizeDistribution(media) {
    const ranges = {
      small: 0,    // < 1MB
      medium: 0,   // 1MB - 10MB
      large: 0,    // 10MB - 50MB
      xlarge: 0    // > 50MB
    };

    media.forEach(m => {
      const size = m.file_size || 0;
      if (size < 1024 * 1024) ranges.small++;
      else if (size < 10 * 1024 * 1024) ranges.medium++;
      else if (size < 50 * 1024 * 1024) ranges.large++;
      else ranges.xlarge++;
    });

    return ranges;
  }

  calculateAveragePlaylistDuration(playlists) {
    const totalDuration = playlists.reduce((sum, playlist) => {
      const playlistDuration = playlist.playlist_items?.reduce((itemSum, item) => 
        itemSum + (item.duration || 0), 0) || 0;
      return sum + playlistDuration;
    }, 0);

    return playlists.length > 0 ? Math.round(totalDuration / playlists.length) : 0;
  }

  calculateItemDistribution(playlists) {
    const distribution = {};
    playlists.forEach(playlist => {
      const itemCount = playlist.playlist_items?.length || 0;
      const range = itemCount === 0 ? 'empty' :
                   itemCount <= 5 ? 'small' :
                   itemCount <= 15 ? 'medium' : 'large';
      distribution[range] = (distribution[range] || 0) + 1;
    });
    return distribution;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clear cache (useful for testing or manual refresh)
   */
  clearCache() {
    this.cache = {};
  }

  /**
   * Get cache status
   */
  getCacheStatus() {
    return {
      enabled: !!this.cache,
      keys: this.cache ? Object.keys(this.cache) : [],
      size: this.cache ? Object.keys(this.cache).length : 0
    };
  }
}

module.exports = { DashboardService };