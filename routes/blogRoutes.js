const express = require('express');
const router = express.Router();
const multer = require('multer');
const blogController = require('../controllers/blogController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, matches other thumbnail uploads
  fileFilter: (req, file, cb) => {
    if (IMAGE_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
    return cb(new Error('Cover image must be JPEG, PNG, or WebP'));
  }
});

/**
 * Blog routes
 *
 * Public (no auth):
 * - GET  /api/blog/posts         - Published posts, paginated
 * - GET  /api/blog/posts/:slug   - A single published post
 *
 * Admin (auth + admin role):
 * - GET    /api/admin/blog/posts       - All posts regardless of status
 * - GET    /api/admin/blog/posts/:id   - Full record for editing
 * - POST   /api/admin/blog/posts       - Create (multipart, optional coverImage)
 * - PUT    /api/admin/blog/posts/:id   - Update (multipart, optional coverImage)
 * - DELETE /api/admin/blog/posts/:id   - Delete
 */

// ── Public ────────────────────────────────────────────────────────────────
router.get('/posts', blogController.listPublished);
router.get('/posts/:slug', blogController.getPublishedBySlug);

// ── Admin ─────────────────────────────────────────────────────────────────
router.get('/admin/posts', authMiddleware, adminMiddleware, blogController.listAll);
router.get('/admin/posts/:id', authMiddleware, adminMiddleware, blogController.getById);
router.post('/admin/posts', authMiddleware, adminMiddleware, upload.single('coverImage'), blogController.create);
router.put('/admin/posts/:id', authMiddleware, adminMiddleware, upload.single('coverImage'), blogController.update);
router.delete('/admin/posts/:id', authMiddleware, adminMiddleware, blogController.remove);

module.exports = router;
