const express = require('express');
const { supabase } = require('../config/supabase');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { 
  validateScreenCreate, 
  validateScreenUpdate,
  validateUUID 
} = require('../middleware/validation');

const router = express.Router();

/**
 * Generate unique device code
 */
function generateDeviceCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Check if device code is unique
 */
async function isDeviceCodeUnique(deviceCode, excludeId = null) {
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
async function generateUniqueDeviceCode(excludeId = null) {
  let deviceCode;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    deviceCode = generateDeviceCode();
    
    if (await isDeviceCodeUnique(deviceCode, excludeId)) {
      return deviceCode;
    }
    
    attempts++;
  }

  throw new ApiError('Failed to generate unique device code', 500, 'DEVICE_CODE_GENERATION_FAILED');
}

/**
 * GET /screens
 * Get all screens with optional filtering and pagination
 */
router.get('/', asyncHandler(async (req, res) => {
  const { 
    status, 
    location, 
    page = 1, 
    limit = 50,
    sortBy = 'created_at',
    sortOrder = 'desc'
  } = req.query;

  // Build query
  let query = supabase
    .from('screens')
    .select(`
      *,
      screen_assignments (
        id,
        playlists (
          id,
          name
        )
      )
    `);

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
    screen_assignments: undefined // Remove from response
  }));

  res.json({
    success: true,
    screens,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total: count,
      totalPages: Math.ceil(count / limitNum)
    }
  });
}));

/**
 * POST /screens
 * Create new screen
 */
router.post('/', validateScreenCreate, asyncHandler(async (req, res) => {
  const { name, location } = req.body;

  // Generate unique device code
  const deviceCode = await generateUniqueDeviceCode();

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

  res.status(201).json({
    success: true,
    message: 'Screen created successfully',
    screen: data
  });
}));

/**
 * GET /screens/:id
 * Get specific screen with assignment details
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

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
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
    }
    throw new ApiError(`Failed to fetch screen: ${error.message}`, 500, 'FETCH_FAILED');
  }

  // Format response
  const screen = {
    ...data,
    assignedPlaylist: data.screen_assignments?.[0]?.playlists || null,
    assignmentDate: data.screen_assignments?.[0]?.assigned_at || null,
    screen_assignments: undefined
  };

  res.json({
    success: true,
    screen
  });
}));

/**
 * PUT /screens/:id
 * Update screen
 */
router.put('/:id', validateScreenUpdate, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, location, status } = req.body;

  try {
    validateUUID(id, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (location !== undefined) updates.location = location?.trim() || null;
  if (status !== undefined) updates.status = status;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length === 1) { // Only updated_at
    throw new ApiError('No valid updates provided', 400, 'NO_UPDATES');
  }

  const { data, error } = await supabase
    .from('screens')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
    }
    throw new ApiError(`Failed to update screen: ${error.message}`, 400, 'UPDATE_FAILED');
  }

  res.json({
    success: true,
    message: 'Screen updated successfully',
    screen: data
  });
}));

/**
 * DELETE /screens/:id
 * Delete screen
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  // First check if screen exists
  const { data: screen, error: fetchError } = await supabase
    .from('screens')
    .select('name')
    .eq('id', id)
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
    .eq('id', id);

  if (error) {
    throw new ApiError(`Failed to delete screen: ${error.message}`, 500, 'DELETE_FAILED');
  }

  res.json({
    success: true,
    message: `Screen "${screen.name}" deleted successfully`
  });
}));

/**
 * POST /screens/:id/regenerate-code
 * Regenerate device code for screen
 */
router.post('/:id/regenerate-code', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  // Generate new unique device code
  const deviceCode = await generateUniqueDeviceCode(id);

  const { data, error } = await supabase
    .from('screens')
    .update({
      device_code: deviceCode,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
    }
    throw new ApiError(`Failed to regenerate device code: ${error.message}`, 400, 'REGENERATE_FAILED');
  }

  res.json({
    success: true,
    message: 'Device code regenerated successfully',
    screen: data
  });
}));

/**
 * GET /screens/:id/status
 * Get screen status and last heartbeat
 */
router.get('/:id/status', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const { data, error } = await supabase
    .from('screens')
    .select('id, name, status, last_heartbeat, device_code')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw new ApiError('Screen not found', 404, 'SCREEN_NOT_FOUND');
    }
    throw new ApiError(`Failed to fetch screen status: ${error.message}`, 500, 'FETCH_FAILED');
  }

  // Calculate if screen is considered online (heartbeat within last 5 minutes)
  const now = new Date();
  const lastHeartbeat = data.last_heartbeat ? new Date(data.last_heartbeat) : null;
  const isOnline = lastHeartbeat && (now - lastHeartbeat) < 5 * 60 * 1000; // 5 minutes

  res.json({
    success: true,
    status: {
      id: data.id,
      name: data.name,
      status: data.status,
      isOnline,
      lastHeartbeat: data.last_heartbeat,
      deviceCode: data.device_code,
      lastSeenMinutesAgo: lastHeartbeat ? Math.floor((now - lastHeartbeat) / 60000) : null
    }
  });
}));

/**
 * GET /screens/stats
 * Get screen statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  // Get all screens
  const { data: screens, error } = await supabase
    .from('screens')
    .select('status, last_heartbeat');

  if (error) {
    throw new ApiError(`Failed to fetch screen stats: ${error.message}`, 500, 'STATS_FAILED');
  }

  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  const stats = {
    total: screens.length,
    online: screens.filter(s => s.status === 'online').length,
    offline: screens.filter(s => s.status === 'offline').length,
    recentlyActive: screens.filter(s => 
      s.last_heartbeat && new Date(s.last_heartbeat) > fiveMinutesAgo
    ).length
  };

  res.json({
    success: true,
    stats
  });
}));

module.exports = router;