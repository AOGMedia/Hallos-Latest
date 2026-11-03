require('dotenv').config();
const mailTransport = require('../services/mailTransport');

const recipient = process.argv[2] || 'sakariyauabdullateef993@gmail.com';

async function run() {
  const target = mailTransport.describe();
  console.log(`Provider: ${target.provider}`);
  console.log(`  Host: ${target.host}`);
  console.log(`  From: ${target.from}`);

  const check = await mailTransport.verify();
  console.log('Connection OK:', JSON.stringify(check));

  const sentAt = new Date().toISOString();
  const info = await mailTransport.sendMail({
    from: `"hallos Team" <${process.env.EMAIL_USER}>`,
    to: recipient,
    subject: `hallos email test (${target.provider})`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a1a">Email config test ✓</h2>
        <p>This confirms the backend can send email through <strong>${target.provider}</strong>.</p>
        <ul>
          <li><strong>Provider:</strong> ${target.provider}</li>
          <li><strong>Sent:</strong> ${sentAt}</li>
        </ul>
      </div>
    `,
    text: `Email config test through ${target.provider}. Sent: ${sentAt}`,
  });

  console.log(`Email sent to ${recipient}! Message ID: ${info.messageId}`);
  process.exit(0);
}

run().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
