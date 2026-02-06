const { supabase } = require('../config/supabase');
const { ApiError } = require('../middleware/errorHandler');

class AssignmentService {
  constructor() {
    // Assignment service for managing screen-playlist assignments
  }

  /**
   * Get all assignments with filtering and pagination
   */
  async getAssignments(filters = {}) {
    try {
      const { 
        page = 1, 
        limit = 50,
        sortBy = 'assigned_at',
        sortOrder = 'desc',
        screenId,
        playlistId,
        status,
        userId
      } = filters;

      let query = supabase
        .from('screen_assignments')
        .select(`
          *,
          screens:screen_id (
            id,
            name,
            device_code,
            location,
            status,
            last_heartbeat
          ),
          playlists:playlist_id (
            id,
            name,
            description,
            created_by,
            playlist_items (
              id,
              order_index,
              duration,
              media:media_id (
                id,
                name,
                type
              )
            )
          )
        `, { count: 'exact' });

      // Apply filters
      if (screenId) {
        query = query.eq('screen_id', screenId);
      }

      if (playlistId) {
        query = query.eq('playlist_id', playlistId);
      }

      if (userId) {
        // Filter by playlists owned by the user
        query = query.eq('playlists.created_by', userId);
      }

      // Apply sorting
      const validSortFields = ['assigned_at', 'screens.name', 'playlists.name'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'assigned_at';
      const ascending = sortOrder.toLowerCase() === 'asc';
      
      query = query.order(sortField, { ascending });

      // Apply pagination
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;
      
      query = query.range(offset, offset + limitNum - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new ApiError(`Failed to fetch assignments: ${error.message}`, 500, 'FETCH_FAILED');
      }

      // Process assignments and add calculated fields
      const assignments = data.map(assignment => this.processAssignmentData(assignment));

      return {
        assignments,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum)
        }
      };
    } catch (error) {
      console.error('Error in getAssignments:', error);
      throw error;
    }
  }

  /**
   * Create new assignment
   */
  async createAssignment(assignmentData, userId) {
    try {
      const { screenId, playlistId } = assignmentData;

      // Validate screen exists
      const { data: screen, error: screenError } = await supabase
        .from('screens')
        .select('id, name')
        .eq('id', screenId)
        .single();

      if (screenError || !screen) {
        throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
      }

      // Validate playlist exists and belongs to user
      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .select('id, name')
        .eq('id', playlistId)
        .eq('created_by', userId)
        .single();

      if (playlistError || !playlist) {
        throw new ApiError('Playlist not found or access denied', 404, 'PLAYLIST_NOT_FOUND');
      }

      // Check if screen already has an assignment
      const { data: existingAssignment, error: checkError } = await supabase
        .from('screen_assignments')
        .select('id, playlist_id')
        .eq('screen_id', screenId)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw new ApiError(`Failed to check existing assignment: ${checkError.message}`, 500, 'CHECK_FAILED');
      }

      if (existingAssignment) {
        // Update existing assignment
        const { data, error } = await supabase
          .from('screen_assignments')
          .update({
            playlist_id: playlistId,
            assigned_at: new Date().toISOString()
          })
          .eq('screen_id', screenId)
          .select(`
            *,
            screens:screen_id (
              id,
              name,
              device_code,
              location,
              status,
              last_heartbeat
            ),
            playlists:playlist_id (
              id,
              name,
              description,
              created_by
            )
          `)
          .single();

        if (error) {
          throw new ApiError(`Failed to update assignment: ${error.message}`, 400, 'UPDATE_FAILED');
        }

        return this.processAssignmentData(data);
      } else {
        // Create new assignment
        const { data, error } = await supabase
          .from('screen_assignments')
          .insert({
            screen_id: screenId,
            playlist_id: playlistId,
            assigned_at: new Date().toISOString()
          })
          .select(`
            *,
            screens:screen_id (
              id,
              name,
              device_code,
              location,
              status,
              last_heartbeat
            ),
            playlists:playlist_id (
              id,
              name,
              description,
              created_by
            )
          `)
          .single();

        if (error) {
          throw new ApiError(`Failed to create assignment: ${error.message}`, 400, 'CREATE_FAILED');
        }

        return this.processAssignmentData(data);
      }
    } catch (error) {
      console.error('Error in createAssignment:', error);
      throw error;
    }
  }

  /**
   * Update assignment
   */
  async updateAssignment(assignmentId, updates, userId) {
    try {
      const { playlistId } = updates;

      // Validate assignment exists
      const { data: existingAssignment, error: fetchError } = await supabase
        .from('screen_assignments')
        .select(`
          *,
          playlists:playlist_id (
            created_by
          )
        `)
        .eq('id', assignmentId)
        .single();

      if (fetchError || !existingAssignment) {
        throw new ApiError('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND');
      }

      // Check if user owns the current playlist
      if (existingAssignment.playlists.created_by !== userId) {
        throw new ApiError('Access denied', 403, 'ACCESS_DENIED');
      }

      // Validate new playlist if provided
      if (playlistId) {
        const { data: playlist, error: playlistError } = await supabase
          .from('playlists')
          .select('id, name')
          .eq('id', playlistId)
          .eq('created_by', userId)
          .single();

        if (playlistError || !playlist) {
          throw new ApiError('Playlist not found or access denied', 404, 'PLAYLIST_NOT_FOUND');
        }
      }

      // Update assignment
      const updateData = {
        assigned_at: new Date().toISOString()
      };

      if (playlistId) {
        updateData.playlist_id = playlistId;
      }

      const { data, error } = await supabase
        .from('screen_assignments')
        .update(updateData)
        .eq('id', assignmentId)
        .select(`
          *,
          screens:screen_id (
            id,
            name,
            device_code,
            location,
            status,
            last_heartbeat
          ),
          playlists:playlist_id (
            id,
            name,
            description,
            created_by
          )
        `)
        .single();

      if (error) {
        throw new ApiError(`Failed to update assignment: ${error.message}`, 400, 'UPDATE_FAILED');
      }

      return this.processAssignmentData(data);
    } catch (error) {
      console.error('Error in updateAssignment:', error);
      throw error;
    }
  }

  /**
   * Remove assignment
   */
  async removeAssignment(assignmentId, userId) {
    try {
      // Validate assignment exists and user has access
      const { data: assignment, error: fetchError } = await supabase
        .from('screen_assignments')
        .select(`
          *,
          screens:screen_id (
            name
          ),
          playlists:playlist_id (
            name,
            created_by
          )
        `)
        .eq('id', assignmentId)
        .single();

      if (fetchError || !assignment) {
        throw new ApiError('Assignment not found', 404, 'ASSIGNMENT_NOT_FOUND');
      }

      // Check if user owns the playlist
      if (assignment.playlists.created_by !== userId) {
        throw new ApiError('Access denied', 403, 'ACCESS_DENIED');
      }

      // Remove assignment
      const { error } = await supabase
        .from('screen_assignments')
        .delete()
        .eq('id', assignmentId);

      if (error) {
        throw new ApiError(`Failed to remove assignment: ${error.message}`, 500, 'DELETE_FAILED');
      }

      return {
        screenName: assignment.screens.name,
        playlistName: assignment.playlists.name
      };
    } catch (error) {
      console.error('Error in removeAssignment:', error);
      throw error;
    }
  }

  /**
   * Remove assignment by screen ID
   */
  async removeAssignmentByScreen(screenId, userId) {
    try {
      // Find assignment for the screen
      const { data: assignment, error: fetchError } = await supabase
        .from('screen_assignments')
        .select(`
          *,
          screens:screen_id (
            name
          ),
          playlists:playlist_id (
            name,
            created_by
          )
        `)
        .eq('screen_id', screenId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          throw new ApiError('No assignment found for this screen', 404, 'ASSIGNMENT_NOT_FOUND');
        }
        throw new ApiError(`Failed to fetch assignment: ${fetchError.message}`, 500, 'FETCH_FAILED');
      }

      // Check if user owns the playlist
      if (assignment.playlists.created_by !== userId) {
        throw new ApiError('Access denied', 403, 'ACCESS_DENIED');
      }

      // Remove assignment
      const { error } = await supabase
        .from('screen_assignments')
        .delete()
        .eq('screen_id', screenId);

      if (error) {
        throw new ApiError(`Failed to remove assignment: ${error.message}`, 500, 'DELETE_FAILED');
      }

      return {
        screenName: assignment.screens.name,
        playlistName: assignment.playlists.name
      };
    } catch (error) {
      console.error('Error in removeAssignmentByScreen:', error);
      throw error;
    }
  }

  /**
   * Bulk assign playlists to screens
   */
  async bulkAssign(assignments, userId) {
    const results = {
      successful: [],
      failed: []
    };

    for (const assignment of assignments) {
      try {
        const result = await this.createAssignment(assignment, userId);
        results.successful.push({
          screenId: assignment.screenId,
          playlistId: assignment.playlistId,
          assignment: result
        });
      } catch (error) {
        results.failed.push({
          screenId: assignment.screenId,
          playlistId: assignment.playlistId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get assignment statistics
   */
  async getAssignmentStats(userId = null) {
    try {
      let query = supabase
        .from('screen_assignments')
        .select(`
          id,
          screens:screen_id (
            status
          ),
          playlists:playlist_id (
            created_by
          )
        `);

      if (userId) {
        query = query.eq('playlists.created_by', userId);
      }

      const { data, error } = await query;

      if (error) {
        throw new ApiError(`Failed to fetch assignment stats: ${error.message}`, 500, 'STATS_FAILED');
      }

      const stats = {
        total: data.length,
        onlineScreens: data.filter(a => a.screens.status === 'online').length,
        offlineScreens: data.filter(a => a.screens.status === 'offline').length
      };

      return stats;
    } catch (error) {
      console.error('Error in getAssignmentStats:', error);
      throw error;
    }
  }

  /**
   * Get screens without assignments
   */
  async getUnassignedScreens() {
    try {
      const { data, error } = await supabase
        .from('screens')
        .select(`
          id,
          name,
          device_code,
          location,
          status,
          last_heartbeat
        `)
        .not('id', 'in', `(
          SELECT screen_id FROM screen_assignments
        )`);

      if (error) {
        throw new ApiError(`Failed to fetch unassigned screens: ${error.message}`, 500, 'FETCH_FAILED');
      }

      return data;
    } catch (error) {
      console.error('Error in getUnassignedScreens:', error);
      throw error;
    }
  }

  /**
   * Get assignment history for a screen
   */
  async getScreenAssignmentHistory(screenId) {
    try {
      // Note: This would require an assignment_history table for full history
      // For now, we'll return the current assignment
      const { data, error } = await supabase
        .from('screen_assignments')
        .select(`
          *,
          playlists:playlist_id (
            id,
            name,
            description
          )
        `)
        .eq('screen_id', screenId)
        .order('assigned_at', { ascending: false });

      if (error) {
        throw new ApiError(`Failed to fetch assignment history: ${error.message}`, 500, 'FETCH_FAILED');
      }

      return data.map(assignment => this.processAssignmentData(assignment));
    } catch (error) {
      console.error('Error in getScreenAssignmentHistory:', error);
      throw error;
    }
  }

  /**
   * Process assignment data and add calculated fields
   */
  processAssignmentData(assignment) {
    const isScreenOnline = assignment.screens?.status === 'online';
    const lastHeartbeat = assignment.screens?.last_heartbeat;
    
    let lastSeen = null;
    if (lastHeartbeat) {
      const now = new Date();
      const heartbeatTime = new Date(lastHeartbeat);
      const diffMs = now - heartbeatTime;
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) lastSeen = 'Just now';
      else if (diffMins < 60) lastSeen = `${diffMins}m ago`;
      else if (diffMins < 1440) lastSeen = `${Math.floor(diffMins / 60)}h ago`;
      else lastSeen = `${Math.floor(diffMins / 1440)}d ago`;
    }

    return {
      ...assignment,
      screen: assignment.screens,
      playlist: assignment.playlists,
      isScreenOnline,
      lastSeen,
      screens: undefined, // Remove raw screens data
      playlists: undefined // Remove raw playlists data
    };
  }

  /**
   * Validate assignment data
   */
  validateAssignmentData(data) {
    const { screenId, playlistId } = data;

    if (!screenId) {
      throw new ApiError('Screen ID is required', 400, 'MISSING_SCREEN_ID');
    }

    if (!playlistId) {
      throw new ApiError('Playlist ID is required', 400, 'MISSING_PLAYLIST_ID');
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(screenId)) {
      throw new ApiError('Invalid screen ID format', 400, 'INVALID_SCREEN_ID');
    }

    if (!uuidRegex.test(playlistId)) {
      throw new ApiError('Invalid playlist ID format', 400, 'INVALID_PLAYLIST_ID');
    }
  }
}

module.exports = { AssignmentService };