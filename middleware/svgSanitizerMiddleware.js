const { sanitizeSVG, isValidSVG } = require('../utils/svgSanitizer');

/**
 * Middleware to sanitize SVG files after multer processes them
 * This runs after multer but before the file is uploaded to S3
 */
const sanitizeSVGUploads = (req, res, next) => {
  try {
    // Check if there are any files
    if (!req.files && !req.file) {
      return next();
    }

    // Handle single file upload
    if (req.file && req.file.mimetype === 'image/svg+xml') {
      console.log('[SVG Middleware] Sanitizing single SVG file');
      
      if (!isValidSVG(req.file.buffer)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid SVG file structure'
        });
      }
      
      req.file.buffer = sanitizeSVG(req.file.buffer);
      console.log('[SVG Middleware] SVG file sanitized successfully');
    }

    // Handle multiple file uploads
    if (req.files) {
      // Handle array of files
      if (Array.isArray(req.files)) {
        req.files.forEach(file => {
          if (file.mimetype === 'image/svg+xml') {
            console.log('[SVG Middleware] Sanitizing SVG file from array');
            
            if (!isValidSVG(file.buffer)) {
              throw new Error('Invalid SVG file structure');
            }
            
            file.buffer = sanitizeSVG(file.buffer);
          }
        });
      } 
      // Handle object with field names
      else {
        Object.keys(req.files).forEach(fieldName => {
          const files = req.files[fieldName];
          files.forEach(file => {
            if (file.mimetype === 'image/svg+xml') {
              console.log(`[SVG Middleware] Sanitizing SVG file from field: ${fieldName}`);
              
              if (!isValidSVG(file.buffer)) {
                throw new Error('Invalid SVG file structure');
              }
              
              file.buffer = sanitizeSVG(file.buffer);
            }
          });
        });
      }
      
      console.log('[SVG Middleware] All SVG files sanitized successfully');
    }

    next();
  } catch (error) {
    console.error('[SVG Middleware] Error sanitizing SVG:', error);
    return res.status(400).json({
      success: false,
      message: error.message || 'Failed to process SVG file'
    });
  }
};

module.exports = {
  sanitizeSVGUploads
};
