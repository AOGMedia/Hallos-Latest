'use strict';
/**
 * Unit tests for TournamentService's pure logic — config validation and
 * final-placement ranking. These don't touch the database; the engine's
 * DB-heavy paths (registration atomicity, round execution, knockout
 * pairing) need real integration tests against a live Postgres instance
 * before go-live, which this suite intentionally doesn't attempt.
 */

// Must mock config/db before any model (and therefore tournamentService) is required.
jest.mock('../config/db', () => {
  const { Sequelize } = require('sequelize');
  const instance = new Sequelize('sqlite::memory:', { logging: false });
  instance.transaction = jest.fn(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  return instance;
});

jest.mock('../services/questionService', () => ({}));
jest.mock('../services/quizWalletService', () => ({}));

const tournamentService = require('../services/tournamentService');

describe('TournamentService._validateTournamentConfig', () => {
  const baseConfig = () => ({
    name: 'Friday Night Trivia',
    format: 'classic',
    entryFee: 50,
    categoryId: 'cat-1',
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    startTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });

  it('accepts a well-formed config and applies the default prize split', () => {
    const result = tournamentService._validateTournamentConfig(baseConfig());
    expect(result.prizeDistribution).toEqual({ first: 60, second: 30, third: 10 });
    expect(result.minParticipants).toBe(2);
  });

  it('rejects a missing required field', () => {
    const config = baseConfig();
    delete config.categoryId;
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/Missing required fields/);
  });

  it('rejects an invalid format', () => {
    const config = { ...baseConfig(), format: 'chaos_mode' };
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/Invalid format/);
  });

  it('rejects a negative entry fee', () => {
    const config = { ...baseConfig(), entryFee: -5 };
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/non-negative/);
  });

  it('rejects maxParticipants below minParticipants', () => {
    const config = { ...baseConfig(), minParticipants: 8, maxParticipants: 4 };
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/maxParticipants/);
  });

  it('rejects a registration deadline in the past', () => {
    const config = { ...baseConfig(), registrationDeadline: new Date(Date.now() - 1000).toISOString() };
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/future/);
  });

  it('rejects a start time before the registration deadline', () => {
    const config = baseConfig();
    config.startTime = config.registrationDeadline;
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/after registration deadline/);
  });

  it('rejects a prize distribution that does not sum to 100', () => {
    const config = { ...baseConfig(), prizeDistribution: { first: 50, second: 30, third: 10 } };
    expect(() => tournamentService._validateTournamentConfig(config)).toThrow(/sum to 100/);
  });
});

describe('TournamentService._rankParticipants', () => {
  it('ranks classic by score desc, then average time asc', () => {
    const participants = [
      { userId: 1, totalScore: 40, averageTime: 5, currentRound: 0 },
      { userId: 2, totalScore: 60, averageTime: 9, currentRound: 0 },
      { userId: 3, totalScore: 60, averageTime: 3, currentRound: 0 }
    ];
    const ranked = tournamentService._rankParticipants('classic', participants);
    expect(ranked.map(p => p.userId)).toEqual([3, 2, 1]); // 3 ties score with 2 but is faster
  });

  it('ranks knockout/battle_royale by how far they survived, then score', () => {
    const participants = [
      { userId: 1, currentRound: 2, totalScore: 10 }, // eliminated round 2
      { userId: 2, currentRound: 4, totalScore: 5 },  // winner (survived furthest)
      { userId: 3, currentRound: 3, totalScore: 20 }, // runner-up-ish, survived round 3
      { userId: 4, currentRound: 3, totalScore: 8 }   // also eliminated round 3, lower score
    ];
    const ranked = tournamentService._rankParticipants('knockout', participants);
    expect(ranked.map(p => p.userId)).toEqual([2, 3, 4, 1]);
  });

  it('speed_run ranks scored participants by time asc, unscored participants always last', () => {
    const participants = [
      { userId: 1, totalScore: 0, averageTime: 1 },   // scored nothing — shouldn't win on raw speed
      { userId: 2, totalScore: 30, averageTime: 8 },
      { userId: 3, totalScore: 10, averageTime: 4 }
    ];
    const ranked = tournamentService._rankParticipants('speed_run', participants);
    expect(ranked.map(p => p.userId)).toEqual([3, 2, 1]);
  });

  it('speed_run tie-breaks equal times by score', () => {
    const participants = [
      { userId: 1, totalScore: 20, averageTime: 5 },
      { userId: 2, totalScore: 35, averageTime: 5 }
    ];
    const ranked = tournamentService._rankParticipants('speed_run', participants);
    expect(ranked.map(p => p.userId)).toEqual([2, 1]);
  });

  it('handles participants with a null averageTime without crashing', () => {
    const participants = [
      { userId: 1, totalScore: 0, averageTime: null, currentRound: 0 },
      { userId: 2, totalScore: 15, averageTime: null, currentRound: 0 }
    ];
    expect(() => tournamentService._rankParticipants('classic', participants)).not.toThrow();
  });
});
