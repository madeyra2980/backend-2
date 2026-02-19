import { Router } from 'express';
import { query } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { filterAllowedSpecialtyIds } from '../constants/specialties.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Настройка multer для загрузки файлов
const documentsDir = path.join(__dirname, '../../uploads/documents');
const avatarsDir = path.join(__dirname, '../../uploads/avatars');
// Создаем директории если их нет
fs.mkdir(documentsDir, { recursive: true }).catch(console.error);
fs.mkdir(avatarsDir, { recursive: true }).catch(console.error);

// Storage для документов
const documentStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(documentsDir, { recursive: true });
    cb(null, documentsDir);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя файла: userId_timestamp.extension
    const userId = req.user.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${userId}_${timestamp}${ext}`);
  },
});

// Storage для аватаров
const avatarStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await fs.mkdir(avatarsDir, { recursive: true });
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    // Генерируем уникальное имя файла: userId_avatar_timestamp.extension
    const userId = req.user.id;
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${userId}_avatar_${timestamp}${ext}`);
  },
});

// Фильтр для изображений
const imageFilter = (req, file, cb) => {
  // Разрешаем только изображения
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Разрешены только изображения (jpeg, jpg, png, gif, webp)'));
};

const uploadDocument = multer({
  storage: documentStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: imageFilter,
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB для аватара
  },
  fileFilter: imageFilter,
});

// Нормализовать строку из users в единый формат (для SELECT * fallback)
function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName ?? row.first_name ?? '',
    lastName: row.lastName ?? row.last_name ?? '',
    phone: row.phone ?? null,
    document_photo: row.document_photo ?? null,
    avatar: row.avatar ?? null,
    google_avatar: row.google_avatar ?? null,
    rating: row.rating ?? 0,
    account_id: row.account_id ?? null,
    isSpecialist: !!row.is_specialist,
    specialistBio: row.specialist_bio ?? null,
    specialistSince: row.specialist_since ?? null,
    specialistSpecialties: Array.isArray(row.specialist_specialties) ? row.specialist_specialties : [],
    specialistCity: row.specialist_city ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  };
}

// Получить профиль текущего пользователя
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let result;
    try {
      result = await query(
        `SELECT
          id, email, "firstName", "lastName", phone, document_photo, avatar, google_avatar,
          rating, account_id, is_specialist as "isSpecialist", specialist_bio as "specialistBio",
          specialist_since as "specialistSince", specialist_specialties as "specialistSpecialties",
          specialist_city as "specialistCity", city,
          "createdAt", "updatedAt"
        FROM users WHERE id = $1`,
        [userId]
      );
    } catch (err) {
      const isColumnError = (e) =>
        (e && (e.code === '42703' || (String(e.message || e).includes('column') && String(e.message || e).includes('does not exist'))));
      if (isColumnError(err)) {
        try {
          result = await query('SELECT * FROM users WHERE id = $1', [userId]);
          if (result.rows[0]) result.rows[0] = normalizeProfileRow(result.rows[0]);
        } catch (fallbackErr) {
          console.error('Profile fallback query failed:', fallbackErr.message);
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (!result || result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    
    // Формируем полное имя
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    
    // Формируем URL для document_photo если это локальный файл
    let documentPhotoUrl = null;
    if (user.document_photo) {
      if (user.document_photo.startsWith('http')) {
        documentPhotoUrl = user.document_photo;
      } else {
        // Локальный файл - возвращаем относительный путь для API
        documentPhotoUrl = `/uploads/documents/${path.basename(user.document_photo)}`;
      }
    }

    // Формируем URL для аватара: приоритет загруженному, если нет - Google аватар
    let avatarUrl = null;
    if (user.avatar) {
      // Загруженный аватар
      if (user.avatar.startsWith('http')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = `/uploads/avatars/${path.basename(user.avatar)}`;
      }
    } else if (user.google_avatar) {
      // Google аватар как fallback
      avatarUrl = user.google_avatar;
    }

    res.json({
      user: {
        id: String(user.id),
        email: user.email || '',
        name: fullName,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        documentPhoto: documentPhotoUrl,
        avatar: avatarUrl,
        rating: user.rating ? parseFloat(user.rating) : 0.0,
        accountId: user.account_id,
        isSpecialist: !!user.isSpecialist,
        specialistBio: user.specialistBio || null,
        specialistSince: user.specialistSince || null,
        specialistSpecialties: Array.isArray(user.specialistSpecialties) ? user.specialistSpecialties : [],
        specialistCity: user.specialistCity || null,
        city: user.city || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Ошибка при получении профиля' });
  }
});

// Обновить ФИО, телефон и город
router.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { firstName, lastName, phone, city } = req.body;

    // Валидация
    if (firstName !== undefined && (!firstName || firstName.trim().length === 0)) {
      return res.status(400).json({ error: 'Имя не может быть пустым' });
    }

    // Формируем запрос обновления
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (firstName !== undefined) {
      updates.push(`"firstName" = $${paramIndex++}`);
      values.push(firstName.trim());
    }

    if (lastName !== undefined) {
      updates.push(`"lastName" = $${paramIndex++}`);
      values.push(lastName ? lastName.trim() : '');
    }

    if (phone !== undefined) {
      // Простая валидация телефона (можно улучшить)
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      if (phone && !phoneRegex.test(phone)) {
        return res.status(400).json({ error: 'Неверный формат номера телефона' });
      }
      updates.push(`phone = $${paramIndex++}`);
      values.push(phone ? phone.trim() : null);
    }

    if (city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(city ? String(city).trim() : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    // Добавляем updatedAt
    updates.push(`"updatedAt" = NOW()`);
    values.push(userId);

    let queryText = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING 
        id, 
        email, 
        "firstName", 
        "lastName", 
        phone,
        document_photo,
        avatar,
        google_avatar,
        rating,
        account_id,
        is_specialist as "isSpecialist",
        specialist_bio as "specialistBio",
        specialist_since as "specialistSince",
        city,
        "createdAt",
        "updatedAt"
    `;

    let result;
    try {
      result = await query(queryText, values);
    } catch (err) {
      // Если camelCase не работает, пробуем snake_case
      if (err.message.includes('column') && err.message.includes('does not exist')) {
        // Пересоздаем запрос с snake_case
        const snakeUpdates = [];
        const snakeValues = [];
        let snakeIndex = 1;

        if (firstName !== undefined) {
          snakeUpdates.push(`first_name = $${snakeIndex++}`);
          snakeValues.push(firstName.trim());
        }
        if (lastName !== undefined) {
          snakeUpdates.push(`last_name = $${snakeIndex++}`);
          snakeValues.push(lastName ? lastName.trim() : '');
        }
        if (phone !== undefined) {
          snakeUpdates.push(`phone = $${snakeIndex++}`);
          snakeValues.push(phone ? phone.trim() : null);
        }
        if (city !== undefined) {
          snakeUpdates.push(`city = $${snakeIndex++}`);
          snakeValues.push(city ? String(city).trim() : null);
        }
        snakeUpdates.push(`updated_at = NOW()`);
        snakeValues.push(userId);

        queryText = `
          UPDATE users 
          SET ${snakeUpdates.join(', ')}
          WHERE id = $${snakeIndex}
          RETURNING 
            id, 
            email, 
            first_name as "firstName", 
            last_name as "lastName", 
            phone,
            document_photo,
            avatar,
            google_avatar,
            rating,
            account_id,
            is_specialist as "isSpecialist",
            specialist_bio as "specialistBio",
            specialist_since as "specialistSince",
            city,
            created_at as "createdAt",
            updated_at as "updatedAt"
        `;
        result = await query(queryText, snakeValues);
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    
    let documentPhotoUrl = null;
    if (user.document_photo) {
      if (user.document_photo.startsWith('http')) {
        documentPhotoUrl = user.document_photo;
      } else {
        documentPhotoUrl = `/uploads/documents/${path.basename(user.document_photo)}`;
      }
    }
    
    // Формируем URL для аватара
    let avatarUrl = null;
    if (user.avatar) {
      if (user.avatar.startsWith('http')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = `/uploads/avatars/${path.basename(user.avatar)}`;
      }
    } else if (user.google_avatar) {
      avatarUrl = user.google_avatar;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        documentPhoto: documentPhotoUrl,
        avatar: avatarUrl,
        rating: user.rating ? parseFloat(user.rating) : 0.0,
        accountId: user.account_id,
        isSpecialist: !!user.isSpecialist,
        specialistBio: user.specialistBio || null,
        specialistSince: user.specialistSince || null,
        city: user.city || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Ошибка при обновлении профиля' });
  }
});

// Включить/обновить роль специалиста (стать специалистом)
router.patch('/me/specialist', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { isSpecialist, specialistBio, specialistSpecialties, specialistCity } = req.body;

    if (typeof isSpecialist !== 'boolean') {
      return res.status(400).json({ error: 'Укажите isSpecialist (true/false)' });
    }

    const rawSpec = Array.isArray(specialistSpecialties) ? specialistSpecialties : [];
    const allowedSpec = filterAllowedSpecialtyIds(rawSpec);
    const city = specialistCity !== undefined ? (specialistCity === null || specialistCity === '' ? null : String(specialistCity).trim()) : undefined;

    let result;
    try {
      result = await query(
        `UPDATE users 
         SET is_specialist = $1, 
             specialist_bio = COALESCE($2, specialist_bio),
             specialist_since = CASE WHEN $1 = true AND specialist_since IS NULL THEN NOW() ELSE specialist_since END,
             specialist_specialties = $3,
             specialist_city = CASE WHEN $5::boolean THEN $4 ELSE specialist_city END,
             "updatedAt" = NOW()
         WHERE id = $6
         RETURNING 
           id, email, "firstName", "lastName", phone, document_photo, avatar, google_avatar,
           rating, account_id, is_specialist as "isSpecialist", specialist_bio as "specialistBio", specialist_since as "specialistSince", specialist_specialties as "specialistSpecialties", specialist_city as "specialistCity",
           "createdAt", "updatedAt"`,
        [isSpecialist, specialistBio === undefined ? null : String(specialistBio || ''), allowedSpec, city ?? null, city !== undefined, userId]
      );
    } catch (err) {
      if (err.message.includes('column') && err.message.includes('does not exist')) {
        result = await query(
          `UPDATE users 
           SET is_specialist = $1, 
               specialist_bio = COALESCE($2, specialist_bio),
               specialist_since = CASE WHEN $1 = true AND specialist_since IS NULL THEN NOW() ELSE specialist_since END,
               specialist_specialties = $3,
               specialist_city = CASE WHEN $5::boolean THEN $4 ELSE specialist_city END,
               updated_at = NOW()
           WHERE id = $6
           RETURNING 
             id, email, first_name as "firstName", last_name as "lastName", phone, document_photo, avatar, google_avatar,
             rating, account_id, is_specialist as "isSpecialist", specialist_bio as "specialistBio", specialist_since as "specialistSince", specialist_specialties as "specialistSpecialties", specialist_city as "specialistCity",
             created_at as "createdAt", updated_at as "updatedAt"`,
          [isSpecialist, specialistBio === undefined ? null : String(specialistBio || ''), allowedSpec, city ?? null, city !== undefined, userId]
        );
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    let documentPhotoUrl = null;
    if (user.document_photo) {
      documentPhotoUrl = user.document_photo.startsWith('http') ? user.document_photo : `/uploads/documents/${path.basename(user.document_photo)}`;
    }
    let avatarUrl = null;
    if (user.avatar) {
      avatarUrl = user.avatar.startsWith('http') ? user.avatar : `/uploads/avatars/${path.basename(user.avatar)}`;
    } else if (user.google_avatar) {
      avatarUrl = user.google_avatar;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        documentPhoto: documentPhotoUrl,
        avatar: avatarUrl,
        rating: user.rating ? parseFloat(user.rating) : 0.0,
        accountId: user.account_id,
        isSpecialist: !!user.isSpecialist,
        specialistBio: user.specialistBio || null,
        specialistSince: user.specialistSince || null,
        specialistSpecialties: Array.isArray(user.specialistSpecialties) ? user.specialistSpecialties : [],
        specialistCity: user.specialistCity || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: isSpecialist ? 'Вы зарегистрированы как специалист' : 'Режим специалиста отключён',
    });
  } catch (error) {
    console.error('Error updating specialist status:', error);
    res.status(500).json({ error: 'Ошибка при обновлении статуса специалиста' });
  }
});

// Загрузить аватар
router.post('/me/avatar', requireAuth, uploadAvatar.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileName = req.file.filename;

    // Удаляем старый аватар, если он существует
    try {
      const oldUser = await query('SELECT avatar FROM users WHERE id = $1', [userId]);
      if (oldUser.rows[0]?.avatar && !oldUser.rows[0].avatar.startsWith('http')) {
        const oldAvatarPath = path.join(avatarsDir, path.basename(oldUser.rows[0].avatar));
        await fs.unlink(oldAvatarPath).catch(console.error);
      }
    } catch (err) {
      console.error('Error deleting old avatar:', err);
    }

    // Сохраняем путь к файлу в базе данных
    let result;
    try {
      result = await query(
        `UPDATE users 
         SET avatar = $1, "updatedAt" = NOW()
         WHERE id = $2
         RETURNING 
           id, 
           email, 
           "firstName", 
           "lastName", 
           phone,
           document_photo,
           avatar,
           google_avatar,
           rating,
           account_id,
           "createdAt",
           "updatedAt"`,
        [filePath, userId]
      );
    } catch (err) {
      // Если camelCase не работает, пробуем snake_case
      if (err.message.includes('column') && err.message.includes('does not exist')) {
        result = await query(
          `UPDATE users 
           SET avatar = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING 
             id, 
             email, 
             first_name as "firstName", 
             last_name as "lastName", 
             phone,
             document_photo,
             avatar,
             google_avatar,
             rating,
             account_id,
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [filePath, userId]
        );
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      // Удаляем загруженный файл если пользователь не найден
      await fs.unlink(filePath).catch(console.error);
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    
    const avatarUrl = `/uploads/avatars/${fileName}`;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        documentPhoto: user.document_photo ? `/uploads/documents/${path.basename(user.document_photo)}` : null,
        avatar: avatarUrl,
        rating: user.rating ? parseFloat(user.rating) : 0.0,
        accountId: user.account_id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: 'Аватар успешно загружен',
    });
  } catch (error) {
    console.error('Error uploading avatar:', error);
    // Удаляем файл при ошибке
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    res.status(500).json({ error: 'Ошибка при загрузке аватара' });
  }
});

// Загрузить фото удостоверения личности
router.post('/me/document-photo', requireAuth, uploadDocument.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Файл не был загружен' });
    }

    const userId = req.user.id;
    const filePath = req.file.path;
    const fileName = req.file.filename;

    // Сохраняем путь к файлу в базе данных
    let result;
    try {
      result = await query(
        `UPDATE users 
         SET document_photo = $1, "updatedAt" = NOW()
         WHERE id = $2
         RETURNING 
           id, 
           email, 
           "firstName", 
           "lastName", 
           phone,
           document_photo,
           rating,
           account_id,
           "createdAt",
           "updatedAt"`,
        [filePath, userId]
      );
    } catch (err) {
      // Если camelCase не работает, пробуем snake_case
      if (err.message.includes('column') && err.message.includes('does not exist')) {
        result = await query(
          `UPDATE users 
           SET document_photo = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING 
             id, 
             email, 
             first_name as "firstName", 
             last_name as "lastName", 
             phone,
             document_photo,
             avatar,
             google_avatar,
             rating,
             account_id,
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [filePath, userId]
        );
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      // Удаляем загруженный файл если пользователь не найден
      await fs.unlink(filePath).catch(console.error);
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const user = result.rows[0];
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email?.split('@')[0] || 'User';
    
    const documentPhotoUrl = `/uploads/documents/${fileName}`;
    
    // Формируем URL для аватара
    let avatarUrl = null;
    if (user.avatar) {
      if (user.avatar.startsWith('http')) {
        avatarUrl = user.avatar;
      } else {
        avatarUrl = `/uploads/avatars/${path.basename(user.avatar)}`;
      }
    } else if (user.google_avatar) {
      avatarUrl = user.google_avatar;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName,
        phone: user.phone,
        documentPhoto: documentPhotoUrl,
        avatar: avatarUrl,
        rating: user.rating ? parseFloat(user.rating) : 0.0,
        accountId: user.account_id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      message: 'Фото удостоверения успешно загружено',
    });
  } catch (error) {
    console.error('Error uploading document photo:', error);
    // Удаляем файл при ошибке
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    res.status(500).json({ error: 'Ошибка при загрузке фото' });
  }
});

// Определить город по координатам через Nominatim (OpenStreetMap)
async function detectCityByCoords(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ru`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'KomekApp/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address || {};
    // Nominatim возвращает city / town / village / county
    return addr.city || addr.town || addr.village || addr.county || null;
  } catch (_) {
    return null;
  }
}

// Обновить местоположение пользователя (автоматически определяет город)
router.put('/location', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    // Валидация
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Широта и долгота обязательны' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Неверный формат координат' });
    }

    if (lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Широта должна быть от -90 до 90' });
    }

    if (lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Долгота должна быть от -180 до 180' });
    }

    // Определяем город по координатам (фоновый запрос, не блокирует ответ при ошибке)
    const detectedCity = await detectCityByCoords(lat, lng);

    // Обновляем местоположение (и city если удалось определить)
    let result;
    try {
      if (detectedCity) {
        result = await query(
          `UPDATE users
           SET latitude = $1, longitude = $2, location_updated_at = NOW(), city = $4, "updatedAt" = NOW()
           WHERE id = $3
           RETURNING id, latitude, longitude, location_updated_at as "locationUpdatedAt", city`,
          [lat, lng, userId, detectedCity]
        );
      } else {
        result = await query(
          `UPDATE users
           SET latitude = $1, longitude = $2, location_updated_at = NOW(), "updatedAt" = NOW()
           WHERE id = $3
           RETURNING id, latitude, longitude, location_updated_at as "locationUpdatedAt", city`,
          [lat, lng, userId]
        );
      }
    } catch (err) {
      // Если camelCase не работает, пробуем snake_case
      if (err.message.includes('column') && err.message.includes('does not exist')) {
        if (detectedCity) {
          result = await query(
            `UPDATE users
             SET latitude = $1, longitude = $2, location_updated_at = NOW(), city = $4, updated_at = NOW()
             WHERE id = $3
             RETURNING id, latitude, longitude, location_updated_at as "locationUpdatedAt", city`,
            [lat, lng, userId, detectedCity]
          );
        } else {
          result = await query(
            `UPDATE users
             SET latitude = $1, longitude = $2, location_updated_at = NOW(), updated_at = NOW()
             WHERE id = $3
             RETURNING id, latitude, longitude, location_updated_at as "locationUpdatedAt", city`,
            [lat, lng, userId]
          );
        }
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    res.json({
      location: {
        latitude: parseFloat(result.rows[0].latitude),
        longitude: parseFloat(result.rows[0].longitude),
        updatedAt: result.rows[0].locationUpdatedAt,
      },
      city: result.rows[0].city ?? null,
      message: 'Местоположение успешно обновлено',
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Ошибка при обновлении местоположения' });
  }
});

// Получить местоположения других пользователей
router.get('/locations', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { radius = 10, limit = 50 } = req.query; // radius в километрах, limit - максимум пользователей

    // Получаем местоположение текущего пользователя
    let userLocation;
    try {
      const userResult = await query(
        `SELECT latitude, longitude FROM users WHERE id = $1 AND latitude IS NOT NULL AND longitude IS NOT NULL`,
        [userId]
      );
      userLocation = userResult.rows[0];
    } catch (err) {
      console.error('Error fetching user location:', err);
    }

    let result;
    if (userLocation) {
      try {
        const radiusKm = parseFloat(radius);
        const limitNum = parseInt(limit, 10);
        result = await query(
          `SELECT 
            id, email, "firstName", "lastName", latitude, longitude,
            location_updated_at as "locationUpdatedAt", rating, account_id as "accountId"
          FROM users 
          WHERE id != $1 AND latitude IS NOT NULL AND longitude IS NOT NULL
            AND location_updated_at IS NOT NULL AND location_updated_at > NOW() - INTERVAL '1 hour'
            AND (6371 * acos(cos(radians($2)) * cos(radians(latitude)) * cos(radians(longitude) - radians($3)) + sin(radians($2)) * sin(radians(latitude)))) <= $4
          ORDER BY location_updated_at DESC LIMIT $5`,
          [userId, userLocation.latitude, userLocation.longitude, radiusKm, limitNum]
        );
      } catch (err) {
        if (err.code === '42703' || (err.message && String(err.message).includes('does not exist'))) {
          result = { rows: [] };
        } else {
          throw err;
        }
      }
    } else {
      // Если у пользователя нет местоположения, возвращаем всех активных пользователей
      const limitNum = parseInt(limit, 10);
      try {
        result = await query(
          `SELECT 
            id,
            email,
            "firstName",
            "lastName",
            latitude,
            longitude,
            location_updated_at as "locationUpdatedAt",
            rating,
            account_id as "accountId"
          FROM users 
          WHERE id != $1 
            AND latitude IS NOT NULL 
            AND longitude IS NOT NULL
            AND location_updated_at IS NOT NULL
            AND location_updated_at > NOW() - INTERVAL '1 hour'
          ORDER BY location_updated_at DESC
          LIMIT $2`,
          [userId, limitNum]
        );
      } catch (err) {
        // Колонки локации или имён могут отсутствовать — отдаём пустой список без 500
        if (err.code === '42703' || (err.message && String(err.message).includes('does not exist'))) {
          result = { rows: [] };
        } else {
          throw err;
        }
      }
    }

    const locations = (result && result.rows ? result.rows : []).map((row) => ({
      userId: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: [row.firstName, row.lastName].filter(Boolean).join(' ') || row.email?.split('@')[0] || 'User',
      position: [parseFloat(row.latitude), parseFloat(row.longitude)],
      rating: row.rating ? parseFloat(row.rating) : 0.0,
      accountId: row.accountId,
      updatedAt: row.locationUpdatedAt,
    }));

    res.json({
      locations,
      count: locations.length,
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Ошибка при получении местоположений' });
  }
});

// Список специалистов с рейтингом (для раздела «Специалисты»).
// Поиск по городу: ?city=... или автоматически по городу текущего пользователя.
// Передать ?city=all чтобы получить всех специалистов без фильтра по городу.
router.get('/specialists', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    let city = typeof req.query.city === 'string' ? req.query.city.trim() : null;
    const showAll = city === 'all';

    // Если город не передан явно — берём город текущего пользователя
    if (!city && !showAll) {
      try {
        const userRow = await query(
          `SELECT city FROM users WHERE id = $1`,
          [userId]
        );
        const userCity = userRow.rows[0]?.city ?? null;
        if (userCity && userCity.trim().length > 0) {
          city = userCity.trim();
        }
      } catch (_) {
        // если колонки city ещё нет — игнорируем
      }
    }

    const hasCityFilter = !showAll && city && city.length > 0;
    let result;
    try {
      if (hasCityFilter) {
        result = await query(
          `SELECT
            id, "firstName", "lastName", phone,
            rating, specialist_bio as "specialistBio", specialist_specialties as "specialistSpecialties",
            specialist_since as "specialistSince", specialist_city as "specialistCity",
            avatar, google_avatar as "googleAvatar"
           FROM users
           WHERE is_specialist = true AND (specialist_city IS NOT NULL AND LOWER(TRIM(specialist_city)) = LOWER($1))
           ORDER BY rating DESC NULLS LAST, "firstName", "lastName"`,
          [city]
        );
      } else {
        result = await query(
          `SELECT
            id, "firstName", "lastName", phone,
            rating, specialist_bio as "specialistBio", specialist_specialties as "specialistSpecialties",
            specialist_since as "specialistSince", specialist_city as "specialistCity",
            avatar, google_avatar as "googleAvatar"
           FROM users
           WHERE is_specialist = true
           ORDER BY rating DESC NULLS LAST, "firstName", "lastName"`,
          []
        );
      }
    } catch (err) {
      if (err.code === '42703' || (err.message && String(err.message).includes('does not exist'))) {
        result = { rows: [] };
      } else {
        throw err;
      }
    }
    const specialists = (result.rows || []).map((row) => {
      const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || 'Специалист';
      return {
        id: row.id,
        firstName: row.firstName ?? '',
        lastName: row.lastName ?? '',
        fullName,
        phone: row.phone ?? null,
        rating: row.rating != null ? parseFloat(row.rating) : 0,
        specialistBio: row.specialistBio ?? null,
        specialistSpecialties: Array.isArray(row.specialistSpecialties) ? row.specialistSpecialties : [],
        specialistSince: row.specialistSince ?? null,
        specialistCity: row.specialistCity ?? null,
        avatar: row.avatar ?? null,
        googleAvatar: row.googleAvatar ?? null,
      };
    });
    res.json({ specialists, count: specialists.length, filteredByCity: hasCityFilter ? city : null });
  } catch (err) {
    if (err.code === '42703' || (err.message && String(err.message).includes('does not exist'))) {
      return res.json({ specialists: [], count: 0, filteredByCity: null });
    }
    console.error('Error fetching specialists:', err);
    res.status(500).json({ error: 'Ошибка при загрузке списка специалистов' });
  }
});

export default router;
