const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,       
  port: process.env.EMAIL_PORT,      
  secure: process.env.EMAIL_SECURE == "true",  
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
        rejectUnauthorized: false
    }
});

/**
 * SOCIAL MEDIA FOOTER - Added to all emails
 */
const getSocialFooter = () => {
  return `
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
};

exports.sendEventRegistrationEmail = async (to, firstname) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>You're In! Get Ready to Connect, Create & Collaborate at the Creators' Summit.</h2>

      <p>Dear ${firstname},</p>

      <p>Welcome aboard! You've successfully registered for the 
      <strong>Hallos Creators' Summit – Enugu Edition</strong>.</p>

      <p>This summit isn't just another event — it's a movement.</p>

      <p><strong>Location:</strong> Enugu, Nigeria<br/>
      <strong>Date:</strong> ${process.env.EVENT_DATE}<br/>
      <strong>Time:</strong> ${process.env.EVENT_TIME}</p>

      <p>We can't wait to meet you and see what you'll create!</p>

      <hr style="margin: 25px 0;">

      <h3>Spread the Word</h3>

      <p>
      "Just signed up for the #hallosCreatorsSummit in Enugu!  
      Can't wait to connect and learn with amazing creators across Africa.  
      Join me at www.hallos.net  
      #hallos #CreatorsSummit #Enugu2025 #LearnCreateEarn"
      </p>

      <p>Forward this message to your creative friends and invite them to register now at <a href="https://www.hallos.net">www.hallos.net</a>.</p>
      
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Creators Summit" <${process.env.EMAIL_USER}>`,
    to,
    subject: "You're In! hallos Creators' Summit – Enugu",
    html,
  });
};


/**
 * hallos PLATFORM WELCOME EMAIL - UPDATED
 */
exports.sendhallosWelcomeEmail = async (to, firstname) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to hallos! 🎉</h1>
      </div>

      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 18px; color: #333;">Hi ${firstname},</p>

        <p style="font-size: 16px; line-height: 1.8; color: #555;">
          Welcome to <strong>hallos</strong> — Africa's fastest-growing creators' marketplace for 
          skill acquisition, knowledge sharing, and revenue generation!
        </p>

        <p style="font-size: 16px; line-height: 1.8; color: #555;">
          We're thrilled to have you join thousands of innovative learners, creators, and educators 
          who are shaping the future of digital knowledge and entrepreneurship.
        </p>

        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #667eea;">
          <h3 style="color: #333; margin-top: 0;">🚀 What You Can Do on hallos:</h3>
          
          <ul style="color: #555; line-height: 2;">
            <li><strong>📚 Self-Paced Courses:</strong> Learn at your own pace with our comprehensive course library</li>
            <li><strong>🎥 Live Classes:</strong> Join interactive live sessions with expert instructors</li>
            <li><strong>📅 Live Series:</strong> Enroll in multi-week learning programs with scheduled sessions</li>
            <li><strong>✅ Quizzes & Assessments:</strong> Test your knowledge and track your progress</li>
            <li><strong>🎁 Free Resources:</strong> Access free learning materials dropped every Thursday!</li>
            <li><strong>💰 Earn as a Creator:</strong> Share your knowledge and monetize your expertise</li>
          </ul>
        </div>

        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #333; margin-top: 0;">🎁 Don't Miss Our Weekly Freebies!</h3>
          <p style="color: #555; margin: 10px 0;">
            Every <strong>Thursday</strong>, we drop exclusive free learning materials, templates, and resources 
            to help you grow. Make sure to check the platform weekly!
          </p>
        </div>

        <div style="text-align: center; margin: 35px 0;">
          <a href="https://www.hallos.net" style="background-color: #667eea; color: white; padding: 15px 40px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; font-size: 16px;">
            Start Exploring Now
          </a>
        </div>

        <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #333; margin-top: 0;">💡 Share the Knowledge!</h3>
          <p style="color: #555; margin: 10px 0;">
            Love what we're building? Invite your friends and family to join hallos! 
            Together, we're creating Africa's largest learning community.
          </p>
          <p style="color: #555; margin: 10px 0;">
            <strong>Share this link:</strong> <a href="https://www.hallos.net" style="color: #667eea;">www.hallos.net</a>
          </p>
        </div>

        <p style="font-size: 16px; line-height: 1.8; color: #555; margin-top: 30px;">
          At hallos, we believe <strong>knowledge is power</strong> — but <strong>shared knowledge is impact</strong>.
        </p>

        <p style="font-size: 16px; line-height: 1.8; color: #555;">
          Take your time to explore, enroll in courses that inspire you, or start building 
          your own community of learners as a creator.
        </p>

        <p style="font-size: 16px; line-height: 1.8; color: #555;">
          Thank you for trusting us to be part of your learning journey. Let's grow together! 🌱
        </p>

        <p style="font-size: 16px; margin-top: 30px;">
          <strong>With appreciation,</strong><br/>
          <strong>Alexander Oseji</strong><br/>
          Co-Founder, hallos
        </p>
      </div>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Welcome to hallos — Let's Start Your Learning Journey! 🚀",
    html,
  });
};

/**
 * PURCHASE CONFIRMATION EMAIL (to student)
 */
exports.sendPurchaseConfirmationEmail = async (to, firstname, contentTitle, amount, currency = 'NGN') => {
  const currencySymbol = currency === 'USD' ? '$' : '₦';
  const formattedAmount = currency === 'USD' ? amount.toFixed(2) : amount.toLocaleString();

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Purchase Confirmed! 🎉</h2>

      <p>Dear ${firstname},</p>

      <p>
        Thank you for your purchase! You now have lifetime access to:
      </p>

      <p style="font-size: 18px; font-weight: bold; color: #333;">
        ${contentTitle}
      </p>

      <p><strong>Amount Paid:</strong> ${currencySymbol}${formattedAmount}</p>

      <p>
        You can access your purchased content anytime from your dashboard at 
        <a href="https://www.hallos.net/dashboard">www.hallos.net/dashboard</a>.
      </p>

      <p>
        Happy learning!
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Purchase Confirmed - ${contentTitle}`,
    html,
  });
};

/**
 * SALE NOTIFICATION EMAIL (to creator)
 */
exports.sendSaleNotificationEmail = async (to, creatorName, contentTitle, studentName, amount, currency = 'NGN') => {
  const currencySymbol = currency === 'USD' ? '$' : '₦';
  const formattedAmount = currency === 'USD' ? amount.toFixed(2) : amount.toLocaleString();

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>You Made a Sale! 💰</h2>

      <p>Dear ${creatorName},</p>

      <p>
        Great news! <strong>${studentName}</strong> just purchased your content:
      </p>

      <p style="font-size: 18px; font-weight: bold; color: #333;">
        ${contentTitle}
      </p>

      <p><strong>Amount:</strong> ${currencySymbol}${formattedAmount}</p>

      <p>
        This amount has been added to your wallet. You can view your earnings and withdraw funds 
        from your creator dashboard at <a href="https://www.hallos.net/dashboard">www.hallos.net/dashboard</a>.
      </p>

      <p>
        Keep creating amazing content!
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `New Sale - ${contentTitle}`,
    html,
  });
};

/**
 * WITHDRAWAL CONFIRMATION EMAIL (to creator)
 */
exports.sendWithdrawalConfirmationEmail = async (to, firstname, amount, netAmount, bankName, accountNumber) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Withdrawal Successful! ✅</h2>

      <p>Dear ${firstname},</p>

      <p>
        Your withdrawal request has been processed successfully!
      </p>

      <p><strong>Withdrawal Amount:</strong> ₦${amount.toFixed(2)}</p>
      <p><strong>Platform Fee (20%):</strong> ₦${(amount * 0.20).toFixed(2)}</p>
      <p><strong>Net Amount Transferred:</strong> ₦${netAmount.toFixed(2)}</p>

      <p><strong>Bank Details:</strong></p>
      <p>
        ${bankName}<br/>
        ${accountNumber}
      </p>

      <p>
        The funds should reflect in your account within 1-3 business days.
      </p>

      <p>
        You can view your transaction history in your creator dashboard at 
        <a href="https://www.hallos.net/dashboard">www.hallos.net/dashboard</a>.
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Withdrawal Successful',
    html,
  });
};

/**
 * WITHDRAWAL FAILURE EMAIL (to creator)
 */
exports.sendWithdrawalFailureEmail = async (to, firstname, amount, reason) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Withdrawal Failed ❌</h2>

      <p>Dear ${firstname},</p>

      <p>
        Unfortunately, your withdrawal request could not be processed.
      </p>

      <p><strong>Amount:</strong> ₦${amount.toFixed(2)}</p>
      <p><strong>Reason:</strong> ${reason}</p>

      <p>
        The funds have been returned to your available balance. Please check your bank details 
        and try again, or contact our support team for assistance.
      </p>

      <p>
        You can retry the withdrawal from your creator dashboard at 
        <a href="https://www.hallos.net/dashboard">www.hallos.net/dashboard</a>.
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Withdrawal Failed - Action Required',
    html,
  });
};

/**
 * PASSWORD RESET OTP EMAIL
 */
exports.sendPasswordResetOTP = async (to, firstname, otp) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Password Reset Request 🔐</h2>

      <p>Dear ${firstname},</p>

      <p>
        You requested to reset your password for your hallos account. 
        Use the verification code below to proceed:
      </p>

      <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
        <h1 style="color: #333; font-size: 32px; letter-spacing: 8px; margin: 0;">
          ${otp}
        </h1>
      </div>

      <p><strong>Important:</strong></p>
      <ul>
        <li>This code expires in <strong>10 minutes</strong></li>
        <li>Do not share this code with anyone</li>
        <li>If you didn't request this, please ignore this email</li>
      </ul>

      <p>
        Enter this code on the password reset page to create your new password.
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Password Reset Code - hallos',
    html,
  });
};

/**
 * WITHDRAWAL CONFIRMATION OTP EMAIL
 */
exports.sendWithdrawalOTP = async (to, firstname, otp, amount, currency, bankAccount) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Withdrawal Confirmation Required 💰</h2>

      <p>Dear ${firstname},</p>

      <p>
        You requested to withdraw <strong>${currency} ${amount.toLocaleString()}</strong> from your hallos wallet.
        For your security, please confirm this withdrawal with the verification code below:
      </p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0;">Withdrawal Details:</h3>
        <p><strong>Amount:</strong> ${currency} ${amount.toLocaleString()}</p>
        <p><strong>Bank Account:</strong> ${bankAccount}</p>
        <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
      </div>

      <div style="background-color: #e8f5e8; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; border: 2px solid #28a745;">
        <h1 style="color: #28a745; font-size: 36px; letter-spacing: 6px; margin: 0;">
          ${otp}
        </h1>
      </div>

      <p><strong>Security Notice:</strong></p>
      <ul>
        <li>This code expires in <strong>10 minutes</strong></li>
        <li>Never share this code with anyone</li>
        <li>If you didn't request this withdrawal, contact support immediately</li>
        <li>Only enter this code on the official hallos website</li>
      </ul>

      <p>
        Enter this code on the withdrawal confirmation page to complete your transaction.
      </p>

      <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>⚠️ Security Tip:</strong> Always verify withdrawal details carefully before confirming.</p>
      </div>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Security" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Withdrawal Confirmation - ${currency} ${amount.toLocaleString()}`,
    html,
  });
};

/**
 * COURSE ENROLLMENT CONFIRMATION EMAIL
 */
exports.sendCourseEnrollmentConfirmationEmail = async (to, firstname, courseTitle, amount, currency, departmentName) => {
  const currencySymbol = currency === 'USD' ? '$' : '₦';
  const formattedAmount = currency === 'USD' ? amount.toFixed(2) : amount.toLocaleString();

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Course Enrollment Confirmed! 🎓</h2>

      <p>Dear ${firstname},</p>

      <p>
        Thank you for your enrollment! Your payment has been successfully processed for:
      </p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
        <h3 style="color: #333; margin-top: 0;">${courseTitle}</h3>
        <p style="margin: 5px 0;"><strong>Department:</strong> ${departmentName}</p>
        <p style="margin: 5px 0;"><strong>Amount Paid:</strong> ${currencySymbol}${formattedAmount}</p>
        <p style="margin: 5px 0;"><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</p>
      </div>

      <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <p style="margin: 0;"><strong>✅ What's Next?</strong></p>
        <p style="margin: 10px 0 0 0;">Your course login credentials will be sent to this email address within the next few hours. Please keep an eye on your inbox!</p>
      </div>

      <p><strong>Important Information:</strong></p>
      <ul>
        <li>Your enrollment has been confirmed and processed</li>
        <li>Course access credentials will be sent shortly</li>
        <li>Check your spam/junk folder if you don't see the credentials email</li>
        <li>Contact support if you don't receive credentials within 24 hours</li>
      </ul>

      <p>
        We're excited to have you join this learning journey! The course will provide you with 
        valuable skills and knowledge to advance your career and personal development.
      </p>

      <p>
        If you have any questions about your enrollment, please don't hesitate to contact our support team.
      </p>

      <p><strong>The Hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"Hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Course Enrollment Confirmed - ${courseTitle}`,
    html,
  });
};

/**
 * LIVE SERIES PURCHASE CONFIRMATION EMAIL
 */
exports.sendLiveSeriesPurchaseEmail = async (to, firstname, seriesTitle, totalSessions, amount, currency, startDate) => {
  const currencySymbol = currency === 'USD' ? '$' : '₦';
  const formattedAmount = currency === 'USD' ? amount.toFixed(2) : amount.toLocaleString();
  const formattedStartDate = new Date(startDate).toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Live Series Access Confirmed! 🎉</h2>

      <p>Dear ${firstname},</p>

      <p>
        Congratulations! You now have full access to all sessions in:
      </p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
        <h3 style="color: #333; margin-top: 0;">${seriesTitle}</h3>
        <p style="margin: 5px 0;"><strong>Total Sessions:</strong> ${totalSessions} live sessions</p>
        <p style="margin: 5px 0;"><strong>Series Starts:</strong> ${formattedStartDate}</p>
        <p style="margin: 5px 0;"><strong>Amount Paid:</strong> ${currencySymbol}${formattedAmount}</p>
        <p style="margin: 5px 0;"><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</p>
      </div>

      <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <p style="margin: 0;"><strong>✅ You're All Set!</strong></p>
        <p style="margin: 10px 0 0 0;">You can now join any live session in this series. View your upcoming sessions and join links from your dashboard.</p>
      </div>

      <p><strong>What You Get:</strong></p>
      <ul>
        <li>Access to all ${totalSessions} live sessions in the series</li>
        <li>Real-time interaction with the instructor</li>
        <li>Q&A opportunities during each session</li>
        <li>Join from any device with internet connection</li>
      </ul>

      <p><strong>How to Join Sessions:</strong></p>
      <ol>
        <li>Log in to your dashboard at <a href="https://www.hallos.net/dashboard">www.hallos.net/dashboard</a></li>
        <li>Go to "My Live Series" or "Upcoming Sessions"</li>
        <li>Click "Join Session" when the session is live</li>
      </ol>

      <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>💡 Pro Tip:</strong> Sessions are only available when the instructor starts them. Make sure to check your schedule and join on time!</p>
      </div>

      <p>
        We're excited to have you in this series! Get ready for an amazing learning experience.
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Live Series Access Confirmed - ${seriesTitle}`,
    html,
  });
};

/**
 * SESSION REMINDER EMAIL (1 hour before)
 */
exports.sendSessionReminderEmail = async (to, firstname, sessionData) => {
  const { sessionId, seriesId, sessionNumber, seriesTitle, scheduledStartTime, thumbnailUrl } = sessionData;
  
  const startTime = new Date(scheduledStartTime);
  const formattedDate = startTime.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  const formattedTime = startTime.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    timeZoneName: 'short'
  });

  // Use seriesId if provided, otherwise fall back to sessionId
  const joinUrl = seriesId 
    ? `${process.env.CLIENT_URL}/series/${seriesId}`
    : `${process.env.CLIENT_URL}/session/${sessionId}/join`;
  const calendarUrl = `${process.env.CLIENT_URL}/session/${sessionId}/calendar`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Your Live Session Starts in 1 Hour! ⏰</h2>

      <p>Hi ${firstname},</p>

      <p>
        This is a friendly reminder that your live session is starting soon!
      </p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
        <h3 style="color: #333; margin-top: 0;">${seriesTitle}</h3>
        <p style="margin: 5px 0;"><strong>Session ${sessionNumber}</strong></p>
        <p style="margin: 5px 0;">📅 ${formattedDate}</p>
        <p style="margin: 5px 0;">⏰ ${formattedTime}</p>
      </div>

      ${thumbnailUrl ? `
      <div style="text-align: center; margin: 20px 0;">
        <img src="${thumbnailUrl}" alt="${seriesTitle}" style="max-width: 100%; height: auto; border-radius: 8px;" />
      </div>
      ` : ''}

      <div style="text-align: center; margin: 30px 0;">
        <a href="${joinUrl}" style="background-color: #28a745; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          Join Session Now
        </a>
      </div>

      <p style="text-align: center; margin: 20px 0;">
        <a href="${calendarUrl}" style="color: #007bff; text-decoration: none;">
          📅 Add to Calendar
        </a>
      </p>

      <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>💡 Pro Tip:</strong> Join a few minutes early to test your connection and get settled!</p>
      </div>

      <p><strong>What to Prepare:</strong></p>
      <ul>
        <li>Stable internet connection</li>
        <li>Headphones or speakers</li>
        <li>Notebook for taking notes</li>
        <li>Any questions you want to ask</li>
      </ul>

      <p>
        See you in the session!
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Reminders" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Starting Soon: ${seriesTitle} - Session ${sessionNumber}`,
    html,
  });
};

/**
 * NEW CONTENT NEWSLETTER EMAIL
 */
exports.sendNewContentEmail = async (to, firstname, contentData) => {
  const { id, title, description, thumbnailUrl, contentType, pricing, creatorName } = contentData;
  
  const contentTypeLabel = {
    'video': 'New Video',
    'live_class': 'New Live Class',
    'live_series': 'New Live Series'
  }[contentType] || 'New Content';

  const viewUrl = `${process.env.CLIENT_URL}/${contentType}/${id}`;
  const unsubscribeUrl = `${process.env.CLIENT_URL}/profile/notifications`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>🎉 ${contentTypeLabel} Available Now!</h2>

      <p>Hi ${firstname},</p>

      <p>
        Great news! New content has just been added to hallos that you might be interested in:
      </p>

      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        ${thumbnailUrl ? `
        <div style="text-align: center; margin-bottom: 15px;">
          <img src="${thumbnailUrl}" alt="${title}" style="max-width: 100%; height: auto; border-radius: 8px;" />
        </div>
        ` : ''}
        
        <h3 style="color: #333; margin-top: 0;">${title}</h3>
        ${creatorName ? `<p style="color: #666; margin: 5px 0;">By ${creatorName}</p>` : ''}
        ${description ? `<p style="margin: 10px 0;">${description.substring(0, 200)}${description.length > 200 ? '...' : ''}</p>` : ''}
        
        ${pricing ? `
        <div style="margin: 15px 0;">
          <p style="margin: 5px 0;"><strong>Price:</strong></p>
          <p style="margin: 5px 0;">₦${pricing.ngn.toLocaleString()} NGN or $${pricing.usd.toFixed(2)} USD</p>
        </div>
        ` : ''}
      </div>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${viewUrl}" style="background-color: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          View ${contentTypeLabel}
        </a>
      </div>

      <p>
        Don't miss out on this opportunity to learn something new!
      </p>

      <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;"/>

      <p style="font-size: 12px; color: #666;">
        You're receiving this email because you subscribed to hallos newsletter. 
        <a href="${unsubscribeUrl}" style="color: #007bff;">Manage your notification preferences</a>
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Newsletter" <${process.env.EMAIL_USER}>`,
    to,
    subject: `${contentTypeLabel}: ${title}`,
    html,
  });
};

/**
 * COLLABORATION REQUEST EMAIL (to company)
 * Sent when a user requests collaboration with a company
 * CC'd to the user who sent the request
 */
exports.sendCollaborationRequestEmail = async (companyEmail, userEmail, collaborationData) => {
  const { 
    companyName, 
    contactName, 
    userFullName, 
    userFirstName,
    message 
  } = collaborationData;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Collaboration Opportunity</h1>
      </div>

      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #333;">Dear ${contactName || 'Team'},</p>

        <p style="font-size: 15px; line-height: 1.8; color: #555;">
          I hope this email finds you well. My name is <strong>${userFullName}</strong>, and I am a content creator on the <strong>Hallos</strong> platform.
        </p>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #667eea;">
          <p style="font-size: 15px; line-height: 1.8; color: #333; margin: 0;">
            ${message}
          </p>
        </div>

        <p style="font-size: 15px; line-height: 1.8; color: #555;">
          I believe a collaboration between us would be mutually beneficial, and I would love to discuss how we can work together to create engaging content that resonates with your audience.
        </p>

        <p style="font-size: 15px; line-height: 1.8; color: #555;">
          I am available for a call or meeting at your convenience to explore this opportunity further.
        </p>

        <p style="font-size: 15px; line-height: 1.8; color: #555;">
          Looking forward to hearing from you.
        </p>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e9ecef;">
          <p style="font-size: 15px; margin: 5px 0;"><strong>Best regards,</strong></p>
          <p style="font-size: 15px; margin: 5px 0;"><strong>${userFullName}</strong></p>
          <p style="font-size: 14px; margin: 5px 0; color: #666;">
            📧 Email: <a href="mailto:${userEmail}" style="color: #667eea; text-decoration: none;">${userEmail}</a>
          </p>
          <p style="font-size: 14px; margin: 5px 0; color: #666;">
            🌐 Platform: <a href="https://www.hallos.net" style="color: #667eea; text-decoration: none;">Hallos (www.hallos.net)</a>
          </p>
        </div>

        <div style="background-color: #e8f5e8; padding: 15px; border-radius: 8px; margin: 25px 0; text-align: center;">
          <p style="margin: 0; color: #333; font-size: 14px;">
            <strong>💡 About Hallos:</strong> Africa's fastest-growing creators' marketplace for skill acquisition, knowledge sharing, and revenue generation.
          </p>
        </div>
      </div>

      ${getSocialFooter()}
    </div>
  `;

  // Send email to company with CC to user
  await transporter.sendMail({
    from: `"${userFullName} via Hallos" <${process.env.EMAIL_USER}>`,
    to: companyEmail,
    cc: userEmail, // CC the user
    replyTo: userEmail, // Company can reply directly to user
    subject: `Collaboration Opportunity with ${userFullName} - Content Creator on Hallos`,
    html,
  });
};


/**
 * SESSION RECORDING EMAIL
 * Sends recording links to enrolled students
 */
exports.sendSessionRecordingEmail = async (to, firstname, recordingData) => {
  const { seriesTitle, recordings, customMessage, thumbnailUrl } = recordingData;
  
  // Build recordings list HTML
  const recordingsHtml = recordings.map(rec => `
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #007bff;">
      <h4 style="color: #333; margin-top: 0;">Session ${rec.sessionNumber}</h4>
      <div style="text-align: center; margin: 15px 0;">
        <a href="${rec.driveLink}" style="background-color: #4285f4; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
          📹 Watch Recording
        </a>
      </div>
    </div>
  `).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Session Recording Available! 🎥</h2>

      <p>Hi ${firstname},</p>

      <p>
        Great news! The recording${recordings.length > 1 ? 's' : ''} for your live session${recordings.length > 1 ? 's are' : ' is'} now available.
      </p>

      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <h3 style="color: #333; margin-top: 0;">${seriesTitle}</h3>
        <p style="margin: 5px 0;">You can now watch the recording${recordings.length > 1 ? 's' : ''} at your convenience!</p>
      </div>

      ${thumbnailUrl ? `
      <div style="text-align: center; margin: 20px 0;">
        <img src="${thumbnailUrl}" alt="${seriesTitle}" style="max-width: 100%; height: auto; border-radius: 8px;" />
      </div>
      ` : ''}

      ${customMessage ? `
      <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>Message from your instructor:</strong></p>
        <p style="margin: 10px 0 0 0;">${customMessage}</p>
      </div>
      ` : ''}

      <h3>Available Recordings:</h3>
      ${recordingsHtml}

      <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0;"><strong>📝 How to Access:</strong></p>
        <ol style="margin: 10px 0 0 0;">
          <li>Click the "Watch Recording" button above</li>
          <li>You'll be redirected to Google Drive</li>
          <li>Stream or download the recording</li>
          <li>Watch at your own pace and take notes</li>
        </ol>
      </div>

      <div style="background-color: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 0;"><strong>💡 Pro Tip:</strong> Rewatch the session to reinforce your learning and catch any details you might have missed!</p>
      </div>

      <p><strong>Need Help?</strong></p>
      <p>
        If you have any issues accessing the recording${recordings.length > 1 ? 's' : ''}, please contact our support team 
        via WhatsApp at <a href="https://wa.me/2347074119865" style="color: #25D366; text-decoration: none; font-weight: bold;">+234 707 411 9865</a>
      </p>

      <p>
        Keep learning and growing!
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Recordings" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Session Recording Available - ${seriesTitle}`,
    html,
  });
};

/**
 * FREEBIE SALE NOTIFICATION EMAIL (to creator)
 * Sent when a buyer successfully purchases a creator's paid freebie
 */
exports.sendFreebieSaleNotificationEmail = async (to, creatorName, freebieTitle, buyerName, amountPaid, currency, purchaseTimestamp) => {
  const currencySymbol = currency === 'USD' ? '$' : '₦';
  const formattedAmount = currency === 'USD' ? parseFloat(amountPaid).toFixed(2) : parseFloat(amountPaid).toLocaleString();
  const formattedDate = new Date(purchaseTimestamp).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>🎉 You Made a Sale!</h2>

      <p>Hi ${creatorName},</p>

      <p>Great news — someone just purchased your content on hallos!</p>

      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <h3 style="color: #333; margin-top: 0;">Sale Details</h3>
        <p style="margin: 5px 0;"><strong>Content:</strong> ${freebieTitle}</p>
        <p style="margin: 5px 0;"><strong>Buyer:</strong> ${buyerName}</p>
        <p style="margin: 5px 0;"><strong>Amount:</strong> ${currencySymbol}${formattedAmount} ${currency}</p>
        <p style="margin: 5px 0;"><strong>Date:</strong> ${formattedDate}</p>
      </div>

      <div style="background-color: #f0f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0;"><strong>💰 Earnings Info:</strong></p>
        <p style="margin: 10px 0 0 0;">
          The full amount of ${currencySymbol}${formattedAmount} has been credited to your hallos wallet. 
          The platform fee will be deducted when you withdraw your earnings.
        </p>
      </div>

      <p>Keep creating great content — your audience is growing!</p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos" <${process.env.EMAIL_USER}>`,
    to,
    subject: `💰 New Sale: ${freebieTitle}`,
    html,
  });
};

/**
 * FREEBIE NEW CONTENT NOTIFICATION EMAIL (to buyer)
 * Sent when a creator adds new items to a paid freebie the buyer has already purchased
 */
exports.sendFreebieNewContentEmail = async (to, buyerFirstname, freebieTitle, newItemCount) => {
  const itemWord = newItemCount === 1 ? 'item' : 'items';

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>📦 New Content Added to Your Purchase!</h2>

      <p>Hi ${buyerFirstname},</p>

      <p>
        The creator has just added <strong>${newItemCount} new ${itemWord}</strong> to a resource you already own — 
        and since you've already paid, you get access automatically!
      </p>

      <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <h3 style="color: #333; margin-top: 0;">📚 ${freebieTitle}</h3>
        <p style="margin: 5px 0;">
          <strong>${newItemCount} new ${itemWord}</strong> added — log in to your hallos account to download them now.
        </p>
      </div>

      <div style="background-color: #f0f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0;"><strong>💡 How to access:</strong></p>
        <ol style="margin: 10px 0 0 0;">
          <li>Log in to your hallos account</li>
          <li>Navigate to the resource hub</li>
          <li>Find <strong>${freebieTitle}</strong></li>
          <li>Download the new ${itemWord}</li>
        </ol>
      </div>

      <p>Enjoy the new content!</p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📦 New content added to: ${freebieTitle}`,
    html,
  });
};


/**
 * HALLOS FASTRACK RETREAT — QUIZ ACCESS EMAIL
 * Sent immediately after payment is confirmed.
 * Combines payment confirmation + quiz link in one email.
 * registrationData: { lastName, talent, location, token }
 */
exports.sendCampaignQuizAccessEmail = async (to, firstName, registrationData) => {
  const { lastName, talent, location, token } = registrationData;
  const quizUrl = `${process.env.CLIENT_URL}/dashboard/campaign/quiz?token=${token}`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 640px; margin: 0 auto;">

      <!-- Header banner -->
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 40px 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #f0c040; margin: 0 0 8px; font-size: 26px; letter-spacing: 1px;">🎯 Registration Confirmed!</h1>
        <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Hallos Fastrack Your Growth to Success Retreat</p>
      </div>

      <!-- Body -->
      <div style="padding: 35px 30px; background-color: #ffffff;">

        <p style="font-size: 17px; color: #222;">Hi <strong>${firstName} ${lastName}</strong>,</p>

        <p style="font-size: 15px; color: #444; line-height: 1.8;">
          Your <strong>₦3,000 registration fee</strong> has been confirmed. You are now officially in the selection pool
          for the <strong>Hallos Fastrack Your Growth to Success Retreat</strong>.
        </p>

        <p style="font-size: 15px; color: #444; line-height: 1.8;">
          But this is just the beginning — a spot at the retreat is <strong>earned, not bought</strong>.
          To qualify, you must complete your Round 1 qualifying quiz. Your personal quiz link is below.
        </p>

        <!-- Quiz link CTA -->
        <div style="background: linear-gradient(135deg, #f0c040 0%, #f5a623 100%); padding: 30px; border-radius: 10px; margin: 30px 0; text-align: center;">
          <h2 style="margin: 0 0 8px; color: #1a1a2e; font-size: 20px;">Your Qualifying Quiz is Ready</h2>
          <p style="margin: 0 0 20px; color: #1a1a2e; font-size: 14px;">⏳ This link expires in <strong>72 hours</strong> — don't wait!</p>
          <a href="${quizUrl}" style="background-color: #1a1a2e; color: #f0c040; padding: 15px 35px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 16px; display: inline-block; letter-spacing: 0.5px;">
            Take My Qualifying Quiz →
          </a>
          <p style="margin: 15px 0 0; color: #1a1a2e; font-size: 12px; word-break: break-all;">
            Or copy this link: ${quizUrl}
          </p>
        </div>

        <!-- Quiz rules -->
        <div style="background-color: #fff3cd; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ffc107;">
          <h3 style="color: #1a1a2e; margin-top: 0;">📋 Quiz Rules — Read Before You Start</h3>
          <ul style="color: #444; line-height: 2.2; margin: 0; padding-left: 20px;">
            <li><strong>20 questions</strong>, each with 5 options (A–E)</li>
            <li><strong>15 seconds per question</strong> — no pausing, no going back</li>
            <li>Questions are <strong>randomised</strong> — every participant gets a different set</li>
            <li>You must be <strong>logged into your hallos account</strong> to take the quiz</li>
            <li><strong>One attempt only</strong> — once you start, you cannot retake it</li>
            <li>This link is <strong>personal to you</strong> — do not share it</li>
            <li>Link expires <strong>72 hours</strong> after this email was sent</li>
          </ul>
        </div>

        <!-- Competition structure -->
        <div style="background-color: #fff8e1; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f0c040;">
          <h3 style="color: #1a1a2e; margin-top: 0;">🏅 How You Qualify for the Retreat</h3>

          <div style="background-color: #ffffff; padding: 15px; border-radius: 6px; margin-bottom: 12px; border: 1px solid #f0c040;">
            <h4 style="color: #0f3460; margin: 0 0 6px;">Round 1 — The Qualifying Quiz (You are here)</h4>
            <p style="color: #555; margin: 0; font-size: 14px;">
              All registered participants take this solo quiz. Top performers — ranked by score, then by speed —
              advance to Round 2. Your results will be emailed to you immediately after you submit.
            </p>
          </div>

          <div style="background-color: #ffffff; padding: 15px; border-radius: 6px; border: 1px solid #f0c040;">
            <h4 style="color: #0f3460; margin: 0 0 6px;">Round 2 — The 1v1 Showdown</h4>
            <p style="color: #555; margin: 0; font-size: 14px;">
              Top scorers from Round 1 enter a live 1v1 bracket. You compete head-to-head until
              <strong>20 finalists</strong> remain. Those 20 earn a fully-covered place at the retreat
              and a shot at the <strong>₦1,000,000 cash prize</strong>.
            </p>
          </div>
        </div>

        <!-- Registration summary -->
        <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #333; margin-top: 0;">✅ Your Registration Details</h3>
          <p style="margin: 5px 0; color: #444;"><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Talent/Skill:</strong> ${talent}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Location:</strong> ${location}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Registration Fee:</strong> ₦3,000 ✅ Paid</p>
        </div>

        <!-- What the retreat covers -->
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #0f3460;">
          <h3 style="color: #1a1a2e; margin-top: 0;">🚀 What the Retreat Covers</h3>
          <ul style="color: #444; line-height: 2.2; margin: 0; padding-left: 20px;">
            <li>🧠 Critical Thinking</li>
            <li>📣 Marketing &amp; Brand Strategy</li>
            <li>🦁 Leadership &amp; Communication</li>
            <li>🎤 Public Speaking</li>
            <li>🤝 Negotiation</li>
            <li>💰 Financial Literacy</li>
            <li>🤖 AI Prompting</li>
            <li>⚙️ Habit Stacking &amp; more</li>
          </ul>
        </div>

        <!-- Share CTA -->
        <div style="background-color: #1a1a2e; padding: 20px; border-radius: 8px; margin: 25px 0; text-align: center;">
          <p style="color: #f0c040; font-size: 15px; margin: 0 0 12px; font-weight: bold;">Know someone who should compete?</p>
          <p style="color: #ccc; font-size: 14px; margin: 0 0 16px; line-height: 1.7;">
            "Just registered for the Hallos Fastrack Retreat! 🚀<br/>
            Take the qualifying quiz, beat the competition, win ₦1 million!<br/>
            Register at www.hallos.net #HallosRetreat #FastrackGrowth"
          </p>
          <a href="https://www.hallos.net" style="background-color: #f0c040; color: #1a1a2e; padding: 12px 28px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 14px; display: inline-block;">
            Share hallos.net
          </a>
        </div>

        <p style="font-size: 15px; color: #444; line-height: 1.8; margin-top: 30px;">
          You registered — now go <em>earn</em> it. Give the quiz everything you have and let's see you in the top 20. 🔥
        </p>

        <p style="font-size: 15px; margin-top: 30px;">
          <strong>With excitement,</strong><br/>
          <strong>Alexander Oseji</strong><br/>
          Co-Founder, hallos
        </p>
      </div>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Retreat" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Registration Confirmed — Your Hallos Qualifying Quiz is Ready (72 Hours)',
    html
  });
};

/**
 * HALLOS FASTRACK RETREAT — QUIZ RESULTS EMAIL
 * Sent immediately after a participant submits their qualifying quiz.
 * resultData: { lastName, score, totalQuestions, totalCorrect, totalTimeMs }
 */
exports.sendCampaignQuizResultsEmail = async (to, firstName, resultData) => {
  const { lastName, score, totalQuestions, totalCorrect, totalTimeMs } = resultData;

  const totalSeconds = Math.floor(totalTimeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const percentage = Math.round((totalCorrect / totalQuestions) * 100);

  const scoreColor = percentage >= 70 ? '#28a745' : percentage >= 50 ? '#f0c040' : '#dc3545';

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 640px; margin: 0 auto;">

      <!-- Header -->
      <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 40px 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: #f0c040; margin: 0 0 8px; font-size: 26px; letter-spacing: 1px;">✅ Quiz Submitted!</h1>
        <p style="color: #ffffff; margin: 0; font-size: 16px; opacity: 0.9;">Hallos Fastrack Retreat — Round 1 Results</p>
      </div>

      <!-- Body -->
      <div style="padding: 35px 30px; background-color: #ffffff;">

        <p style="font-size: 17px; color: #222;">Hi <strong>${firstName} ${lastName}</strong>,</p>

        <p style="font-size: 15px; color: #444; line-height: 1.8;">
          You've completed your Round 1 qualifying quiz. Here's how you did:
        </p>

        <!-- Score card -->
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 10px; margin: 25px 0; text-align: center; border: 2px solid ${scoreColor};">
          <p style="font-size: 14px; color: #666; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Your Score</p>
          <p style="font-size: 56px; font-weight: bold; color: ${scoreColor}; margin: 0 0 4px; line-height: 1;">${score}<span style="font-size: 24px; color: #999;">/${totalQuestions}</span></p>
          <p style="font-size: 18px; color: #555; margin: 0 0 16px;">${percentage}% correct</p>
          <div style="display: inline-block; background-color: #1a1a2e; color: #f0c040; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: bold;">
            ⏱ Total Time: ${timeDisplay}
          </div>
        </div>

        <!-- Stats breakdown -->
        <div style="background-color: #e8f5e8; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #28a745;">
          <h3 style="color: #333; margin-top: 0;">📊 Your Breakdown</h3>
          <p style="margin: 5px 0; color: #444;"><strong>Correct answers:</strong> ${totalCorrect} out of ${totalQuestions}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Wrong / Timed out:</strong> ${totalQuestions - totalCorrect}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Total time taken:</strong> ${timeDisplay}</p>
          <p style="margin: 5px 0; color: #444;"><strong>Accuracy:</strong> ${percentage}%</p>
        </div>

        <!-- What happens next -->
        <div style="background-color: #fff8e1; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f0c040;">
          <h3 style="color: #1a1a2e; margin-top: 0;">⏳ What Happens Next</h3>
          <p style="color: #555; margin: 0 0 12px;">
            The campaign quiz is still open. Other participants are taking their qualifying quiz.
            Once the Round 1 window closes, the top scorers (ranked by score, then by speed) will be selected
            for Round 2.
          </p>
          <p style="color: #555; margin: 0;">
            If you advance to <strong>Round 2</strong>, you will receive a separate email with details for
            the live 1v1 bracket. The <strong>top 20 finalists</strong> earn a place at the retreat and
            compete for the <strong>₦1,000,000 prize</strong>.
          </p>
        </div>

        <p style="font-size: 15px; color: #444; line-height: 1.8; margin-top: 30px;">
          You showed up. That already puts you ahead. Now we wait — stay sharp. 🔥
        </p>

        <p style="font-size: 15px; margin-top: 30px;">
          <strong>The hallos Team</strong>
        </p>
      </div>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Retreat" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Your Round 1 Results: ${score}/${totalQuestions} — Hallos Fastrack Retreat`,
    html
  });
};

/**
 * COMMUNITY STATUS EMAIL (rejection / suspension)
 */
exports.sendCommunityStatusEmail = async (to, firstname, communityName, status) => {
  const isRejected = status === 'rejected';
  const subject = isRejected
    ? `Your community "${communityName}" was not approved`
    : `Your community "${communityName}" has been suspended`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>${isRejected ? 'Community Not Approved' : 'Community Suspended'}</h2>
      <p>Hi ${firstname},</p>
      <p>Your community <strong>${communityName}</strong> has been <strong>${status}</strong> by the hallos platform team.</p>
      <p>If you believe this is an error, please contact our support team.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to, subject, html
  });
};

/**
 * COMMUNITY JOIN CONFIRMATION EMAIL
 */
exports.sendCommunityJoinConfirmationEmail = async (to, firstname, communityName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Welcome to ${communityName}! 🎉</h2>
      <p>Hi ${firstname},</p>
      <p>Your request to join <strong>${communityName}</strong> has been approved. You now have full access to the community.</p>
      <p>Visit <a href="https://www.hallos.net">hallos</a> to get started.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You've been approved to join ${communityName}`,
    html
  });
};

/**
 * COMMUNITY MEMBER INVITE EMAIL (for existing platform users)
 */
exports.sendCommunityMemberInviteEmail = async (to, firstname, communityName, inviteToken) => {
  const acceptUrl = `${process.env.CLIENT_URL || 'https://www.hallos.net'}/communities/invite/${inviteToken}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>You've been invited to join ${communityName}!</h2>
      <p>Hi ${firstname},</p>
      <p>You've been invited to join the <strong>${communityName}</strong> community on hallos.</p>
      <p>Click the button below to accept the invitation:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${acceptUrl}" style="background-color: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
          Accept Invitation
        </a>
      </div>
      <p>If you don't want to join, you can ignore this email.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Communities" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You've been invited to join ${communityName} on hallos`,
    html
  });
};

/**
 * COMMUNITY INVITE EMAIL (for non-registered users)
 */
exports.sendCommunityInviteEmail = async (to, communityName, inviteToken) => {
  // Non-registered users go to signup page — after registration the frontend
  // reads the invite param and calls GET /api/communities/invite/:token
  const inviteUrl = `${process.env.CLIENT_URL || 'https://www.hallos.net'}/register?invite=${inviteToken}&community=${encodeURIComponent(communityName)}`;
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>You've been invited to join ${communityName} on hallos!</h2>
      <p>You've been invited to join the <strong>${communityName}</strong> community on hallos.</p>
      <p>Click the link below to create your free account and join:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${inviteUrl}" style="background-color: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">
          Create Account & Join ${communityName}
        </a>
      </div>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You're invited to join ${communityName} on hallos`,
    html
  });
};

/**
 * COMMUNITY ANNOUNCEMENT EMAIL
 */
exports.sendCommunityAnnouncementEmail = async (to, firstname, communityName, title, body) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>New Announcement in ${communityName}</h2>
      <p>Hi ${firstname},</p>
      <p><strong>${title}</strong></p>
      <p>${body}</p>
      <p>Visit <a href="https://www.hallos.net">hallos</a> to view the full announcement.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Communities" <${process.env.EMAIL_USER}>`,
    to,
    subject: `[${communityName}] ${title}`,
    html
  });
};

/**
 * COMMUNITY OWNERSHIP TRANSFER EMAIL
 */
exports.sendCommunityOwnershipTransferEmail = async (to, firstname, communityName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>You are now the owner of ${communityName}</h2>
      <p>Hi ${firstname},</p>
      <p>You have been assigned as the new owner of <strong>${communityName}</strong> on hallos.</p>
      <p>Visit <a href="https://www.hallos.net">hallos</a> to manage your community.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to,
    subject: `You are now the owner of ${communityName}`,
    html
  });
};

/**
 * COMMUNITY OWNERLESS NOTIFICATION (to platform admin)
 */
exports.sendCommunityOwnerlessEmail = async (to, adminName, communityName) => {
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>Community Requires New Owner</h2>
      <p>Hi ${adminName},</p>
      <p>The community <strong>${communityName}</strong> no longer has an owner. The community status has been set to <strong>pending</strong>.</p>
      <p>Please assign a new owner via the admin dashboard.</p>
      <p><strong>The hallos Team</strong></p>
      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos Admin" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Action Required: ${communityName} needs a new owner`,
    html
  });
};

/**
 * DIGEST EMAIL (daily or weekly)
 * Sends a single email with multiple upcoming live classes/series
 * @param {string} to - Recipient email
 * @param {string} firstname - Recipient first name
 * @param {Array} items - Array of content items { title, creatorName, startTime, category, thumbnailUrl, price, currency, contentType, joinLink }
 * @param {string} digestType - 'daily' | 'weekly'
 */
exports.sendDigestEmail = async (to, firstname, items, digestType) => {
  const isWeekly = digestType === 'weekly';
  const subject = isWeekly
    ? `Your weekly live class roundup on hallos`
    : `Upcoming live classes for you on hallos`;

  const formatDate = (date) => {
    if (!date) return 'TBD';
    return new Date(date).toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    }) + ' UTC';
  };

  const itemsHtml = items.map(item => `
    <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #ffffff;">
      ${item.thumbnailUrl ? `
        <div style="text-align: center; margin-bottom: 12px;">
          <img src="${item.thumbnailUrl}" alt="${item.title}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px;" />
        </div>
      ` : ''}
      <h3 style="margin: 0 0 6px; font-size: 16px; color: #1a202c;">${item.title}</h3>
      <p style="margin: 0 0 4px; color: #718096; font-size: 13px;">By <strong>${item.creatorName}</strong></p>
      ${item.category ? `<p style="margin: 0 0 4px; color: #718096; font-size: 13px;">📂 ${item.category}</p>` : ''}
      <p style="margin: 0 0 8px; color: #718096; font-size: 13px;">🗓 ${formatDate(item.startTime)}</p>
      <p style="margin: 0 0 14px; font-size: 13px; color: #2d3748;">
        ${item.price === 0
          ? '<span style="color: #38a169; font-weight: bold;">Free</span>'
          : `<span style="font-weight: bold;">${item.currency === 'USD' ? '$' : '₦'}${parseFloat(item.price).toLocaleString()}</span>`
        }
      </p>
      <div style="text-align: center;">
        <a href="${item.joinLink}" style="display: inline-block; background-color: #667eea; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: bold;">
          ${item.contentType === 'live_series' ? 'View Series →' : 'View Class →'}
        </a>
      </div>
    </div>
  `).join('');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6;">
      <h2>${isWeekly ? '📅 Your Weekly Live Class Roundup' : '🎯 Upcoming Live Classes For You'}</h2>

      <p>Hi ${firstname},</p>

      <p>
        ${isWeekly
          ? "Here's your weekly roundup of upcoming live classes on hallos that you might enjoy:"
          : "Here are some upcoming live classes on hallos picked for you:"}
      </p>

      ${itemsHtml}

      <div style="background-color: #f0f7ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
        <p style="margin: 0; font-size: 13px; color: #4a5568;">
          💡 <strong>Tip:</strong> Log in to your dashboard at 
          <a href="${process.env.CLIENT_URL || 'https://www.hallos.net'}/dashboard" style="color: #667eea;">hallos.net/dashboard</a> 
          to see all upcoming classes and manage your registrations.
        </p>
      </div>

      <hr style="margin: 25px 0; border: none; border-top: 1px solid #ddd;" />

      <p style="font-size: 12px; color: #666; text-align: center;">
        You're receiving this because you subscribed to hallos notifications.<br/>
        <a href="${process.env.CLIENT_URL || 'https://www.hallos.net'}/settings/notifications" style="color: #667eea;">Manage your notification preferences</a>
      </p>

      <p><strong>The hallos Team</strong></p>

      ${getSocialFooter()}
    </div>
  `;

  await transporter.sendMail({
    from: `"hallos" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
};
