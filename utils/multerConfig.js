const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Check if S3 is configured
const useS3 = process.env.AWS_ACCESS_KEY_ID && 
              process.env.AWS_SECRET_ACCESS_KEY && 
              process.env.AWS_S3_BUCKET;

let upload;

if (useS3) {
  // Use S3 storage
  console.log('✅ Using AWS S3 for file uploads');
  const { uploadToS3 } = require('../services/s3Service');
  upload = uploadToS3;
} else {
  // Fallback to local storage
  console.log('⚠️ AWS S3 not configured, using local storage');
  
  const uploadPath = 'uploads/';
  
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath);
  }
  
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadPath),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = file.originalname.replace(ext, '').toLowerCase().split(' ').join('-');
      cb(null, `${name}-${Date.now()}${ext}`);
    },
  });
  
  const fileFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only image files are allowed for thumbnails'));
    }
    cb(null, true);
  };
  
  upload = multer({ storage, fileFilter });
}

module.exports = { upload };