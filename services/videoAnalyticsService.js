const VideoView = require('../models/VideoView');
const Video = require('../models/Video');
const { Op } = require('sequelize');

exports.recordView = async ({ videoId, userId, ipAddress }) => {
  try {
    // Check if viewer already watched this video recently
    const existingView = await VideoView.findOne({
      where: {
        videoId,
        [Op.or]: [
          { userId: userId || null },
          { ipAddress: ipAddress || null },
        ],
        createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // within 24 hours, so each view only counts once per day
      },
    });

    if (!existingView) {
      // Log new view
      await VideoView.create({ videoId, userId, ipAddress });
      // Increment main view counter
      await Video.increment('viewsCount', { where: { id: videoId } });
    } else {
      // Update last watched time
      existingView.lastWatchedAt = new Date();
      await existingView.save();
    }
  } catch (error) {
    console.error('Error recording view:', error);
  }
};

//Track how long the user watched
exports.updateWatchDuration = async (viewId, duration) => {
  try {
    await VideoView.update({ watchDuration: duration }, { where: { id: viewId } });
  } catch (error) {
    console.error('Error updating watch duration:', error);
  }
};