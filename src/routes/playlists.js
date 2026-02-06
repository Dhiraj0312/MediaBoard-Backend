const express = require('express');
const { PlaylistService } = require('../services/playlistService');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { 
  validatePlaylistCreate, 
  validatePlaylistUpdate,
  validateUUID 
} = require('../middleware/validation');

const router = express.Router();
const playlistService = new PlaylistService();

/**
 * GET /playlists
 * Get all playlists for the authenticated user with filtering and pagination
 */
router.get('/', asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 20,
    sortBy = 'created_at',
    sortOrder = 'desc',
    search
  } = req.query;

  const filters = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder,
    search,
    userId: req.user.id
  };

  const result = await playlistService.getUserPlaylists(filters);

  res.json({
    success: true,
    ...result
  });
}));

/**
 * POST /playlists
 * Create new playlist
 */
router.post('/', validatePlaylistCreate, asyncHandler(async (req, res) => {
  const playlist = await playlistService.createPlaylist(req.body, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Playlist created successfully',
    playlist
  });
}));

/**
 * GET /playlists/:id
 * Get specific playlist
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Playlist ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const playlist = await playlistService.getPlaylistById(id, req.user.id);

  res.json({
    success: true,
    playlist
  });
}));

/**
 * PUT /playlists/:id
 * Update playlist
 */
router.put('/:id', validatePlaylistUpdate, asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Playlist ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const playlist = await playlistService.updatePlaylist(id, req.body, req.user.id);

  res.json({
    success: true,
    message: 'Playlist updated successfully',
    playlist
  });
}));

/**
 * DELETE /playlists/:id
 * Delete playlist
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Playlist ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const playlistName = await playlistService.deletePlaylist(id, req.user.id);

  res.json({
    success: true,
    message: `Playlist "${playlistName}" deleted successfully`
  });
}));

/**
 * POST /playlists/:id/duplicate
 * Duplicate playlist
 */
router.post('/:id/duplicate', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  try {
    validateUUID(id, 'Playlist ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const duplicatedPlaylist = await playlistService.duplicatePlaylist(id, name, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Playlist duplicated successfully',
    playlist: duplicatedPlaylist
  });
}));

/**
 * GET /playlists/stats
 * Get playlist statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await playlistService.getPlaylistStats(req.user.id);

  res.json({
    success: true,
    stats
  });
}));

/**
 * GET /playlists/:id/usage
 * Check if playlist can be safely deleted
 */
router.get('/:id/usage', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Playlist ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const canDelete = await playlistService.canDeletePlaylist(id);

  res.json({
    success: true,
    canDelete,
    message: canDelete ? 'Playlist can be safely deleted' : 'Playlist is assigned to screens'
  });
}));

module.exports = router;