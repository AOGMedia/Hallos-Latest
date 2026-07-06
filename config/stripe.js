const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("FATAL: STRIPE_SECRET_KEY is missing from .env");
}

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = {
  stripeClient,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET
};
