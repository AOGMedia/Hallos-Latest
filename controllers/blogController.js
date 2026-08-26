const blogService = require('../services/blogService');
const { uploadFileToS3, deleteFileFromS3 } = require('../services/s3Service');

const S3_FOLDER = 'upload/blog';

// ── Public ────────────────────────────────────────────────────────────────

/** GET /api/blog/posts */
exports.listPublished = async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const result = await blogService.listPublished({ page: parseInt(page), limit: parseInt(limit) });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Blog Controller] List published error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load posts' });
  }
};

/** GET /api/blog/posts/:slug */
exports.getPublishedBySlug = async (req, res) => {
  try {
    const post = await blogService.getPublishedBySlug(req.params.slug);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }
    return res.status(200).json({ success: true, post });
  } catch (error) {
    console.error('[Blog Controller] Get post error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load post' });
  }
};

// ── Admin ─────────────────────────────────────────────────────────────────

/** GET /api/admin/blog/posts */
exports.listAll = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const result = await blogService.listAll({ page: parseInt(page), limit: parseInt(limit), status });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('[Blog Controller] List all error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load posts' });
  }
};

/** GET /api/admin/blog/posts/:id — full record (draft body included) for the edit form */
exports.getById = async (req, res) => {
  try {
    const post = await blogService.getById(req.params.id);
    return res.status(200).json({ success: true, post });
  } catch (error) {
    console.error('[Blog Controller] Get by id error:', error);
    return res.status(404).json({ success: false, message: error.message || 'Post not found' });
  }
};

/** POST /api/admin/blog/posts — multipart, optional `coverImage` file */
exports.create = async (req, res) => {
  try {
    const { title, excerpt, body, status } = req.body;

    let coverImageUrl = null;
    const coverFile = req.file;
    if (coverFile) {
      const result = await uploadFileToS3(coverFile.buffer, coverFile.originalname, coverFile.mimetype, S3_FOLDER);
      coverImageUrl = result.url;
    }

    const post = await blogService.create(req.user.id, { title, excerpt, body, coverImageUrl, status });
    return res.status(201).json({ success: true, post });
  } catch (error) {
    console.error('[Blog Controller] Create error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to create post' });
  }
};

/** PUT /api/admin/blog/posts/:id — multipart, replaces the cover image if a new one is sent */
exports.update = async (req, res) => {
  try {
    const { title, excerpt, body, status } = req.body;
    const existing = await blogService.getById(req.params.id);

    let coverImageUrl;
    const coverFile = req.file;
    if (coverFile) {
      const result = await uploadFileToS3(coverFile.buffer, coverFile.originalname, coverFile.mimetype, S3_FOLDER);
      coverImageUrl = result.url;
      // Best-effort — an old orphaned S3 object isn't worth failing the save over.
      if (existing.coverImageUrl) {
        deleteFileFromS3(existing.coverImageUrl).catch((e) =>
          console.error('[Blog Controller] Failed to delete old cover image:', e.message)
        );
      }
    }

    const post = await blogService.update(req.params.id, { title, excerpt, body, coverImageUrl, status });
    return res.status(200).json({ success: true, post });
  } catch (error) {
    console.error('[Blog Controller] Update error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to update post' });
  }
};

/** DELETE /api/admin/blog/posts/:id */
exports.remove = async (req, res) => {
  try {
    const post = await blogService.delete(req.params.id);
    if (post.coverImageUrl) {
      deleteFileFromS3(post.coverImageUrl).catch((e) =>
        console.error('[Blog Controller] Failed to delete cover image:', e.message)
      );
    }
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Blog Controller] Delete error:', error);
    return res.status(400).json({ success: false, message: error.message || 'Failed to delete post' });
  }
};
