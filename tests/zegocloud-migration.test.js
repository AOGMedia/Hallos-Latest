const fc = require('fast-check');
const sequelize = require('../config/db');
const LiveClass = require('../models/LiveClass');

/**
 * Feature: zegocloud-live-classes, Property 9: Mux Functionality Preservation
 * Validates: Requirements 6.1, 6.2, 6.3
 * 
 * This property test ensures that after adding ZegoCloud fields to the database,
 * all existing Mux functionality remains intact and accessible.
 */

describe('ZegoCloud Database Migration Safety', () => {
  let testUserId;

  beforeAll(async () => {
    // Ensure database connection is established
    await sequelize.authenticate();
    
    // Create a test user for the tests
    const User = require('../models/User');
    const testUser = await User.create({
      firstname: 'Test',
      lastname: 'User',
      email: 'test@example.com',
      password: 'testpassword'
    });
    testUserId = testUser.id;
  });

  afterAll(async () => {
    // Clean up test user
    if (testUserId) {
      const User = require('../models/User');
      await User.destroy({ where: { id: testUserId } });
    }
    await sequelize.close();
  });

  test('Property 9: Mux Functionality Preservation - All existing Mux fields remain accessible', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate test data for existing Mux fields with safer constraints
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 50 }),
          description: fc.option(fc.string({ maxLength: 200 })),
          price: fc.float({ min: 0, max: 1000 }),
          thumbnailUrl: fc.option(fc.webUrl()),
          startTime: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          endTime: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
          privacy: fc.constantFrom('public', 'private'),
          status: fc.constantFrom('scheduled', 'live', 'ended', 'recorded'),
          // Existing Mux fields that must remain functional
          mux_stream_id: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          mux_stream_key: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          mux_rtmp_url: fc.option(fc.webUrl()),
          mux_playback_id: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
          recording_asset_id: fc.option(fc.string({ minLength: 1, maxLength: 50 }))
        }),
        async (liveClassData) => {
          // Test that we can create a live class with Mux fields
          const createdClass = await LiveClass.create({
            userId: testUserId,
            ...liveClassData,
            streaming_provider: 'mux' // Explicitly set to Mux
          });

          // Verify all Mux fields are preserved and accessible
          expect(createdClass.mux_stream_id).toBe(liveClassData.mux_stream_id);
          expect(createdClass.mux_stream_key).toBe(liveClassData.mux_stream_key);
          expect(createdClass.mux_rtmp_url).toBe(liveClassData.mux_rtmp_url);
          expect(createdClass.mux_playback_id).toBe(liveClassData.mux_playback_id);
          expect(createdClass.recording_asset_id).toBe(liveClassData.recording_asset_id);

          // Verify streaming provider is correctly set
          expect(createdClass.streaming_provider).toBe('mux');

          // Verify we can retrieve and update the record
          const retrievedClass = await LiveClass.findByPk(createdClass.id);
          expect(retrievedClass).not.toBeNull();
          expect(retrievedClass.mux_stream_id).toBe(liveClassData.mux_stream_id);

          // Test updating Mux fields still works
          const newStreamId = 'updated_stream_id_' + Date.now();
          await retrievedClass.update({ mux_stream_id: newStreamId });
          
          const updatedClass = await LiveClass.findByPk(createdClass.id);
          expect(updatedClass.mux_stream_id).toBe(newStreamId);

          // Clean up
          await createdClass.destroy();
        }
      ),
      { numRuns: 100 } // Run 100 iterations as specified in design
    );
  });

  test('Property 9: ZegoCloud fields are optional and do not interfere with Mux', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          title: fc.string({ minLength: 1, maxLength: 100 }),
          price: fc.float({ min: 0, max: 1000 }),
          mux_stream_id: fc.string({ minLength: 1 }),
          mux_playback_id: fc.string({ minLength: 1 })
        }),
        async (muxData) => {
          // Create a Mux-only live class (no ZegoCloud fields)
          const muxClass = await LiveClass.create({
            userId: testUserId,
            ...muxData,
            streaming_provider: 'mux',
            // Explicitly leave ZegoCloud fields null
            zego_room_id: null,
            zego_app_id: null,
            zego_room_token: null,
            max_participants: null
          });

          // Verify Mux functionality works without ZegoCloud fields
          expect(muxClass.streaming_provider).toBe('mux');
          expect(muxClass.mux_stream_id).toBe(muxData.mux_stream_id);
          expect(muxClass.mux_playback_id).toBe(muxData.mux_playback_id);
          
          // Verify ZegoCloud fields are null and don't interfere
          expect(muxClass.zego_room_id).toBeNull();
          expect(muxClass.zego_app_id).toBeNull();
          expect(muxClass.zego_room_token).toBeNull();
          expect(muxClass.max_participants).toBeNull();

          // Verify we can query by streaming provider
          const muxClasses = await LiveClass.findAll({
            where: { streaming_provider: 'mux' }
          });
          
          expect(muxClasses.length).toBeGreaterThan(0);
          expect(muxClasses.some(c => c.id === muxClass.id)).toBe(true);

          // Clean up
          await muxClass.destroy();
        }
      ),
      { numRuns: 100 }
    );
  });

  test('Property 9: Database schema preserves all existing relationships', async () => {
    // Test that existing model relationships still work after migration
    const testClass = await LiveClass.create({
      userId: testUserId,
      title: 'Test Relationship Class',
      price: 0,
      streaming_provider: 'mux',
      mux_stream_id: 'test_stream_123'
    });

    // Verify the live class can be found and has correct structure
    const foundClass = await LiveClass.findByPk(testClass.id);
    expect(foundClass).not.toBeNull();
    expect(foundClass.title).toBe('Test Relationship Class');
    expect(foundClass.streaming_provider).toBe('mux');

    // Verify all expected fields exist in the model
    const expectedMuxFields = [
      'mux_stream_id', 'mux_stream_key', 'mux_rtmp_url', 
      'mux_playback_id', 'recording_asset_id'
    ];
    
    const expectedZegoFields = [
      'zego_room_id', 'zego_app_id', 'streaming_provider',
      'zego_room_token', 'max_participants'
    ];

    expectedMuxFields.forEach(field => {
      expect(foundClass.dataValues.hasOwnProperty(field)).toBe(true);
    });

    expectedZegoFields.forEach(field => {
      expect(foundClass.dataValues.hasOwnProperty(field)).toBe(true);
    });

    // Clean up
    await testClass.destroy();
  });
});