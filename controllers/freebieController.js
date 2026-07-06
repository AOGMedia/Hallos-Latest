const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { Freebie, FreebieItem, FreebieDownload, FreebieAccess } = require('../models/freebieIndex');
const User = require('../models/User');
const { uploadFileToS3, deleteFileFromS3, getSignedUrl, s3 } = require('../services/s3Service');
const { sendFreebieNewContentEmail } = require('../utils/email');

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES = 20;
const S3_FOLDER = 'freebies';
const DOWNLOAD_URL_TTL = 300; // 5 minutes

// ─── helpers ────────────────────────────────────────────────────────────────

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

// ─── Creator: Create Freebie ─────────────────────────────────────────────────

/**
 * POST /api/freebies
 * Multipart form — files[] + optional thumbnail + JSON body fields
 * Also accepts links[] as JSON array in body
 */
exports.createFreebie = async (req, res) => {
  const t = await sequelize.transaction();
  const uploadedKeys = []; // track S3 keys for rollback

  try {
    const userId = req.user.id;
    const { title, description, estimatedReadingTime, links, price, currency } = req.body;

    // ── Validate required fields ──
    if (!title || !description || !estimatedReadingTime) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'title, description, and estimatedReadingTime are required' });
    }

    const readingTime = parseInt(estimatedReadingTime);
    if (isNaN(readingTime) || readingTime < 1) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'estimatedReadingTime must be a positive integer (minutes)' });
    }

    if (title.length > 200) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'title must be 200 characters or less' });
    }

    // ── Parse links ──
    let parsedLinks = [];
    if (links) {
      try {
        parsedLinks = typeof links === 'string' ? JSON.parse(links) : links;
        if (!Array.isArray(parsedLinks)) parsedLinks = [];
      } catch {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'links must be a valid JSON array' });
      }
    }

    // Validate each link
    for (const link of parsedLinks) {
      if (!link.url || !isValidUrl(link.url)) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Invalid URL: ${link.url}` });
      }
      if (!link.title || link.title.trim().length === 0) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Each link must have a title' });
      }
    }

    // ── Validate files ──
    const files = req.files?.files || [];
    const totalItems = files.length + parsedLinks.length;

    if (totalItems === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'At least one file or link is required' });
    }

    if (totalItems > MAX_FILES) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Maximum ${MAX_FILES} items (files + links) per freebie` });
    }

    for (const file of files) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `File type not allowed: ${file.originalname}. Allowed: PDF, DOCX, DOC, XLSX, XLS, PPTX, PPT` });
      }
      if (file.size > MAX_FILE_SIZE) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `File too large: ${file.originalname}. Maximum size is 50MB` });
      }
    }

    // ── Upload thumbnail if provided ──
    let thumbnailUrl = null;
    const thumbnailFile = req.files?.thumbnail?.[0];
    if (thumbnailFile) {
      const thumbResult = await uploadFileToS3(thumbnailFile.buffer, thumbnailFile.originalname, thumbnailFile.mimetype, `${S3_FOLDER}/thumbnails`);
      thumbnailUrl = thumbResult.url;
      uploadedKeys.push(thumbResult.key);
    }

    // ── Create Freebie record ──
    const freebie = await Freebie.create({
      userId,
      title: title.trim(),
      description: description.trim(),
      thumbnailUrl,
      estimatedReadingTime: readingTime,
      downloadCount: 0,
      price: price !== undefined ? parseFloat(price) : 0,
      currency: currency ? currency.toUpperCase() : 'NGN'
    }, { transaction: t });

    // ── Upload files to S3 and create FreebieItem records ──
    const itemsToCreate = [];

    for (const file of files) {
      const result = await uploadFileToS3(file.buffer, file.originalname, file.mimetype, S3_FOLDER);
      uploadedKeys.push(result.key);

      itemsToCreate.push({
        freebieId: freebie.id,
        itemType: 'file',
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        s3Key: result.key,
        fileUrl: result.url,
        downloadCount: 0,
        isFreePreview: false
      });
    }

    // ── Create link items ──
    for (const link of parsedLinks) {
      itemsToCreate.push({
        freebieId: freebie.id,
        itemType: 'link',
        linkUrl: link.url.trim(),
        linkTitle: link.title.trim(),
        downloadCount: 0,
        isFreePreview: false
      });
    }

    await FreebieItem.bulkCreate(itemsToCreate, { transaction: t });

    await t.commit();

    // Return full freebie with items
    const created = await Freebie.findByPk(freebie.id, {
      include: [
        { model: FreebieItem, as: 'items' },
        { model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] }
      ]
    });

    return res.status(201).json({ success: true, freebie: created });

  } catch (error) {
    await t.rollback();
    // Clean up any S3 uploads that succeeded before the error
    for (const key of uploadedKeys) {
      try {
        await s3.deleteObject({ Bucket: process.env.AWS_S3_BUCKET, Key: key }).promise();
      } catch (e) {
        console.error('[Freebies] S3 rollback failed for key:', key, e.message);
      }
    }
    console.error('[Freebies] Create error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create freebie' });
  }
};

// ─── Public: List Freebies ───────────────────────────────────────────────────

/**
 * GET /api/freebies?page=1
 */
exports.listFreebies = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 12;
    const offset = (page - 1) * limit;

    const { count, rows } = await Freebie.findAndCountAll({
      include: [
        { model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] }
      ],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    const freebies = rows.map(f => ({
      id: f.id,
      title: f.title,
      description: f.description,
      thumbnailUrl: f.thumbnailUrl,
      estimatedReadingTime: f.estimatedReadingTime,
      downloadCount: f.downloadCount,
      price: parseFloat(f.price),
      currency: f.currency,
      creatorName: `${f.creator.firstname} ${f.creator.lastname}`,
      creatorId: f.creator.id,
      createdAt: f.createdAt
    }));

    return res.status(200).json({
      success: true,
      freebies,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('[Freebies] List error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch freebies' });
  }
};

// ─── Public: Get Freebie Detail ──────────────────────────────────────────────

/**
 * GET /api/freebies/:id
 */
exports.getFreebieById = async (req, res) => {
  try {
    const freebie = await Freebie.findByPk(req.params.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] },
        {
          model: FreebieItem,
          as: 'items',
          attributes: ['id', 'itemType', 'fileName', 'fileType', 'fileSize', 'linkUrl', 'linkTitle', 'downloadCount', 'isFreePreview']
        }
      ]
    });

    if (!freebie) return res.status(404).json({ success: false, message: 'Freebie not found' });

    // Check if the authenticated user has already purchased this freebie
    let purchased = false;
    const userId = req.user?.id;
    if (userId && parseFloat(freebie.price) > 0) {
      const access = await FreebieAccess.findOne({ where: { userId, freebieId: freebie.id } });
      purchased = !!access;
    }

    return res.status(200).json({
      success: true,
      freebie: {
        id: freebie.id,
        title: freebie.title,
        description: freebie.description,
        thumbnailUrl: freebie.thumbnailUrl,
        estimatedReadingTime: freebie.estimatedReadingTime,
        downloadCount: freebie.downloadCount,
        price: parseFloat(freebie.price),
        currency: freebie.currency,
        creatorName: `${freebie.creator.firstname} ${freebie.creator.lastname}`,
        creatorId: freebie.creator.id,
        createdAt: freebie.createdAt,
        purchased,
        items: freebie.items
      }
    });
  } catch (error) {
    console.error('[Freebies] Get by ID error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch freebie' });
  }
};

// ─── Auth: Download / Access Item ───────────────────────────────────────────

/**
 * POST /api/freebies/items/:itemId/download
 * For files: returns a pre-signed S3 URL (300s TTL)
 * For links: returns the URL directly + records the "download"
 */
exports.downloadItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const item = await FreebieItem.findByPk(req.params.itemId, {
      include: [{ model: Freebie, as: 'freebie' }]
    });

    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const freebie = item.freebie;
    const isPaidFreebie = parseFloat(freebie.price) > 0;

    // ── Download Gate ────────────────────────────────────────────────────────
    if (isPaidFreebie && !item.isFreePreview && freebie.userId !== userId) {
      // Check FreebieAccess
      const access = await FreebieAccess.findOne({
        where: { userId, freebieId: freebie.id }
      });

      if (!access) {
        return res.status(403).json({
          success: false,
          message: 'Payment required to download this item',
          freebieId: freebie.id,
          price: parseFloat(freebie.price),
          currency: freebie.currency
        });
      }
    }
    // ── End Gate ─────────────────────────────────────────────────────────────

    // Record download and increment counters atomically
    await sequelize.transaction(async (t) => {
      await FreebieDownload.create({
        userId,
        freebieId: item.freebieId,
        freebieItemId: item.id
      }, { transaction: t });

      await FreebieItem.increment('downloadCount', { where: { id: item.id }, transaction: t });
      await Freebie.increment('downloadCount', { where: { id: item.freebieId }, transaction: t });
    });

    if (item.itemType === 'link') {
      return res.status(200).json({
        success: true,
        type: 'link',
        url: item.linkUrl,
        title: item.linkTitle
      });
    }

    // Generate pre-signed URL for file
    const signedUrl = getSignedUrl(item.s3Key, DOWNLOAD_URL_TTL);

    return res.status(200).json({
      success: true,
      type: 'file',
      url: signedUrl,
      fileName: item.fileName,
      fileType: item.fileType,
      expiresIn: DOWNLOAD_URL_TTL
    });

  } catch (error) {
    console.error('[Freebies] Download error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process download' });
  }
};

// ─── Creator: Get My Freebies ────────────────────────────────────────────────

/**
 * GET /api/freebies/my
 */
exports.getMyFreebies = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 12;
    const offset = (page - 1) * limit;

    const { count, rows } = await Freebie.findAndCountAll({
      where: { userId },
      include: [{ model: FreebieItem, as: 'items', attributes: ['id', 'itemType', 'fileName', 'linkTitle', 'downloadCount'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return res.status(200).json({
      success: true,
      freebies: rows,
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) }
    });
  } catch (error) {
    console.error('[Freebies] Get my freebies error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch your freebies' });
  }
};

// ─── Creator: Delete Own Freebie ────────────────────────────────────────────

/**
 * DELETE /api/freebies/my/:id
 * Creator can only delete their own freebies
 */
exports.deleteMyFreebie = async (req, res) => {
  try {
    const userId = req.user.id;

    const freebie = await Freebie.findByPk(req.params.id, {
      include: [{ model: FreebieItem, as: 'items' }]
    });

    if (!freebie) return res.status(404).json({ success: false, message: 'Freebie not found' });

    // Ownership check — only the creator can delete their own freebie
    if (freebie.userId !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own freebies' });
    }

    // Delete all S3 files (non-fatal per file)
    for (const item of freebie.items) {
      if (item.itemType === 'file' && item.s3Key) {
        try {
          await s3.deleteObject({ Bucket: process.env.AWS_S3_BUCKET, Key: item.s3Key }).promise();
        } catch (e) {
          console.error('[Freebies] S3 delete failed for item:', item.id, e.message);
        }
      }
    }

    // Delete thumbnail
    if (freebie.thumbnailUrl) {
      try { await deleteFileFromS3(freebie.thumbnailUrl); } catch (e) {
        console.error('[Freebies] S3 thumbnail delete failed:', e.message);
      }
    }

    // DB cascade deletes items + downloads
    await freebie.destroy();

    return res.status(200).json({ success: true, message: 'Freebie deleted successfully' });
  } catch (error) {
    console.error('[Freebies] Delete my freebie error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete freebie' });
  }
};

/**
 * DELETE /api/freebies/:id
 */
exports.deleteFreebie = async (req, res) => {
  try {
    const freebie = await Freebie.findByPk(req.params.id, {
      include: [{ model: FreebieItem, as: 'items' }]
    });

    if (!freebie) return res.status(404).json({ success: false, message: 'Freebie not found' });

    // Delete all S3 files (non-fatal per file)
    for (const item of freebie.items) {
      if (item.itemType === 'file' && item.s3Key) {
        try {
          await s3.deleteObject({ Bucket: process.env.AWS_S3_BUCKET, Key: item.s3Key }).promise();
        } catch (e) {
          console.error('[Freebies] S3 delete failed for item:', item.id, e.message);
        }
      }
    }

    // Delete thumbnail
    if (freebie.thumbnailUrl) {
      try { await deleteFileFromS3(freebie.thumbnailUrl); } catch (e) {
        console.error('[Freebies] S3 thumbnail delete failed:', e.message);
      }
    }

    // DB cascade deletes items + downloads
    await freebie.destroy();

    return res.status(200).json({ success: true, message: 'Freebie deleted successfully' });
  } catch (error) {
    console.error('[Freebies] Delete error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete freebie' });
  }
};

// ─── Admin: Delete Individual Item ──────────────────────────────────────────

/**
 * DELETE /api/freebies/items/:itemId
 */
exports.deleteItem = async (req, res) => {
  try {
    const item = await FreebieItem.findByPk(req.params.itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    if (item.itemType === 'file' && item.s3Key) {
      try {
        await s3.deleteObject({ Bucket: process.env.AWS_S3_BUCKET, Key: item.s3Key }).promise();
      } catch (e) {
        console.error('[Freebies] S3 delete failed for item:', item.id, e.message);
      }
    }

    await item.destroy();

    return res.status(200).json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('[Freebies] Delete item error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete item' });
  }
};

// ─── Admin: Analytics ───────────────────────────────────────────────────────

/**
 * GET /api/freebies/admin/analytics
 */
exports.getAnalytics = async (req, res) => {
  try {
    const freebies = await Freebie.findAll({
      include: [
        { model: User, as: 'creator', attributes: ['id', 'firstname', 'lastname'] },
        { model: FreebieItem, as: 'items', attributes: ['id', 'itemType', 'fileName', 'linkTitle', 'fileType', 'downloadCount'] }
      ],
      order: [['downloadCount', 'DESC']]
    });

    return res.status(200).json({ success: true, freebies });
  } catch (error) {
    console.error('[Freebies] Analytics error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch analytics' });
  }
};

/**
 * GET /api/freebies/admin/items/:itemId/downloads?page=1
 * Paginated download log for a specific item
 */
exports.getItemDownloadLog = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const { count, rows } = await FreebieDownload.findAndCountAll({
      where: { freebieItemId: req.params.itemId },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstname', 'lastname', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit,
      offset
    });

    return res.status(200).json({
      success: true,
      downloads: rows,
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) }
    });
  } catch (error) {
    console.error('[Freebies] Download log error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch download log' });
  }
};

// ─── Creator: Update Freebie Price ──────────────────────────────────────────

/**
 * PATCH /api/freebies/:id/price
 * Creator can update the price and currency of their own freebie at any time.
 */
exports.updateFreebiePrice = async (req, res) => {
  try {
    const userId = req.user.id;
    const { price, currency } = req.body;

    const freebie = await Freebie.findByPk(req.params.id);
    if (!freebie) return res.status(404).json({ success: false, message: 'Freebie not found' });

    // Ownership check
    if (freebie.userId !== userId) {
      return res.status(403).json({ success: false, message: 'You can only update your own freebies' });
    }

    // Validate price
    if (price === undefined || parseFloat(price) < 0 || isNaN(parseFloat(price))) {
      return res.status(400).json({ success: false, message: 'price must be a non-negative number' });
    }

    // Validate currency
    if (currency && !['NGN', 'USD'].includes(currency.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'currency must be NGN or USD' });
    }

    await freebie.update({
      price: parseFloat(price),
      ...(currency && { currency: currency.toUpperCase() })
    });

    return res.status(200).json({
      success: true,
      freebie: {
        id: freebie.id,
        price: parseFloat(freebie.price),
        currency: freebie.currency
      }
    });
  } catch (error) {
    console.error('[Freebies] Update price error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update freebie price' });
  }
};

// ─── Internal: Notify buyers of new content ──────────────────────────────────

/**
 * Fire-and-forget: notify all buyers when new items are added to a paid freebie.
 * Called after items are committed to DB.
 */
async function notifyBuyersOfNewContent(freebieId, freebieTitle, newItemCount) {
  try {
    const accessRecords = await FreebieAccess.findAll({
      where: { freebieId },
      include: [{ model: User, as: 'buyer', attributes: ['email', 'firstname'] }]
    });

    for (const access of accessRecords) {
      try {
        await sendFreebieNewContentEmail(
          access.buyer.email,
          access.buyer.firstname,
          freebieTitle,
          newItemCount
        );
      } catch (emailErr) {
        console.error(`[Freebies] New-content email failed for user ${access.userId}:`, emailErr.message);
      }
    }
  } catch (err) {
    console.error('[Freebies] notifyBuyersOfNewContent error:', err.message);
  }
}

exports.notifyBuyersOfNewContent = notifyBuyersOfNewContent;

// ============================
//  LINK FREEBIE TO COMMUNITY
// ============================
exports.linkFreebieToCommunity = async (req, res) => {
  try {
    const { id } = req.params;
    const { communityId, communityVisibility = 'community_only' } = req.body;
    const userId = req.user.id;

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'communityId is required' });
    }

    const Freebie = require('../models/Freebie');
    const freebie = await Freebie.findByPk(id);
    if (!freebie) {
      return res.status(404).json({ success: false, message: 'Freebie not found' });
    }

    if (freebie.userId !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const Community = require('../models/Community');
    const CommunityMember = require('../models/CommunityMember');
    const CommunityContentSubmission = require('../models/CommunityContentSubmission');

    const community = await Community.findByPk(communityId);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const membership = req.user.role === 'admin' ? null : await CommunityMember.findOne({
      where: { communityId, userId, status: 'active' }
    });

    const canDirectLink = req.user.role === 'admin' ||
      (membership && ['owner', 'moderator'].includes(membership.role));

    if (canDirectLink) {
      await freebie.update({ communityId, communityVisibility });
      return res.json({ success: true, queued: false, data: freebie });
    }

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You must be an active member of this community.' });
    }

    const submission = await CommunityContentSubmission.create({
      communityId,
      submittedBy: userId,
      contentType: 'freebie',
      contentData: { ...freebie.toJSON(), communityVisibility },
      status: 'pending'
    });

    return res.status(201).json({
      success: true,
      queued: true,
      message: 'Your freebie has been submitted for moderator review.',
      data: submission
    });
  } catch (error) {
    console.error('[Freebie Controller] Link to community error:', error);
    return res.status(500).json({ success: false, message: 'Failed to link freebie to community' });
  }
};
