const multer = require('multer');

/**
 * Uploads an image for use inside an email (campaigns and personal emails).
 * The file's real type is checked from its bytes, not its name, and it goes to
 * the same object storage as other uploads so mail clients can load it.
 */
const MAX_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

const receiveImage = (req, res, next) =>
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Images can be up to 5 MB.' : 'Couldn’t read that file.';
    return res.status(400).json({ success: false, message });
  });

async function uploadEmailImage(req, res) {
  try {
    const storage = require('../services/s3Service');
    if (!storage.isStorageConfigured()) {
      return res.status(503).json({ success: false, message: 'Image storage isn’t set up on the server. Use an image address instead.' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image to upload.' });

    const { sniffImageType } = require('../services/liveChatMediaService');
    const type = sniffImageType(req.file.buffer);
    if (!type) return res.status(400).json({ success: false, message: 'Use a JPEG, PNG, WebP or GIF image.' });

    const { url } = await storage.uploadFileToS3(req.file.buffer, `email${type.ext}`, type.mime, 'email-images');
    console.log(`[EmailImage] Uploaded ${req.file.size} bytes by user ${req.user.id}`);
    return res.status(201).json({ success: true, data: { url } });
  } catch (error) {
    console.error('[EmailImage] Upload failed:', error.message);
    return res.status(500).json({ success: false, message: 'The image couldn’t be uploaded. Please try again.' });
  }
}

module.exports = { receiveImage, uploadEmailImage };
