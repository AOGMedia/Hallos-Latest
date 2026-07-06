const crypto = require('crypto');
const { Op } = require('sequelize');
const sequelize = require('../config/db');
const CampaignQuizSession = require('../models/CampaignQuizSession');
const CampaignQuizAnswer = require('../models/CampaignQuizAnswer');
const QuizQuestion = require('../models/QuizQuestion');

const QUESTIONS_PER_SESSION = 20;
const SECONDS_PER_QUESTION = 15;
const MS_PER_QUESTION = SECONDS_PER_QUESTION * 1000;
const NETWORK_BUFFER_MS = 2000; // grace period for network latency
const TOKEN_EXPIRY_HOURS = 72;

/**
 * Generate a secure 64-character hex access token
 */
function generateAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Fisher-Yates shuffle — returns a new shuffled copy
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle the option keys (a/b/c/d/e) for a single question.
 * Returns { shuffledOptions, correctAnswer } where correctAnswer is
 * the NEW key (after shuffling) that holds the correct text.
 */
function shuffleOptions(originalOptions, originalCorrectAnswer) {
  const keys = Object.keys(originalOptions); // e.g. ['a','b','c','d','e']
  const shuffledKeys = shuffle(keys);

  const shuffledOptions = {};
  let newCorrectAnswer = null;

  shuffledKeys.forEach((originalKey, newIdx) => {
    const newKey = keys[newIdx]; // reassign to same set of labels a,b,c...
    shuffledOptions[newKey] = originalOptions[originalKey];
    if (originalKey === originalCorrectAnswer) {
      newCorrectAnswer = newKey;
    }
  });

  return { shuffledOptions, correctAnswer: newCorrectAnswer };
}

/**
 * Select 20 random questions from a category.
 * Pure random — no difficulty balancing needed for campaign (170 questions pool).
 */
async function selectRandomQuestions(categoryId) {
  const questions = await QuizQuestion.findAll({
    where: { categoryId, isActive: true },
    order: sequelize.random(),
    limit: QUESTIONS_PER_SESSION,
    attributes: ['id', 'questionText', 'options', 'correctAnswer', 'difficulty']
  });

  if (questions.length < QUESTIONS_PER_SESSION) {
    throw new Error(
      `Not enough active questions in this category. Need ${QUESTIONS_PER_SESSION}, found ${questions.length}.`
    );
  }

  return questions;
}

/**
 * Create a quiz session immediately after payment is confirmed.
 * Called by webhook and verify controllers.
 *
 * @param {string} registrationId
 * @param {string} email
 * @returns {{ session: CampaignQuizSession, token: string }}
 */
async function createQuizSession(registrationId, email) {
  const categoryId = process.env.CAMPAIGN_QUIZ_CATEGORY_ID;
  if (!categoryId) {
    throw new Error('CAMPAIGN_QUIZ_CATEGORY_ID env variable is not set');
  }

  // Idempotent — if a session already exists for this registration, return it
  const existing = await CampaignQuizSession.findOne({ where: { registrationId } });
  if (existing) {
    return { session: existing, token: existing.accessToken };
  }

  const questions = await selectRandomQuestions(categoryId);

  // Build per-question shuffled data
  const questionIds = [];
  const sessionData = {};

  for (const q of questions) {
    const { shuffledOptions, correctAnswer } = shuffleOptions(q.options, q.correctAnswer);
    questionIds.push(q.id);
    sessionData[q.id] = { shuffledOptions, correctAnswer }; // correctAnswer never leaves server
  }

  const token = generateAccessToken();
  const tokenExpiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  const session = await CampaignQuizSession.create({
    registrationId,
    email: email.toLowerCase().trim(),
    accessToken: token,
    tokenExpiresAt,
    status: 'pending',
    categoryId,
    questions: questionIds,
    sessionData
  });

  return { session, token };
}

/**
 * Validate a token and return the session.
 * Throws descriptive errors for expired / not found / already completed.
 */
async function getValidSession(token) {
  const session = await CampaignQuizSession.findOne({ where: { accessToken: token } });

  if (!session) {
    const err = new Error('Quiz link is invalid or has already been used.');
    err.status = 404;
    throw err;
  }

  if (session.status === 'completed') {
    const err = new Error('You have already completed this quiz. Only one attempt is allowed.');
    err.status = 409;
    err.alreadyCompleted = true;
    throw err;
  }

  if (session.status === 'expired' || new Date() > new Date(session.tokenExpiresAt)) {
    if (session.status !== 'expired') {
      await session.update({ status: 'expired' });
    }
    const err = new Error('This quiz link has expired. Quiz links are valid for 72 hours.');
    err.status = 410;
    err.expired = true;
    throw err;
  }

  return session;
}

/**
 * Start a session — associate userId, mark active, record startedAt.
 * Returns the 20 questions with shuffled options and question text (NO correct answers).
 */
async function startSession(token, userId) {
  const session = await getValidSession(token);

  // If already active with a different user, someone is trying to share the link
  if (session.userId && session.userId !== userId) {
    const err = new Error('This quiz link has already been claimed by another account.');
    err.status = 403;
    throw err;
  }

  // Already active for this same user — return current state (browser refresh)
  if (session.status === 'active' && session.userId === userId) {
    return await buildSessionResponse(session);
  }

  await session.update({
    userId,
    status: 'active',
    startedAt: new Date()
  });

  return await buildSessionResponse(session);
}

/**
 * Build the response payload for start — fetches question text, strips correct answers.
 * Question text is fetched fresh from DB each time (not stored in session).
 */
async function buildSessionResponse(session) {
  // Fetch question texts in one query, maintaining order from session.questions
  const questionRows = await QuizQuestion.findAll({
    where: { id: session.questions },
    attributes: ['id', 'questionText']
  });

  const textMap = {};
  for (const q of questionRows) textMap[q.id] = q.questionText;

  const questionList = session.questions.map((questionId, index) => {
    const data = session.sessionData[questionId];
    return {
      questionIndex: index,
      questionId,
      questionText: textMap[questionId] || '',
      shuffledOptions: data.shuffledOptions
      // correctAnswer intentionally omitted
    };
  });

  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    status: session.status,
    secondsPerQuestion: SECONDS_PER_QUESTION,
    totalQuestions: QUESTIONS_PER_SESSION,
    maxDurationSeconds: QUESTIONS_PER_SESSION * SECONDS_PER_QUESTION,
    questions: questionList
  };
}

/**
 * Submit a single answer.
 * Validates timing window based on sessionStartedAt + questionIndex * 15s.
 *
 * @returns {{ answersSubmitted, totalQuestions, timedOut }}
 */
async function submitAnswer(token, userId, { questionId, questionIndex, selectedAnswer, clientTimestamp }) {
  const session = await CampaignQuizSession.findOne({ where: { accessToken: token } });

  if (!session || session.status !== 'active') {
    const err = new Error('No active quiz session found for this token.');
    err.status = 400;
    throw err;
  }

  if (session.userId !== userId) {
    const err = new Error('This quiz session belongs to a different account.');
    err.status = 403;
    throw err;
  }

  // Validate question belongs to this session
  if (!session.questions.includes(questionId) || session.questions[questionIndex] !== questionId) {
    const err = new Error('Invalid question for this session.');
    err.status = 400;
    throw err;
  }

  // Prevent duplicate answers for same question
  const existing = await CampaignQuizAnswer.findOne({
    where: { sessionId: session.id, questionIndex }
  });
  if (existing) {
    const err = new Error(`Question ${questionIndex + 1} has already been answered.`);
    err.status = 409;
    throw err;
  }

  // Validate answer value
  const validAnswers = ['a', 'b', 'c', 'd', 'e', 'timeout'];
  if (!validAnswers.includes(selectedAnswer)) {
    const err = new Error('Invalid answer. Must be a, b, c, d, e, or timeout.');
    err.status = 400;
    throw err;
  }

  const serverTimestamp = Date.now();
  const sessionStartMs = new Date(session.startedAt).getTime();

  // Each question N has a window: [startedAt + N*15s, startedAt + (N+1)*15s + 2s buffer]
  const windowStart = sessionStartMs + questionIndex * MS_PER_QUESTION;
  const windowEnd = windowStart + MS_PER_QUESTION + NETWORK_BUFFER_MS;

  let timedOut = false;
  let responseTimeMs;
  let finalAnswer = selectedAnswer;

  if (serverTimestamp > windowEnd) {
    timedOut = true;
    finalAnswer = 'timeout';
    responseTimeMs = MS_PER_QUESTION; // max
  } else {
    responseTimeMs = Math.min(Math.max(serverTimestamp - windowStart, 0), MS_PER_QUESTION);
  }

  const questionData = session.sessionData[questionId];
  const isCorrect = !timedOut && finalAnswer === questionData.correctAnswer;

  await CampaignQuizAnswer.create({
    sessionId: session.id,
    questionId,
    questionIndex,
    selectedAnswer: finalAnswer,
    isCorrect,
    responseTimeMs,
    clientTimestamp: clientTimestamp || null,
    serverTimestamp
  });

  const answersSubmitted = await CampaignQuizAnswer.count({ where: { sessionId: session.id } });

  return {
    answersSubmitted,
    totalQuestions: QUESTIONS_PER_SESSION,
    timedOut
  };
}

/**
 * Submit / close the quiz session.
 * Auto-fills timeout answers for any unanswered questions.
 * Calculates score and totalTimeMs.
 *
 * @returns {{ score, totalCorrect, totalQuestions, totalTimeMs }}
 */
async function submitQuiz(token, userId) {
  const session = await CampaignQuizSession.findOne({ where: { accessToken: token } });

  if (!session || session.status !== 'active') {
    const err = new Error('No active quiz session to submit.');
    err.status = 400;
    throw err;
  }

  if (session.userId !== userId) {
    const err = new Error('This quiz session belongs to a different account.');
    err.status = 403;
    throw err;
  }

  const serverTimestamp = Date.now();
  const completedAt = new Date(serverTimestamp);
  const sessionStartMs = new Date(session.startedAt).getTime();

  // Find which question indices have been answered
  const answered = await CampaignQuizAnswer.findAll({ where: { sessionId: session.id } });
  const answeredIndices = new Set(answered.map(a => a.questionIndex));

  // Auto-fill timeout for unanswered questions
  const timeoutInserts = [];
  for (let i = 0; i < QUESTIONS_PER_SESSION; i++) {
    if (!answeredIndices.has(i)) {
      const questionId = session.questions[i];
      timeoutInserts.push({
        sessionId: session.id,
        questionId,
        questionIndex: i,
        selectedAnswer: 'timeout',
        isCorrect: false,
        responseTimeMs: MS_PER_QUESTION,
        clientTimestamp: null,
        serverTimestamp
      });
    }
  }

  if (timeoutInserts.length > 0) {
    await CampaignQuizAnswer.bulkCreate(timeoutInserts);
  }

  // Calculate final score
  const allAnswers = await CampaignQuizAnswer.findAll({ where: { sessionId: session.id } });
  const totalCorrect = allAnswers.filter(a => a.isCorrect).length;
  const score = totalCorrect; // 1 point per correct answer, max 20
  const totalTimeMs = serverTimestamp - sessionStartMs;

  await session.update({ status: 'completed', score, totalCorrect, totalTimeMs, completedAt });

  return { score, totalCorrect, totalQuestions: QUESTIONS_PER_SESSION, totalTimeMs };
}

/**
 * Get the current session status (for refresh / resume detection on frontend).
 */
async function getSessionStatus(token, userId) {
  const session = await CampaignQuizSession.findOne({ where: { accessToken: token } });

  if (!session) {
    const err = new Error('Quiz link is invalid.');
    err.status = 404;
    throw err;
  }

  // Token expired but not yet marked
  if (session.status === 'pending' && new Date() > new Date(session.tokenExpiresAt)) {
    await session.update({ status: 'expired' });
    const err = new Error('This quiz link has expired.');
    err.status = 410;
    err.expired = true;
    throw err;
  }

  if (session.status === 'completed') {
    return {
      status: 'completed',
      score: session.score,
      totalCorrect: session.totalCorrect,
      totalQuestions: QUESTIONS_PER_SESSION,
      totalTimeMs: session.totalTimeMs,
      completedAt: session.completedAt
    };
  }

  if (session.status === 'active') {
    if (session.userId && session.userId !== userId) {
      const err = new Error('This quiz session belongs to a different account.');
      err.status = 403;
      throw err;
    }
    const answersSubmitted = await CampaignQuizAnswer.count({ where: { sessionId: session.id } });
    return {
      status: 'active',
      startedAt: session.startedAt,
      answersSubmitted,
      totalQuestions: QUESTIONS_PER_SESSION,
      secondsPerQuestion: SECONDS_PER_QUESTION
    };
  }

  return {
    status: session.status,
    tokenExpiresAt: session.tokenExpiresAt
  };
}

module.exports = {
  createQuizSession,
  getValidSession,
  startSession,
  submitAnswer,
  submitQuiz,
  getSessionStatus
};
