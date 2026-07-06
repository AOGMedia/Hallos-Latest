const fc = require('fast-check');
const { zegoCloudService } = require('../services/zegoCloudService');
const User = require('../models/User');
const LiveClass = require('../models/LiveClass');

/**
 * Feature: zegocloud-live-classes, Property 12: User Data Integration
 * Validates: Requirements 7.2, 8.3
 * 
 * This property test ensures that user data is properly integrated with ZegoCloud
 * participant management and that user information is correctly displayed in rooms.
 */

// Mock dependencies
jest.mock('../models/User');
jest.mock('../models/LiveClass');

describe('ZegoCloud User Data Integration Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 12: User Data Integration - User information is properly integrated', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.integer({ min: 1, max: 999999 }),
          firstname: fc.string({ minLength: 1, maxLength: 50 }),
          lastname: fc.string({ minLength: 1, maxLength: 50 }),
          email: fc.emailAddress(),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (userData) => {
          // Mock user data
          const mockUser = {
            id: userData.userId,
            firstname: userData.firstname,
            lastname: userData.lastname,
            email: userData.email,
            name: `${userData.firstname} ${userData.lastname}`,
            avatar: null,
            role: 'viewer'
          };

          User.findByPk.mockResolvedValue(mockUser);

          // Test user data integration in participant management
          const userInfo = {
            displayName: mockUser.name,
            avatar: mockUser.avatar,
            email: mockUser.email
          };

          const participantResult = await zegoCloudService.addParticipant(
            userData.roomId,
            userData.userId,
            userData.role,
            userInfo
          );

          // Verify user data is properly integrated
          expect(participantResult.success).toBe(true);
          expect(participantResult.userId).toBe(userData.userId);
          expect(participantResult.role).toBe(userData.role);
          expect(participantResult.userInfo).toBeDefined();
          expect(participantResult.userInfo.displayName).toBe(mockUser.name);
          expect(participantResult.userInfo.email).toBe(mockUser.email);
          expect(participantResult.token).toBeDefined();

          // Verify token contains user information
          expect(participantResult.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 12: User Data Integration - Handles missing user data gracefully', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.integer({ min: 1, max: 999999 }),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (userData) => {
          // Mock missing user data
          User.findByPk.mockResolvedValue(null);

          // Test participant addition with missing user data
          const participantResult = await zegoCloudService.addParticipant(
            userData.roomId,
            userData.userId,
            userData.role
          );

          // Verify system handles missing user data gracefully
          expect(participantResult.success).toBe(true);
          expect(participantResult.userId).toBe(userData.userId);
          expect(participantResult.role).toBe(userData.role);
          expect(participantResult.userInfo).toBeDefined();
          expect(participantResult.userInfo.displayName).toBe(`User ${userData.userId}`);
          expect(participantResult.userInfo.email).toBeNull();
          expect(participantResult.userInfo.avatar).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 12: User Data Integration - Role-based privileges are correctly assigned', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.integer({ min: 1, max: 999999 }),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          role: fc.constantFrom('host', 'participant', 'audience')
        }),
        async (userData) => {
          const participantResult = await zegoCloudService.addParticipant(
            userData.roomId,
            userData.userId,
            userData.role
          );

          expect(participantResult.success).toBe(true);
          expect(participantResult.role).toBe(userData.role);

          // Verify token contains correct role information
          const token = participantResult.token;
          expect(token).toBeDefined();
          
          // Decode token payload (simplified check)
          const tokenParts = token.split('.');
          expect(tokenParts).toHaveLength(3);
          
          const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
          expect(payload.role).toBe(userData.role);
          expect(payload.user_id).toBe(userData.userId.toString());
          expect(payload.room_id).toBe(userData.roomId);

          // Verify role privileges
          const expectedPrivileges = zegoCloudService.getRolePrivileges(userData.role);
          expect(payload.privilege).toEqual(expectedPrivileges);

          if (userData.role === 'host') {
            expect(payload.privilege.canPublish).toBe(true);
            expect(payload.privilege.canKickOut).toBe(true);
            expect(payload.privilege.canManageRoom).toBe(true);
          } else if (userData.role === 'participant') {
            expect(payload.privilege.canPublish).toBe(true);
            expect(payload.privilege.canKickOut).toBe(false);
            expect(payload.privilege.canManageRoom).toBe(false);
          } else if (userData.role === 'audience') {
            expect(payload.privilege.canPublish).toBe(false);
            expect(payload.privilege.canKickOut).toBe(false);
            expect(payload.privilege.canManageRoom).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 12: User Data Integration - User display names are properly formatted', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.integer({ min: 1, max: 999999 }),
          firstname: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          lastname: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          email: fc.emailAddress(),
          roomId: fc.string({ minLength: 10, maxLength: 50 })
        }),
        async (userData) => {
          // Mock user with various name formats
          const mockUser = {
            id: userData.userId,
            firstname: userData.firstname.trim(),
            lastname: userData.lastname.trim(),
            email: userData.email,
            name: `${userData.firstname.trim()} ${userData.lastname.trim()}`,
            avatar: null
          };

          User.findByPk.mockResolvedValue(mockUser);

          const userInfo = {
            displayName: mockUser.name,
            avatar: mockUser.avatar,
            email: mockUser.email
          };

          const participantResult = await zegoCloudService.addParticipant(
            userData.roomId,
            userData.userId,
            'participant',
            userInfo
          );

          // Verify display name formatting
          expect(participantResult.success).toBe(true);
          expect(participantResult.userInfo.displayName).toBe(mockUser.name);
          expect(participantResult.userInfo.displayName).toMatch(/^.+ .+$/); // Should have space between names
          expect(participantResult.userInfo.displayName.trim()).toBe(participantResult.userInfo.displayName);
          expect(participantResult.userInfo.email).toBe(userData.email);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 12: User Data Integration - Creator role assignment works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          creatorId: fc.integer({ min: 1, max: 999999 }),
          participantId: fc.integer({ min: 1000000, max: 9999999 }),
          liveClassId: fc.uuid(),
          roomId: fc.string({ minLength: 10, maxLength: 50 })
        }),
        async (testData) => {
          // Mock live class with creator
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.creatorId,
            title: 'Test Live Class',
            zego_room_id: testData.roomId,
            status: 'live'
          };

          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Mock creator user
          const mockCreator = {
            id: testData.creatorId,
            firstname: 'Creator',
            lastname: 'User',
            name: 'Creator User',
            email: 'creator@test.com'
          };

          // Mock participant user
          const mockParticipant = {
            id: testData.participantId,
            firstname: 'Participant',
            lastname: 'User',
            name: 'Participant User',
            email: 'participant@test.com'
          };

          User.findByPk.mockImplementation((id) => {
            if (id === testData.creatorId) return Promise.resolve(mockCreator);
            if (id === testData.participantId) return Promise.resolve(mockParticipant);
            return Promise.resolve(null);
          });

          // Test creator gets host role
          const creatorResult = await zegoCloudService.addParticipant(
            testData.roomId,
            testData.creatorId,
            'host',
            {
              displayName: mockCreator.name,
              email: mockCreator.email
            }
          );

          expect(creatorResult.success).toBe(true);
          expect(creatorResult.role).toBe('host');
          expect(creatorResult.userInfo.displayName).toBe('Creator User');

          // Test participant gets participant role
          const participantResult = await zegoCloudService.addParticipant(
            testData.roomId,
            testData.participantId,
            'participant',
            {
              displayName: mockParticipant.name,
              email: mockParticipant.email
            }
          );

          expect(participantResult.success).toBe(true);
          expect(participantResult.role).toBe('participant');
          expect(participantResult.userInfo.displayName).toBe('Participant User');

          // Verify different privileges
          const creatorToken = creatorResult.token;
          const participantToken = participantResult.token;

          const creatorPayload = JSON.parse(Buffer.from(creatorToken.split('.')[1], 'base64url').toString());
          const participantPayload = JSON.parse(Buffer.from(participantToken.split('.')[1], 'base64url').toString());

          expect(creatorPayload.privilege.canManageRoom).toBe(true);
          expect(participantPayload.privilege.canManageRoom).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test('Property 12: User Data Integration - Email validation and privacy', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          userId: fc.integer({ min: 1, max: 999999 }),
          email: fc.option(fc.emailAddress()),
          roomId: fc.string({ minLength: 10, maxLength: 50 }),
          includeEmail: fc.boolean()
        }),
        async (userData) => {
          const mockUser = {
            id: userData.userId,
            firstname: 'Test',
            lastname: 'User',
            name: 'Test User',
            email: userData.email
          };

          User.findByPk.mockResolvedValue(mockUser);

          const userInfo = {
            displayName: mockUser.name,
            email: userData.includeEmail ? mockUser.email : null
          };

          const participantResult = await zegoCloudService.addParticipant(
            userData.roomId,
            userData.userId,
            'participant',
            userInfo
          );

          expect(participantResult.success).toBe(true);
          expect(participantResult.userInfo.displayName).toBe('Test User');

          if (userData.includeEmail && userData.email) {
            expect(participantResult.userInfo.email).toBe(userData.email);
          } else {
            expect(participantResult.userInfo.email).toBeNull();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});