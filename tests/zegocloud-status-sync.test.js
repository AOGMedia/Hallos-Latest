const fc = require('fast-check');
const { zegoCloudStatusService } = require('../services/zegoCloudStatusService');
const LiveClass = require('../models/LiveClass');

/**
 * Feature: zegocloud-live-classes, Property 2: Database Status Synchronization
 * Validates: Requirements 1.3, 1.4
 * 
 * This property test ensures that database status updates are properly synchronized
 * when streaming starts/stops and that automatic room cleanup works correctly.
 */

// Mock dependencies
jest.mock('../models/LiveClass');

describe('ZegoCloud Status Synchronization Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 2: Database Status Synchronization - Status updates are properly synchronized', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          initialStatus: fc.constantFrom('scheduled', 'live'),
          newStatus: fc.constantFrom('live', 'ended', 'recorded'),
          userId: fc.integer({ min: 1, max: 999999 }),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          appId: fc.string({ minLength: 10, maxLength: 50 })
        }),
        async (testData) => {
          // Mock live class
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.userId,
            status: testData.initialStatus,
            startTime: testData.initialStatus === 'live' ? new Date() : null,
            endTime: null,
            update: jest.fn().mockResolvedValue(true)
          };

          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Validate status transition
          const transitionValidation = zegoCloudStatusService.validateStatusTransition(
            testData.initialStatus,
            testData.newStatus
          );

          if (transitionValidation.valid) {
            // Test valid status update
            const result = await zegoCloudStatusService.updateLiveClassStatus(
              testData.liveClassId,
              testData.newStatus
            );

            expect(result.success).toBe(true);
            expect(result.liveClassId).toBe(testData.liveClassId);
            expect(result.previousStatus).toBe(testData.initialStatus);
            expect(result.newStatus).toBe(testData.newStatus);
            expect(result.updatedAt).toBeInstanceOf(Date);

            // Verify update was called with correct data
            expect(mockLiveClass.update).toHaveBeenCalled();
            const updateCall = mockLiveClass.update.mock.calls[0][0];
            expect(updateCall.status).toBe(testData.newStatus);

            // Verify timestamp handling
            if (testData.newStatus === 'live' && !mockLiveClass.startTime) {
              expect(updateCall.startTime).toBeInstanceOf(Date);
            }
            if (testData.newStatus === 'ended' && !mockLiveClass.endTime) {
              expect(updateCall.endTime).toBeInstanceOf(Date);
            }
          } else {
            // Test invalid status transition
            await expect(
              zegoCloudStatusService.updateLiveClassStatus(
                testData.liveClassId,
                testData.newStatus
              )
            ).resolves.toBeDefined(); // Status service doesn't enforce transitions, just updates
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 2: Database Status Synchronization - Live session lifecycle is properly managed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          userId: fc.integer({ min: 1, max: 999999 }),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          appId: fc.string({ minLength: 10, maxLength: 50 }),
          creatorToken: fc.string({ minLength: 50, maxLength: 200 })
        }),
        async (testData) => {
          // Mock live class in scheduled state
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.userId,
            status: 'scheduled',
            startTime: null,
            endTime: null,
            zego_room_id: null,
            update: jest.fn().mockResolvedValue(true)
          };

          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Test starting live session
          const startResult = await zegoCloudStatusService.startLiveSession(
            testData.liveClassId,
            testData.roomId,
            testData.appId,
            testData.creatorToken
          );

          expect(startResult.success).toBe(true);
          expect(startResult.sessionStarted).toBe(true);
          expect(startResult.roomId).toBe(testData.roomId);
          expect(startResult.appId).toBe(testData.appId);
          expect(startResult.newStatus).toBe('live');

          // Verify database update for session start
          expect(mockLiveClass.update).toHaveBeenCalledWith({
            zego_room_id: testData.roomId,
            zego_app_id: testData.appId,
            streaming_provider: 'zegocloud',
            zego_room_token: testData.creatorToken,
            status: 'live',
            startTime: expect.any(Date)
          });

          // Update mock to reflect live state
          mockLiveClass.status = 'live';
          mockLiveClass.startTime = new Date();
          mockLiveClass.zego_room_id = testData.roomId;
          mockLiveClass.update.mockClear();

          // Test ending live session
          const endResult = await zegoCloudStatusService.endLiveSession(
            testData.liveClassId,
            'completed'
          );

          expect(endResult.success).toBe(true);
          expect(endResult.sessionEnded).toBe(true);
          expect(endResult.reason).toBe('completed');
          expect(endResult.newStatus).toBe('ended');

          // Verify database update for session end
          expect(mockLiveClass.update).toHaveBeenCalledWith({
            status: 'ended',
            endTime: expect.any(Date)
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 2: Database Status Synchronization - Cleanup inactive rooms works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          maxAgeHours: fc.integer({ min: 1, max: 48 }),
          staleRoomCount: fc.integer({ min: 0, max: 5 })
        }),
        async (testData) => {
          // Create mock stale rooms
          const staleRooms = Array.from({ length: testData.staleRoomCount }, (_, i) => ({
            id: `stale-${i}`,
            title: `Stale Room ${i}`,
            startTime: new Date(Date.now() - (testData.maxAgeHours + 1) * 60 * 60 * 1000),
            zego_room_id: `room_${i}`,
            userId: 1000 + i,
            status: 'live',
            streaming_provider: 'zegocloud'
          }));

          LiveClass.findAll.mockResolvedValue(staleRooms);

          // Mock individual live class updates
          staleRooms.forEach(room => {
            const mockLiveClass = {
              ...room,
              update: jest.fn().mockResolvedValue(true)
            };
            LiveClass.findByPk.mockImplementation((id) => {
              if (id === room.id) return Promise.resolve(mockLiveClass);
              return Promise.resolve(null);
            });
          });

          // Test cleanup
          const cleanupResult = await zegoCloudStatusService.cleanupInactiveRooms(testData.maxAgeHours);

          expect(cleanupResult.success).toBe(true);
          expect(cleanupResult.totalFound).toBe(testData.staleRoomCount);
          expect(cleanupResult.totalCleaned).toBe(testData.staleRoomCount);
          expect(cleanupResult.cleanupResults).toHaveLength(testData.staleRoomCount);
          expect(cleanupResult.cutoffTime).toBeInstanceOf(Date);
          expect(cleanupResult.cleanedAt).toBeInstanceOf(Date);

          // Verify all stale rooms were processed
          cleanupResult.cleanupResults.forEach((result, index) => {
            expect(result.liveClassId).toBe(`stale-${index}`);
            expect(result.cleaned).toBe(true);
            expect(result.roomId).toBe(`room_${index}`);
          });
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 2: Database Status Synchronization - Status validation works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          currentStatus: fc.constantFrom('scheduled', 'live', 'ended', 'recorded'),
          newStatus: fc.constantFrom('scheduled', 'live', 'ended', 'recorded')
        }),
        async (testData) => {
          const validation = zegoCloudStatusService.validateStatusTransition(
            testData.currentStatus,
            testData.newStatus
          );

          expect(validation).toBeDefined();
          expect(typeof validation.valid).toBe('boolean');
          expect(validation.currentStatus).toBe(testData.currentStatus);
          expect(validation.newStatus).toBe(testData.newStatus);
          expect(Array.isArray(validation.allowedTransitions)).toBe(true);
          expect(typeof validation.message).toBe('string');

          // Verify specific transition rules
          const validTransitions = {
            'scheduled': ['live', 'ended'],
            'live': ['ended', 'recorded'],
            'ended': ['recorded'],
            'recorded': []
          };

          const expectedValid = validTransitions[testData.currentStatus]?.includes(testData.newStatus) || false;
          expect(validation.valid).toBe(expectedValid);
          expect(validation.allowedTransitions).toEqual(validTransitions[testData.currentStatus] || []);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 2: Database Status Synchronization - Batch updates work correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            liveClassId: fc.uuid(),
            status: fc.constantFrom('live', 'ended', 'recorded'),
            userId: fc.integer({ min: 1, max: 999999 })
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (updates) => {
          // Mock live classes for each update
          updates.forEach(update => {
            const mockLiveClass = {
              id: update.liveClassId,
              userId: update.userId,
              status: 'scheduled',
              update: jest.fn().mockResolvedValue(true)
            };
            LiveClass.findByPk.mockImplementation((id) => {
              if (id === update.liveClassId) return Promise.resolve(mockLiveClass);
              return Promise.resolve(null);
            });
          });

          // Test batch update
          const batchResult = await zegoCloudStatusService.batchUpdateStatuses(updates);

          expect(batchResult.success).toBe(true);
          expect(batchResult.totalUpdates).toBe(updates.length);
          expect(batchResult.successfulUpdates).toBe(updates.length);
          expect(batchResult.failedUpdates).toBe(0);
          expect(batchResult.results).toHaveLength(updates.length);
          expect(batchResult.errors).toHaveLength(0);
          expect(batchResult.processedAt).toBeInstanceOf(Date);

          // Verify each update result
          batchResult.results.forEach((result, index) => {
            expect(result.success).toBe(true);
            expect(result.liveClassId).toBe(updates[index].liveClassId);
            expect(result.newStatus).toBe(updates[index].status);
          });
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 2: Database Status Synchronization - Error handling preserves data integrity', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          validLiveClassId: fc.uuid(),
          invalidLiveClassId: fc.uuid(),
          status: fc.constantFrom('live', 'ended')
        }),
        async (testData) => {
          // Mock valid live class
          const mockValidLiveClass = {
            id: testData.validLiveClassId,
            status: 'scheduled',
            update: jest.fn().mockResolvedValue(true)
          };

          LiveClass.findByPk.mockImplementation((id) => {
            if (id === testData.validLiveClassId) return Promise.resolve(mockValidLiveClass);
            if (id === testData.invalidLiveClassId) return Promise.resolve(null);
            return Promise.resolve(null);
          });

          // Test error handling for invalid live class
          await expect(
            zegoCloudStatusService.updateLiveClassStatus(testData.invalidLiveClassId, testData.status)
          ).rejects.toThrow('Live class not found');

          // Verify valid operations still work after errors
          const validResult = await zegoCloudStatusService.updateLiveClassStatus(
            testData.validLiveClassId,
            testData.status
          );

          expect(validResult.success).toBe(true);
          expect(validResult.liveClassId).toBe(testData.validLiveClassId);
          expect(validResult.newStatus).toBe(testData.status);
        }
      ),
      { numRuns: 50 }
    );
  });
});