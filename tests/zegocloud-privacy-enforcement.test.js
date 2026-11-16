const fc = require('fast-check');
const { zegoCloudPrivacyService } = require('../services/zegoCloudPrivacyService');
const LiveClass = require('../models/liveClass');
const User = require('../models/User');

/**
 * Feature: zegocloud-live-classes, Property 7: Privacy Settings Enforcement
 * Validates: Requirements 5.1, 5.4
 * 
 * This property test ensures that privacy settings are properly enforced
 * and that access control works correctly for public and private rooms.
 */

// Mock dependencies
jest.mock('../models/liveClass');
jest.mock('../models/User');

describe('ZegoCloud Privacy Settings Enforcement Properties', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Property 7: Privacy Settings Enforcement - Public classes allow unrestricted access', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          userId: fc.integer({ min: 1000000, max: 9999999 }),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          price: fc.float({ min: 0, max: 1000 })
        }),
        async (testData) => {
          // Mock public live class
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.creatorId,
            title: testData.title,
            privacy: 'public',
            price: testData.price,
            status: 'live'
          };

          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          // Test access check for public class
          const accessResult = await zegoCloudPrivacyService.checkPrivateAccess(
            testData.liveClassId,
            testData.userId
          );

          expect(accessResult.success).toBe(true);
          expect(accessResult.hasAccess).toBe(true);
          expect(accessResult.accessType).toBe('public');
          expect(accessResult.privacy).toBe('public');
          expect(accessResult.reason).toContain('Public live class');

          // Test privacy enforcement for public class
          const enforcementResult = await zegoCloudPrivacyService.enforcePrivacySettings(
            testData.liveClassId,
            testData.userId
          );

          expect(enforcementResult.success).toBe(true);
          expect(enforcementResult.allowed).toBe(true);
          expect(enforcementResult.accessType).toBe('public');
          expect(enforcementResult.grantedAt).toBeInstanceOf(Date);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 7: Privacy Settings Enforcement - Creators always have access to their classes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          privacy: fc.constantFrom('public', 'private'),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          price: fc.float({ min: 0, max: 1000 })
        }),
        async (testData) => {
          // Mock live class owned by creator
          // (This file was cut off here in the first commit; the rest was rewritten to match.)
          const mockLiveClass = {
            id: testData.liveClassId,
            userId: testData.creatorId,
            title: testData.title,
            privacy: testData.privacy,
            price: testData.price,
            status: 'live'
          };

          LiveClass.findByPk.mockResolvedValue(mockLiveClass);

          const accessResult = await zegoCloudPrivacyService.checkPrivateAccess(
            testData.liveClassId,
            testData.creatorId
          );

          expect(accessResult.success).toBe(true);
          expect(accessResult.hasAccess).toBe(true);
          // Public classes are open to everyone first; private ones are open to their creator.
          expect(accessResult.accessType).toBe(testData.privacy === 'public' ? 'public' : 'creator');

          const enforcementResult = await zegoCloudPrivacyService.enforcePrivacySettings(
            testData.liveClassId,
            testData.creatorId
          );

          expect(enforcementResult.success).toBe(true);
          expect(enforcementResult.allowed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 7: Privacy Settings Enforcement - Private classes refuse people without access', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          liveClassId: fc.uuid(),
          creatorId: fc.integer({ min: 1, max: 999999 }),
          userId: fc.integer({ min: 1000000, max: 9999999 }), // never the creator
          price: fc.float({ min: 0, max: 1000, noNaN: true })
        }),
        async (testData) => {
          LiveClass.findByPk.mockResolvedValue({
            id: testData.liveClassId,
            userId: testData.creatorId,
            title: 'Private class',
            privacy: 'private',
            price: testData.price,
            status: 'live'
          });

          const enforcementResult = await zegoCloudPrivacyService.enforcePrivacySettings(
            testData.liveClassId,
            testData.userId
          );

          expect(enforcementResult.success).toBe(false);
          expect(enforcementResult.allowed).toBe(false);
          expect(enforcementResult.errorCode).toBe('ACCESS_DENIED');
          expect(enforcementResult.httpStatus).toBe(403);

          // Someone who bought it gets in.
          const buyer = await zegoCloudPrivacyService.enforcePrivacySettings(
            testData.liveClassId,
            testData.userId,
            { hasPurchasedAccess: true }
          );
          expect(buyer.allowed).toBe(true);
          expect(buyer.accessType).toBe('purchased');
        }
      ),
      { numRuns: 100 }
    );
  });
});