const { isGetStreamSchemaReady } = require('./ensureGetStreamSupport');
const { getStreamService } = require('../services/getStreamService');

/**
 * Which live class providers a new class can use right now. ZegoCloud is
 * always on; GetStream only once its keys are set and the schema is ready.
 * The frontend reads this (GET /live/create-capabilities) to decide what the
 * "Streaming Method" picker offers.
 */
const isGetStreamAvailable = () => getStreamService.isConfigured() && isGetStreamSchemaReady();

const availableLiveProviders = () => ({
  zegocloud: true,
  getstream: isGetStreamAvailable()
});

module.exports = { isGetStreamAvailable, availableLiveProviders };
