export function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Требуется авторизация' });
}

// Админ-доступ: либо сессия, либо Authorization: Basic <login:password>
export function requireAdmin(req, res, next) {
  // Вариант 1: сессия (если работает кука)
  if (req.session && req.session.isAdmin) {
    return next();
  }

  // Вариант 2: заголовок Authorization (Basic), чтобы обойти проблемы с third-party cookies
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6).trim();
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      const [login, password] = decoded.split(':', 2);
      // Те же дефолты, что и в POST /admin/login — иначе с другого origin Basic не пройдёт
      const ADMIN_LOGIN = (process.env.ADMIN_LOGIN || 'komek-2026').trim();
      const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'Saken-Madik2002').trim();
      if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
        return next();
      }
    } catch (e) {
      // игнорируем и падаем в 401 ниже
    }
  }

  res.status(401).json({ error: 'Требуется админ-доступ' });
}
