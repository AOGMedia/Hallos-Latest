const FraudDetectionService = require('./fraudDetectionService');

/**
 * The one fraud detector for this process. The middleware that screens money
 * movements and the admin endpoints that read stats or unblock people must
 * share it; separate instances meant admins saw an empty detector and their
 * unblocks never reached the one doing the blocking.
 *
 * State is in memory, so it resets when the server restarts.
 */
module.exports = new FraudDetectionService();
