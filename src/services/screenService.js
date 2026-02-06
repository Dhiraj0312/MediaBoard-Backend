const { supabase } = require('../config/supabase');
const { ApiError } = require('../middleware/errorHandler');

class ScreenService {
  constructor() {
    this.heartbeatTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Generate unique device code
   */
  generateDeviceCode() {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }

  /**
   * Check if device code is unique
   */
  async isDeviceCodeUnique(deviceCode, excludeId = null) {
    let query = supabase
      .from('screens')
      .select('id')
      .eq('device_code', deviceCode);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data } = await query.single();
    return !data;
  }

  /**
   * Generate unique device code with retry logic
   */
  async generateUniqueDeviceCode(excludeId = null) {
    let deviceCode;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      deviceCode = this.generateDeviceCode();
      
      if (await this.isDeviceCodeUnique(deviceCode, excludeId)) {
        return deviceCode;
      }
      
      attempts++;
    }

    throw new ApiError('Failed to generate unique device code', 500, 'DEVICE_CODE_GENERATION_FAILED');
  }

  /**
   * Create a new screen
   */
  async createScreen(screenData) {
    const { name, location } = screenData;

    // Generate unique device code
    const deviceCode = await this.generateUniqueDeviceCode();

    const { data, error } = await supabase
      .from('screens')
      .insert({
        name: name.trim(),
        location: location?.trim() || null,
        device_code: deviceCode,
        status: 'offline'
      })
      .select()
      .single();

    if (error) {
      throw new ApiError(`Failed to create screen: ${error.message}`, 400, 'CREATE_FAILED');
    }

    return data;
  }

  /**
   * Get all screens with optional filtering
   */
  async getScreens(filters = {}) {
    const { 
      status, 
      location, 
      page = 1, 
      limit = 50,
      sortBy = 'created_at',
      sortOrder = 'desc',
      includeAssignments = true
    } = filters;

    // Build query
    let query = supabase.from('screens');

    if (includeAssignments) {
      query = query.select(`
        *,
        screen_assignments (
          id,
          assigned_at,
          playlists (
            id,
            name
          )
        )
      `);
    } else {
      query = query.select('*');
    }

    // Apply filters
    if (status) {
      query = query.eq('status', status);
    }

    if (location) {
      query = query.ilike('location', `%${location}%`);
    }

    // Apply sorting
    const validSortFields = ['name', 'status', 'location', 'created_at', 'updated_at', 'last_heartbeat'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
    const ascending = sortOrder.toLowerCase() === 'asc';
    
    query = query.order(sortField, { ascending });

    // Apply pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    
    query = query.range(offset, offset + limitNum - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new ApiError(`Failed to fetch screens: ${error.message}`, 500, 'FETCH_FAILED');
    }

    // Format response data
    const screens = data.map(screen => ({
      ...screen,
      assignedPlaylist: screen.screen_assignments?.[0]?.playlists || null,
      assignmentDate: screen.screen_assignments?.[0]?.assigned_at || null,
      isOnline: this.isScreenOnline(screen.last_heartbeat),
      screen_assignments: undefined // Remove from response
    }));

    return {
      screens,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        totalPages: Math.ceil(count / limitNum)
      }
    };
  }

  /**
   * Get screen by ID
   */
  async getScreenById(screenId) {
    const { data, error } = await supabase
      .from('screens')
      .select(`
        *,
        screen_assignments (
          id,
          assigned_at,
          playlists (
            id,
            name,
            description
          )
        )
      `)
      .eq('id', screenId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to fetch screen: ${error.message}`, 500, 'FETCH_FAILED');
    }

    // Format response
    return {
      ...data,
      assignedPlaylist: data.screen_assignments?.[0]?.playlists || null,
      assignmentDate: data.screen_assignments?.[0]?.assigned_at || null,
      isOnline: this.isScreenOnline(data.last_heartbeat),
      screen_assignments: undefined
    };
  }

  /**
   * Get screen by device code
   */
  async getScreenByDeviceCode(deviceCode) {
    const { data, error } = await supabase
      .from('screens')
      .select('*')
      .eq('device_code', deviceCode)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to fetch screen: ${error.message}`, 500, 'FETCH_FAILED');
    }

    return {
      ...data,
      isOnline: this.isScreenOnline(data.last_heartbeat)
    };
  }

  /**
   * Update screen
   */
  async updateScreen(screenId, updates) {
    const validUpdates = {};
    
    if (updates.name !== undefined) validUpdates.name = updates.name.trim();
    if (updates.location !== undefined) validUpdates.location = updates.location?.trim() || null;
    if (updates.status !== undefined) validUpdates.status = updates.status;
    
    validUpdates.updated_at = new Date().toISOString();

    if (Object.keys(validUpdates).length === 1) { // Only updated_at
      throw new ApiError('No valid updates provided', 400, 'NO_UPDATES');
    }

    const { data, error } = await supabase
      .from('screens')
      .update(validUpdates)
      .eq('id', screenId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to update screen: ${error.message}`, 400, 'UPDATE_FAILED');
    }

    return {
      ...data,
      isOnline: this.isScreenOnline(data.last_heartbeat)
    };
  }

  /**
   * Delete screen
   */
  async deleteScreen(screenId) {
    // First check if screen exists
    const { data: screen, error: fetchError } = await supabase
      .from('screens')
      .select('name')
      .eq('id', screenId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to fetch screen: ${fetchError.message}`, 500, 'FETCH_FAILED');
    }

    // Delete the screen (assignments will be deleted by CASCADE)
    const { error } = await supabase
      .from('screens')
      .delete()
      .eq('id', screenId);

    if (error) {
      throw new ApiError(`Failed to delete screen: ${error.message}`, 500, 'DELETE_FAILED');
    }

    return screen.name;
  }

  /**
   * Regenerate device code
   */
  async regenerateDeviceCode(screenId) {
    const deviceCode = await this.generateUniqueDeviceCode(screenId);

    const { data, error } = await supabase
      .from('screens')
      .update({
        device_code: deviceCode,
        updated_at: new Date().toISOString()
      })
      .eq('id', screenId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to regenerate device code: ${error.message}`, 400, 'REGENERATE_FAILED');
    }

    return data;
  }

  /**
   * Update screen heartbeat
   */
  async updateHeartbeat(deviceCode, status = 'online') {
    const { data, error } = await supabase
      .from('screens')
      .update({
        status: status,
        last_heartbeat: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('device_code', deviceCode)
      .select('id, name, status')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }
      throw new ApiError(`Failed to update heartbeat: ${error.message}`, 500, 'HEARTBEAT_FAILED');
    }

    return data;
  }

  /**
   * Get screen statistics
   */
  async getScreenStats() {
    const { data: screens, error } = await supabase
      .from('screens')
      .select('status, last_heartbeat');

    if (error) {
      throw new ApiError(`Failed to fetch screen stats: ${error.message}`, 500, 'STATS_FAILED');
    }

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.heartbeatTimeout);

    const stats = {
      total: screens.length,
      online: screens.filter(s => s.status === 'online').length,
      offline: screens.filter(s => s.status === 'offline').length,
      recentlyActive: screens.filter(s => 
        s.last_heartbeat && new Date(s.last_heartbeat) > cutoffTime
      ).length
    };

    return stats;
  }

  /**
   * Check if screen is considered online based on heartbeat
   */
  isScreenOnline(lastHeartbeat) {
    if (!lastHeartbeat) return false;
    
    const now = new Date();
    const heartbeatTime = new Date(lastHeartbeat);
    return (now - heartbeatTime) < this.heartbeatTimeout;
  }

  /**
   * Get screens that haven't sent heartbeat recently
   */
  async getOfflineScreens() {
    const { data: screens, error } = await supabase
      .from('screens')
      .select('id, name, device_code, last_heartbeat, status')
      .order('last_heartbeat', { ascending: true });

    if (error) {
      throw new ApiError(`Failed to fetch offline screens: ${error.message}`, 500, 'FETCH_FAILED');
    }

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - this.heartbeatTimeout);

    return screens.filter(screen => {
      if (!screen.last_heartbeat) return true;
      return new Date(screen.last_heartbeat) < cutoffTime;
    });
  }

  /**
   * Bulk update screen statuses based on heartbeat
   */
  async updateScreenStatuses() {
    const offlineScreens = await this.getOfflineScreens();
    
    if (offlineScreens.length === 0) {
      return { updated: 0 };
    }

    const screenIds = offlineScreens.map(s => s.id);
    
    const { error } = await supabase
      .from('screens')
      .update({ 
        status: 'offline',
        updated_at: new Date().toISOString()
      })
      .in('id', screenIds)
      .neq('status', 'offline'); // Only update if not already offline

    if (error) {
      throw new ApiError(`Failed to update screen statuses: ${error.message}`, 500, 'STATUS_UPDATE_FAILED');
    }

    return { updated: offlineScreens.length };
  }
}

module.exports = { ScreenService };