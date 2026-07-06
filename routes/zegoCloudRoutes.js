const express = require('express');
const router = express.Router();

// Import middleware
const authenticateToken = require('../middleware/authMiddleware');
const { checkZegoCloudAccess, checkZegoCloudAccessByParam } = require('../middleware/zegoCloudMiddleware');

// Import controller methods
const zegoCloudController = require('../controllers/zegoCloudController');

// Extract functions from controller
const {
  createRoom,
  joinRoom,
  getRoomInfo,
  endRoom,
  getParticipants,
  removeParticipant,
  getInvitationCode,
  validateInvitation
} = zegoCloudController;

/**
 * ZegoCloud Live Streaming Routes
 * All routes require authentication
 * Some routes require purchase verification
 */

// Room Management Routes

/**
 * @route   POST /api/live/zegocloud/create-room
 * @desc    Create a new ZegoCloud room for live streaming
 * @access  Private (Creator only)
 * @body    { liveClassId, maxParticipants?, privacy? }
 */
router.post('/create-room', authenticateToken, createRoom);

/**
 * @route   DELETE /api/live/zegocloud/room/:id
 * @desc    End/delete a ZegoCloud room
 * @access  Private (Creator only)
 * @params  id - Live class ID
 */
router.delete('/room/:id', authenticateToken, endRoom);

/**
 * @route   GET /api/live/zegocloud/room/:id
 * @desc    Get room information and status
 * @access  Private (Requires purchase or creator access)
 * @params  id - Live class ID
 */
router.get('/room/:id', authenticateToken, checkZegoCloudAccessByParam, getRoomInfo);

// Participant Management Routes

/**
 * @route   POST /api/live/zegocloud/join-room
 * @desc    Join a ZegoCloud room as participant (uses official ZegoCloud tokens)
 * @access  Private (Requires purchase or creator access)
 * @body    { liveClassId, role?, invitationCode? }
 * 
 * Response: { 
 *   success: true, 
 *   data: { 
 *     roomId, appId, token, role, userInfo, liveClass 
 *   } 
 * }
 */
router.post('/join-room', authenticateToken, checkZegoCloudAccess, joinRoom);

/**
 * @route   GET /api/live/zegocloud/participants/:id
 * @desc    Get participants list for a room
 * @access  Private (Requires purchase or creator access)
 * @params  id - Live class ID
 */
router.get('/participants/:id', authenticateToken, checkZegoCloudAccessByParam, getParticipants);

/**
 * @route   POST /api/live/zegocloud/remove-participant
 * @desc    Remove a participant from room
 * @access  Private (Creator only)
 * @body    { liveClassId, participantId, reason? }
 */
router.post('/remove-participant', authenticateToken, removeParticipant);

// Privacy and Access Control Routes

/**
 * @route   GET /api/live/zegocloud/invitation/:id
 * @desc    Get invitation code for private live class
 * @access  Private (Creator only)
 * @params  id - Live class ID
 */
router.get('/invitation/:id', authenticateToken, getInvitationCode);

/**
 * @route   POST /api/live/zegocloud/validate-invitation
 * @desc    Validate invitation code for private live class
 * @access  Public
 * @body    { liveClassId, invitationCode }
 */
router.post('/validate-invitation', validateInvitation);

// Health Check Route

/**
 * @route   GET /api/live/zegocloud/health
 * @desc    Health check for ZegoCloud service
 * @access  Public
 */
router.get('/health', (req, res) => {
  const { zegoCloudService } = require('../services/zegoCloudService');
  
  try {
    const configValidation = zegoCloudService.validateConfiguration();
    
    res.status(200).json({
      success: true,
      service: 'zegocloud',
      status: configValidation.valid ? 'healthy' : 'configuration_issues',
      timestamp: new Date().toISOString(),
      configuration: configValidation
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      service: 'zegocloud',
      status: 'error',
      message: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Configuration Info Route (for debugging)

/**
 * @route   GET /api/live/zegocloud/config
 * @desc    Get ZegoCloud configuration status (for debugging)
 * @access  Private (Admin only - in production, add admin middleware)
 */
router.get('/config', authenticateToken, (req, res) => {
  const { zegoCloudService } = require('../services/zegoCloudService');
  
  try {
    const configValidation = zegoCloudService.validateConfiguration();
    
    res.status(200).json({
      success: true,
      configuration: configValidation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get configuration status',
      timestamp: new Date().toISOString()
    });
  }
});

// Routes are ready

module.exports = router;