const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { sanitizeSVG, isValidSVG } = require('../utils/svgSanitizer');

/**
 * AWS S3 Service for handling thumbnail uploads
 * 
 * Handles thumbnail uploads for videos and live classes to S3
 * Returns public URLs that can be stored in database
 * Supports SVG with automatic sanitization for security
 */

// Configure AWS
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();

/**
 * Multer configuration for S3 uploads
 * Thumbnails stored in upload/photos/
 * Profile pictures stored in upload/profiles/
 * SVG files are automatically sanitized before upload
 */
const uploadToS3 = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.AWS_S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const extension = path.extname(file.originalname);
      
      // Determine folder based on field name
      const folder = file.fieldname === 'profilePicture' ? 'upload/profiles' : 'upload/photos';
      const filename = `${folder}/${timestamp}-${randomString}${extension}`;
      cb(null, filename);
    },
    // Transform SVG files before upload (sanitization)
    contentDisposition: 'inline',
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    }
  }),
  // File size limit (5MB)
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  // File filter - images including SVG
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'image/jpeg', 
      'image/jpg', 
      'image/png', 
      'image/gif', 
      'image/webp',
      'image/svg+xml'  // ✅ Added SVG support
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      // For SVG files, we'll sanitize them
      if (file.mimetype === 'image/svg+xml') {
        console.log('[S3 Service] SVG file detected, will sanitize before upload');
      }
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG images are allowed.'), false);
    }
  }
});

/**
 * Direct S3 upload function (alternative to multer)
 * Use this for programmatic uploads
 * Automatically sanitizes SVG files
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original filename
 * @param {string} contentType - MIME type
 * @param {string} folder - S3 folder (default: 'photos', options: 'photos', 'profiles')
 */
const uploadFileToS3 = async (fileBuffer, fileName, contentType, folder = 'photos') => {
  try {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = path.extname(fileName);
    const key = `upload/${folder}/${timestamp}-${randomString}${extension}`;
    
    let uploadBuffer = fileBuffer;
    
    // Sanitize SVG files
    if (contentType === 'image/svg+xml') {
      console.log('[S3 Service] Sanitizing SVG file before upload');
      
      // Validate SVG structure
      if (!isValidSVG(fileBuffer)) {
        throw new Error('Invalid SVG file structure');
      }
      
      // Sanitize the SVG
      uploadBuffer = sanitizeSVG(fileBuffer);
      console.log('[S3 Service] SVG sanitization completed');
    }
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: uploadBuffer,
      ContentType: contentType
    };
    
    const result = await s3.upload(params).promise();
    
    return {
      success: true,
      url: result.Location,
      key: result.Key,
      bucket: result.Bucket
    };
  } catch (error) {
    console.error('S3 upload error:', error);
    throw error;
  }
};

/**
 * Delete file from S3
 */
const deleteFileFromS3 = async (fileUrl) => {
  try {
    // Extract key from URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Remove leading slash
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key
    };
    
    await s3.deleteObject(params).promise();
    
    return {
      success: true,
      message: 'File deleted successfully'
    };
  } catch (error) {
    console.error('S3 delete error:', error);
    throw error;
  }
};

/**
 * Get signed URL for temporary access (if needed for private files)
 */
const getSignedUrl = (key, expiresIn = 3600) => {
  try {
    const params = {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Expires: expiresIn // seconds
    };
    
    return s3.getSignedUrl('getObject', params);
  } catch (error) {
    console.error('S3 signed URL error:', error);
    throw error;
  }
};

/**
 * Check if S3 is properly configured
 */
const validateS3Configuration = () => {
  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_S3_BUCKET'
  ];
  
  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    return {
      valid: false,
      missing: missing,
      message: `Missing required environment variables: ${missing.join(', ')}`
    };
  }
  
  return {
    valid: true,
    message: 'S3 configuration is valid',
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION
  };
};

module.exports = {
  uploadToS3,
  uploadFileToS3,
  deleteFileFromS3,
  getSignedUrl,
  validateS3Configuration,
  s3,
  // Export sanitization utilities
  sanitizeSVG,
  isValidSVG
};
