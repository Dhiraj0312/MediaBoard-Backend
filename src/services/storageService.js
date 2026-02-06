const { supabase } = require('../config/supabase');
const path = require('path');

class StorageService {
  constructor() {
    this.bucketName = 'media';
  }

  /**
   * Upload media file to Supabase Storage
   */
  async uploadMedia(file, userId) {
    try {
      // Generate unique filename with user folder structure
      const fileExtension = path.extname(file.originalname);
      const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(2)}${fileExtension}`;
      
      // Upload file to Supabase Storage
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (error) {
        console.error('Storage upload error:', error);
        throw new Error(`Upload failed: ${error.message}`);
      }

      // Get public URL for the uploaded file
      const { data: { publicUrl } } = supabase.storage
        .from(this.bucketName)
        .getPublicUrl(fileName);

      return {
        path: fileName,
        url: publicUrl,
        size: file.size,
        mimeType: file.mimetype
      };
    } catch (error) {
      console.error('Error in uploadMedia:', error);
      throw error;
    }
  }

  /**
   * Delete media file from Supabase Storage
   */
  async deleteMedia(filePath) {
    try {
      const { error } = await supabase.storage
        .from(this.bucketName)
        .remove([filePath]);

      if (error) {
        console.error('Storage delete error:', error);
        throw new Error(`Delete failed: ${error.message}`);
      }

      return true;
    } catch (error) {
      console.error('Error in deleteMedia:', error);
      throw error;
    }
  }

  /**
   * Get public URL for a media file with fallback
   */
  getPublicUrl(filePath) {
    const { data: { publicUrl } } = supabase.storage
      .from(this.bucketName)
      .getPublicUrl(filePath);

    console.log('🔍 Generated public URL:', publicUrl);
    return publicUrl;
  }

  /**
   * Get signed URL as fallback (temporary access)
   */
  async getSignedUrl(filePath, expiresIn = 3600) {
    try {
      const { data, error } = await supabase.storage
        .from(this.bucketName)
        .createSignedUrl(filePath, expiresIn);

      if (error) {
        console.error('Signed URL error:', error);
        return this.getPublicUrl(filePath); // Fallback to public URL
      }

      console.log('🔍 Generated signed URL:', data.signedUrl);
      return data.signedUrl;
    } catch (error) {
      console.error('Error creating signed URL:', error);
      return this.getPublicUrl(filePath); // Fallback to public URL
    }
  }

  /**
   * Check if file type is supported
   */
  isValidFileType(mimeType) {
    const supportedTypes = [
      // Images
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      // Videos
      'video/mp4',
      'video/webm',
      'video/ogg'
    ];

    return supportedTypes.includes(mimeType.toLowerCase());
  }

  /**
   * Check if file size is within limits
   */
  isValidFileSize(size) {
    const maxSize = 50 * 1024 * 1024; // 50MB limit
    return size <= maxSize;
  }

  /**
   * Get media type from MIME type
   */
  getMediaType(mimeType) {
    if (mimeType.startsWith('image/')) {
      return 'image';
    } else if (mimeType.startsWith('video/')) {
      return 'video';
    }
    return 'unknown';
  }

  /**
   * Create storage bucket if it doesn't exist
   */
  async ensureBucketExists() {
    try {
      // Check if bucket exists
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      
      if (listError) {
        console.error('Error listing buckets:', listError);
        return false;
      }

      const bucketExists = buckets.some(bucket => bucket.name === this.bucketName);
      
      if (!bucketExists) {
        // Create bucket
        const { error: createError } = await supabase.storage.createBucket(this.bucketName, {
          public: true,
          allowedMimeTypes: [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'video/ogg'
          ],
          fileSizeLimit: 52428800 // 50MB
        });

        if (createError) {
          console.error('Error creating bucket:', createError);
          return false;
        }

        console.log(`Created storage bucket: ${this.bucketName}`);
      }

      return true;
    } catch (error) {
      console.error('Error in ensureBucketExists:', error);
      return false;
    }
  }
}

module.exports = { StorageService };