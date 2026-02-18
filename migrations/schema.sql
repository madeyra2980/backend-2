-- =============================================================================
-- Единая схема БД (все миграции в одном файле)
-- Выполнять на пустой БД или при первом развёртывании
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 000: Базовая таблица users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE,
  "firstName" VARCHAR(255) NOT NULL DEFAULT 'User',
  "lastName" VARCHAR(255) DEFAULT '',
  account_id VARCHAR(255),
  google_id VARCHAR(255) UNIQUE,
  google_avatar TEXT,
  "createdAt" TIMESTAMP DEFAULT NOW(),
  "updatedAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

COMMENT ON TABLE users IS 'Пользователи (заказчики и специалисты)';

-- -----------------------------------------------------------------------------
-- 001: Поля профиля пользователя
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS document_photo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating DECIMAL(3,2) DEFAULT 0.0 CHECK (rating >= 0 AND rating <= 5.0);
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

COMMENT ON COLUMN users.phone IS 'Номер телефона клиента';
COMMENT ON COLUMN users.document_photo IS 'URL или путь к фото удостоверения личности';
COMMENT ON COLUMN users.rating IS 'Рейтинг пользователя от 0.0 до 5.0';
COMMENT ON COLUMN users.account_id IS 'ID аккаунта для платежей и мониторинга';

-- -----------------------------------------------------------------------------
-- 002: Поля местоположения пользователя
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_location ON users(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_location_active ON users(location_updated_at) WHERE location_updated_at IS NOT NULL;

COMMENT ON COLUMN users.latitude IS 'Широта местоположения пользователя';
COMMENT ON COLUMN users.longitude IS 'Долгота местоположения пользователя';
COMMENT ON COLUMN users.location_updated_at IS 'Время последнего обновления местоположения';

-- -----------------------------------------------------------------------------
-- 003: Поля аватара пользователя
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_avatar TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;

COMMENT ON COLUMN users.google_avatar IS 'URL аватара из Google аккаунта';
COMMENT ON COLUMN users.avatar IS 'Путь к загруженному аватару пользователя';

-- -----------------------------------------------------------------------------
-- 004: Поля «специалист»
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_specialist BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialist_bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialist_since TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_is_specialist ON users(is_specialist) WHERE is_specialist = true;

COMMENT ON COLUMN users.is_specialist IS 'Пользователь зарегистрирован как специалист и может оказывать услуги';
COMMENT ON COLUMN users.specialist_bio IS 'Описание услуг / о себе для карточки специалиста';
COMMENT ON COLUMN users.specialist_since IS 'Дата регистрации в качестве специалиста';

-- -----------------------------------------------------------------------------
-- 005: Специальности специалиста
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialist_specialties TEXT[] DEFAULT '{}';

COMMENT ON COLUMN users.specialist_specialties IS 'Массив кодов выбранных специальностей (например: santehnik, elektrik)';

-- -----------------------------------------------------------------------------
-- 006: Таблица заявок (orders)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  specialty_id VARCHAR(50) NOT NULL,
  description TEXT,
  proposed_price DECIMAL(12, 2),
  preferred_at TIMESTAMP,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  address_text VARCHAR(500),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'completed', 'cancelled')),
  specialist_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_specialty ON orders(specialty_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_specialist ON orders(specialist_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);

COMMENT ON TABLE orders IS 'Заявки заказчиков: услуга, цена, время, геолокация; специалист принимает';

-- -----------------------------------------------------------------------------
-- 007: Город специалиста
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS specialist_city VARCHAR(255);

COMMENT ON COLUMN users.specialist_city IS 'Город специалиста (для поиска и карточки)';
CREATE INDEX IF NOT EXISTS idx_users_specialist_city ON users(specialist_city) WHERE specialist_city IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 008: Таблица организаций
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  city VARCHAR(255),
  address TEXT,
  phone VARCHAR(100),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_city ON organizations(city);
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);

COMMENT ON TABLE organizations IS 'Организации (справочник/раздел для приложения)';

-- -----------------------------------------------------------------------------
-- 009: Справочник городов
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  country_code CHAR(2) NOT NULL DEFAULT 'KZ'
);

COMMENT ON TABLE cities IS 'Справочник городов';
COMMENT ON COLUMN cities.name IS 'Название города';
COMMENT ON COLUMN cities.country_code IS 'Код страны (ISO 3166-1 alpha-2)';

INSERT INTO cities (name, country_code) VALUES
  ('Алматы', 'KZ'),
  ('Астана', 'KZ'),
  ('Шымкент', 'KZ'),
  ('Караганда', 'KZ'),
  ('Актобе', 'KZ'),
  ('Тараз', 'KZ'),
  ('Павлодар', 'KZ'),
  ('Усть-Каменогорск', 'KZ'),
  ('Семей', 'KZ'),
  ('Атырау', 'KZ'),
  ('Костанай', 'KZ'),
  ('Кызылорда', 'KZ'),
  ('Уральск', 'KZ'),
  ('Петропавловск', 'KZ'),
  ('Туркестан', 'KZ')
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 010: Пароль и отчество
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "middleName" VARCHAR(255);

COMMENT ON COLUMN users.password_hash IS 'Хеш пароля для входа по номеру телефона';
COMMENT ON COLUMN users."middleName" IS 'Отчество пользователя';

-- -----------------------------------------------------------------------------
-- 011: Пароль в открытом виде (админка)
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_plain TEXT;

COMMENT ON COLUMN users.password_plain IS 'Пароль в открытом виде, только для админ-панели';

-- -----------------------------------------------------------------------------
-- 012: Верификация email
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN users.email_verified IS 'Почта подтверждена по ссылке из письма';
COMMENT ON COLUMN users.verification_token IS 'Токен для ссылки верификации';
COMMENT ON COLUMN users.verification_token_expires IS 'Срок действия токена верификации';

CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token) WHERE verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email) WHERE email_verified = true;

-- -----------------------------------------------------------------------------
-- 013: Флаг администратора
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_admin IS 'Доступ в админ-панель по email и паролю из БД';

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- -----------------------------------------------------------------------------
-- 014: Статус заявки "Еду" (in_progress)
-- -----------------------------------------------------------------------------
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('open', 'accepted', 'in_progress', 'completed', 'cancelled'));

COMMENT ON COLUMN orders.status IS 'open=в поиске, accepted=принята, in_progress=еду, completed=выполнена, cancelled=отменена';

-- -----------------------------------------------------------------------------
-- 015: Позиция специалиста при поездке к клиенту (мониторинг как InDriver)
-- -----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS specialist_latitude DECIMAL(10, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS specialist_longitude DECIMAL(11, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS specialist_location_updated_at TIMESTAMP;

COMMENT ON COLUMN orders.specialist_latitude IS 'Текущая широта специалиста (еду к клиенту)';
COMMENT ON COLUMN orders.specialist_longitude IS 'Текущая долгота специалиста (еду к клиенту)';
COMMENT ON COLUMN orders.specialist_location_updated_at IS 'Время последнего обновления позиции специалиста';

-- -----------------------------------------------------------------------------
-- 016: Позиция клиента в реальном времени (для специалиста)
-- -----------------------------------------------------------------------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_latitude DECIMAL(10, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_longitude DECIMAL(11, 8);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_location_updated_at TIMESTAMP;

COMMENT ON COLUMN orders.customer_latitude IS 'Текущая широта клиента (отправляется клиентом в реальном времени)';
COMMENT ON COLUMN orders.customer_longitude IS 'Текущая долгота клиента';
COMMENT ON COLUMN orders.customer_location_updated_at IS 'Время последнего обновления позиции клиента';
