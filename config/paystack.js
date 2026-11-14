const axios = require('axios');

if (!process.env.PAYSTACK_SECRET_KEY) {
  console.error("FATAL: PAYSTACK_SECRET_KEY is missing from .env");
}

const paystackClient = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Live or test key per request (see services/gatewayModeService.js). Outside a
// buyer checkout, webhook or refund this is always the live key, as before.
paystackClient.interceptors.request.use((config) => {
  const key = require('../services/gatewayModeService').secretKeyFor('paystack');
  config.headers.Authorization = `Bearer ${key}`;
  return config;
});

module.exports = {
  paystackClient,
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
  PAYSTACK_WEBHOOK_SECRET: process.env.PAYSTACK_WEBHOOK_SECRET
};
