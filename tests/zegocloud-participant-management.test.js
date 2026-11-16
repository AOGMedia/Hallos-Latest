const fc = require('fast-check');
const { zegoCloudService, ZegoCloudError } = require('../services/zegoCloudService');

/**
 * Feature: zegocloud-live-classes, Property 5: Participant Tracking Accuracy
 * Validates: Requirements 2.3, 7.1, 7.3
 * 
 * This property test ensures that participant management methods work correctly
 * for adding, removing, and tracking participants in ZegoCloud rooms.
 */

describe('ZegoCloud Participant Management Properties', () => {
  
  test('Property 5: Participant Tracking Accuracy - Add participant generates valid credentials', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0), // blank room IDs are rejected
          userId: fc.integer({ min: 1, max: 999999 }),
          role: fc.constantFrom('host', 'participant', 'audience'),
          userInfo: fc.record({
            displayName: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
            avatar: fc.option(fc.webUrl()),
            email: fc.option(fc.emailAddress())
          })
        }),
        async (participantData) => {
          const result = await zegoCloudService.addParticipant(
            participantData.roomId,
            participantData.userId,
            participantData.role,
            participantData.userInfo
          );

          // Verify participant addition success
          expect(result.success).toBe(true);
          expect(result.roomId).toBe(participantData.roomId);
          expect(result.userId).toBe(participantData.userId);
          expect(result.role).toBe(participantData.role);

          // Verify token is generated
          expect(result.token).toBeDefined();
          expect(typeof result.token).toBe('string');
          expect(result.token.length).toBeGreaterThan(0);

          // Verify app ID is provided
          expect(result.appId).toBeDefined();
          expect(typeof result.appId).toBe('string');

          // Verify user info is properly handled
          expect(result.userInfo).toBeDefined();
          expect(result.userInfo.displayName).toBeDefined();
          
          if (participantData.userInfo.displayName) {
            expect(result.userInfo.displayName).toBe(participantData.userInfo.displayName);
          } else {
            expect(result.userInfo.displayName).toBe(`User ${participantData.userId}`);
          }

          // Verify timestamps
          expect(result.joinedAt).toBeInstanceOf(Date);
          expect(result.joinedAt.getTime()).toBeLessThanOrEqual(Date.now());
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - Remove participant works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0), // blank room IDs are rejected
          userId: fc.integer({ min: 1, max: 999999 }),
          reason: fc.option(fc.constantFrom('kicked', 'left', 'timeout', 'banned'))
        }),
        async (removalData) => {
          const result = await zegoCloudService.removeParticipant(
            removalData.roomId,
            removalData.userId,
            removalData.reason
          );

          // Verify participant removal success
          expect(result.success).toBe(true);
          expect(result.roomId).toBe(removalData.roomId);
          expect(result.userId).toBe(removalData.userId);

          // Verify reason is recorded
          if (removalData.reason) {
            expect(result.reason).toBe(removalData.reason);
          } else {
            expect(result.reason).toBe('removed');
          }

          // Verify timestamps and message
          expect(result.removedAt).toBeInstanceOf(Date);
          expect(result.removedAt.getTime()).toBeLessThanOrEqual(Date.now());
          expect(result.message).toBe('Participant access revoked');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - Get participants returns valid structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 5, maxLength: 50 }),
        async (roomId) => {
          const result = await zegoCloudService.getParticipants(roomId);

          // Verify participants retrieval success
          expect(result.success).toBe(true);
          expect(result.roomId).toBe(roomId);

          // Verify participants structure
          expect(Array.isArray(result.participants)).toBe(true);
          expect(typeof result.participantCount).toBe('number');
          expect(result.participantCount).toBeGreaterThanOrEqual(0);

          // Verify timestamps and message
          expect(result.retrievedAt).toBeInstanceOf(Date);
          expect(result.retrievedAt.getTime()).toBeLessThanOrEqual(Date.now());
          expect(result.message).toBe('Participants retrieved successfully');
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - Invalid inputs produce appropriate errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.option(fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(''),
            fc.constant('   '), // whitespace-only string
            fc.string({ minLength: 1, maxLength: 50 })
          )),
          userId: fc.option(fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(0),
            fc.constant(-1),
            fc.integer({ min: 1, max: 999999 })
          )),
          role: fc.option(fc.oneof(
            fc.constantFrom('host', 'participant', 'audience'),
            fc.constant('invalid_role'),
            fc.constant(null)
          ))
        }),
        async (invalidData) => {
          const hasValidRoomId = invalidData.roomId && 
                                typeof invalidData.roomId === 'string' && 
                                invalidData.roomId.trim().length > 0;
          const hasValidUserId = invalidData.userId && 
                               typeof invalidData.userId === 'number' && 
                               invalidData.userId > 0;
          // A missing role is sent as 'participant' below, so only a wrong role is invalid.
          const hasValidRole = ['host', 'participant', 'audience'].includes(invalidData.role || 'participant');

          if (!hasValidRoomId || !hasValidUserId || !hasValidRole) {
            // Should throw ZegoCloudError for invalid inputs
            await expect(
              zegoCloudService.addParticipant(
                invalidData.roomId, 
                invalidData.userId, 
                invalidData.role || 'participant'
              )
            ).rejects.toThrow(ZegoCloudError);
          } else {
            // Should succeed with valid inputs
            const result = await zegoCloudService.addParticipant(
              invalidData.roomId,
              invalidData.userId,
              invalidData.role || 'participant'
            );
            expect(result.success).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - Role validation works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0), // blank room IDs are rejected
          userId: fc.integer({ min: 1, max: 999999 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (participantData) => {
          const result = await zegoCloudService.addParticipant(
            participantData.roomId,
            participantData.userId,
            participantData.role
          );

          // Verify role is correctly assigned
          expect(result.role).toBe(participantData.role);

          // The token is ZegoCloud's official encrypted token04 (not a JWT, so it can't be
          // decoded here); the role's privileges are covered in zegocloud-room-creation.test.js.
          expect(result.token.startsWith('04')).toBe(true);
          expect(result.token.length).toBeGreaterThan(100);
          expect(result.userId).toBe(participantData.userId);
          expect(result.roomId).toBe(participantData.roomId);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - User info handling is consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0), // blank room IDs are rejected
          userId: fc.integer({ min: 1, max: 999999 }),
          userInfo: fc.option(fc.record({
            displayName: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
            avatar: fc.option(fc.webUrl()),
            email: fc.option(fc.emailAddress())
          }))
        }),
        async (participantData) => {
          const result = await zegoCloudService.addParticipant(
            participantData.roomId,
            participantData.userId,
            'participant',
            participantData.userInfo
          );

          // Verify user info structure is always present
          expect(result.userInfo).toBeDefined();
          expect(typeof result.userInfo).toBe('object');

          // Verify display name handling
          if (participantData.userInfo && participantData.userInfo.displayName) {
            expect(result.userInfo.displayName).toBe(participantData.userInfo.displayName);
          } else {
            expect(result.userInfo.displayName).toBe(`User ${participantData.userId}`);
          }

          // Verify optional fields
          if (participantData.userInfo && participantData.userInfo.avatar) {
            expect(result.userInfo.avatar).toBe(participantData.userInfo.avatar);
          }

          if (participantData.userInfo && participantData.userInfo.email) {
            expect(result.userInfo.email).toBe(participantData.userInfo.email);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 5: Participant Tracking Accuracy - Concurrent participant operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }).filter(s => s.trim().length > 0), // blank room IDs are rejected
          participants: fc.array(
            fc.record({
              userId: fc.integer({ min: 1, max: 999999 }),
              role: fc.constantFrom('host', 'participant', 'audience')
            }),
            { minLength: 2, maxLength: 10 }
          )
        }),
        async (roomData) => {
          // Add multiple participants concurrently
          const addPromises = roomData.participants.map(participant =>
            zegoCloudService.addParticipant(
              roomData.roomId,
              participant.userId,
              participant.role
            )
          );

          const addResults = await Promise.all(addPromises);

          // Verify all participants were added successfully
          expect(addResults).toHaveLength(roomData.participants.length);
          addResults.forEach((result, index) => {
            expect(result.success).toBe(true);
            expect(result.userId).toBe(roomData.participants[index].userId);
            expect(result.role).toBe(roomData.participants[index].role);
            expect(result.token).toBeDefined();
          });

          // Remove participants concurrently
          const removePromises = roomData.participants.map(participant =>
            zegoCloudService.removeParticipant(roomData.roomId, participant.userId)
          );

          const removeResults = await Promise.all(removePromises);

          // Verify all participants were removed successfully
          expect(removeResults).toHaveLength(roomData.participants.length);
          removeResults.forEach((result, index) => {
            expect(result.success).toBe(true);
            expect(result.userId).toBe(roomData.participants[index].userId);
            expect(result.message).toBe('Participant access revoked');
          });
        }
      ),
      { numRuns: 50 } // Reduced runs due to concurrent operations complexity
    );
  });
});