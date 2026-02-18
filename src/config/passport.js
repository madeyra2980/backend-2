import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { findOrCreateFromGoogle, findById } from '../store/users.js';

export function configurePassport() {
  const clientID = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const baseUrl = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  // Отдельный URL для редиректа приложения (Flutter): эмулятор Android видит ПК как 10.0.2.2
  const appCallbackBase = (process.env.APP_CALLBACK_BASE_URL || baseUrl).replace(/\/$/, '');
  const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ||
    'http://localhost:3000/auth/google/callback';
  const callbackURLApp = `${appCallbackBase}/auth/google/callback/app`;

  console.log('OAuth redirect URIs:', { callbackURL, callbackURLApp });

  const verify = async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateFromGoogle(profile);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  };

  if (clientID && clientSecret) {
    passport.use(
      new GoogleStrategy(
        { clientID, clientSecret, callbackURL, scope: ['profile', 'email'] },
        verify
      )
    );
    passport.use(
      'google-app',
      new GoogleStrategy(
        { clientID, clientSecret, callbackURL: callbackURLApp, scope: ['profile', 'email'] },
        verify
      )
    );
  } else {
    console.warn('⚠️  Google OAuth не настроен: задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в backend/.env (см. backend/AUTH_APP.md)');
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await findById(id);
      done(null, user || null);
    } catch (err) {
      done(err, null);
    }
  });
}
