const fc = require('fast-check');
const { zegoCloudPrivacyService } = require('../services/zegoCloudPrivacyService');
const LiveClass = require('../models/LiveClass');
const User = require('../models/User');

/**
 * Feature: zegocloud-live-classes, Property 7: Privacy Settings Enforcement
 * Validates: Requirements 5.1, 5.4
 * 
 * This property test ensures that privacy settings are properly enforced
 * and that access control works correctly for public and private rooms.
 */

// Mock dependencies
jest.mock('../models/LiveClass');
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
          const mockLiveClass = {