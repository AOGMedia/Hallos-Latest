'use strict';
/**
 * Unit tests for the wallet fixes made as part of the tournament registration
 * race-condition fix: lockUserWallet requires an active transaction (it's a
 * transaction-scoped Postgres advisory lock — calling it without one is a
 * programming error, not a runtime edge case, so it should fail loudly).
 */

jest.mock('../config/db', () => {
  const { Sequelize } = require('sequelize');
  const instance = new Sequelize('sqlite::memory:', { logging: false });
  instance.query = jest.fn().mockResolvedValue([]);
  return instance;
});

const quizWalletService = require('../services/quizWalletService');

describe('QuizWalletService.lockUserWallet', () => {
  it('throws if called without a transaction', async () => {
    await expect(quizWalletService.lockUserWallet(1, null)).rejects.toThrow(/requires an active transaction/);
  });

  it('issues a pg_advisory_xact_lock scoped to the given transaction', async () => {
    const sequelize = require('../config/db');
    const fakeTransaction = { id: 'tx-1' };

    await quizWalletService.lockUserWallet(42, fakeTransaction);

    expect(sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      expect.objectContaining({
        replacements: { userId: 42 },
        transaction: fakeTransaction
      })
    );
  });
});
