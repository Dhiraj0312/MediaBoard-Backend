const { ApiError } = require('./errorHandler');

/**
 * Validation middleware factory
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errorMessage = error.details
        .map(detail => detail.message)
        .join(', ');
      
      return next(new ApiError(errorMessage, 400, 'VALIDATION_ERROR'));
    }

    next();
  };
};

/**
 * Common validation schemas (using simple validation functions since we don't have Joi)
 */
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validateRequired = (value, fieldName) => {
  if (!value || (typeof value === 'string' && value.trim() === '')) {
    throw new ApiError(`${fieldName} is required`, 400, 'VALIDATION_ERROR');
  }
};

const validateLength = (value, min, max, fieldName) => {
  if (typeof value === 'string') {
    if (value.length < min) {
      throw new ApiError(`${fieldName} must be at least ${min} characters`, 400, 'VALIDATION_ERROR');
    }
    if (max && value.length > max) {
      throw new ApiError(`${fieldName} must be no more than ${max} characters`, 400, 'VALIDATION_ERROR');
    }
  }
};

const validateUUID = (value, fieldName) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(value)) {
    throw new ApiError(`${fieldName} must be a valid UUID`, 400, 'VALIDATION_ERROR');
  }
};

/**
 * Request validation middleware
 */
const validateLogin = (req, res, next) => {
  try {
    const { token } = req.body;
    validateRequired(token, 'Token');
    next();
  } catch (error) {
    next(error);
  }
};

const validateScreenCreate = (req, res, next) => {
  try {
    const { name, location } = req.body;
    
    validateRequired(name, 'Screen name');
    validateLength(name, 1, 100, 'Screen name');
    
    if (location) {
      validateLength(location, 0, 200, 'Location');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validateScreenUpdate = (req, res, next) => {
  try {
    const { name, location, status } = req.body;
    
    if (name !== undefined) {
      validateRequired(name, 'Screen name');
      validateLength(name, 1, 100, 'Screen name');
    }
    
    if (location !== undefined) {
      validateLength(location, 0, 200, 'Location');
    }
    
    if (status !== undefined) {
      const validStatuses = ['online', 'offline'];
      if (!validStatuses.includes(status)) {
        throw new ApiError('Status must be either "online" or "offline"', 400, 'VALIDATION_ERROR');
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validatePlaylistCreate = (req, res, next) => {
  try {
    const { name, description } = req.body;
    
    validateRequired(name, 'Playlist name');
    validateLength(name, 1, 100, 'Playlist name');
    
    if (description) {
      validateLength(description, 0, 500, 'Description');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validatePlaylistUpdate = (req, res, next) => {
  try {
    const { name, description } = req.body;
    
    if (name !== undefined) {
      validateRequired(name, 'Playlist name');
      validateLength(name, 1, 100, 'Playlist name');
    }
    
    if (description !== undefined) {
      validateLength(description, 0, 500, 'Description');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validateAssignment = (req, res, next) => {
  try {
    const { screenId, playlistId } = req.body;
    
    validateRequired(screenId, 'Screen ID');
    validateUUID(screenId, 'Screen ID');
    
    validateRequired(playlistId, 'Playlist ID');
    validateUUID(playlistId, 'Playlist ID');
    
    next();
  } catch (error) {
    next(error);
  }
};

const validateMediaUpdate = (req, res, next) => {
  try {
    const { name } = req.body;
    
    if (name !== undefined) {
      validateRequired(name, 'Media name');
      validateLength(name, 1, 200, 'Media name');
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validateHeartbeat = (req, res, next) => {
  try {
    const { status } = req.body;
    
    if (status !== undefined) {
      const validStatuses = ['online', 'offline'];
      if (!validStatuses.includes(status)) {
        throw new ApiError('Status must be either "online" or "offline"', 400, 'VALIDATION_ERROR');
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
};

const validateErrorReport = (req, res, next) => {
  try {
    const { error: errorMessage } = req.body;
    
    validateRequired(errorMessage, 'Error message');
    validateLength(errorMessage, 1, 1000, 'Error message');
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validate,
  validateEmail,
  validateRequired,
  validateLength,
  validateUUID,
  validateLogin,
  validateScreenCreate,
  validateScreenUpdate,
  validatePlaylistCreate,
  validatePlaylistUpdate,
  validateAssignment,
  validateMediaUpdate,
  validateHeartbeat,
  validateErrorReport
};