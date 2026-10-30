/**
 * Creates (or updates) a login for the email portal.
 *
 * Usage:
 *   node scripts/seedEmailMarketer.js --email copywriter@hallos.net --first Ada --last Okafor
 *   node scripts/seedEmailMarketer.js --email copywriter@hallos.net --reset      (new password for an existing account)
 *
 * The password is read from EMAIL_MARKETER_PASSWORD, or generated and printed once.
 * The account gets role "email_marketer": it can use /email-portal only and is
 * rejected by every admin endpoint.
 */
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/db');
const User = require('../models/User');

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
};

const generatePassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `${body}#7`;
};

async function run() {
  const email = (arg('email') || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Provide a valid --email');
    process.exit(1);
  }

  const reset = process.argv.includes('--reset');
  let user = await User.findOne({ where: { email } });
  const existed = Boolean(user);
  const needsPassword = !existed || reset;
  const password = needsPassword ? process.env.EMAIL_MARKETER_PASSWORD || generatePassword() : null;

  if (!user) {
    user = await User.create({
      firstname: arg('first') || 'Email',
      lastname: arg('last') || 'Marketer',
      email,
      password: await bcrypt.hash(password, 10),
      role: 'email_marketer'
    });
  } else {
    const updates = { role: user.role === 'admin' ? 'admin' : 'email_marketer' };
    if (reset) updates.password = await bcrypt.hash(password, 10);
    await user.update(updates);
  }

  console.log(existed ? 'Updated existing account' : 'Created account');
  console.log(`  Email:    ${email}`);
  console.log(`  Role:     ${user.role}`);
  if (needsPassword) console.log(`  Password: ${password}`);
  else console.log('  Password: unchanged (pass --reset to set a new one)');
  console.log('  Portal:   /email-portal/login');
  await sequelize.close();
}

run().catch((error) => {
  console.error('Seed failed:', error.message);
  process.exit(1);
});
