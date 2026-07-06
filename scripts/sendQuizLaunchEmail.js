/**
 * Quiz Launch Announcement Email Script
 *
 * Usage:
 *   Test (send to yourself only):
 *     node scripts/sendQuizLaunchEmail.js test your@email.com
 *
 *   Send to ALL users (800+):
 *     node scripts/sendQuizLaunchEmail.js all
 *
 * The script sends in batches of 10 with a 2-second delay between batches
 * to avoid overwhelming the mail server.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const { Sequelize } = require('sequelize');
const sequelize = require('../config/db');
const User = require('../models/User');

// ─── Transporter (same config as utils/email.js) ────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: { rejectUnauthorized: false }
});

// ─── Social Footer (copied from utils/email.js) ──────────────────────────────
const getSocialFooter = () => `
  <div style="background-color: #f8f9fa; padding: 25px; margin-top: 30px; border-radius: 8px; text-align: center;">
    <h3 style="color: #333; margin-top: 0;">Stay Connected With Us!</h3>
    <div style="margin: 20px 0;">
      <a href="https://www.linkedin.com/company/106357438/" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn" style="width: 32px; height: 32px;"/>
      </a>
      <a href="https://web.facebook.com/profile.php?id=61573028903471" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/facebook.png" alt="Facebook" style="width: 32px; height: 32px;"/>
      </a>
      <a href="https://www.instagram.com/learning247live/" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/instagram-new.png" alt="Instagram" style="width: 32px; height: 32px;"/>
      </a>
      <a href="https://www.tiktok.com/@learning247live?lang=en" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/tiktok.png" alt="TikTok" style="width: 32px; height: 32px;"/>
      </a>
      <a href="https://x.com/Learning247Live" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/twitter.png" alt="X (Twitter)" style="width: 32px; height: 32px;"/>
      </a>
      <a href="https://whatsapp.com/channel/0029VbAuQCzGpLHXVDV17t3u" style="margin: 0 10px; text-decoration: none;">
        <img src="https://img.icons8.com/color/48/000000/whatsapp.png" alt="WhatsApp Channel" style="width: 32px; height: 32px;"/>
      </a>
    </div>
    <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; color: #333;">
        <strong>📞 Need Help?</strong><br/>
        WhatsApp Support: <a href="https://wa.me/2347074119865" style="color: #25D366; text-decoration: none; font-weight: bold;">+234 707 411 9865</a>
      </p>
    </div>
    <p style="color: #666; font-size: 14px; margin: 15px 0;">
      Join our WhatsApp channel for exclusive updates, free resources every Thursday, and learning tips!
    </p>
  </div>
  <hr style="margin: 25px 0; border: none; border-top: 1px solid #ddd;"/>
  <p style="text-align: center; color: #666; font-size: 12px;">
    <em>Empowering Creators. Elevating Knowledge Sharing.</em><br/>
    © ${new Date().getFullYear()} hallos. All rights reserved.
  </p>
`;

// ─── Email HTML Builder ───────────────────────────────────────────────────────
const buildEmailHtml = (firstname) => `
  <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">

    <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
      <h1 style="color: #e94560; margin: 0 0 10px 0; font-size: 32px; letter-spacing: 2px;">🎮 QUIZ IS COMING!</h1>
      <p style="color: #ffffff; margin: 0; font-size: 18px; opacity: 0.9;">Something big is launching on hallos this week</p>
    </div>

    <div style="padding: 30px; background-color: #ffffff;">
      <p style="font-size: 18px; color: #333;">Hi ${firstname},</p>

      <p style="font-size: 16px; line-height: 1.8; color: #555;">
        We've been working on something exciting behind the scenes, and we can't keep it a secret any longer — 
        <strong>the hallos Quiz Platform is launching this week!</strong> 🚀
      </p>

      <div style="background: linear-gradient(135deg, #1a1a2e, #0f3460); padding: 25px; border-radius: 12px; margin: 25px 0; text-align: center;">
        <h2 style="color: #e94560; margin: 0 0 15px 0; font-size: 24px;">⚡ Challenge. Compete. Win Real Money.</h2>
        <p style="color: #ffffff; margin: 0; font-size: 16px; line-height: 1.8;">
          Pick a subject. Challenge another player. Answer questions. 
          The winner takes the Morgan points — and converts them to real cash!
        </p>
      </div>

      <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #0f3460;">
        <h3 style="color: #333; margin-top: 0;">🎯 How It Works:</h3>
        <ul style="color: #555; line-height: 2.2; margin: 0; padding-left: 20px;">
          <li>Create your <strong>quiz nickname</strong> and pick your avatar</li>
          <li>Get <strong>1 Free Morgan or 100 free Chuta points</strong> just for signing up</li>
          <li>Challenge any online player to a 1v1 quiz battle</li>
          <li>Both players wager Morgan points — winner takes all</li>
          <li>Answer questions</li>
          <li>Faster correct answers = <strong>more bonus points</strong></li>
          <li>Withdraw your winnings directly to your bank account 💰</li>
        </ul>
      </div>

      <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
        <h3 style="color: #333; margin-top: 0;">💡 Currency System:</h3>
        <p style="color: #555; margin: 5px 0;">Convert your morgan coins to real cash</p>
        <p style="color: #555; margin: 5px 0;">Win matches → Accumulate Morgan → Convert to real money</p>
        <p style="color: #555; margin: 0; font-style: italic;">The more you know, the more you earn!</p>
      </div>

      <div style="text-align: center; margin: 35px 0;">
        <a href="https://www.hallos.net/dashboard/games" style="background: linear-gradient(135deg, #e94560, #c62a47); color: white; padding: 18px 45px; text-decoration: none; border-radius: 30px; font-weight: bold; display: inline-block; font-size: 18px; letter-spacing: 1px;">
          🎮 Play Now
        </a>
      </div>

      <hr style="margin: 30px 0; border: none; border-top: 2px solid #f0f0f0;"/>

      <h2 style="color: #333; text-align: center;">📚 Also on hallos Right Now</h2>
      <p style="color: #555; text-align: center; margin-bottom: 20px;">Check out these live series you can enroll in today:</p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #667eea;">
        <h3 style="color: #333; margin-top: 0;">🤖 Artificial Intelligence Masterclass</h3>
        <p style="color: #555; margin: 5px 0;">
          From machine learning basics to building real AI applications — taught by industry experts. 
          Perfect for beginners and intermediate learners who want to stay ahead of the curve.
        </p>
        <p style="color: #667eea; margin: 0; font-weight: bold;">Coming Soon — Register your interest now!</p>
      </div>

      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <h3 style="color: #333; margin-top: 0;">📝 WAEC/GCE Preparation Classes</h3>
        <p style="color: #555; margin: 5px 0;">
          Intensive live preparation sessions covering all major WAEC/GCE subjects. 
          Expert tutors, past questions, and exam strategies to help students score their best.
        </p>
        <p style="color: #28a745; margin: 5px 0; font-weight: bold;">✅ Enrollment is OPEN now!</p>
        <div style="text-align: center; margin-top: 15px;">
          <a href="https://www.hallos.net/series/a6651361-4441-47a0-882b-0d6a0c686afd" style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 20px; font-weight: bold; display: inline-block; font-size: 15px;">
            Enroll Now →
          </a>
        </div>
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://www.hallos.net" style="background-color: #667eea; color: white; padding: 15px 40px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px;">
          Explore hallos Now
        </a>
      </div>

      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #28a745;">
        <h3 style="color: #333; margin-top: 0;">🎁 Free Resources Every Thursday!</h3>
        <p style="color: #555; margin: 0;">
          Don't forget — every <strong>Thursday</strong> we drop free learning materials, templates, and resources 
          on the platform. Log in weekly so you never miss out!
        </p>
      </div>

      <div style="background: linear-gradient(135deg, #1a1a2e, #0f3460); padding: 25px; border-radius: 12px; margin: 25px 0; text-align: center;">
        <h3 style="color: #ffc107; margin-top: 0;">💳 Fund Your Wallet — Play More, Win More!</h3>
        <p style="color: #ffffff; margin: 10px 0; line-height: 1.8;">
          Your 100 free Chuta points are waiting for you — but the real fun starts when you top up your wallet 
          and raise the stakes. The bigger the wager, the bigger the win!
        </p>
        <a href="https://www.hallos.net/dashboard/games" style="background: linear-gradient(135deg, #ffc107, #ff9800); color: #1a1a2e; padding: 12px 30px; text-decoration: none; border-radius: 20px; font-weight: bold; display: inline-block; font-size: 15px; margin-top: 10px;">
          💰 Fund Wallet & Play
        </a>
      </div>

      <div style="background-color: #f0f7ff; padding: 25px; border-radius: 12px; margin: 25px 0; text-align: center; border: 2px dashed #667eea;">
        <h3 style="color: #333; margin-top: 0;">👥 Invite Your Friends — Challenge Them!</h3>
        <p style="color: #555; margin: 10px 0; line-height: 1.8;">
          The quiz is more fun with people you know! Invite your friends to join hallos, 
          then challenge them to a 1v1 quiz battle. Prove who's smarter — and take their Morgan points!
        </p>
        <p style="color: #555; margin: 10px 0;">
          Share this link with your friends:
        </p>
        <div style="background-color: #e8f0fe; padding: 10px 20px; border-radius: 8px; display: inline-block; margin: 10px 0;">
          <strong style="color: #667eea; font-size: 16px;">www.hallos.net</strong>
        </div>
        <br/>
        <a href="https://www.hallos.net/dashboard/games" style="background-color: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 20px; font-weight: bold; display: inline-block; font-size: 15px; margin-top: 15px;">
          🎮 Challenge a Friend Now
        </a>
      </div>

      <p style="font-size: 16px; line-height: 1.8; color: #555; margin-top: 30px;">
        We're building something special for Africa's learners and creators, and you're part of this journey. 
        Thank you for being with us. 🌍
      </p>

      <p style="font-size: 16px; margin-top: 30px;">
        <strong>With excitement,</strong><br/>
        <strong>Alexander Oseji</strong><br/>
        Co-Founder, hallos
      </p>
    </div>

    ${getSocialFooter()}
  </div>
`;

// ─── Send to one user ─────────────────────────────────────────────────────────
const sendToUser = async (email, firstname) => {
  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: '🎮 Quiz is Coming to hallos — Challenge Players & Win Real Money!',
    html: buildEmailHtml(firstname),
  });
};

// ─── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.argv[2]; // 'test' or 'all'
  const testEmail = process.argv[3]; // only used in test mode

  if (!mode) {
    console.log('Usage:');
    console.log('  Test:  node scripts/sendQuizLaunchEmail.js test your@email.com');
    console.log('  All:   node scripts/sendQuizLaunchEmail.js all');
    process.exit(0);
  }

  // ── TEST MODE ──
  if (mode === 'test') {
    if (!testEmail) {
      console.error('❌ Please provide your email: node scripts/sendQuizLaunchEmail.js test your@email.com');
      process.exit(1);
    }
    console.log(`📧 Sending test email to ${testEmail}...`);
    await sendToUser(testEmail, 'there');
    console.log('✅ Test email sent! Check your inbox.');
    process.exit(0);
  }

  // ── ALL USERS MODE ──
  if (mode === 'all') {
    console.log('🔌 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Connected\n');

    const users = await User.findAll({
      attributes: ['id', 'firstname', 'email'],
      order: [['createdAt', 'ASC']]
    });

    console.log(`📊 Found ${users.length} users\n`);
    console.log('🚀 Starting bulk send (batches of 10, 2s delay between batches)...\n');

    const BATCH_SIZE = 10;
    const DELAY_MS = 2000;

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async (user) => {
          try {
            await sendToUser(user.email, user.firstname || 'there');
            sent++;
            console.log(`  ✅ [${sent + failed}/${users.length}] Sent to ${user.email}`);
          } catch (err) {
            failed++;
            console.error(`  ❌ [${sent + failed}/${users.length}] Failed: ${user.email} — ${err.message}`);
          }
        })
      );

      // Delay between batches (skip delay after last batch)
      if (i + BATCH_SIZE < users.length) {
        console.log(`  ⏳ Waiting ${DELAY_MS / 1000}s before next batch...\n`);
        await sleep(DELAY_MS);
      }
    }

    console.log('\n─────────────────────────────────');
    console.log(`✅ Done! Sent: ${sent} | Failed: ${failed} | Total: ${users.length}`);
    console.log('─────────────────────────────────');
    process.exit(0);
  }

  console.error('❌ Unknown mode. Use "test" or "all"');
  process.exit(1);
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
