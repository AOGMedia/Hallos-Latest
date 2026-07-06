const fc = require('fast-check');
const { zegoCloudService, ZegoCloudError } = require('../services/zegoCloudService');

/**
 * Feature: zegocloud-live-classes, Property 1: Room Creation Generates Valid Credentials
 * Validates: Requirements 1.1, 1.2, 8.1
 * 
 * This property test ensures that room creation always generates valid credentials
 * including room ID, app ID, and access tokens for any valid input.
 */

describe('ZegoCloud Room Creation Properties', () => {
  
  test('Property 1: Room Creation Generates Valid Credentials - Valid room and token generation', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate test data for room creation
        fc.record({
          liveClassId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          maxParticipants: fc.option(fc.integer({ min: 1, max: 1000 })),
          privacy: fc.constantFrom('public', 'private')
        }),
        async (roomData) => {
          // Test room creation with valid inputs
          const result = await zegoCloudService.createRoom(
            roomData.liveClassId,
            roomData.creatorId,
            {
              maxParticipants: roomData.maxParticipants,
              privacy: roomData.privacy
            }
          );

          // Verify room creation success
          expect(result.success).toBe(true);
          expect(result.roomId).toBeDefined();
          expect(typeof result.roomId).toBe('string');
          expect(result.roomId.length).toBeGreaterThan(0);

          // Verify app ID is provided
          expect(result.appId).toBeDefined();
          expect(typeof result.appId).toBe('string');

          // Verify creator token is generated
          expect(result.creatorToken).toBeDefined();
          expect(typeof result.creatorToken).toBe('string');
          expect(result.creatorToken.length).toBeGreaterThan(0);

          // Verify room configuration is complete
          expect(result.roomConfig).toBeDefined();
          expect(result.roomConfig.roomId).toBe(result.roomId);
          expect(result.roomConfig.creatorId).toBe(roomData.creatorId);
          expect(result.roomConfig.liveClassId).toBe(roomData.liveClassId);
          expect(result.roomConfig.privacy).toBe(roomData.privacy);

          // Verify room ID format (should contain live class ID)
          expect(result.roomId).toContain('live_');
          expect(result.roomId).toContain(roomData.liveClassId);

          // Verify token format (should be JWT-like with 3 parts)
          const tokenParts = result.creatorToken.split('.');
          expect(tokenParts).toHaveLength(3);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Token Generation Consistency - Same inputs produce valid but different tokens over time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }),
          userId: fc.integer({ min: 1, max: 999999 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (tokenData) => {
          // Generate two tokens with same parameters but different timestamps
          const token1 = zegoCloudService.generateToken(
            tokenData.roomId,
            tokenData.userId,
            tokenData.role
          );

          // Wait a moment to ensure different timestamp
          await new Promise(resolve => setTimeout(resolve, 10));

          const token2 = zegoCloudService.generateToken(
            tokenData.roomId,
            tokenData.userId,
            tokenData.role
          );

          // Both tokens should be valid strings
          expect(typeof token1).toBe('string');
          expect(typeof token2).toBe('string');
          expect(token1.length).toBeGreaterThan(0);
          expect(token2.length).toBeGreaterThan(0);

          // Tokens should have JWT format
          expect(token1.split('.')).toHaveLength(3);
          expect(token2.split('.')).toHaveLength(3);

          // Tokens should be different due to different timestamps
          expect(token1).not.toBe(token2);

          // Both tokens should decode to valid payloads
          const payload1 = JSON.parse(Buffer.from(token1.split('.')[1], 'base64url').toString());
          const payload2 = JSON.parse(Buffer.from(token2.split('.')[1], 'base64url').toString());

          expect(payload1.room_id).toBe(tokenData.roomId);
          expect(payload1.user_id).toBe(tokenData.userId.toString());
          expect(payload1.role).toBe(tokenData.role);

          expect(payload2.room_id).toBe(tokenData.roomId);
          expect(payload2.user_id).toBe(tokenData.userId.toString());
          expect(payload2.role).toBe(tokenData.role);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Room ID Uniqueness - Different live classes generate unique room IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            liveClassId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
            creatorId: fc.integer({ min: 1, max: 999999 })
          }),
          { minLength: 2, maxLength: 10 }
        ),
        async (roomDataArray) => {
          const roomIds = new Set();
          
          // Create rooms for all live classes
          for (const roomData of roomDataArray) {
            const result = await zegoCloudService.createRoom(
              roomData.liveClassId,
              roomData.creatorId
            );

            expect(result.success).toBe(true);
            expect(result.roomId).toBeDefined();

            // Verify room ID is unique
            expect(roomIds.has(result.roomId)).toBe(false);
            roomIds.add(result.roomId);
          }

          // Verify all room IDs are unique
          expect(roomIds.size).toBe(roomDataArray.length);
        }
      ),
      { numRuns: 50 } // Reduced runs due to array generation complexity
    );
  });

  test('Property 1: Error Handling - Invalid inputs produce appropriate errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.option(fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(''),
            fc.string({ minLength: 1, maxLength: 50 })
          )),
          creatorId: fc.option(fc.oneof(
            fc.constant(null),
            fc.constant(undefined),
            fc.constant(0),
            fc.constant(-1),
            fc.integer({ min: 1, max: 999999 })
          ))
        }),
        async (invalidData) => {
          // Test with invalid inputs
          const hasValidLiveClassId = invalidData.liveClassId && 
                                    typeof invalidData.liveClassId === 'string' && 
                                    invalidData.liveClassId.length > 0;
          const hasValidCreatorId = invalidData.creatorId && 
                                  typeof invalidData.creatorId === 'number' && 
                                  invalidData.creatorId > 0;

          if (!hasValidLiveClassId || !hasValidCreatorId) {
            // Should throw ZegoCloudError for invalid inputs
            await expect(
              zegoCloudService.createRoom(invalidData.liveClassId, invalidData.creatorId)
            ).rejects.toThrow(ZegoCloudError);
          } else {
            // Should succeed with valid inputs
            const result = await zegoCloudService.createRoom(
              invalidData.liveClassId, 
              invalidData.creatorId
            );
            expect(result.success).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Role-based Token Privileges - Different roles have appropriate privileges', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          roomId: fc.string({ minLength: 5, maxLength: 50 }),
          userId: fc.integer({ min: 1, max: 999999 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (tokenData) => {
          const token = zegoCloudService.generateToken(
            tokenData.roomId,
            tokenData.userId,
            tokenData.role
          );

          // Decode token payload
          const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

          // Verify role-specific privileges
          expect(payload.privilege).toBeDefined();
          
          if (tokenData.role === 'host') {
            expect(payload.privilege.canPublish).toBe(true);
            expect(payload.privilege.canSubscribe).toBe(true);
            expect(payload.privilege.canKickOut).toBe(true);
            expect(payload.privilege.canMuteOthers).toBe(true);
            expect(payload.privilege.canManageRoom).toBe(true);
          } else if (tokenData.role === 'participant') {
            expect(payload.privilege.canPublish).toBe(true);
            expect(payload.privilege.canSubscribe).toBe(true);
            expect(payload.privilege.canKickOut).toBe(false);
            expect(payload.privilege.canMuteOthers).toBe(false);
            expect(payload.privilege.canManageRoom).toBe(false);
          } else if (tokenData.role === 'audience') {
            expect(payload.privilege.canPublish).toBe(false);
            expect(payload.privilege.canSubscribe).toBe(true);
            expect(payload.privilege.canKickOut).toBe(false);
            expect(payload.privilege.canMuteOthers).toBe(false);
            expect(payload.privilege.canManageRoom).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 1: Configuration Validation - Service validates configuration correctly', () => {
    const validation = zegoCloudService.validateConfiguration();
    
    // Configuration validation should always return a structured result
    expect(validation).toBeDefined();
    expect(typeof validation.valid).toBe('boolean');
    expect(Array.isArray(validation.issues)).toBe(true);
    expect(validation.configuration).toBeDefined();
    expect(validation.configuration.tokenExpiry).toBeGreaterThan(0);
  });
});