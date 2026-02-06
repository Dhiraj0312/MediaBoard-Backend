const { supabase } = require('../config/supabase');
const { StorageService } = require('./storageService');
const { ApiError } = require('../middleware/errorHandler');

class PlaylistService {
  constructor() {
    this.storageService = new StorageService();
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(playlistData, userId) {
    try {
      const { name, description, items = [] } = playlistData;

      // Validate playlist name
      if (!name || name.trim().length === 0) {
        throw new ApiError('Playlist name is required', 400, 'MISSING_NAME');
      }

      if (name.trim().length > 100) {
        throw new ApiError('Playlist name must be less than 100 characters', 400, 'NAME_TOO_LONG');
      }

      // Validate description
      if (description && description.length > 500) {
        throw new ApiError('Description must be less than 500 characters', 400, 'DESCRIPTION_TOO_LONG');
      }

      // Validate items if provided
      if (items.length > 0) {
        await this.validatePlaylistItems(items, userId);
      }

      // Create playlist
      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .insert({
          name: name.trim(),
          description: description?.trim() || null,
          created_by: userId
        })
        .select()
        .single();

      if (playlistError) {
        throw new ApiError(`Failed to create playlist: ${playlistError.message}`, 400, 'CREATE_FAILED');
      }

      // Add playlist items if provided
      if (items.length > 0) {
        await this.updatePlaylistItems(playlist.id, items);
      }

      // Return complete playlist with items
      return await this.getPlaylistById(playlist.id, userId);
    } catch (error) {
      console.error('Error in createPlaylist:', error);
      throw error;
    }
  }

  /**
   * Get all playlists for a user with filtering and pagination
   */
  async getUserPlaylists(filters = {}) {
    try {
      const { 
        page = 1, 
        limit = 20,
        sortBy = 'created_at',
        sortOrder = 'desc',
        search,
        userId
      } = filters;

      let query = supabase
        .from('playlists')
        .select(`
          *,
          playlist_items (
            id,
            order_index,
            duration,
            media:media_id (
              id,
              name,
              type,
              file_path,
              mime_type,
              file_size
            )
          )
        `, { count: 'exact' })
        .eq('created_by', userId);

      // Apply search filter
      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      // Apply sorting
      const validSortFields = ['name', 'created_at', 'updated_at'];
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
        throw new ApiError(`Failed to fetch playlists: ${error.message}`, 500, 'FETCH_FAILED');
      }

      // Process playlists and add calculated fields
      const playlists = data.map(playlist => this.processPlaylistData(playlist));

      return {
        playlists,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum)
        }
      };
    } catch (error) {
      console.error('Error in getUserPlaylists:', error);
      throw error;
    }
  }

  /**
   * Get playlist by ID
   */
  async getPlaylistById(playlistId, userId) {
    try {
      const { data, error } = await supabase
        .from('playlists')
        .select(`
          *,
          playlist_items (
            id,
            order_index,
            duration,
            media:media_id (
              id,
              name,
              type,
              file_path,
              mime_type,
              file_size
            )
          )
        `)
        .eq('id', playlistId)
        .eq('created_by', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new ApiError('Playlist not found', 404, 'PLAYLIST_NOT_FOUND');
        }
        throw new ApiError(`Failed to fetch playlist: ${error.message}`, 500, 'FETCH_FAILED');
      }

      return this.processPlaylistData(data);
    } catch (error) {
      console.error('Error in getPlaylistById:', error);
      throw error;
    }
  }

  /**
   * Update playlist
   */
  async updatePlaylist(playlistId, updates, userId) {
    try {
      const { name, description, items } = updates;

      // Validate updates
      const validUpdates = {};
      
      if (name !== undefined) {
        if (!name || name.trim().length === 0) {
          throw new ApiError('Playlist name is required', 400, 'MISSING_NAME');
        }
        if (name.trim().length > 100) {
          throw new ApiError('Playlist name must be less than 100 characters', 400, 'NAME_TOO_LONG');
        }
        validUpdates.name = name.trim();
      }

      if (description !== undefined) {
        if (description && description.length > 500) {
          throw new ApiError('Description must be less than 500 characters', 400, 'DESCRIPTION_TOO_LONG');
        }
        validUpdates.description = description?.trim() || null;
      }

      validUpdates.updated_at = new Date().toISOString();

      // Update playlist metadata if there are changes
      if (Object.keys(validUpdates).length > 1) { // More than just updated_at
        const { error: updateError } = await supabase
          .from('playlists')
          .update(validUpdates)
          .eq('id', playlistId)
          .eq('created_by', userId);

        if (updateError) {
          if (updateError.code === 'PGRST116') {
            throw new ApiError('Playlist not found', 404, 'PLAYLIST_NOT_FOUND');
          }
          throw new ApiError(`Failed to update playlist: ${updateError.message}`, 400, 'UPDATE_FAILED');
        }
      }

      // Update playlist items if provided
      if (items !== undefined) {
        if (items.length > 0) {
          await this.validatePlaylistItems(items, userId);
        }
        await this.updatePlaylistItems(playlistId, items);
      }

      // Return updated playlist
      return await this.getPlaylistById(playlistId, userId);
    } catch (error) {
      console.error('Error in updatePlaylist:', error);
      throw error;
    }
  }

  /**
   * Delete playlist
   */
  async deletePlaylist(playlistId, userId) {
    try {
      // Check if playlist exists and belongs to user
      const { data: playlist, error: fetchError } = await supabase
        .from('playlists')
        .select('name')
        .eq('id', playlistId)
        .eq('created_by', userId)
        .single();

      if (fetchError) {
        if (fetchError.code === 'PGRST116') {
          throw new ApiError('Playlist not found', 404, 'PLAYLIST_NOT_FOUND');
        }
        throw new ApiError(`Failed to fetch playlist: ${fetchError.message}`, 500, 'FETCH_FAILED');
      }

      // Check if playlist is assigned to any screens
      const { data: assignments, error: assignmentError } = await supabase
        .from('screen_assignments')
        .select('id')
        .eq('playlist_id', playlistId);

      if (assignmentError) {
        throw new ApiError(`Failed to check playlist assignments: ${assignmentError.message}`, 500, 'ASSIGNMENT_CHECK_FAILED');
      }

      if (assignments.length > 0) {
        throw new ApiError('Cannot delete playlist that is assigned to screens. Please remove assignments first.', 400, 'PLAYLIST_IN_USE');
      }

      // Delete playlist (items will be deleted by CASCADE)
      const { error } = await supabase
        .from('playlists')
        .delete()
        .eq('id', playlistId)
        .eq('created_by', userId);

      if (error) {
        throw new ApiError(`Failed to delete playlist: ${error.message}`, 500, 'DELETE_FAILED');
      }

      return playlist.name;
    } catch (error) {
      console.error('Error in deletePlaylist:', error);
      throw error;
    }
  }

  /**
   * Duplicate playlist
   */
  async duplicatePlaylist(playlistId, newName, userId) {
    try {
      // Get original playlist
      const originalPlaylist = await this.getPlaylistById(playlistId, userId);

      // Create duplicate
      const duplicateData = {
        name: newName || `${originalPlaylist.name} (Copy)`,
        description: originalPlaylist.description,
        items: originalPlaylist.items.map(item => ({
          media_id: item.media.id,
          duration: item.duration
        }))
      };

      return await this.createPlaylist(duplicateData, userId);
    } catch (error) {
      console.error('Error in duplicatePlaylist:', error);
      throw error;
    }
  }

  /**
   * Get playlist statistics
   */
  async getPlaylistStats(userId = null) {
    try {
      let query = supabase
        .from('playlists')
        .select(`
          id,
          playlist_items (
            duration
          )
        `);

      if (userId) {
        query = query.eq('created_by', userId);
      }

      const { data, error } = await query;

      if (error) {
        throw new ApiError(`Failed to fetch playlist stats: ${error.message}`, 500, 'STATS_FAILED');
      }

      const stats = {
        total: data.length,
        totalItems: data.reduce((sum, playlist) => sum + playlist.playlist_items.length, 0),
        averageItems: data.length > 0 ? Math.round(data.reduce((sum, playlist) => sum + playlist.playlist_items.length, 0) / data.length) : 0,
        totalDuration: data.reduce((sum, playlist) => 
          sum + playlist.playlist_items.reduce((itemSum, item) => itemSum + item.duration, 0), 0
        )
      };

      // Format total duration in human readable format
      stats.totalDurationFormatted = this.formatDuration(stats.totalDuration);

      return stats;
    } catch (error) {
      console.error('Error in getPlaylistStats:', error);
      throw error;
    }
  }

  /**
   * Validate playlist items
   */
  async validatePlaylistItems(items, userId) {
    if (!Array.isArray(items)) {
      throw new ApiError('Items must be an array', 400, 'INVALID_ITEMS');
    }

    if (items.length > 100) {
      throw new ApiError('Playlist cannot have more than 100 items', 400, 'TOO_MANY_ITEMS');
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      if (!item.media_id) {
        throw new ApiError(`Item ${i + 1}: media_id is required`, 400, 'MISSING_MEDIA_ID');
      }

      if (!item.duration || item.duration < 1 || item.duration > 3600) {
        throw new ApiError(`Item ${i + 1}: duration must be between 1 and 3600 seconds`, 400, 'INVALID_DURATION');
      }

      // Verify media exists and belongs to user
      const { data: media, error: mediaError } = await supabase
        .from('media')
        .select('id')
        .eq('id', item.media_id)
        .eq('created_by', userId)
        .single();

      if (mediaError || !media) {
        throw new ApiError(`Item ${i + 1}: media not found or access denied`, 400, 'MEDIA_NOT_FOUND');
      }
    }
  }

  /**
   * Update playlist items
   */
  async updatePlaylistItems(playlistId, items) {
    try {
      // Delete existing items
      const { error: deleteError } = await supabase
        .from('playlist_items')
        .delete()
        .eq('playlist_id', playlistId);

      if (deleteError) {
        throw new ApiError(`Failed to delete existing items: ${deleteError.message}`, 500, 'DELETE_ITEMS_FAILED');
      }

      // Insert new items
      if (items.length > 0) {
        const playlistItems = items.map((item, index) => ({
          playlist_id: playlistId,
          media_id: item.media_id,
          order_index: index,
          duration: item.duration
        }));

        const { error: insertError } = await supabase
          .from('playlist_items')
          .insert(playlistItems);

        if (insertError) {
          throw new ApiError(`Failed to insert playlist items: ${insertError.message}`, 500, 'INSERT_ITEMS_FAILED');
        }
      }
    } catch (error) {
      console.error('Error in updatePlaylistItems:', error);
      throw error;
    }
  }

  /**
   * Process playlist data and add calculated fields
   */
  processPlaylistData(playlist) {
    // Sort playlist items by order_index
    const sortedItems = playlist.playlist_items.sort((a, b) => a.order_index - b.order_index);

    // Add public URLs to media items
    const items = sortedItems.map(item => ({
      id: item.id,
      order_index: item.order_index,
      duration: item.duration,
      media: {
        ...item.media,
        url: this.storageService.getPublicUrl(item.media.file_path)
      }
    }));

    // Calculate playlist statistics
    const totalDuration = items.reduce((sum, item) => sum + item.duration, 0);
    const totalItems = items.length;

    return {
      ...playlist,
      items,
      totalItems,
      totalDuration,
      totalDurationFormatted: this.formatDuration(totalDuration),
      playlist_items: undefined // Remove raw playlist_items
    };
  }

  /**
   * Format duration in human readable format
   */
  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;
      
      let result = `${hours}h`;
      if (minutes > 0) result += ` ${minutes}m`;
      if (remainingSeconds > 0) result += ` ${remainingSeconds}s`;
      
      return result;
    }
  }

  /**
   * Get playlists that use a specific media item
   */
  async getPlaylistsUsingMedia(mediaId, userId = null) {
    try {
      let query = supabase
        .from('playlist_items')
        .select(`
          playlists (
            id,
            name,
            created_by
          )
        `)
        .eq('media_id', mediaId);

      const { data, error } = await query;

      if (error) {
        throw new ApiError(`Failed to fetch playlists using media: ${error.message}`, 500, 'FETCH_FAILED');
      }

      let playlists = data.map(item => item.playlists);

      // Filter by user if specified
      if (userId) {
        playlists = playlists.filter(playlist => playlist.created_by === userId);
      }

      // Remove duplicates
      const uniquePlaylists = playlists.filter((playlist, index, self) => 
        index === self.findIndex(p => p.id === playlist.id)
      );

      return uniquePlaylists;
    } catch (error) {
      console.error('Error in getPlaylistsUsingMedia:', error);
      throw error;
    }
  }

  /**
   * Check if a playlist can be safely deleted
   */
  async canDeletePlaylist(playlistId) {
    try {
      const { data: assignments, error } = await supabase
        .from('screen_assignments')
        .select('id')
        .eq('playlist_id', playlistId);

      if (error) {
        throw new ApiError(`Failed to check playlist assignments: ${error.message}`, 500, 'ASSIGNMENT_CHECK_FAILED');
      }

      return assignments.length === 0;
    } catch (error) {
      console.error('Error in canDeletePlaylist:', error);
      return false;
    }
  }
}

module.exports = { PlaylistService };