const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

const googleStrategy = new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;

    let user = await User.findOne({ where: { email } });

    if (!user) {
      user = await User.create({
        firstname: profile.name?.givenName || '',
        lastname: profile.name?.familyName || '',
        email: email,
        password: '', // leave blank or set null; mark as OAuth user in DB
        role: 'viewer',
        provider: 'google', // optional: track provider
        providerId: profile.id // optional: store google profile id
      });
    } else {
      // Optionally: update user with latest Google profile details
      // await user.update({ firstname: ..., lastname: ... });
    }

    // Use their Google photo as the profile picture if they don't have one
    // yet. In the background: never slows down or blocks signing in.
    const photoUrl = profile.photos && profile.photos[0] && profile.photos[0].value;
    if (photoUrl) {
      const userId = user.id;
      setImmediate(() => {
        require('./oauthAvatarService').importGooglePhoto(userId, photoUrl).catch(() => {});
      });
    }

    // done(null, user) passes the user object to serializeUser
    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
});

// If you're using sessions (passport + express-session):
passport.serializeUser((user, done) => {
  // Save minimal identifier in session
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = { googleStrategy };