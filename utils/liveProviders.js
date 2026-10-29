const { isGetStreamSchemaReady, isGetStreamSeriesSchemaReady } = require('./ensureGetStreamSupport');
const { getStreamService } = require('../services/getStreamService');

const SERIES_PROVIDERS = ['zegocloud', 'getstream'];

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

const isGetStreamSeriesAvailable = () => getStreamService.isConfigured() && isGetStreamSeriesSchemaReady();

const availableSeriesProviders = () => ({
  zegocloud: true,
  getstream: isGetStreamSeriesAvailable()
});

/** The provider a series uses ('zegocloud' for every series created before the choice existed). */
const seriesProviderOf = (series) => (series && series.streamingProvider) || 'zegocloud';

/**
 * Validates a requested series provider.
 * @returns {{ provider?: string, error?: string }}
 */
const resolveSeriesProvider = (requested) => {
  const provider = requested || 'zegocloud';
  if (!SERIES_PROVIDERS.includes(provider)) {
    return { error: "Invalid streaming provider. Must be 'zegocloud' or 'getstream'" };
  }
  if (provider === 'getstream' && !isGetStreamSeriesAvailable()) {
    return { error: 'GetStream live series are not available yet. Please choose Stream In-App.' };
  }
  return { provider };
};

module.exports = {
  isGetStreamAvailable,
  availableLiveProviders,
  availableSeriesProviders,
  seriesProviderOf,
  resolveSeriesProvider
};
