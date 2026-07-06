require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function run() {
  console.log('Verifying SMTP connection...');
  console.log(`  Host: ${process.env.EMAIL_HOST}`);
  console.log(`  Port: ${process.env.EMAIL_PORT}`);
  console.log(`  User: ${process.env.EMAIL_USER}`);

  await transporter.verify();
  console.log('SMTP connection OK. Sending test email...');

  const info = await transporter.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to: 'osejialexander77@gmail.com',
    subject: 'hallos Email Test — support@hallos.net',
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a1a">Email config test ✓</h2>
        <p>This confirms the new email account is working correctly.</p>
        <ul>
          <li><strong>From:</strong> ${process.env.EMAIL_USER}</li>
          <li><strong>Host:</strong> ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}</li>
          <li><strong>Sent:</strong> ${new Date().toISOString()}</li>
        </ul>
        <p style="color:#888;font-size:13px">hallos.net backend — test script</p>
      </div>
    `,
    text: `Email config test. From: ${process.env.EMAIL_USER}. Host: ${process.env.EMAIL_HOST}:${process.env.EMAIL_PORT}. Sent: ${new Date().toISOString()}`,
  });

  console.log(`Email sent! Message ID: ${info.messageId}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
