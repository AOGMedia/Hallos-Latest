const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { MAX_PHOTO_BYTES } = require('../services/liveChatMediaService');

/**
 * Limits for the GetStream in-room extras (gifts, chat photos). Keyed by the
 * signed-in user, so people on one shared network don't limit each other.
 * Used only by the GetStream routes.
 */

const perUser = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user && req.user.id}`,
    message: { success: false, message }
  });

const giftRateLimit = perUser(60 * 1000, 30, "You're sending gifts too fast. Please wait a moment.");
const photoRateLimit = perUser(60 * 1000, 8, "You're sharing photos too fast. Please wait a moment.");

/** One photo in memory (it's checked and forwarded to storage, never written to disk). */
const parseChatPhoto = (req, res, next) => {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }).single('photo')(
    req,
    res,
    (error) => {
      if (!error) return next();
      const tooBig = error.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        success: false,
        message: tooBig ? 'That photo is too large (5 MB max)' : 'Could not read that photo'
      });
    }
  );
};

module.exports = { giftRateLimit, photoRateLimit, parseChatPhoto };
