const { supabase } = require('../config/supabase');
const { StorageService } = require('./storageService');
const { ApiError } = require('../middleware/errorHandler');

class MediaService {
  constructor() {
    this.storageService = new StorageService();
  }

  /**
   * Upload and save media file
   */
  async uploadMedia(file, userId) {
    try {
      // Validate file
      if (!this.storageService.isValidFileType(file.mimetype)) {
        throw new ApiError('Unsupported file type. Please upload images (JPEG, PNG, GIF, WebP) or videos (MP4, WebM, OGG).', 400, 'INVALID_FILE_TYPE');
      }

      if (!this.storageService.isValidFileSize(file.size)) {
        throw new ApiError('File size too large. Maximum size is 50MB.', 400, 'FILE_TOO_LARGE');
      }

      // Upload to storage
      const uploadResult = await this.storageService.uploadMedia(file, userId);

      // Save metadata to database
      const { data, error } = await supabase
        .from('media')
        .insert({
          name: file.originalname,
          type: this.storageService.getMediaType(file.mimetype),
          file_path: uploadResult.path,
          file_size: uploadResult.size,
          mime_type: uploadResult.mimeType,
          created_by: userId
        })
        .select()
        .single();

      if (error) {
        // Clean up uploaded file if database insert fails
        await this.storageService.deleteMedia(uploadResult.path);
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return {
        ...data,
        url: uploadResult.url
      };
    } catch (error) {
      console.error('Error in uploadMedia:', error);
      throw error;
    }
  }

  /**
   * Get media files for a user with filtering and pagination
   */
  async getUserMedia(filters = {}) {
    try {
      const { 
        type, 
        page = 1, 
        limit = 20,
        sortBy = 'created_at',
        sortOrder = 'desc',
        search,
        userId
      } = filters;

      let query = supabase
        .from('media')
        .select('*', { count: 'exact' })
        .eq('created_by', userId);

      // Apply filters
      if (type) {
        query = query.eq('type', type);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      // Apply sorting
      const validSortFields = ['name', 'type', 'file_size', 'created_at', 'updated_at'];
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
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      // Add public URLs to each media item
      const media = data.map(item => ({
        ...item,
        url: this.storageService.getPublicUrl(item.file_path)
      }));

      return {
        media,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum)
        }
      };
    } catch (error) {
      console.error('Error in getUserMedia:', error);
      throw error;
    }
  }

  /**
   * Get all media files (admin access) with filtering and pagination
   */
  async getAllMedia(filters = {}) {
    try {
      const { 
        type, 
        page = 1, 
        limit = 20,
        sortBy = 'created_at',
        sortOrder = 'desc',
        search
      } = filters;

      let query = supabase
        .from('media')
        .select(`
          *,
          profiles:created_by (
            email
          )
        `, { count: 'exact' });

      // Apply filters
      if (type) {
        query = query.eq('type', type);
      }

      if (search) {
        query = query.ilike('name', `%${search}%`);
      }

      // Apply sorting
      const validSortFields = ['name', 'type', 'file_size', 'created_at', 'updated_at'];
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
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      // Add public URLs to each media item
      const media = data.map(item => ({
        ...item,
        url: this.storageService.getPublicUrl(item.file_path),
        createdBy: item.profiles?.email || 'Unknown'
      }));

      return {
        media,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum)
        }
      };
    } catch (error) {
      console.error('Error in getAllMedia:', error);
      throw error;
    }
  }

  /**
   * Get media by ID
   */
  async getMediaById(mediaId, userId = null) {
    try {
      let query = supabase
        .from('media')
        .select('*')
        .eq('id', mediaId);

      // If userId provided, filter by user
      if (userId) {
        query = query.eq('created_by', userId);
      }

      const { data, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new ApiError('Media not found', 404, 'MEDIA_NOT_FOUND');
        }
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return {
        ...data,
        url: this.storageService.getPublicUrl(data.file_path)
      };
    } catch (error) {
      console.error('Error in getMediaById:', error);
      throw error;
    }
  }

  /**
   * Delete media file
   */
  async deleteMedia(mediaId, userId) {
    try {
      // Get media info first
      const media = await this.getMediaById(mediaId, userId);

      // Delete from storage
      await this.storageService.deleteMedia(media.file_path);

      // Delete from database
      const { error } = await supabase
        .from('media')
        .delete()
        .eq('id', mediaId)
        .eq('created_by', userId);

      if (error) {
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return media.name;
    } catch (error) {
      console.error('Error in deleteMedia:', error);
      throw error;
    }
  }

  /**
   * Bulk delete media files
   */
  async bulkDeleteMedia(mediaIds, userId) {
    const results = {
      successful: [],
      failed: []
    };

    for (const mediaId of mediaIds) {
      try {
        const mediaName = await this.deleteMedia(mediaId, userId);
        results.successful.push({ id: mediaId, name: mediaName });
      } catch (error) {
        results.failed.push({ id: mediaId, error: error.message });
      }
    }

    return results;
  }

  /**
   * Update media metadata
   */
  async updateMedia(mediaId, updates, userId) {
    try {
      const allowedUpdates = ['name'];
      const filteredUpdates = {};

      // Only allow specific fields to be updated
      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      if (Object.keys(filteredUpdates).length === 0) {
        throw new ApiError('No valid updates provided', 400, 'NO_VALID_UPDATES');
      }

      filteredUpdates.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('media')
        .update(filteredUpdates)
        .eq('id', mediaId)
        .eq('created_by', userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          throw new ApiError('Media not found', 404, 'MEDIA_NOT_FOUND');
        }
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return {
        ...data,
        url: this.storageService.getPublicUrl(data.file_path)
      };
    } catch (error) {
      console.error('Error in updateMedia:', error);
      throw error;
    }
  }

  /**
   * Duplicate media file
   */
  async duplicateMedia(mediaId, userId) {
    try {
      // Get original media
      const originalMedia = await this.getMediaById(mediaId, userId);

      // Create new database entry
      const { data, error } = await supabase
        .from('media')
        .insert({
          name: `${originalMedia.name} (Copy)`,
          type: originalMedia.type,
          file_path: originalMedia.file_path, // Same file path (shared storage)
          file_size: originalMedia.file_size,
          mime_type: originalMedia.mime_type,
          duration: originalMedia.duration,
          created_by: userId
        })
        .select()
        .single();

      if (error) {
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return {
        ...data,
        url: this.storageService.getPublicUrl(data.file_path)
      };
    } catch (error) {
      console.error('Error in duplicateMedia:', error);
      throw error;
    }
  }

  /**
   * Get media statistics
   */
  async getMediaStats(userId = null) {
    try {
      let query = supabase
        .from('media')
        .select('type, file_size');

      if (userId) {
        query = query.eq('created_by', userId);
      }

      const { data, error } = await query;

      if (error) {
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      const stats = {
        total: data.length,
        images: data.filter(m => m.type === 'image').length,
        videos: data.filter(m => m.type === 'video').length,
        totalSize: data.reduce((sum, m) => sum + (m.file_size || 0), 0),
        averageSize: data.length > 0 ? Math.round(data.reduce((sum, m) => sum + (m.file_size || 0), 0) / data.length) : 0
      };

      // Format total size in human readable format
      stats.totalSizeFormatted = this.formatFileSize(stats.totalSize);
      stats.averageSizeFormatted = this.formatFileSize(stats.averageSize);

      return stats;
    } catch (error) {
      console.error('Error in getMediaStats:', error);
      throw error;
    }
  }

  /**
   * Format file size in human readable format
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get media files used in playlists
   */
  async getMediaUsage(mediaId) {
    try {
      const { data, error } = await supabase
        .from('playlist_items')
        .select(`
          playlists (
            id,
            name
          )
        `)
        .eq('media_id', mediaId);

      if (error) {
        throw new ApiError(`Database error: ${error.message}`, 500, 'DATABASE_ERROR');
      }

      return data.map(item => item.playlists);
    } catch (error) {
      console.error('Error in getMediaUsage:', error);
      throw error;
    }
  }

  /**
   * Check if media can be safely deleted (not used in any playlists)
   */
  async canDeleteMedia(mediaId) {
    try {
      const usage = await this.getMediaUsage(mediaId);
      return usage.length === 0;
    } catch (error) {
      console.error('Error in canDeleteMedia:', error);
      return false;
    }
  }
}

module.exports = { MediaService };