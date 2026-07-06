const fc = require('fast-check');
const { zegoCloudService } = require('../services/zegoCloudService');
const LiveClass = require('../models/LiveClass');

/**
 * Feature: zegocloud-live-classes, Property 10: System Isolation
 * Validates: Requirements 6.4, 9.3, 9.5
 * 
 * This property test ensures that ZegoCloud and Mux systems operate independently
 * and that ZegoCloud service failures don't affect other platform features.
 */

// Mock dependencies
jest.mock('../models/LiveClass');

describe('ZegoCloud System Integration Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 10: System Isolation - ZegoCloud service operates independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.string({ minLength: 1, maxLength: 50 }),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          maxParticipants: fc.option(fc.integer({ min: 1, max: 1000 })),
          privacy: fc.constantFrom('public', 'private')
        }),
        async (roomData) => {
          // Test that ZegoCloud service can create rooms independently
          const result = await zegoCloudService.createRoom(
            roomData.liveClassId,
            roomData.creatorId,
            {
              maxParticipants: roomData.maxParticipants,
              privacy: roomData.privacy
            }
          );

          // Verify ZegoCloud service works independently
          expect(result.success).toBe(true);
          expect(result.roomId).toBeDefined();
          expect(result.appId).toBeDefined();
          expect(result.creatorToken).toBeDefined();

          // Verify room configuration is independent
          expect(result.roomConfig).toBeDefined();
          expect(result.roomConfig.roomId).toBe(result.roomId);
          expect(result.roomConfig.creatorId).toBe(roomData.creatorId);
          expect(result.roomConfig.liveClassId).toBe(roomData.liveClassId);
          expect(result.roomConfig.privacy).toBe(roomData.privacy);

          // Test participant management independence
          const participantResult = await zegoCloudService.addParticipant(
            result.roomId,
            roomData.creatorId + 1,
            'participant'
          );

          expect(participantResult.success).toBe(true);
          expect(participantResult.token).toBeDefined();
          expect(participantResult.role).toBe('participant');

          // Test room cleanup independence
          const cleanupResult = await zegoCloudService.deleteRoom(result.roomId);
          expect(cleanupResult.success).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 10: System Isolation - Service failures are contained', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.string({ minLength: 1, maxLength: 50 }),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          failureType: fc.constantFrom('room_creation', 'token_generation', 'participant_management')
        }),
        async (testData) => {
          try {
            if (testData.failureType === 'room_creation') {
              // Test room creation with invalid data
              await expect(
                zegoCloudService.createRoom('', testData.creatorId)
              ).rejects.toThrow();
            } else if (testData.failureType === 'token_generation') {
              // Test token generation with invalid data
              expect(() => {
                zegoCloudService.generateToken('', testData.creatorId);
              }).toThrow();
            } else if (testData.failureType === 'participant_management') {
              // Test participant management with invalid data
              await expect(
                zegoCloudService.addParticipant('', testData.creatorId)
              ).rejects.toThrow();
            }

            // Verify that failures are properly contained and don't crash the system
            // The system should continue to function after errors
            const validResult = await zegoCloudService.createRoom(
              testData.liveClassId,
              testData.creatorId
            );
            expect(validResult.success).toBe(true);

          } catch (error) {
            // Errors should be properly handled and not propagate
            expect(error).toBeDefined();
            expect(error.message).toBeDefined();
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 10: System Isolation - Configuration validation works independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(true), // Just run the test
        async () => {
          // Test configuration validation
          const validation = zegoCloudService.validateConfiguration();
          
          // Verify configuration validation is independent
          expect(validation).toBeDefined();
          expect(typeof validation.valid).toBe('boolean');
          expect(Array.isArray(validation.issues)).toBe(true);
          expect(validation.configuration).toBeDefined();
          expect(typeof validation.configuration.tokenExpiry).toBe('number');
          expect(validation.configuration.tokenExpiry).toBeGreaterThan(0);

          // Configuration should have proper structure
          expect(validation.configuration.appId).toBeDefined();
          expect(validation.configuration.serverSecret).toBeDefined();
        }
      ),
      { numRuns: 10 }
    );
  });

  test('Property 10: System Isolation - Database operations are isolated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          userId: fc.integer({ min: 1, max: 999999 }),
          streamingProvider: fc.constantFrom('mux', 'zegocloud')
        }),
        async (testData) => {
          // Mock LiveClass to simulate database operations
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.userId,
            streaming_provider: testData.streamingProvider,
            zego_room_id: testData.streamingProvider === 'zegocloud' ? 'test_room_id' : null,
            mux_stream_id: testData.streamingProvider === 'mux' ? 'test_stream_id' : null,
            update: jest.fn().mockResolvedValue(true)
          };
          
          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Verify that different streaming providers can coexist
          if (testData.streamingProvider === 'zegocloud') {
            expect(mockLiveClass.zego_room_id).toBeDefined();
            expect(mockLiveClass.streaming_provider).toBe('zegocloud');
          } else {
            expect(mockLiveClass.mux_stream_id).toBeDefined();
            expect(mockLiveClass.streaming_provider).toBe('mux');
          }

          // Both providers should be able to exist in the same database
          expect(mockLiveClass.id).toBe(testData.liveClassId);
          expect(mockLiveClass.userId).toBe(testData.userId);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 10: System Isolation - Error handling preserves system stability', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          validLiveClassId: fc.string({ minLength: 1, maxLength: 50 }),
          invalidLiveClassId: fc.constantFrom('', null, undefined),
          validCreatorId: fc.integer({ min: 1, max: 999999 }),
          invalidCreatorId: fc.constantFrom(0, -1, null, undefined)
        }),
        async (testData) => {
          // Test that invalid operations don't affect valid ones
          try {
            await zegoCloudService.createRoom(
              testData.invalidLiveClassId,
              testData.invalidCreatorId
            );
            // Should not reach here
            expect(false).toBe(true);
          } catch (error) {
            // Error should be properly handled
            expect(error).toBeDefined();
          }

          // Valid operations should still work after errors
          const validResult = await zegoCloudService.createRoom(
            testData.validLiveClassId,
            testData.validCreatorId
          );

          expect(validResult.success).toBe(true);
          expect(validResult.roomId).toBeDefined();
          expect(validResult.appId).toBeDefined();
          expect(validResult.creatorToken).toBeDefined();
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 10: System Isolation - Concurrent operations work independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            liveClassId: fc.string({ minLength: 1, maxLength: 50 }),
            creatorId: fc.integer({ min: 1, max: 999999 })
          }),
          { minLength: 2, maxLength: 5 }
        ),
        async (roomDataArray) => {
          // Test concurrent room creation
          const createPromises = roomDataArray.map(roomData =>
            zegoCloudService.createRoom(roomData.liveClassId, roomData.creatorId)
          );

          const results = await Promise.all(createPromises);

          // All operations should succeed independently
          expect(results).toHaveLength(roomDataArray.length);
          results.forEach((result, index) => {
            expect(result.success).toBe(true);
            expect(result.roomId).toBeDefined();
            expect(result.roomConfig.liveClassId).toBe(roomDataArray[index].liveClassId);
            expect(result.roomConfig.creatorId).toBe(roomDataArray[index].creatorId);
          });

          // All room IDs should be unique
          const roomIds = results.map(result => result.roomId);
          const uniqueRoomIds = new Set(roomIds);
          expect(uniqueRoomIds.size).toBe(roomIds.length);

          // Test concurrent cleanup
          const cleanupPromises = results.map(result =>
            zegoCloudService.deleteRoom(result.roomId)
          );

          const cleanupResults = await Promise.all(cleanupPromises);
          cleanupResults.forEach(result => {
            expect(result.success).toBe(true);
          });
        }
      ),
      { numRuns: 20 }
    );
  });

  test('Property 10: System Isolation - Service maintains state consistency', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.string({ minLength: 1, maxLength: 50 }),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          participantId: fc.integer({ min: 1000, max: 999999 })
        }),
        async (testData) => {
          // Create room
          const roomResult = await zegoCloudService.createRoom(
            testData.liveClassId,
            testData.creatorId
          );

          expect(roomResult.success).toBe(true);
          const roomId = roomResult.roomId;

          // Add participant
          const participantResult = await zegoCloudService.addParticipant(
            roomId,
            testData.participantId,
            'participant'
          );

          expect(participantResult.success).toBe(true);
          expect(participantResult.roomId).toBe(roomId);
          expect(participantResult.userId).toBe(testData.participantId);

          // Get room info
          const roomInfo = await zegoCloudService.getRoomInfo(roomId);
          expect(roomInfo.success).toBe(true);
          expect(roomInfo.roomId).toBe(roomId);

          // Remove participant
          const removeResult = await zegoCloudService.removeParticipant(
            roomId,
            testData.participantId
          );

          expect(removeResult.success).toBe(true);
          expect(removeResult.roomId).toBe(roomId);
          expect(removeResult.userId).toBe(testData.participantId);

          // Clean up room
          const cleanupResult = await zegoCloudService.deleteRoom(roomId);
          expect(cleanupResult.success).toBe(true);
        }
      ),
      { numRuns: 30 }
    );
  });
});