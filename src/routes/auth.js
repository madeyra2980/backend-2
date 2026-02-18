import { Router } from 'express';
import passport from 'passport';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { findById, findByEmail, findOrCreateFromGoogle } from '../store/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3001';
const APP_REDIRECT_SCHEME = process.env.APP_REDIRECT_SCHEME || 'komek';

function isGoogleOAuthConfigured() {
  const id = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const secret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  return Boolean(id && secret);
}

const APP_TOKENS_FILE = path.join(__dirname, '../../data/app-tokens.json');
const appTokenStore = new Map();

const googleClient = new OAuth2Client((process.env.GOOGLE_CLIENT_ID || '').trim());

function generateAppToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function persistAppTokens() {
  try {
    const dir = path.dirname(APP_TOKENS_FILE);
    await fs.mkdir(dir, { recursive: true });
    const now = Date.now();
    const entries = [];
    for (const [token, data] of appTokenStore) {
      if (data.expiresAt > now) entries.push({ token, userId: data.userId, expiresAt: data.expiresAt });
    }
    await fs.writeFile(APP_TOKENS_FILE, JSON.stringify(entries), 'utf8');
  } catch (err) {
    console.error('Failed to persist app tokens:', err.message);
  }
}

export async function loadAppTokens() {
  try {
    const data = await fs.readFile(APP_TOKENS_FILE, 'utf8');
    const entries = JSON.parse(data);
    const now = Date.now();
    for (const { token, userId, expiresAt } of entries) {
      if (expiresAt > now) appTokenStore.set(token, { userId, expiresAt });
    }
    if (entries.length > 0) console.log('[Auth] Loaded', appTokenStore.size, 'app token(s) from', APP_TOKENS_FILE);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[Auth] No app-tokens file yet (will be created on first app login)');
    } else {
      console.error('[Auth] Failed to load app tokens:', err.message);
    }
  }
}

// ————— OAuth Google —————

// Запуск входа через Google
// ?app=1 — используется отдельный callback /auth/google/callback/app → редирект в приложение (komek://)
router.get('/google', (req, res, next) => {
  console.log('[Auth] /auth/google start | app=', req.query.app, '| ua=', req.headers['user-agent']);
  if (!isGoogleOAuthConfigured()) {
    console.warn('[Auth] /auth/google blocked: Google OAuth is not configured');
    return res.redirect(`${FRONTEND_URL}/?error=oauth_not_configured`);
  }
  if (req.query.app === '1') {
    const appBase = (process.env.APP_CALLBACK_BASE_URL || process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    console.log('[Auth] App login: redirect_uri sent to Google =', appBase + '/auth/google/callback/app');
    passport.authenticate('google-app', { scope: ['profile', 'email'] })(req, res, next);
  } else {
    console.log('[Auth] Web login: redirect_uri will be', process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback');
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  }
});

// Callback для веба: выдаём токен и редирект на frontend (как для app)
router.get('/google/callback', (req, res, next) => {
  console.log('[Auth] /auth/google/callback hit | ua=', req.headers['user-agent']);
  if (!isGoogleOAuthConfigured()) {
    console.warn('[Auth] /auth/google/callback blocked: Google OAuth is not configured');
    return res.redirect(`${FRONTEND_URL}/login?error=oauth_not_configured`);
  }
  passport.authenticate('google', {
    session: false,
    failureRedirect: `${FRONTEND_URL}/login?error=auth_failed`,
  })(req, res, async (err) => {
    if (err) {
      console.error('[Auth] /auth/google/callback error:', err.message);
      return next(err);
    }
    if (!req.user) {
      console.warn('[Auth] /auth/google/callback: req.user is empty, redirecting with error');
      return res.redirect(`${FRONTEND_URL}/login?error=auth_failed`);
    }
    const token = generateAppToken();
    appTokenStore.set(token, {
      userId: req.user.id,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    await persistAppTokens();
    console.log('[Auth] Web OAuth success for user', req.user.id, '| token prefix:', token.slice(0, 8), '...');
    res.redirect(`${FRONTEND_URL}/login/oauth-callback?token=${encodeURIComponent(token)}`);
  });
});

// Callback для приложения → редирект на страницу app-redirect (оттуда открывается приложение)
// В Google Cloud Console добавьте: http://localhost:3000/auth/google/callback/app
router.get('/google/callback/app', (req, res, next) => {
  console.log('[Auth] /auth/google/callback/app hit | ua=', req.headers['user-agent']);
  if (!isGoogleOAuthConfigured()) {
    console.warn('[Auth] /auth/google/callback/app blocked: Google OAuth is not configured');
    return res.redirect(`${FRONTEND_URL}/?error=oauth_not_configured`);
  }
  passport.authenticate('google-app', {
    session: false,
    failureRedirect: `${FRONTEND_URL}/?error=auth_failed`,
  })(req, res, async (err) => {
    if (err) {
      console.error('[Auth] /auth/google/callback/app error:', err.message);
      return next(err);
    }
    if (!req.user) {
      console.warn('[Auth] /auth/google/callback/app: req.user is empty, redirecting with error');
      return res.redirect(`${FRONTEND_URL}/?error=auth_failed`);
    }
    const token = generateAppToken();
    appTokenStore.set(token, {
      userId: req.user.id,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    await persistAppTokens();
    console.log('[Auth] App token saved for user', req.user.id, '| token prefix:', token.slice(0, 8), '... | store size:', appTokenStore.size);
    res.redirect(`/auth/app-redirect?token=${encodeURIComponent(token)}`);
  });
});

// Прямая авторизация из мобильного приложения по Google ID token (без браузерного редиректа и deep-link)
router.post('/google/mobile-signin', async (req, res) => {
  try {
    const idToken = String(req.body.idToken || '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'idToken is required' });
    }

    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
      console.warn('[Auth] /auth/google/mobile-signin: GOOGLE_CLIENT_ID is not configured');
      return res.status(500).json({ error: 'Google OAuth is not configured' });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      console.warn('[Auth] /auth/google/mobile-signin: empty payload from Google');
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const profile = {
      id: payload.sub,
      displayName: payload.name || '',
      emails: payload.email ? [{ value: payload.email }] : [],
      photos: payload.picture ? [{ value: payload.picture }] : [],
    };

    const user = await findOrCreateFromGoogle(profile);

    const token = generateAppToken();
    appTokenStore.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    await persistAppTokens();

    console.log(
      '[Auth] /auth/google/mobile-signin success for user',
      user.id,
      '| token prefix:',
      token.slice(0, 8),
      '... | store size:',
      appTokenStore.size
    );

    const nameFromDb =
      user.name ||
      user.full_name ||
      user.firstName ||
      user.first_name ||
      payload.name ||
      '';

    return res.json({
      token,
      user: {
        id: String(user.id),
        email: user.email || payload.email || '',
        name: nameFromDb || (payload.email ? payload.email.split('@')[0] : 'User'),
        picture: user.google_avatar || user.picture || payload.picture || null,
      },
    });
  } catch (err) {
    console.error('[Auth] /auth/google/mobile-signin error:', err.message);
    return res.status(500).json({ error: 'Google sign-in failed' });
  }
});

// После OAuth — редирект в приложение: komek:// для нативных или URL для веба (APP_REDIRECT_WEB_URL)
router.get('/app-redirect', (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) {
    console.warn('[Auth] /auth/app-redirect without token, redirecting with error');
    return res.redirect(`${FRONTEND_URL}/?error=missing_token`);
  }
  const ua = req.headers['user-agent'] || '';
  const isYandex =
    typeof ua === 'string' &&
    /YaBrowser|YaSearchBrowser|YaApp_Android|YandexSearch/i.test(ua);

  // Специальный кейс для Яндекс-браузера/поиска на Android:
  // некоторые версии блокируют прямые схемы komek://,
  // но поддерживают intent:// с указанием package.
  if (isYandex) {
    const intentUrl = `intent://login?token=${encodeURIComponent(
      token
    )}#Intent;scheme=${APP_REDIRECT_SCHEME};package=com.komek.app;end;`;
    console.log(
      '[Auth] /auth/app-redirect → intent for Yandex | token prefix:',
      token.slice(0, 8),
      '... | intentUrl=',
      intentUrl
    );
    return res.redirect(intentUrl);
  }

  const webUrl = process.env.APP_REDIRECT_WEB_URL || '';
  if (webUrl) {
    const base = webUrl.replace(/\/$/, '');
    console.log('[Auth] /auth/app-redirect → web | token prefix:', token.slice(0, 8), '... | redirectTo=', `${base}/#/login?token=...`);
    return res.redirect(`${base}/#/login?token=${encodeURIComponent(token)}`);
  }
  const appUrl = `${APP_REDIRECT_SCHEME}://login?token=${encodeURIComponent(token)}`;
  console.log('[Auth] /auth/app-redirect → app | scheme=', APP_REDIRECT_SCHEME, '| token prefix:', token.slice(0, 8), '... | redirectTo=', appUrl);
  res.redirect(appUrl);
});

// Выход (токен остаётся валидным до истечения — клиент удаляет его локально)
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// Middleware: установить req.user из Bearer-токена (для приложения Flutter)
export function setUserFromToken(req, res, next) {
  if (req.user) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[Auth] setUserFromToken: no Bearer header for', req.method, req.originalUrl, '| ua=', req.headers['user-agent']);
    return next();
  }
  const token = authHeader.slice(7);
  const entry = appTokenStore.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    console.warn(
      '[Auth] setUserFromToken: invalid or expired token for',
      req.method,
      req.originalUrl,
      '| inStore=',
      !!entry,
      '| expired=',
      entry ? Date.now() > entry.expiresAt : 'n/a',
      '| ua=',
      req.headers['user-agent']
    );
    return next();
  }
  findById(entry.userId)
    .then((user) => {
      req.user = user;
      console.log(
        '[Auth] setUserFromToken: req.user set for',
        req.method,
        req.originalUrl,
        '| userId=',
        user && user.id ? String(user.id) : 'unknown'
      );
      next();
    })
    .catch((err) => {
      console.error('[Auth] findById error:', err.message);
      next();
    });
}

// Текущий пользователь (для SPA или приложения: сессия или Bearer-токен)
router.get('/me', (req, res) => {
  const user = req.user;
  if (user) {
    // PostgreSQL возвращает snake_case, поэтому используем правильные имена
    // Пробуем разные варианты колонок
    const name = user.name || user.full_name || user.firstName || user.first_name || '';
    const firstName = user.firstName || user.first_name || '';
    const lastName = user.lastName || user.last_name || '';
    const createdAt = user.createdAt || user.created_at || null;
    
    // Если name не заполнено, пробуем собрать из firstName и lastName
    const finalName = name || [firstName, lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    
    // Формируем URL для аватара: приоритет загруженному, если нет - Google аватар
    let avatarUrl = null;
    if (user.avatar) {
      // Загруженный аватар
      if (user.avatar.startsWith('http')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = `/uploads/avatars/${user.avatar.split('/').pop()}`;
      }
    } else if (user.google_avatar) {
      // Google аватар как fallback
      avatarUrl = user.google_avatar;
    } else if (user.picture) {
      // Старый picture для обратной совместимости
      avatarUrl = user.picture;
    }
    
    console.log('[Auth] /auth/me success for user', String(user.id));
    return res.json({
      user: {
        id: String(user.id),
        email: user.email || '',
        phone: user.phone || '',
        name: finalName,
        picture: avatarUrl,
        avatar: avatarUrl,
        createdAt,
      },
    });
  }
  console.warn(
    '[Auth] /auth/me unauthorized | authHeader=',
    req.headers.authorization || '',
    '| ua=',
    req.headers['user-agent']
  );
  res.status(401).json({ user: null });
});

export default router;
