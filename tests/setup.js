// Test setup for ZegoCloud integration tests
require('dotenv').config();

// Increase timeout for database operations
jest.setTimeout(30000);

// Global test configuration
global.console = {
  ...console,
  // Suppress console.log during tests unless needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: console.warn,
  error: console.error,
};