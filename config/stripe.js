const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("FATAL: STRIPE_SECRET_KEY is missing from .env");
}

const liveClient = new Stripe(process.env.STRIPE_SECRET_KEY);
let testClient = null;
const getTestClient = () => {
  if (!testClient && process.env.STRIPE_TEST_SECRET_KEY) testClient = new Stripe(process.env.STRIPE_TEST_SECRET_KEY);
  return testClient;
};

/**
 * The live Stripe client, or the test one inside a buyer checkout, webhook or
 * refund that runs in test mode (see services/gatewayModeService.js).
 * Everywhere else — payouts, withdrawals, admin — it is the live client, as before.
 */
const stripeClient = new Proxy(liveClient, {
  get(target, property) {
    const { modeFor, secretKeyFor } = require('../services/gatewayModeService');
    let client = target;
    if (modeFor('stripe') === 'test') {
      secretKeyFor('stripe'); // throws a clear error if test keys aren't set up
      client = getTestClient();
    }
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

module.exports = {
  stripeClient,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET
};
