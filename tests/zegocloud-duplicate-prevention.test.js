const fc = require('fast-check');
const { zegoCloudStatusService } = require('../services/zegoCloudStatusService');
const LiveClass = require('../models/LiveClass');

/**
 * Feature: zegocloud-live-classes, Property 3: Duplicate Session Prevention
 * Validates: Requirements 1.5
 * 
 * This property test ensures that creators cannot create overlapping live classes
 * and that the system properly prevents duplicate active sessions.
 */

// Mock dependencies
jest.mock('../models/LiveClass');

describe('ZegoCloud Duplicate Session Prevention Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 3: Duplicate Session Prevention - Detects existing active sessions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          activeSessionCount: fc.integer({ min: 0, max: 5 }),
          excludeLiveClassId: fc.option(fc.uuid())
        }),
        async (testData) => {
          // Create mock active live classes
          const activeLiveClasses = Array.from({ length: testData.activeSessionCount }, (_, i) => ({
            id: `active-${i}`,
            title: `Active Live Class ${i}`,
            startTime: new Date(Date.now() - i * 60000), // Stagger start times
            zego_room_id: `room_${i}`,
            userId: testData.creatorId,
            status: 'live'
          }));

          // Filter out excluded live class if specified
          const filteredActiveSessions = testData.excludeLiveClassId
            ? activeLiveClasses.filter(lc => lc.id !== testData.excludeLiveClassId)
            : activeLiveClasses;

          LiveClass.findAll.mockResolvedValue(filteredActiveSessions);

          // Test duplicate session check
          const checkResult = await zegoCloudStatusService.checkDuplicateSessions(
            testData.creatorId,
            testData.excludeLiveClassId
          );

          expect(checkResult.success).toBe(true);
          expect(checkResult.creatorId).toBe(testData.creatorId);
          expect(checkResult.hasDuplicates).toBe(filteredActiveSessions.length > 0);
          expect(checkResult.duplicateCount).toBe(filteredActiveSessions.length);
          expect(checkResult.activeSessions).toHaveLength(filteredActiveSessions.length);
          expect(checkResult.checkedAt).toBeInstanceOf(Date);

          // Verify active session details
          checkResult.activeSessions.forEach((session, index) => {
            expect(session.id).toBe(filteredActiveSessions[index].id);
            expect(session.title).toBe(filteredActiveSessions[index].title);
            expect(session.startTime).toEqual(filteredActiveSessions[index].startTime);
            expect(session.roomId).toBe(filteredActiveSessions[index].zego_room_id);
          });

          // Verify database query was called correctly
          expect(LiveClass.findAll).toHaveBeenCalledWith({
            where: expect.objectContaining({
              userId: testData.creatorId,
              status: 'live'
            }),
            attributes: ['id', 'title', 'startTime', 'zego_room_id']
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Handles exclusion correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          totalSessions: fc.integer({ min: 2, max: 5 }),
          excludeIndex: fc.integer({ min: 0, max: 4 })
        }),
        async (testData) => {
          // Ensure excludeIndex is within bounds
          const safeExcludeIndex = testData.excludeIndex % testData.totalSessions;
          
          // Create mock active live classes
          const allActiveSessions = Array.from({ length: testData.totalSessions }, (_, i) => ({
            id: `session-${i}`,
            title: `Live Class ${i}`,
            startTime: new Date(Date.now() - i * 60000),
            zego_room_id: `room_${i}`,
            userId: testData.creatorId,
            status: 'live'
          }));

          const excludedSessionId = allActiveSessions[safeExcludeIndex].id;
          const expectedFilteredSessions = allActiveSessions.filter(s => s.id !== excludedSessionId);

          LiveClass.findAll.mockResolvedValue(expectedFilteredSessions);

          // Test duplicate check with exclusion
          const checkResult = await zegoCloudStatusService.checkDuplicateSessions(
            testData.creatorId,
            excludedSessionId
          );

          expect(checkResult.success).toBe(true);
          expect(checkResult.duplicateCount).toBe(testData.totalSessions - 1);
          expect(checkResult.hasDuplicates).toBe(testData.totalSessions > 1);
          expect(checkResult.activeSessions).toHaveLength(testData.totalSessions - 1);

          // Verify excluded session is not in results
          const sessionIds = checkResult.activeSessions.map(s => s.id);
          expect(sessionIds).not.toContain(excludedSessionId);

          // Verify all other sessions are included
          expectedFilteredSessions.forEach(session => {
            expect(sessionIds).toContain(session.id);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Handles no active sessions correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 })
        }),
        async (testData) => {
          // Mock no active sessions
          LiveClass.findAll.mockResolvedValue([]);

          const checkResult = await zegoCloudStatusService.checkDuplicateSessions(testData.creatorId);

          expect(checkResult.success).toBe(true);
          expect(checkResult.creatorId).toBe(testData.creatorId);
          expect(checkResult.hasDuplicates).toBe(false);
          expect(checkResult.duplicateCount).toBe(0);
          expect(checkResult.activeSessions).toHaveLength(0);
          expect(checkResult.checkedAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Validates creator ID input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          invalidCreatorId: fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(''),
            fc.constant(0),
            fc.constant(-1),
            fc.string()
          )
        }),
        async (testData) => {
          // Test invalid creator ID handling
          await expect(
            zegoCloudStatusService.checkDuplicateSessions(testData.invalidCreatorId)
          ).rejects.toThrow('Creator ID is required and must be a number');
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Handles database errors gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          errorMessage: fc.string({ minLength: 1, maxLength: 100 })
        }),
        async (testData) => {
          // Mock database error
          LiveClass.findAll.mockRejectedValue(new Error(testData.errorMessage));

          // Test error handling
          await expect(
            zegoCloudStatusService.checkDuplicateSessions(testData.creatorId)
          ).rejects.toThrow('Failed to check for duplicate sessions');
        }
      ),
      { numRuns: 30 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Works with different creator IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creator1Id: fc.integer({ min: 1, max: 999999 }),
          creator2Id: fc.integer({ min: 1000000, max: 9999999 }),
          creator1Sessions: fc.integer({ min: 0, max: 3 }),
          creator2Sessions: fc.integer({ min: 0, max: 3 })
        }),
        async (testData) => {
          // Ensure different creator IDs
          if (testData.creator1Id === testData.creator2Id) {
            testData.creator2Id = testData.creator1Id + 1;
          }

          // Create sessions for creator 1
          const creator1Sessions = Array.from({ length: testData.creator1Sessions }, (_, i) => ({
            id: `c1-session-${i}`,
            title: `Creator 1 Class ${i}`,
            startTime: new Date(),
            zego_room_id: `c1-room-${i}`,
            userId: testData.creator1Id,
            status: 'live'
          }));

          // Create sessions for creator 2
          const creator2Sessions = Array.from({ length: testData.creator2Sessions }, (_, i) => ({
            id: `c2-session-${i}`,
            title: `Creator 2 Class ${i}`,
            startTime: new Date(),
            zego_room_id: `c2-room-${i}`,
            userId: testData.creator2Id,
            status: 'live'
          }));

          // Mock database to return sessions for specific creator
          LiveClass.findAll.mockImplementation(({ where }) => {
            if (where.userId === testData.creator1Id) {
              return Promise.resolve(creator1Sessions);
            } else if (where.userId === testData.creator2Id) {
              return Promise.resolve(creator2Sessions);
            }
            return Promise.resolve([]);
          });

          // Test creator 1
          const creator1Result = await zegoCloudStatusService.checkDuplicateSessions(testData.creator1Id);
          expect(creator1Result.success).toBe(true);
          expect(creator1Result.duplicateCount).toBe(testData.creator1Sessions);
          expect(creator1Result.hasDuplicates).toBe(testData.creator1Sessions > 0);

          // Test creator 2
          const creator2Result = await zegoCloudStatusService.checkDuplicateSessions(testData.creator2Id);
          expect(creator2Result.success).toBe(true);
          expect(creator2Result.duplicateCount).toBe(testData.creator2Sessions);
          expect(creator2Result.hasDuplicates).toBe(testData.creator2Sessions > 0);

          // Verify isolation - creator 1 results don't include creator 2 sessions
          const creator1SessionIds = creator1Result.activeSessions.map(s => s.id);
          const creator2SessionIds = creator2Result.activeSessions.map(s => s.id);
          
          creator2SessionIds.forEach(id => {
            expect(creator1SessionIds).not.toContain(id);
          });
          
          creator1SessionIds.forEach(id => {
            expect(creator2SessionIds).not.toContain(id);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Session timing is properly tracked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          sessionCount: fc.integer({ min: 1, max: 4 })
        }),
        async (testData) => {
          // Create sessions with different start times
          const now = Date.now();
          const activeSessions = Array.from({ length: testData.sessionCount }, (_, i) => ({
            id: `timed-session-${i}`,
            title: `Timed Class ${i}`,
            startTime: new Date(now - (i * 300000)), // 5 minutes apart
            zego_room_id: `timed-room-${i}`,
            userId: testData.creatorId,
            status: 'live'
          }));

          LiveClass.findAll.mockResolvedValue(activeSessions);

          const checkResult = await zegoCloudStatusService.checkDuplicateSessions(testData.creatorId);

          expect(checkResult.success).toBe(true);
          expect(checkResult.activeSessions).toHaveLength(testData.sessionCount);

          // Verify start times are preserved and properly formatted
          checkResult.activeSessions.forEach((session, index) => {
            expect(session.startTime).toEqual(activeSessions[index].startTime);
            expect(session.startTime).toBeInstanceOf(Date);
            
            // Verify sessions are ordered by the database query (not necessarily by time)
            expect(session.id).toBe(activeSessions[index].id);
            expect(session.title).toBe(activeSessions[index].title);
            expect(session.roomId).toBe(activeSessions[index].zego_room_id);
          });
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 3: Duplicate Session Prevention - Concurrent checks work correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          concurrentChecks: fc.integer({ min: 2, max: 5 }),
          activeSessionCount: fc.integer({ min: 0, max: 3 })
        }),
        async (testData) => {
          // Create mock active sessions
          const activeSessions = Array.from({ length: testData.activeSessionCount }, (_, i) => ({
            id: `concurrent-${i}`,
            title: `Concurrent Class ${i}`,
            startTime: new Date(),
            zego_room_id: `concurrent-room-${i}`,
            userId: testData.creatorId,
            status: 'live'
          }));

          LiveClass.findAll.mockResolvedValue(activeSessions);

          // Perform concurrent duplicate checks
          const checkPromises = Array.from({ length: testData.concurrentChecks }, () =>
            zegoCloudStatusService.checkDuplicateSessions(testData.creatorId)
          );

          const results = await Promise.all(checkPromises);

          // Verify all concurrent checks return consistent results
          expect(results).toHaveLength(testData.concurrentChecks);
          
          results.forEach(result => {
            expect(result.success).toBe(true);
            expect(result.creatorId).toBe(testData.creatorId);
            expect(result.duplicateCount).toBe(testData.activeSessionCount);
            expect(result.hasDuplicates).toBe(testData.activeSessionCount > 0);
            expect(result.activeSessions).toHaveLength(testData.activeSessionCount);
          });

          // Verify all results are identical
          const firstResult = results[0];
          results.slice(1).forEach(result => {
            expect(result.duplicateCount).toBe(firstResult.duplicateCount);
            expect(result.hasDuplicates).toBe(firstResult.hasDuplicates);
            expect(result.activeSessions.map(s => s.id)).toEqual(firstResult.activeSessions.map(s => s.id));
          });
        }
      ),
      { numRuns: 30 }
    );
  });
});