const mux = require('../config/mux');
const VideoModel = require('../models/Video');

exports.uploadVideoService = async ({
  userId,
  title,
  description,
  price,
  currency,
  type,
  category,
  tags,
  privacy,
  ageRestriction,
  thumbnailFile,
}) => {
  try {

    const upload = await mux.video.uploads.create({
      cors_origin: '*',
      new_asset_settings: {
        playback_policy: ['public'],
      },
    });

    // Validate currency if provided
    const validCurrencies = ['NGN', 'USD'];
    const finalCurrency = currency && validCurrencies.includes(currency.toUpperCase()) 
      ? currency.toUpperCase() 
      : 'NGN';

    // 🔍 Process thumbnail URL
    const thumbnailUrl = thumbnailFile 
      ? (thumbnailFile.location || `/upload/${thumbnailFile.filename}`) 
      : null;

    console.log('📸 Video Service - Thumbnail Processing:', {
      hasThumbnailFile: !!thumbnailFile,
      s3Location: thumbnailFile?.location,
      localFilename: thumbnailFile?.filename,
      finalThumbnailUrl: thumbnailUrl
    });

    const video = await VideoModel.create({
      userId,
      title,
      description,
      price,
      currency: finalCurrency,
      type,
      category,
      tags: (typeof tags === 'string' && tags.length > 0) ? tags.split(',').map(tag => tag.trim()) : (Array.isArray(tags) ? tags : []),
      privacy,
      ageRestriction: ageRestriction === 'true',
      thumbnailUrl: thumbnailUrl,
      muxUploadId: upload.id,
      status: 'uploading',
    });

    console.log('✅ Video created with thumbnail:', {
      videoId: video.id,
      thumbnailUrl: video.thumbnailUrl
    });


    return {
      success: true,
      message: 'Mux upload created successfully',
      uploadUrl: upload.url,
      uploadId: upload.id,
      video: video, // Return full video object with thumbnailUrl
    };
  } catch (err) {
    console.error('Error uploading video:', err);
    throw err;
  }
};
