const fc = require('fast-check');
const request = require('supertest');
const express = require('express');
const zegoCloudController = require('../controllers/zegoCloudController');
const { zegoCloudService } = require('../services/zegoCloudService');
const LiveClass = require('../models/LiveClass');
const User = require('../models/User');

/**
 * Feature: zegocloud-live-classes, Property 13: Room Lifecycle Management
 * Validates: Requirements 8.2, 8.4
 * 
 * This property test ensures that room management operations (create, join, leave, delete)
 * handle requests correctly through the API endpoints.
 */

// Mock dependencies
jest.mock('../services/zegoCloudService');
jest.mock('../models/LiveClass');
jest.mock('../models/User');

// Create Express app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock authentication middleware
  app.use((req, res, next) => {
    req.user = { id: 1 };
    req.hasAccess = true;
    next();
  });
  
  // Add routes
  app.post('/create-room', zegoCloudController.createRoom);
  app.post('/join-room', zegoCloudController.joinRoom);
  app.get('/room/:id', zegoCloudController.getRoomInfo);
  app.delete('/room/:id', zegoCloudController.endRoom);
  app.get('/participants/:id', zegoCloudController.getParticipants);
  app.post('/remove-participant', zegoCloudController.removeParticipant);
  
  return app;
};

describe('ZegoCloud Controller Properties', () => {
  let app;
  
  beforeEach(() => {
    app = createTestApp();
    jest.clearAllMocks();
  });

  test('Property 13: Room Lifecycle Management - Create room endpoint works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          maxParticipants: fc.option(fc.integer({ min: 1, max: 1000 })),
          privacy: fc.constantFrom('public', 'private')
        }),
        async (roomData) => {
          // Mock LiveClass.findOne
          const mockLiveClass = {
            id: roomData.liveClassId,
            userId: 1,
            privacy: roomData.privacy,
            status: 'scheduled',
            zego_room_id: null,
            update: jest.fn().mockResolvedValue(true)
          };
          LiveClass.findOne.mockResolvedValue(mockLiveClass);

          // Mock zegoCloudService.createRoom
          const mockRoomResult = {
            roomId: `room_${roomData.liveClassId}`,
            appId: 'test_app_id',
            creatorToken: 'test_token'
          };
          zegoCloudService.createRoom.mockResolvedValue(mockRoomResult);

          const response = await request(app)
            .post('/create-room')
            .send(roomData);

          // Verify response structure
          expect(response.status).toBe(201);
          expect(response.body.success).toBe(true);
          expect(response.body.message).toBe('ZegoCloud room created successfully');
          expect(response.body.data).toBeDefined();
          expect(response.body.data.roomId).toBe(mockRoomResult.roomId);
          expect(response.body.data.appId).toBe(mockRoomResult.appId);
          expect(response.body.data.creatorToken).toBe(mockRoomResult.creatorToken);
          expect(response.body.data.liveClassId).toBe(roomData.liveClassId);

          // Verify service was called correctly
          expect(zegoCloudService.createRoom).toHaveBeenCalledWith(
            roomData.liveClassId,
            1,
            {
              maxParticipants: roomData.maxParticipants,
              privacy: roomData.privacy
            }
          );

          // Verify database update was called
          expect(mockLiveClass.update).toHaveBeenCalledWith({
            zego_room_id: mockRoomResult.roomId,
            zego_app_id: mockRoomResult.appId,
            streaming_provider: 'zegocloud',
            zego_room_token: mockRoomResult.creatorToken,
            max_participants: roomData.maxParticipants || null,
            status: 'live'
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 13: Room Lifecycle Management - Join room endpoint works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          role: fc.constantFrom('participant', 'audience')
        }),
        async (joinData) => {
          // Mock LiveClass.findByPk
          const mockLiveClass = {
            id: joinData.liveClassId,
            userId: 2, // Different from req.user.id
            title: 'Test Live Class',
            description: 'Test Description',
            privacy: 'public',
            status: 'live',
            zego_room_id: 'test_room_id',
            zego_app_id: 'test_app_id'
          };
          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Mock User.findByPk
          const mockUser = {
            id: 1,
            name: 'Test User',
            email: 'test@example.com',
            avatar: 'avatar_url'
          };
          User.findByPk.mockResolvedValue(mockUser);

          // Mock zegoCloudService.addParticipant
          const mockJoinResult = {
            token: 'participant_token',
            userInfo: {
              displayName: mockUser.name,
              avatar: mockUser.avatar,
              email: mockUser.email
            }
          };
          zegoCloudService.addParticipant.mockResolvedValue(mockJoinResult);

          const response = await request(app)
            .post('/join-room')
            .send(joinData);

          // Verify response structure
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.message).toBe('Successfully joined live class');
          expect(response.body.data).toBeDefined();
          expect(response.body.data.roomId).toBe(mockLiveClass.zego_room_id);
          expect(response.body.data.appId).toBe(mockLiveClass.zego_app_id);
          expect(response.body.data.token).toBe(mockJoinResult.token);
          expect(response.body.data.role).toBe(joinData.role);
          expect(response.body.data.liveClass.id).toBe(joinData.liveClassId);

          // Verify service was called correctly
          expect(zegoCloudService.addParticipant).toHaveBeenCalledWith(
            mockLiveClass.zego_room_id,
            1,
            joinData.role,
            {
              displayName: mockUser.name,
              avatar: mockUser.avatar,
              email: mockUser.email
            }
          );
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 13: Room Lifecycle Management - Get room info endpoint works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (liveClassId) => {
          // Mock LiveClass.findByPk
          const mockLiveClass = {
            id: liveClassId,
            userId: 1,
            title: 'Test Live Class',
            description: 'Test Description',
            price: 100,
            thumbnailUrl: 'thumbnail_url',
            startTime: new Date(),
            endTime: null,
            privacy: 'public',
            status: 'live',
            streaming_provider: 'zegocloud',
            max_participants: 100,
            zego_room_id: 'test_room_id',
            zego_app_id: 'test_app_id'
          };
          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Mock zegoCloudService.getRoomInfo
          const mockRoomInfo = {
            success: true,
            roomId: 'test_room_id',
            status: 'active'
          };
          zegoCloudService.getRoomInfo.mockResolvedValue(mockRoomInfo);

          const response = await request(app)
            .get(`/room/${liveClassId}`);

          // Verify response structure
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.data).toBeDefined();
          expect(response.body.data.liveClass).toBeDefined();
          expect(response.body.data.liveClass.id).toBe(liveClassId);
          expect(response.body.data.room).toBeDefined();
          expect(response.body.data.room.roomId).toBe(mockLiveClass.zego_room_id);
          expect(response.body.data.room.appId).toBe(mockLiveClass.zego_app_id);
          expect(response.body.data.room.isActive).toBe(true);
          expect(response.body.data.userRole).toBe('creator');

          // Verify service was called correctly
          expect(zegoCloudService.getRoomInfo).toHaveBeenCalledWith(mockLiveClass.zego_room_id);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 13: Room Lifecycle Management - End room endpoint works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (liveClassId) => {
          // Mock LiveClass.findByPk
          const mockLiveClass = {
            id: liveClassId,
            userId: 1,
            zego_room_id: 'test_room_id',
            update: jest.fn().mockImplementation((updateData) => {
              Object.assign(mockLiveClass, updateData);
              return Promise.resolve(true);
            })
          };
          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Mock zegoCloudService.deleteRoom
          zegoCloudService.deleteRoom.mockResolvedValue({
            success: true,
            roomId: 'test_room_id'
          });

          const response = await request(app)
            .delete(`/room/${liveClassId}`);

          // Verify response structure
          expect(response.status).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.message).toBe('Live class ended successfully');
          expect(response.body.data).toBeDefined();
          expect(response.body.data.liveClassId).toBe(liveClassId);
          expect(response.body.data.endedAt).toBeDefined();

          // Verify service was called correctly
          expect(zegoCloudService.deleteRoom).toHaveBeenCalledWith('test_room_id');

          // Verify database update was called
          expect(mockLiveClass.update).toHaveBeenCalledWith({
            status: 'ended',
            endTime: expect.any(Date)
          });
          
          // Verify endedAt is in response (should be the updated endTime)
          expect(mockLiveClass.endTime).toBeDefined();
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 13: Room Lifecycle Management - Error handling works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          endpoint: fc.constantFrom('create-room', 'join-room'),
          errorType: fc.constantFrom('not_found', 'service_error')
        }),
        async (errorData) => {
          if (errorData.errorType === 'not_found') {
            LiveClass.findOne.mockResolvedValue(null);
            LiveClass.findByPk.mockResolvedValue(null);
          } else {
            const mockLiveClass = {
              id: 'test-id',
              userId: 1,
              privacy: 'public',
              status: 'scheduled',
              zego_room_id: null,
              zego_app_id: 'test_app_id',
              update: jest.fn()
            };
            LiveClass.findOne.mockResolvedValue(mockLiveClass);
            LiveClass.findByPk.mockResolvedValue(mockLiveClass);
            
            // Mock service error
            zegoCloudService.createRoom.mockRejectedValue(new Error('Service error'));
            zegoCloudService.addParticipant.mockRejectedValue(new Error('Service error'));
          }

          const requestData = {
            liveClassId: 'test-id',
            role: 'participant'
          };

          const response = await request(app)
            .post(`/${errorData.endpoint}`)
            .send(requestData);

          // Verify error response structure
          expect(response.body.success).toBe(false);
          expect(response.body.message).toBeDefined();
          expect(typeof response.body.message).toBe('string');

          if (errorData.errorType === 'not_found') {
            expect(response.status).toBe(404);
          } else {
            // Service errors can return different status codes based on the specific error
            expect([400, 409, 500]).toContain(response.status);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 13: Room Lifecycle Management - Input validation works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          endpoint: fc.constantFrom('create-room', 'join-room', 'remove-participant'),
          invalidData: fc.oneof(
            fc.constant({}), // Empty object
            fc.constant({ liveClassId: '' }), // Empty string
            fc.constant({ liveClassId: null }), // Null value
            fc.constant({ participantId: null }) // Missing required field
          )
        }),
        async (testData) => {
          const response = await request(app)
            .post(`/${testData.endpoint}`)
            .send(testData.invalidData);

          // Verify validation error response
          expect(response.status).toBe(400);
          expect(response.body.success).toBe(false);
          expect(response.body.message).toBeDefined();
          expect(typeof response.body.message).toBe('string');
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 13: Room Lifecycle Management - Authorization works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          endpoint: fc.constantFrom('room', 'participants'),
          userRole: fc.constantFrom('creator', 'non_creator_no_access', 'non_creator_with_access')
        }),
        async (authData) => {
          const liveClassId = 'test-live-class-id';
          
          // Create test app with different auth scenarios
          const testApp = express();
          testApp.use(express.json());
          
          // Mock authentication based on test scenario
          testApp.use((req, res, next) => {
            if (authData.userRole === 'creator') {
              req.user = { id: 1 };
              req.hasAccess = true;
            } else if (authData.userRole === 'non_creator_with_access') {
              req.user = { id: 2 };
              req.hasAccess = true;
            } else {
              req.user = { id: 2 };
              req.hasAccess = false;
            }
            next();
          });
          
          testApp.get('/room/:id', zegoCloudController.getRoomInfo);
          testApp.get('/participants/:id', zegoCloudController.getParticipants);

          // Mock LiveClass
          const mockLiveClass = {
            id: liveClassId,
            userId: 1, // Creator ID
            zego_room_id: 'test_room_id',
            zego_app_id: 'test_app_id'
          };
          LiveClass.findByPk.mockResolvedValue(mockLiveClass);
          zegoCloudService.getRoomInfo.mockResolvedValue({ success: true });
          zegoCloudService.getParticipants.mockResolvedValue({ participants: [], participantCount: 0 });

          const response = await request(testApp)
            .get(`/${authData.endpoint}/${liveClassId}`);

          if (authData.userRole === 'creator' || authData.userRole === 'non_creator_with_access') {
            // Should have access
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
          } else {
            // Should be denied access
            expect(response.status).toBe(403);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('Access denied');
          }
        }
      ),
      { numRuns: 30 }
    );
  });
});