import crypto from 'crypto';
import { query } from '../db.js';

/**
 * Найти или создать пользователя из Google профиля
 */
export async function findOrCreateFromGoogle(profile) {
  const { id: googleId, emails, displayName, photos } = profile;
  const email = emails && emails[0] ? emails[0].value : null;
  const picture = photos && photos[0] ? photos[0].value : null;

  // Разделяем displayName на firstName и lastName
  let firstName = 'User';
  let lastName = '';
  
  if (displayName) {
    const nameParts = displayName.trim().split(/\s+/);
    firstName = nameParts[0] || 'User';
    lastName = nameParts.slice(1).join(' ') || '';
  } else if (email) {
    firstName = email.split('@')[0];
  }

  // Проверяем, существует ли пользователь с таким Google ID
  // Если колонки google_id нет, этот запрос пропустим
  try {
    const existingUser = await query(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId]
    );

    if (existingUser.rows.length > 0) {
      const user = existingUser.rows[0];
      // Обновляем Google аватар, если его еще нет или он изменился
      if (picture && (!user.google_avatar || user.google_avatar !== picture)) {
        try {
          const updateResult = await query(
            'UPDATE users SET google_avatar = $1, "updatedAt" = NOW() WHERE id = $2 RETURNING *',
            [picture, user.id]
          );
          return updateResult.rows[0];
        } catch (err) {
          // Если updatedAt не работает, пробуем без него
          try {
            const updateResult = await query(
              'UPDATE users SET google_avatar = $1 WHERE id = $2 RETURNING *',
              [picture, user.id]
            );
            return updateResult.rows[0];
          } catch (err2) {
            // Если колонки google_avatar нет, просто возвращаем пользователя
            return user;
          }
        }
      }
      return user;
    }
  } catch (err) {
    // Колонка google_id может отсутствовать, продолжаем проверку по email
    // Игнорируем только ошибки о несуществующих колонках
    const isColumnError = err.message.includes('column') && err.message.includes('does not exist');
    if (!isColumnError) {
      throw err; // Другие ошибки пробрасываем дальше
    }
    // Если это ошибка отсутствующей колонки, просто продолжаем
  }

  // Проверяем, существует ли пользователь с таким email
  if (email) {
    const existingByEmail = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (existingByEmail.rows.length > 0) {
      const user = existingByEmail.rows[0];
      // Обновляем Google ID и аватар для существующего пользователя
      try {
        // Пробуем обновить google_id и google_avatar
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (googleId) {
          updates.push(`google_id = $${paramIndex++}`);
          values.push(googleId);
        }
        
        if (picture && (!user.google_avatar || user.google_avatar !== picture)) {
          updates.push(`google_avatar = $${paramIndex++}`);
          values.push(picture);
        }
        
        if (updates.length > 0) {
          updates.push(`"updatedAt" = NOW()`);
          values.push(email);
          
          const updateResult = await query(
            `UPDATE users SET ${updates.join(', ')} WHERE email = $${paramIndex} RETURNING *`,
            values
          );
          return updateResult.rows[0];
        }
        return user;
      } catch (err) {
        // Если колонки нет, пробуем без updatedAt
        if (err.message.includes('column') && err.message.includes('does not exist')) {
          try {
            const updates = [];
            const values = [];
            let paramIndex = 1;
            
            if (googleId) {
              updates.push(`google_id = $${paramIndex++}`);
              values.push(googleId);
            }
            
            if (picture && (!user.google_avatar || user.google_avatar !== picture)) {
              updates.push(`google_avatar = $${paramIndex++}`);
              values.push(picture);
            }
            
            if (updates.length > 0) {
              values.push(email);
              const updateResult = await query(
                `UPDATE users SET ${updates.join(', ')} WHERE email = $${paramIndex} RETURNING *`,
                values
              );
              return updateResult.rows[0];
            }
            return user;
          } catch (err2) {
            // Если и это не работает, просто возвращаем пользователя
            return user;
          }
        }
        // Если колонки google_id нет, просто возвращаем существующего пользователя
        return user;
      }
    }
  }

  // Создаем нового пользователя
  // Генерируем уникальный UUID для id
  const id = crypto.randomUUID();
  
  // Генерируем уникальный account_id (формат: ACC-XXXXXXXX где X - случайные символы)
  const accountId = `ACC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  
  // Убеждаемся, что firstName не пустой (NOT NULL constraint)
  const finalFirstName = firstName || 'User';
  const finalLastName = lastName || '';

  // Пробуем разные варианты колонок
  // Сначала пробуем camelCase (firstName, lastName, createdAt, updatedAt) - судя по ошибке, это правильный вариант
  // В PostgreSQL имена с кавычками сохраняют регистр
  try {
    // Пробуем с createdAt и updatedAt (camelCase) и account_id, добавляем google_avatar
    const result = await query(
      `INSERT INTO users (id, email, "firstName", "lastName", account_id, google_avatar, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [id, email, finalFirstName, finalLastName, accountId, picture]
    );
    return result.rows[0];
  } catch (err) {
    // Если createdAt/updatedAt не работают, пробуем created_at/updated_at
    if (err.message.includes('column') && err.message.includes('does not exist') && 
        (err.message.includes('createdAt') || err.message.includes('updatedAt'))) {
      try {
        const result = await query(
          `INSERT INTO users (id, email, "firstName", "lastName", account_id, google_avatar, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
           RETURNING *`,
          [id, email, finalFirstName, finalLastName, accountId, picture]
        );
        return result.rows[0];
      } catch (err2) {
        // Если и created_at/updated_at нет, пробуем только updatedAt
        if (err2.message.includes('column') && err2.message.includes('does not exist')) {
          try {
            const result = await query(
              `INSERT INTO users (id, email, "firstName", "lastName", account_id, google_avatar, "updatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, NOW())
               RETURNING *`,
              [id, email, finalFirstName, finalLastName, accountId, picture]
            );
            return result.rows[0];
          } catch (err3) {
            throw err2; // Если и это не работает, пробрасываем ошибку
          }
        }
        throw err2;
      }
    }
    // Если ошибка не про createdAt, пробуем snake_case
    if (err.message.includes('column') && err.message.includes('does not exist')) {
      try {
        const result = await query(
          `INSERT INTO users (id, email, first_name, last_name, account_id, google_avatar, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING *`,
          [id, email, finalFirstName, finalLastName, accountId, picture]
        );
        return result.rows[0];
      } catch (err2) {
        // Если и это не работает, пробуем только name
        if (err2.message.includes('column') && err2.message.includes('does not exist')) {
          try {
            const name = [finalFirstName, finalLastName].filter(Boolean).join(' ') || finalFirstName;
            const result = await query(
              `INSERT INTO users (id, email, name, account_id, google_avatar, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               RETURNING *`,
              [id, email, name, accountId, picture]
            );
            return result.rows[0];
          } catch (err3) {
            // Последний вариант - только id, email, account_id и google_avatar
            try {
              const result = await query(
                `INSERT INTO users (id, email, account_id, google_avatar)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [id, email, accountId, picture]
              );
              return result.rows[0];
            } catch (err4) {
              // Если и google_avatar нет, пробуем без него
              const result = await query(
                `INSERT INTO users (id, email, account_id)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [id, email, accountId]
              );
              return result.rows[0];
            }
          }
        }
        throw err2;
      }
    }
    throw err;
  }
}

/**
 * Найти пользователя по ID
 */
export async function findById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Найти пользователя по email
 */
export async function findByEmail(email) {
  if (!email || !String(email).trim()) return null;
  const result = await query('SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Найти пользователя по номеру телефона (для входа специалистов).
 * Сравниваем с нормализацией пробелов: +7 700 123 45 67 и 87001234567 находят одну запись.
 */
export async function findByPhone(phone) {
  if (!phone || !String(phone).trim()) return null;
  const normalized = String(phone).trim().replace(/\s+/g, '');
  const result = await query(
    `SELECT * FROM users WHERE phone = $1 OR REPLACE(COALESCE(phone, ''), ' ', '') = $2 LIMIT 1`,
    [String(phone).trim(), normalized]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Создать пользователя по email и паролю (для регистрации). email_verified = false, выдаётся verification_token.
 */
export async function createUserByEmail({ email, passwordHash, firstName, lastName, verificationToken, verificationTokenExpires }) {
  const id = crypto.randomUUID();
  const accountId = `ACC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const em = String(email).trim().toLowerCase();
  const fn = String(firstName || '').trim() || em.split('@')[0] || 'User';
  const ln = String(lastName || '').trim();

  try {
    const result = await query(
      `INSERT INTO users (id, email, "firstName", "lastName", account_id, password_hash, email_verified, verification_token, verification_token_expires, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, NOW(), NOW())
       RETURNING *`,
      [id, em, fn, ln, accountId, passwordHash, verificationToken, verificationTokenExpires]
    );
    return result.rows[0];
  } catch (err) {
    if (err.message.includes('column') && err.message.includes('does not exist')) {
      const result = await query(
        `INSERT INTO users (id, email, first_name, last_name, account_id, password_hash, email_verified, verification_token, verification_token_expires, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, NOW(), NOW())
         RETURNING *`,
        [id, em, fn, ln, accountId, passwordHash, verificationToken, verificationTokenExpires]
      );
      return result.rows[0];
    }
    throw err;
  }
}

/**
 * Подтвердить почту по токену верификации. Возвращает пользователя или null.
 */
export async function setVerifiedByToken(token) {
  if (!token || !String(token).trim()) return null;
  const t = String(token).trim();
  try {
    const result = await query(
      `UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL, "updatedAt" = NOW()
       WHERE verification_token = $1 AND verification_token_expires > NOW()
       RETURNING *`,
      [t]
    );
    if (result.rows.length > 0) return result.rows[0];
  } catch (_) {}
  try {
    const r2 = await query(
      `UPDATE users SET email_verified = true, verification_token = NULL, verification_token_expires = NULL, updated_at = NOW()
       WHERE verification_token = $1 AND verification_token_expires > NOW()
       RETURNING *`,
      [t]
    );
    return r2.rows[0] || null;
  } catch (_) {
    return null;
  }
}

/**
 * Найти пользователя по токену верификации (без обновления)
 */
export async function findByVerificationToken(token) {
  if (!token || !String(token).trim()) return null;
  const result = await query(
    'SELECT * FROM users WHERE verification_token = $1 AND verification_token_expires > NOW()',
    [String(token).trim()]
  );
  return result.rows.length > 0 ? result.rows[0] : null;
}
