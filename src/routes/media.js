const express = require('express');
const multer = require('multer');
const { MediaService } = require('../services/mediaService');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { validateMediaUpdate, validateUUID } = require('../middleware/validation');

const router = express.Router();
const mediaService = new MediaService();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1 // Only allow single file upload
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg'
    ];
    
    if (allowedTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new ApiError(
        'Invalid file type. Only images (JPEG, PNG, GIF, WebP) and videos (MP4, WebM, OGG) are allowed.',
        400,
        'INVALID_FILE_TYPE'
      ));
    }
  }
});

// Multer error handler middleware
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 50MB.',
        code: 'FILE_TOO_LARGE'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Unexpected file field. Use "file" as the field name.',
        code: 'UNEXPECTED_FILE'
      });
    }
  }
  next(error);
};

/**
 * POST /media/upload
 * Upload media file
 */
router.post('/upload', upload.single('file'), handleMulterError, asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError('No file provided', 400, 'NO_FILE');
  }

  const media = await mediaService.uploadMedia(req.file, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Media uploaded successfully',
    media
  });
}));

/**
 * POST /media/upload/multiple
 * Upload multiple media files
 */
router.post('/upload/multiple', upload.array('files', 10), handleMulterError, asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new ApiError('No files provided', 400, 'NO_FILES');
  }

  const uploadPromises = req.files.map(file => 
    mediaService.uploadMedia(file, req.user.id)
  );

  const results = await Promise.allSettled(uploadPromises);
  
  const successful = results
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
    
  const failed = results
    .filter(result => result.status === 'rejected')
    .map(result => result.reason.message);

  res.status(201).json({
    success: true,
    message: `${successful.length} files uploaded successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
    media: successful,
    errors: failed.length > 0 ? failed : undefined
  });
}));

/**
 * GET /media
 * Get media files for the authenticated user with filtering and pagination
 */
router.get('/', asyncHandler(async (req, res) => {
  const { 
    type, 
    page = 1, 
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search
  } = req.query;

  const filters = {
    type,
    page: parseInt(page),
    limit: Math.min(100, parseInt(limit)),
    sortBy,
    sortOrder,
    search,
    userId: req.user.id
  };

  const result = await mediaService.getUserMedia(filters);

  res.json({
    success: true,
    ...result
  });
}));

/**
 * GET /media/all
 * Get all media files (admin access) with filtering and pagination
 */
router.get('/all', asyncHandler(async (req, res) => {
  const { 
    type, 
    page = 1, 
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search
  } = req.query;

  const filters = {
    type,
    page: parseInt(page),
    limit: Math.min(100, parseInt(limit)),
    sortBy,
    sortOrder,
    search
  };

  const result = await mediaService.getAllMedia(filters);

  res.json({
    success: true,
    ...result
  });
}));

/**
 * GET /media/:id
 * Get specific media file
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Media ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const media = await mediaService.getMediaById(id, req.user.id);

  res.json({
    success: true,
    media
  });
}));

/**
 * PUT /media/:id
 * Update media metadata
 */
router.put('/:id', validateMediaUpdate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    validateUUID(id, 'Media ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const media = await mediaService.updateMedia(id, updates, req.user.id);

  res.json({
    success: true,
    message: 'Media updated successfully',
    media
  });
}));

/**
 * DELETE /media/:id
 * Delete media file
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Media ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const mediaName = await mediaService.deleteMedia(id, req.user.id);

  res.json({
    success: true,
    message: `Media "${mediaName}" deleted successfully`
  });
}));

/**
 * DELETE /media/bulk
 * Delete multiple media files
 */
router.delete('/bulk', asyncHandler(async (req, res) => {
  const { mediaIds } = req.body;

  if (!mediaIds || !Array.isArray(mediaIds) || mediaIds.length === 0) {
    throw new ApiError('Media IDs array is required', 400, 'MISSING_MEDIA_IDS');
  }

  if (mediaIds.length > 50) {
    throw new ApiError('Cannot delete more than 50 media files at once', 400, 'TOO_MANY_FILES');
  }

  // Validate all IDs
  for (const id of mediaIds) {
    try {
      validateUUID(id, 'Media ID');
    } catch (error) {
      throw new ApiError(`Invalid media ID: ${id}`, 400, 'INVALID_ID');
    }
  }

  const results = await mediaService.bulkDeleteMedia(mediaIds, req.user.id);

  res.json({
    success: true,
    message: `${results.successful.length} media files deleted successfully${results.failed.length > 0 ? `, ${results.failed.length} failed` : ''}`,
    deleted: results.successful,
    errors: results.failed.length > 0 ? results.failed : undefined
  });
}));

/**
 * GET /media/stats
 * Get media statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await mediaService.getMediaStats(req.user.id);

  res.json({
    success: true,
    stats
  });
}));

/**
 * GET /media/stats/all
 * Get global media statistics (admin)
 */
router.get('/stats/all', asyncHandler(async (req, res) => {
  const stats = await mediaService.getMediaStats();

  res.json({
    success: true,
    stats
  });
}));

/**
 * POST /media/:id/duplicate
 * Create a copy of existing media file
 */
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Media ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const duplicatedMedia = await mediaService.duplicateMedia(id, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Media duplicated successfully',
    media: duplicatedMedia
  });
}));

module.exports = router;