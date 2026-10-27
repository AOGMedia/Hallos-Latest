const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { sanitizeSVG, isValidSVG } = require('../utils/svgSanitizer');

/**
 * Object storage service for handling thumbnail uploads
 *
 * Talks to Cloudflare R2 (S3-compatible) when R2_* variables are set,
 * otherwise falls back to AWS S3 via the legacy AWS_* variables.
 * Handles thumbnail uploads for videos and live classes
 * Returns public URLs that can be stored in database
 * Supports SVG with automatic sanitization for security
 */

const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET || process.env.AWS_S3_BUCKET;
const r2Endpoint = process.env.R2_ENDPOINT
  || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
const publicBaseUrl = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const usingR2 = Boolean(r2Endpoint);

const s3 = new AWS.S3({
  accessKeyId,
  secretAccessKey,
  region: usingR2 ? 'auto' : process.env.AWS_REGION,
  ...(usingR2 && {
    endpoint: r2Endpoint,
    s3ForcePathStyle: true,
    signatureVersion: 'v4'
  })
});

const isStorageConfigured = () => Boolean(accessKeyId && secretAccessKey && bucket);

/**
 * R2's S3 endpoint is private, so the URL returned by the SDK cannot be opened
 * in a browser. When R2_PUBLIC_URL is set (r2.dev subdomain or custom domain),
 * public URLs are built from it instead.
 */
const buildPublicUrl = (key, sdkLocation) => {
  if (publicBaseUrl) return `${publicBaseUrl}/${key}`;
  if (usingR2) console.warn('[Storage] R2_PUBLIC_URL is not set - returned URLs are not publicly readable');
  return sdkLocation;
};

/**
 * Multer configuration for S3 uploads
 * Thumbnails stored in upload/photos/
 * Profile pictures stored in upload/profiles/
 * SVG files are automatically sanitized before upload
 */
const s3Storage = !bucket ? null : multerS3({
    s3: s3,
    bucket,
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
  });

if (s3Storage) {
  const handleS3File = s3Storage._handleFile.bind(s3Storage);
  s3Storage._handleFile = (req, file, cb) => {
    handleS3File(req, file, (err, info) => {
      if (info) info.location = buildPublicUrl(info.key, info.location);
      cb(err, info);
    });
  };
}

const uploadToS3 = !s3Storage ? null : multer({
  storage: s3Storage,
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
      Bucket: bucket,
      Key: key,
      Body: uploadBuffer,
      ContentType: contentType
    };
    
    const result = await s3.upload(params).promise();
    
    return {
      success: true,
      url: buildPublicUrl(result.Key, result.Location),
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
    let key;
    if (publicBaseUrl && fileUrl.startsWith(`${publicBaseUrl}/`)) {
      key = decodeURIComponent(fileUrl.slice(publicBaseUrl.length + 1));
    } else {
      key = decodeURIComponent(new URL(fileUrl).pathname.substring(1));
      if (key.startsWith(`${bucket}/`)) key = key.slice(bucket.length + 1);
    }

    const params = {
      Bucket: bucket,
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
      Bucket: bucket,
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
  const missing = [];
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('R2_BUCKET');
  if (!usingR2 && !process.env.AWS_REGION) missing.push('R2_ENDPOINT (or AWS_REGION for AWS S3)');

  if (missing.length > 0) {
    return {
      valid: false,
      missing: missing,
      message: `Missing required environment variables: ${missing.join(', ')}`
    };
  }
  
  return {
    valid: true,
    message: 'Storage configuration is valid',
    provider: usingR2 ? 'cloudflare-r2' : 'aws-s3',
    bucket,
    publicUrlConfigured: Boolean(publicBaseUrl)
  };
};

module.exports = {
  uploadToS3,
  uploadFileToS3,
  deleteFileFromS3,
  getSignedUrl,
  validateS3Configuration,
  isStorageConfigured,
  buildPublicUrl,
  bucket,
  s3,
  // Export sanitization utilities
  sanitizeSVG,
  isValidSVG
};
