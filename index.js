import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import passport from 'passport';
import dotenv from 'dotenv';
import { configurePassport } from './src/config/passport.js';
import authRoutes, { setUserFromToken, loadAppTokens } from './src/routes/auth.js';
import profileRoutes from './src/routes/profile.js';
import ordersRoutes from './src/routes/orders.js';
import adminRoutes from './src/routes/admin.js';
import { SPECIALTIES } from './src/constants/specialties.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env.example как fallback если нет GOOGLE_CLIENT_ID
if (!process.env.GOOGLE_CLIENT_ID) {
  dotenv.config({ path: path.join(__dirname, '.env.example') });
}

const app = express();
const PORT = process.env.PORT || 3000;


const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const corsOrigin = (origin, cb) => {
  if (!origin) return cb(null, true); // запросы без Origin (нативное приложение, Postman)
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, origin);
  cb(null, false);
};
app.use(
  cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Парсинг JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Настройка сессий
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'kamila1234567890',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 часа
    },
  })
);

// Инициализация Passport
app.use(passport.initialize());
app.use(passport.session());

// Настройка Passport стратегий
configurePassport();

// Для Flutter: установить req.user из Bearer-токена, если передан
app.use(setUserFromToken);

// Лог редиректов: статус 301/302/307/308 и заголовок Location
app.use((req, res, next) => {
  res.on('finish', () => {
    const status = res.statusCode;
    const location = res.get('Location');
    if ((status === 301 || status === 302 || status === 307 || status === 308) && location) {
      console.log(`[Redirect] ${status} ${req.method} ${req.originalUrl} -> ${location}`);
    }
  });
  next();
});

// Роуты
app.use('/auth', authRoutes);
app.use('/profile', profileRoutes);
app.use('/orders', ordersRoutes);
app.use('/admin', adminRoutes);

// Список специальностей (публичный, единый источник с backend)
app.get('/specialties', (req, res) => {
  res.json({ specialties: SPECIALTIES });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  });
});

loadAppTokens().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on ${process.env.BACKEND_URL}`);
  });
}); 
