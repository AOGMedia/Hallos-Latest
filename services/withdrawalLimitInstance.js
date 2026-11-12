const WithdrawalLimitService = require('./withdrawalLimitService');

/**
 * The one withdrawal limit tracker for this process. The middleware that
 * enforces limits and the admin endpoints that read stats, set tiers or
 * suspend people must share it, or admin changes never take effect.
 *
 * State is in memory, so it resets when the server restarts.
 */
module.exports = new WithdrawalLimitService();
