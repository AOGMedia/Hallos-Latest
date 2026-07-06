const dotenv = require("dotenv");
dotenv.config();

// Startup environment guards
if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET env variable is required');
if (!process.env.JWT_SECRET_KEY) throw new Error('JWT_SECRET_KEY env variable is required');

const cors = require('cors');
const express = require('express');
const rateLimit = require('express-rate-limit');
const passport = require('passport');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const webhookRoutes = require('./routes/webhookRoutes');
const authRoutes = require('./routes/authRoutes');
const passwordResetRoutes = require('./routes/passwordResetRoutes');
const registrationRoutes = require('./routes/registrationRoutes');
const videoRoutes = require('./routes/videoRoutes');
const liveRoutes = require('./routes/liveRoutes');
const zegoCloudRoutes = require('./routes/zegoCloudRoutes');
const liveSeriesRoutes = require('./routes/liveSeries');
const userRoutes = require('./routes/userRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const walletRoutes = require('./routes/walletRoutes');
const adminRoutes = require('./routes/adminRoutes');
const courseRoutes = require('./routes/courseRoutes');
const profileRoutes = require('./routes/profileRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');
const ugcRoutes = require('./routes/ugcRoutes');
const referralRoutes = require('./routes/referralRoutes');
const sessionRecordingRoutes = require('./routes/sessionRecordingRoutes');
const quizRoutes = require('./routes/quizRoutes');
const freebieRoutes = require('./routes/freebieRoutes');
const couponRoutes = require('./routes/couponRoutes');
const adminCouponRoutes = require('./routes/adminCouponRoutes');
const communityRoutes = require('./routes/communityRoutes');
const adminCommunityRoutes = require('./routes/adminCommunityRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const rateLimiter = require('./middleware/rateLimiter');
const sequelize = require('./config/db');
const LiveClassCleanupService = require('./services/liveClassCleanupService');
const emailSchedulerService = require('./services/emailSchedulerService');
const websocketManager = require('./services/websocketManager');
const activeUserTracker = require('./services/activeUserTracker');
const leaderboardService = require('./services/leaderboardService');
const quizRateLimiter = require('./middleware/quizRateLimiter');
const suspiciousActivityService = require('./services/suspiciousActivityService');

require('./models/walletIndex');
require('./models/courseIndex');
require('./models/liveSeriesIndex');
require('./models/feedbackIndex');
require('./models/ugcIndex');
require('./models/referralIndex');
require('./models/quizIndex');
require('./models/freebieIndex');
require('./models/couponIndex');
require('./models/communityIndex');

const app = express();

// Trust the first proxy (AWS ALB/nginx) so req.ip returns the real client IP
app.set('trust proxy', 1);

const allowedOrigins = [
  'https://www.aahbibi.com',
  'https://aahbibi.com',
  'https://prod-api.aahbibi.com',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://localhost:3001',
  'https://aistudio.google.com',
  'https://www.hallos.net',
  'https://hallos.net',
  'https://www.quiz.hallos.net'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS blocked: " + origin), false);
  },
  credentials: true,
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// Use the library's own ipKeyGenerator for proper IPv4/IPv6 handling
const { ipKeyGenerator } = require('express-rate-limit');

// Global rate limit - per real IP
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || '127.0.0.1';
    return ipKeyGenerator(ip);
  }
});
app.use(globalRateLimit);

// Auth endpoints - per real IP
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || '127.0.0.1';
    return ipKeyGenerator(ip);
  }
});

// Financial endpoints - per real IP
const financialRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many financial requests, please try again later.' },
  keyGenerator: (req) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || '127.0.0.1';
    return ipKeyGenerator(ip);
  }
});

app.use(
  "/api/webhooks", webhookRoutes   
);

app.use(cookieParser());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));


app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false, // don't create sessions for unauthenticated visitors
}));

app.use(passport.initialize());
app.use(passport.session()); 
 
app.use('/auth', authRateLimiter, authRoutes);
app.use('/auth', authRateLimiter, passwordResetRoutes); //  Password reset routes
app.use('/register', rateLimiter);
app.use('/event', registrationRoutes);
app.use('/live', liveRoutes);
app.use('/api/live/zegocloud', zegoCloudRoutes);
app.use('/api/live/series', liveSeriesRoutes);
app.use('/api/users', userRoutes);
app.use('/api/payments', financialRateLimiter, paymentRoutes);
app.use('/api/wallet', financialRateLimiter, walletRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/ugc', ugcRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/admin/live-series', sessionRecordingRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/freebies', freebieRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/admin/coupons', adminCouponRoutes);
app.use('/api/communities', communityRoutes);
app.use('/api/admin/communities', adminCommunityRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/uploads', express.static('uploads'));

app.use('/videos', videoRoutes);

// Global error handler - catches any unhandled errors from routes/middleware
// Must be defined after all routes
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err.stack || err.message || err);
  
  // Don't leak internal error details in production
  const isDev = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : 'An unexpected error occurred',
    ...(isDev && { stack: err.stack })
  });
});

const PORT = process.env.PORT || 8080; 
    
sequelize.sync({ force: false })
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      
      // Initialize WebSocket Manager
      websocketManager.initialize(server);
      
      // Initialize Active User Tracker
      activeUserTracker.initialize(websocketManager).catch(err => {
        console.error('❌ Failed to initialize Active User Tracker:', err.message);
      });
      
      // Initialize Leaderboard Service with Redis caching
      leaderboardService.initialize().catch(err => {
        console.error('❌ Failed to initialize Leaderboard Service:', err.message);
      });
      
      // Initialize Quiz Rate Limiter
      quizRateLimiter.initialize().catch(err => {
        console.error('❌ Failed to initialize Quiz Rate Limiter:', err.message);
      });
      
      // Initialize Suspicious Activity Service
      suspiciousActivityService.initialize().catch(err => {
        console.error('❌ Failed to initialize Suspicious Activity Service:', err.message);
      });
      
      setupLiveClassCleanup();
      setupEmailScheduler();
      setupQuizScheduledTasks();
    });
  })
  .catch(err => console.error('DB Connection Failed:', err));

/**
 * Setup email notification scheduler
 */
function setupEmailScheduler() {
  console.log('📧 Starting email notification scheduler...');
  emailSchedulerService.startAll();
  
  const status = emailSchedulerService.getStatus();
  console.log(`✅ Email scheduler started:`, status);
}

/**     
 * Setup automated live class cleanup cron jobs
 */
function setupLiveClassCleanup() {
  const cleanupService = new LiveClassCleanupService();
  
  // 🕐 Every hour: Auto-end stale live classes AND sessions
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('🧹 [Cron] Running hourly live class cleanup...');
      
      // Clean up one-time classes
      const classResult = await cleanupService.autoEndStaleLiveClasses();
      if (classResult.endedCount > 0) {
        console.log(`✅ [Cron] Auto-ended ${classResult.endedCount} stale live classes`);
      }
      
      // Clean up series sessions
      const sessionResult = await cleanupService.autoEndStaleSessions();
      if (sessionResult.endedCount > 0) {
        console.log(`✅ [Cron] Auto-ended ${sessionResult.endedCount} stale live sessions`);
      }
      
      if (classResult.errors.length > 0 || sessionResult.errors.length > 0) {
        console.error(`⚠️ [Cron] ${classResult.errors.length + sessionResult.errors.length} cleanup errors occurred`);
      }
    } catch (error) {
      console.error('❌ [Cron] Hourly cleanup failed:', error.message);
    }
  });
  
  // 🗓️ Every Sunday at 2 AM: Archive old ended classes
  cron.schedule('0 2 * * 0', async () => {
    try {
      console.log('🗄️ [Cron] Running weekly archive cleanup...');
      const result = await cleanupService.archiveOldEndedClasses();
      
      if (result.archivedCount > 0) {
        console.log(`📦 [Cron] Archived ${result.archivedCount} old classes`);
      }
    } catch (error) {
      console.error('❌ [Cron] Weekly archive failed:', error.message);
    }
  });
  
  console.log('⏰ Live class cleanup cron jobs scheduled:');
  console.log('   - Hourly: Auto-end stale live classes and sessions');
  console.log('   - Weekly: Archive old ended classes');
}

/**
 * Setup quiz platform scheduled tasks
 */
function setupQuizScheduledTasks() {
  const QuizMatch = require('./models/QuizMatch');
  const leaderboardService = require('./services/leaderboardService');
  
  console.log('🎮 Starting quiz platform scheduled tasks...');
  
  // 🕐 Every 5 minutes: Refresh leaderboard cache
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('🔄 [Cron] Refreshing leaderboard cache...');
      await leaderboardService.invalidateCache('all');
      console.log('✅ [Cron] Leaderboard cache refreshed');
    } catch (error) {
      console.error('❌ [Cron] Leaderboard cache refresh failed:', error.message);
    }
  });
  
  // 🕐 Every minute: Expire old challenges (60s timeout)
  cron.schedule('* * * * *', async () => {
    try {
      console.log('🧹 [Cron] Expiring old challenges...');
      
      const lobbyService = require('./services/lobbyService');
      const expiredChallenges = await QuizMatch.findAll({
        where: {
          status: 'pending',
          expiresAt: {
            [require('sequelize').Op.lt]: new Date()
          }
        }
      });
      
      let expiredCount = 0;
      for (const challenge of expiredChallenges) {
        try {
          await lobbyService.expireChallenge(challenge.id);
          expiredCount++;
        } catch (error) {
          console.error(`❌ [Cron] Failed to expire challenge ${challenge.id}:`, error.message);
        }
      }
      
      if (expiredCount > 0) {
        console.log(`✅ [Cron] Expired ${expiredCount} old challenges`);
      }
    } catch (error) {
      console.error('❌ [Cron] Challenge expiration failed:', error.message);
    }
  });
  
  console.log('⏰ Quiz platform scheduled tasks configured:');
  console.log('   - Every 5 minutes: Refresh leaderboard cache');
  console.log('   - Hourly: Expire old challenges (24h+)');
}
  