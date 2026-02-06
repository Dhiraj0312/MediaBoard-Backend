const express = require('express');
const { AssignmentService } = require('../services/assignmentService');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const { 
  validateAssignment,
  validateUUID 
} = require('../middleware/validation');

const router = express.Router();
const assignmentService = new AssignmentService();

/**
 * GET /assignments
 * Get all screen-playlist assignments with filtering and pagination
 */
router.get('/', asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50,
    sortBy = 'assigned_at',
    sortOrder = 'desc',
    screenId,
    playlistId,
    status
  } = req.query;

  const filters = {
    page: parseInt(page),
    limit: parseInt(limit),
    sortBy,
    sortOrder,
    screenId,
    playlistId,
    status,
    userId: req.user.id
  };

  const result = await assignmentService.getAssignments(filters);

  res.json({
    success: true,
    ...result
  });
}));

/**
 * POST /assignments
 * Create new screen-playlist assignment
 */
router.post('/', validateAssignment, asyncHandler(async (req, res) => {
  assignmentService.validateAssignmentData(req.body);
  
  const assignment = await assignmentService.createAssignment(req.body, req.user.id);

  res.status(201).json({
    success: true,
    message: 'Assignment created successfully',
    assignment
  });
}));

/**
 * PUT /assignments/:id
 * Update assignment
 */
router.put('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Assignment ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const assignment = await assignmentService.updateAssignment(id, req.body, req.user.id);

  res.json({
    success: true,
    message: 'Assignment updated successfully',
    assignment
  });
}));

/**
 * DELETE /assignments/:id
 * Remove assignment
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    validateUUID(id, 'Assignment ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const result = await assignmentService.removeAssignment(id, req.user.id);

  res.json({
    success: true,
    message: `Removed assignment: "${result.playlistName}" from "${result.screenName}"`
  });
}));

/**
 * DELETE /assignments/screen/:screenId
 * Remove assignment by screen ID
 */
router.delete('/screen/:screenId', asyncHandler(async (req, res) => {
  const { screenId } = req.params;

  try {
    validateUUID(screenId, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const result = await assignmentService.removeAssignmentByScreen(screenId, req.user.id);

  res.json({
    success: true,
    message: `Removed assignment: "${result.playlistName}" from "${result.screenName}"`
  });
}));

/**
 * POST /assignments/bulk
 * Bulk assign playlists to screens
 */
router.post('/bulk', asyncHandler(async (req, res) => {
  const { assignments } = req.body;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    throw new ApiError('Assignments array is required', 400, 'MISSING_ASSIGNMENTS');
  }

  if (assignments.length > 50) {
    throw new ApiError('Cannot process more than 50 assignments at once', 400, 'TOO_MANY_ASSIGNMENTS');
  }

  // Validate all assignments
  for (const assignment of assignments) {
    assignmentService.validateAssignmentData(assignment);
  }

  const results = await assignmentService.bulkAssign(assignments, req.user.id);

  res.json({
    success: true,
    message: `${results.successful.length} assignments created successfully${results.failed.length > 0 ? `, ${results.failed.length} failed` : ''}`,
    successful: results.successful,
    failed: results.failed.length > 0 ? results.failed : undefined
  });
}));

/**
 * GET /assignments/stats
 * Get assignment statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await assignmentService.getAssignmentStats(req.user.id);

  res.json({
    success: true,
    stats
  });
}));

/**
 * GET /assignments/unassigned-screens
 * Get screens without assignments
 */
router.get('/unassigned-screens', asyncHandler(async (req, res) => {
  const screens = await assignmentService.getUnassignedScreens();

  res.json({
    success: true,
    screens
  });
}));

/**
 * GET /assignments/screen/:screenId/history
 * Get assignment history for a screen
 */
router.get('/screen/:screenId/history', asyncHandler(async (req, res) => {
  const { screenId } = req.params;

  try {
    validateUUID(screenId, 'Screen ID');
  } catch (error) {
    throw new ApiError(error.message, 400, 'INVALID_ID');
  }

  const history = await assignmentService.getScreenAssignmentHistory(screenId);

  res.json({
    success: true,
    history
  });
}));

module.exports = router;
        