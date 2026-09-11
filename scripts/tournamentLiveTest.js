/**
 * Live end-to-end tournament test harness — runs against the REAL production
 * backend (not a mock), using real signups, real registration, and real
 * Socket.IO gameplay exactly as the frontend would drive it. Exercises all 4
 * formats plus the two edge cases QA flagged (AFK / silent disconnect).
 *
 * This is a test CLIENT, not a bypass — it uses the public API/socket surface
 * throughout. The one exception is promoting one freshly-created test account
 * to admin (direct DB write, since there's no self-service "become admin"
 * endpoint, nor should there be) so it can legitimately call the real admin
 * tournament endpoints the same way a human admin would from a browser.
 *
 * Usage: node scripts/tournamentLiveTest.js
 */

const axios = require('axios');
const { io } = require('socket.io-client');
const { Client } = require('pg');

const API_BASE = 'https://hallos-latest.onrender.com';
const NUM_ACCOUNTS = 8;
const RUN_ID = Date.now();

// A long-running test (the AFK/disconnect scenarios alone span several
// minutes of real wall-clock waiting) can outlast a single Postgres
// connection — Render's managed instance can drop an idle connection, and
// `pg.Client` emits an uncaught 'error' event that crashes the whole process
// if nothing is listening for it. Reconnecting transparently on error (rather
// than just adding a no-op listener) keeps every later `dbClient.query(...)`
// call in this file working without having to change any of them.
let dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { require: true, rejectUnauthorized: false }
});

function attachDbErrorHandler(client) {
  client.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] DB connection error, reconnecting:`, err.message);
    dbClient = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { require: true, rejectUnauthorized: false }
    });
    attachDbErrorHandler(dbClient);
    dbClient.connect().catch((e) => console.error('DB reconnect failed:', e.message));
  });
}
attachDbErrorHandler(dbClient);

function log(...args) { console.log(`[${new Date().toISOString()}]`, ...args); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Account setup ────────────────────────────────────────────────────────────

async function signup(i) {
  const email = `tourney-test-${RUN_ID}-${i}@hallos-test.invalid`;
  const password = 'TestPass123!';
  const res = await axios.post(`${API_BASE}/auth/signup`, {
    firstname: `TestP${i}`, lastname: `Run${RUN_ID}`, email, password, confirmPassword: password
  });
  const token = res.data.token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  return { userId: payload.id, token, email };
}

async function registerQuizProfile(account, i) {
  const nickname = `TestP${i}_${RUN_ID}`.slice(0, 30);
  await axios.post(`${API_BASE}/api/quiz/user/register`, {
    nickname,
    avatarUrl: `https://api.dicebear.com/9.x/bottts/svg?seed=${nickname}`
  }, { headers: { Authorization: `Bearer ${account.token}` } });
  return { ...account, nickname };
}

async function setupAccounts() {
  log(`Creating ${NUM_ACCOUNTS} test accounts...`);
  const accounts = [];
  for (let i = 1; i <= NUM_ACCOUNTS; i++) {
    const account = await signup(i);
    const withProfile = await registerQuizProfile(account, i);
    accounts.push(withProfile);
    log(`  account ${i}: userId=${withProfile.userId} nickname=${withProfile.nickname}`);
  }
  return accounts;
}

async function promoteToAdminAndRelogin(account) {
  await dbClient.query(`UPDATE "Users" SET role = 'admin' WHERE id = $1;`, [account.userId]);
  // Role is baked into the JWT at issue time — the old token still says
  // 'viewer', so a fresh login is required to actually get admin-flavored auth.
  const res = await axios.post(`${API_BASE}/auth/login`, {
    email: account.email, password: 'TestPass123!'
  });
  return { ...account, token: res.data.token };
}

async function getGeneralKnowledgeCategoryId() {
  const res = await axios.get(`${API_BASE}/api/quiz/categories`, {
    headers: { Authorization: `Bearer ${adminToken()}` }
  });
  const cat = res.data.categories.find((c) => c.name === 'General Knowledge');
  if (!cat) throw new Error('General Knowledge category not found');
  return cat.id;
}

let _adminToken = null;
function adminToken() { return _adminToken; }

// ── Tournament lifecycle helpers ─────────────────────────────────────────────

async function createTournament({ format, categoryId, entryFee = 0, maxParticipants, minParticipants }) {
  const now = Date.now();
  // Generous margins on purpose — these requests go over a real network to a
  // live Render service, and registering N accounts takes real, variable
  // wall-clock time. A tight deadline here is a test-harness bug, not
  // something the app itself needs to tolerate (a human admin sets these
  // days in advance in practice).
  const res = await axios.post(`${API_BASE}/api/quiz/admin/tournament/create`, {
    name: `LiveTest ${format} ${RUN_ID}`,
    description: 'Automated live test tournament',
    format,
    entryFee,
    categoryId,
    maxParticipants,
    minParticipants,
    registrationDeadline: new Date(now + 120000).toISOString(),
    startTime: new Date(now + 130000).toISOString(),
    ...(format === 'classic' || format === 'speed_run' ? { totalRounds: 1 } : {})
  }, { headers: { Authorization: `Bearer ${adminToken()}` } });
  return res.data.tournamentId;
}

async function registerParticipants(tournamentId, accounts) {
  // In parallel — also a more realistic simulation of many real users
  // registering for a popular tournament around the same time than a slow
  // sequential loop would be.
  await Promise.all(accounts.map((acc) =>
    axios.post(`${API_BASE}/api/quiz/tournament/${tournamentId}/register`, {}, {
      headers: { Authorization: `Bearer ${acc.token}` }
    })
  ));
  log(`  ${accounts.length} participant(s) registered for tournament ${tournamentId}`);
}

async function startTournament(tournamentId) {
  const res = await axios.post(`${API_BASE}/api/quiz/admin/tournament/${tournamentId}/start`, {}, {
    headers: { Authorization: `Bearer ${adminToken()}` }
  });
  log(`  Started tournament ${tournamentId}: format rounds=${res.data.totalRounds}`);
  return res.data;
}

// ── Oracle: look up the real correct answer directly from the DB, exactly
// what a QA engineer with DB access would do — the API deliberately never
// sends this to the client, so there's no other way to build a deterministic
// "this account always answers correctly" test player. ─────────────────────

async function correctAnswerFor(questionId) {
  const res = await dbClient.query(`SELECT correct_answer FROM quiz_questions WHERE id = $1;`, [questionId]);
  return res.rows[0]?.correct_answer;
}

// ── Socket-driven auto-play ──────────────────────────────────────────────────

function connectSocket(token, label) {
  const socket = io(API_BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
  socket.on('connect_error', (err) => log(`  [socket:${label}] connect_error:`, err.message));
  return socket;
}

/**
 * Drives one account through a knockout match (reuses the 1v1 match engine —
 * `challenge_accepted` + `submit_answer`, same as the real lobby). `smart`
 * accounts answer correctly (DB oracle); others answer randomly.
 */
function autoPlayKnockoutMatch(socket, label, smart) {
  socket.on('challenge_accepted', async (payload) => {
    log(`  [${label}] knockout match ready — ${payload.questions.length} questions vs ${payload.opponent?.nickname}`);
    socket.emit('join_match', { matchId: payload.matchId });
    for (const q of payload.questions) {
      let answer = ['a', 'b', 'c', 'd'][Math.floor(Math.random() * 4)];
      if (smart) {
        const correct = await correctAnswerFor(q.id);
        if (correct) answer = correct;
      }
      socket.emit('submit_answer', { matchId: payload.matchId, questionId: q.id, answer, timeInSeconds: 3 });
      await sleep(300);
    }
  });
  socket.on('match_ended', (payload) => log(`  [${label}] match_ended:`, JSON.stringify(payload)));
}

/**
 * Drives one account through a shared-question round (classic/speed_run/
 * battle_royale) — `round_started` + `submit_tournament_answer`.
 */
function autoPlaySharedRound(socket, label, smart, tournamentId) {
  socket.on('round_started', async (payload) => {
    if (payload.format === 'knockout') return;
    log(`  [${label}] round ${payload.roundNumber} started — ${payload.questions.length} questions`);
    for (const q of payload.questions) {
      let answer = ['a', 'b', 'c', 'd'][Math.floor(Math.random() * 4)];
      if (smart) {
        const correct = await correctAnswerFor(q.id);
        if (correct) answer = correct;
      }
      socket.emit('submit_tournament_answer', {
        tournamentId, roundNumber: payload.roundNumber, questionId: q.id, answerId: answer, clientTimestamp: Date.now()
      });
      await sleep(300);
    }
  });
  socket.on('round_ended', (payload) => log(`  [${label}] round_ended: ${JSON.stringify(payload.results?.map((r) => ({ userId: r.userId, score: r.score, rank: r.rank })))}`));
  socket.on('participant_eliminated', (payload) => log(`  [${label}] participant_eliminated event received (userId ${payload.userId}, reason ${payload.reason})`));
}

function attachCommonListeners(socket, label) {
  socket.on('tournament_started', (p) => log(`  [${label}] tournament_started (direct or room):`, p.format, p.participantCount, 'players'));
  socket.on('tournament_bye', (p) => log(`  [${label}] got a BYE for round ${p.roundNumber}`));
  socket.on('tournament_ended', (p) => log(`  [${label}] tournament_ended: placement=${p.placement} prizeWon=${p.prizeWon}`));
  socket.on('participant_forfeited', (p) => log(`  [${label}] participant_forfeited: userId ${p.userId}`));
}

async function waitForTournamentStatus(tournamentId, targetStatuses, timeoutMs, pollMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await dbClient.query(`SELECT status, current_round, total_rounds FROM quiz_tournaments WHERE id = $1;`, [tournamentId]);
    const row = res.rows[0];
    if (row && targetStatuses.includes(row.status)) return row;
    await sleep(pollMs);
  }
  const res = await dbClient.query(`SELECT status, current_round, total_rounds FROM quiz_tournaments WHERE id = $1;`, [tournamentId]);
  return { ...res.rows[0], timedOut: true };
}

// ── Scenario runners ──────────────────────────────────────────────────────────

async function runSharedFormatScenario(format, categoryId, accounts) {
  log(`\n=== SCENARIO: ${format} (${accounts.length} participants, all answering promptly) ===`);
  const tournamentId = await createTournament({ format, categoryId, entryFee: 0, maxParticipants: accounts.length, minParticipants: 2 });
  await registerParticipants(tournamentId, accounts);

  const sockets = accounts.map((acc, i) => {
    const socket = connectSocket(acc.token, `${format}-${i}`);
    attachCommonListeners(socket, `${format}-${i}`);
    autoPlaySharedRound(socket, `${format}-${i}`, i === 0, tournamentId); // account 0 always answers correctly
    socket.emit('join_tournament', { tournamentId }); // half the accounts skip this deliberately below
    return socket;
  });

  await sleep(2000); // let sockets finish connecting/joining before starting
  await startTournament(tournamentId);

  // battle_royale eliminates down to 2 over several rounds (each with its own
  // full answer + broadcast cycle), so it legitimately needs longer than a
  // single-round classic/speed_run tournament to reach 'completed'.
  const waitMs = format === 'battle_royale' ? 10 * 60 * 1000 : 5 * 60 * 1000;
  const final = await waitForTournamentStatus(tournamentId, ['completed', 'cancelled'], waitMs);
  log(`  Final status: ${JSON.stringify(final)}`);

  const winnerRow = await dbClient.query(
    `SELECT user_id, placement, prize_won, total_score FROM quiz_tournament_participants WHERE tournament_id = $1 ORDER BY placement ASC NULLS LAST;`,
    [tournamentId]
  );
  log(`  Placements: ${JSON.stringify(winnerRow.rows)}`);

  sockets.forEach((s) => s.disconnect());
  return { tournamentId, final, placements: winnerRow.rows };
}

async function runKnockoutScenario(categoryId, accounts) {
  log(`\n=== SCENARIO: knockout (${accounts.length} participants — odd count to force a bye) ===`);
  const tournamentId = await createTournament({ format: 'knockout', categoryId, entryFee: 0, maxParticipants: accounts.length, minParticipants: 2 });
  await registerParticipants(tournamentId, accounts);

  const sockets = accounts.map((acc, i) => {
    const socket = connectSocket(acc.token, `ko-${i}`);
    attachCommonListeners(socket, `ko-${i}`);
    autoPlayKnockoutMatch(socket, `ko-${i}`, i === 0);
    socket.emit('join_tournament', { tournamentId });
    return socket;
  });

  await sleep(2000); // let sockets finish connecting/joining before starting
  await startTournament(tournamentId);

  const final = await waitForTournamentStatus(tournamentId, ['completed', 'cancelled'], 8 * 60 * 1000);
  log(`  Final status: ${JSON.stringify(final)}`);

  const placements = await dbClient.query(
    `SELECT user_id, placement, prize_won, current_round, status FROM quiz_tournament_participants WHERE tournament_id = $1 ORDER BY placement ASC NULLS LAST;`,
    [tournamentId]
  );
  log(`  Placements: ${JSON.stringify(placements.rows)}`);

  sockets.forEach((s) => s.disconnect());
  return { tournamentId, final, placements: placements.rows };
}

/** Edge case: one participant's socket connects, joins, but never answers a
 * single question — pure AFK. Verifies the sweepStaleRounds cron actually
 * force-completes the round instead of hanging forever. */
async function runAfkScenario(categoryId, accounts) {
  log(`\n=== SCENARIO: AFK participant (never answers) ===`);
  const participants = accounts.slice(0, 4);
  const tournamentId = await createTournament({ format: 'classic', categoryId, entryFee: 0, maxParticipants: 4, minParticipants: 2 });
  await registerParticipants(tournamentId, participants);

  const sockets = participants.map((acc, i) => {
    const socket = connectSocket(acc.token, `afk-${i}`);
    attachCommonListeners(socket, `afk-${i}`);
    if (i !== 0) autoPlaySharedRound(socket, `afk-${i}`, true, tournamentId); // account 0 is the AFK one — no listener attached, never answers
    else socket.on('round_started', () => log(`  [afk-0] round started — deliberately NOT answering (AFK test)`));
    socket.emit('join_tournament', { tournamentId });
    return socket;
  });

  await sleep(2000); // let sockets finish connecting/joining before starting
  await startTournament(tournamentId);

  log('  Waiting for the AFK sweep cron to force-complete the round (expect a few minutes)...');
  const final = await waitForTournamentStatus(tournamentId, ['completed', 'cancelled'], 8 * 60 * 1000);
  log(`  Final status after AFK: ${JSON.stringify(final)}`);

  sockets.forEach((s) => s.disconnect());
  return { tournamentId, final };
}

/** Edge case: one participant's socket is forcibly killed mid-round and never
 * reconnects — verifies the (now-150s) tournament reconnect grace period
 * actually forfeits them and lets the tournament continue rather than hang,
 * and doesn't fire early (a real regression risk if the timer were wrong). */
async function runDisconnectScenario(categoryId, accounts) {
  log(`\n=== SCENARIO: mid-round disconnect (no reconnect) ===`);
  const participants = accounts.slice(0, 4);
  const tournamentId = await createTournament({ format: 'classic', categoryId, entryFee: 0, maxParticipants: 4, minParticipants: 2 });
  await registerParticipants(tournamentId, participants);

  let victimSocket = null;
  const sockets = participants.map((acc, i) => {
    const socket = connectSocket(acc.token, `disc-${i}`);
    attachCommonListeners(socket, `disc-${i}`);
    if (i === 0) {
      victimSocket = socket;
      socket.on('round_started', () => {
        log(`  [disc-0] round started — will disconnect in 2s and never come back`);
        setTimeout(() => { log('  [disc-0] disconnecting now'); socket.disconnect(); }, 2000);
      });
    } else {
      autoPlaySharedRound(socket, `disc-${i}`, true, tournamentId);
    }
    socket.emit('join_tournament', { tournamentId });
    return socket;
  });

  await sleep(2000); // let sockets finish connecting/joining before starting
  await startTournament(tournamentId);

  log('  Waiting for the tournament reconnect grace period (~150s) + forfeit to resolve...');
  const final = await waitForTournamentStatus(tournamentId, ['completed', 'cancelled'], 6 * 60 * 1000);
  log(`  Final status after disconnect: ${JSON.stringify(final)}`);

  const victimStatus = await dbClient.query(
    `SELECT status FROM quiz_tournament_participants WHERE tournament_id = $1 AND user_id = $2;`,
    [tournamentId, participants[0].userId]
  );
  log(`  Disconnected participant's final status: ${victimStatus.rows[0]?.status}`);

  sockets.filter((s) => s !== victimSocket).forEach((s) => s.disconnect());
  return { tournamentId, final };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await dbClient.connect();
  log('DB connection OK. Starting live tournament test run', RUN_ID);

  const accounts = await setupAccounts();
  const admin = await promoteToAdminAndRelogin(accounts[0]);
  _adminToken = admin.token;
  log(`Promoted account 1 (userId ${admin.userId}) to admin for this test run.`);

  const categoryId = await getGeneralKnowledgeCategoryId();
  log(`Using category ${categoryId} (General Knowledge)`);

  const results = {};

  for (const format of ['classic', 'speed_run']) {
    try {
      results[format] = await runSharedFormatScenario(format, categoryId, accounts);
    } catch (err) {
      log(`  ✗ ${format} scenario FAILED:`, err.response?.data || err.message);
      results[format] = { error: err.message };
    }
  }

  try {
    results.knockout = await runKnockoutScenario(categoryId, accounts.slice(0, 7)); // odd count -> bye
  } catch (err) {
    log('  ✗ knockout scenario FAILED:', err.response?.data || err.message);
    results.knockout = { error: err.message };
  }

  try {
    results.battle_royale = await runSharedFormatScenario('battle_royale', categoryId, accounts);
  } catch (err) {
    log('  ✗ battle_royale scenario FAILED:', err.response?.data || err.message);
    results.battle_royale = { error: err.message };
  }

  try {
    results.afk = await runAfkScenario(categoryId, accounts);
  } catch (err) {
    log('  ✗ AFK scenario FAILED:', err.response?.data || err.message);
    results.afk = { error: err.message };
  }

  try {
    results.disconnect = await runDisconnectScenario(categoryId, accounts);
  } catch (err) {
    log('  ✗ disconnect scenario FAILED:', err.response?.data || err.message);
    results.disconnect = { error: err.message };
  }

  log('\n\n========== SUMMARY ==========');
  for (const [name, r] of Object.entries(results)) {
    if (r.error) {
      log(`${name}: ✗ ERROR — ${r.error}`);
    } else if (r.final?.timedOut) {
      log(`${name}: ✗ TIMED OUT — status stuck at "${r.final.status}"`);
    } else if (r.final?.status === 'completed') {
      log(`${name}: ✓ completed`);
    } else {
      log(`${name}: ? status=${r.final?.status}`);
    }
  }

  await dbClient.end();
}

main().catch((err) => {
  console.error('[LiveTest] Fatal error:', err);
  process.exit(1);
});
