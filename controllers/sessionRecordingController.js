const { LiveSeries } = require('../models/liveSeriesIndex');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const SessionRecordingSend = require('../models/SessionRecordingSend');
const { sendSessionRecordingEmail } = require('../utils/email');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const { v4: uuidv4 } = require('uuid');

/**
 * Session Recording Controller
 * 
 * Handles sending session recordings to enrolled students:
 * - Send test email
 * - Send recordings to all enrolled students
 * - Track delivery to prevent duplicates
 */

/**
 * Send recording email to individual student (manual send)
 * POST /api/admin/live-series/:seriesId/send-recording/test
 */
exports.sendTestRecordingEmail = async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { recordings, customMessage, testEmail } = req.body;

    // Validation
    if (!testEmail) {
      return res.status(400).json({
        success: false,
        message: 'Student email address is required'
      });
    }

    if (!recordings || !Array.isArray(recordings) || recordings.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one recording is required'
      });
    }

    // Validate recording format
    for (const rec of recordings) {
      if (!rec.sessionNumber || !rec.driveLink) {
        return res.status(400).json({
          success: false,
          message: 'Each recording must have sessionNumber and driveLink'
        });
      }
    }

    // Get series details
    const series = await LiveSeries.findByPk(seriesId);

    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Live series not found'
      });
    }

    // Look up student by email
    const student = await User.findOne({
      where: { email: testEmail },
      attributes: ['id', 'email', 'firstname', 'lastname']
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: `No user found with email: ${testEmail}`
      });
    }

    // Check if student is enrolled in this series
    const enrollment = await Purchase.findOne({
      where: {
        contentType: 'live_series',
        contentId: seriesId,
        userId: student.id,
        paymentStatus: 'completed'
      }
    });

    if (!enrollment) {
      return res.status(400).json({
        success: false,
        message: `${student.firstname} (${testEmail}) is not enrolled in this series`
      });
    }

    // Check if student already received these recordings
    const sessionNumbers = recordings.map(r => r.sessionNumber);
    const existingSends = await SessionRecordingSend.findAll({
      where: {
        seriesId: seriesId,
        userId: student.id,
        sessionNumber: {
          [Op.in]: sessionNumbers
        }
      },
      attributes: ['sessionNumber']
    });

    const receivedSessionNumbers = existingSends.map(s => s.sessionNumber);
    const alreadyReceived = sessionNumbers.filter(num => receivedSessionNumbers.includes(num));

    if (alreadyReceived.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${student.firstname} already received recording(s) for session(s): ${alreadyReceived.join(', ')}`,
        alreadyReceivedSessions: alreadyReceived
      });
    }

    // Prepare recording data
    const recordingData = {
      seriesTitle: series.title,
      recordings: recordings.map(r => ({
        sessionNumber: r.sessionNumber,
        driveLink: r.driveLink
      })),
      customMessage: customMessage || null,
      thumbnailUrl: series.thumbnailUrl
    };

    // Generate batch ID for this manual send
    const batchId = uuidv4();

    // Send email with student's actual name
    await sendSessionRecordingEmail(
      student.email,
      student.firstname,
      recordingData
    );

    // Track in database
    for (const recording of recordings) {
      await SessionRecordingSend.create({
        seriesId: seriesId,
        sessionNumber: recording.sessionNumber,
        userId: student.id,
        driveLink: recording.driveLink,
        sendBatchId: batchId,
        sentAt: new Date()
      });
    }

    console.log(`[Recording Controller] Manual send to ${student.email} (${student.firstname}) - Batch ID: ${batchId}`);

    return res.status(200).json({
      success: true,
      message: `Recording email sent successfully to ${student.firstname} (${testEmail})`,
      batchId: batchId,
      student: {
        id: student.id,
        email: student.email,
        firstname: student.firstname,
        lastname: student.lastname
      },
      sessionsSent: sessionNumbers
    });

  } catch (error) {
    console.error('[Recording Controller] Manual send error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send recording email: ' + error.message
    });
  }
};

/**
 * Send recording emails to all enrolled students
 * POST /api/admin/live-series/:seriesId/send-recording
 */
exports.sendRecordingToStudents = async (req, res) => {
  try {
    const { seriesId } = req.params;
    const { recordings, customMessage } = req.body;

    // Validation
    if (!recordings || !Array.isArray(recordings) || recordings.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one recording is required'
      });
    }

    // Validate recording format
    for (const rec of recordings) {
      if (!rec.sessionNumber || !rec.driveLink) {
        return res.status(400).json({
          success: false,
          message: 'Each recording must have sessionNumber and driveLink'
        });
      }
    }

    // Get series details
    const series = await LiveSeries.findByPk(seriesId);

    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Live series not found'
      });
    }

    // Get all enrolled students
    const purchases = await Purchase.findAll({
      where: {
        contentType: 'live_series',
        contentId: seriesId,
        paymentStatus: 'completed'
      },
      attributes: ['userId']
    });

    const userIds = [...new Set(purchases.map(p => p.userId))];

    if (userIds.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No enrolled students found for this series'
      });
    }

    // Get user details
    const users = await User.findAll({
      where: {
        id: {
          [Op.in]: userIds
        }
      },
      attributes: ['id', 'email', 'firstname', 'lastname']
    });

    console.log(`[Recording Controller] Found ${users.length} enrolled students for series ${seriesId}`);

    // Generate batch ID for this send operation
    const batchId = uuidv4();

    // Prepare recording data
    const recordingData = {
      seriesTitle: series.title,
      recordings: recordings.map(r => ({
        sessionNumber: r.sessionNumber,
        driveLink: r.driveLink
      })),
      customMessage: customMessage || null,
      thumbnailUrl: series.thumbnailUrl
    };

    // Track results
    let alreadySent = 0;
    let newlySent = 0;
    let failed = 0;
    const failedUsers = [];

    // Process each user
    for (const user of users) {
      try {
        // Check if user already received ALL these recordings
        const sessionNumbers = recordings.map(r => r.sessionNumber);
        
        const existingSends = await SessionRecordingSend.findAll({
          where: {
            seriesId: seriesId,
            userId: user.id,
            sessionNumber: {
              [Op.in]: sessionNumbers
            }
          },
          attributes: ['sessionNumber']
        });

        const receivedSessionNumbers = existingSends.map(s => s.sessionNumber);
        const allReceived = sessionNumbers.every(num => receivedSessionNumbers.includes(num));

        if (allReceived) {
          console.log(`[Recording Controller] User ${user.email} already received all recordings - skipping`);
          alreadySent++;
          continue;
        }

        // Send email
        await sendSessionRecordingEmail(
          user.email,
          user.firstname,
          recordingData
        );

        // Record each session send in database
        for (const recording of recordings) {
          // Check if this specific session was already sent
          const alreadySentThisSession = receivedSessionNumbers.includes(recording.sessionNumber);
          
          if (!alreadySentThisSession) {
            await SessionRecordingSend.create({
              seriesId: seriesId,
              sessionNumber: recording.sessionNumber,
              userId: user.id,
              driveLink: recording.driveLink,
              sendBatchId: batchId,
              sentAt: new Date()
            });
          }
        }

        console.log(`[Recording Controller] Sent to ${user.email}`);
        newlySent++;

        // Small delay to avoid overwhelming email server
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[Recording Controller] Failed to send to ${user.email}:`, error);
        failed++;
        failedUsers.push({
          email: user.email,
          error: error.message
        });
      }
    }

    const result = {
      success: true,
      batchId: batchId,
      alreadySent: alreadySent,
      newlySent: newlySent,
      failed: failed,
      total: users.length,
      failedUsers: failedUsers.length > 0 ? failedUsers : undefined
    };

    console.log('[Recording Controller] Send operation completed:', result);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[Recording Controller] Send recordings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send recordings: ' + error.message
    });
  }
};

/**
 * Get send history for a series
 * GET /api/admin/live-series/:seriesId/recording-history
 */
exports.getRecordingHistory = async (req, res) => {
  try {
    const { seriesId } = req.params;

    // Get unique batch sends
    const sends = await SessionRecordingSend.findAll({
      where: { seriesId },
      attributes: [
        'sendBatchId',
        'sessionNumber',
        'driveLink',
        [sequelize.fn('COUNT', sequelize.col('user_id')), 'recipientCount'],
        [sequelize.fn('MIN', sequelize.col('sent_at')), 'sentAt']
      ],
      group: ['sendBatchId', 'sessionNumber', 'driveLink'],
      order: [[sequelize.fn('MIN', sequelize.col('sent_at')), 'DESC']],
      raw: true
    });

    // Group by batch
    const batches = {};
    sends.forEach(send => {
      if (!batches[send.sendBatchId]) {
        batches[send.sendBatchId] = {
          batchId: send.sendBatchId,
          sentAt: send.sentAt,
          sessions: [],
          totalRecipients: 0
        };
      }
      batches[send.sendBatchId].sessions.push({
        sessionNumber: send.sessionNumber,
        driveLink: send.driveLink
      });
      batches[send.sendBatchId].totalRecipients = parseInt(send.recipientCount);
    });

    const history = Object.values(batches);

    return res.status(200).json({
      success: true,
      count: history.length,
      history
    });

  } catch (error) {
    console.error('[Recording Controller] Get history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get recording history'
    });
  }
};
