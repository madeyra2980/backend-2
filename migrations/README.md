# Миграции базы данных

## Порядок применения

**Сначала создаётся таблица `users` (000), затем к ней добавляются поля (001–005).**

### Самый простой способ (из папки backend)

Подключение берётся из `backend/.env` (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD):

```bash
cd backend
npm run migrate
```

### Вручную через psql (из папки backend)

```bash
cd backend
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/000_create_users_table.sql
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/001_add_user_profile_fields.sql
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/002_add_user_location_fields.sql
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/003_add_user_avatar_fields.sql
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/004_add_specialist_fields.sql
psql -h localhost -p 5433 -U komek_user -d komek_db -f migrations/005_add_specialist_specialties.sql
```
    
Порт `5433` и пароль — как в вашем `backend/.env` (DB_PORT, DB_USER, пароль в переменной окружения или в коде db.js). Если БД на порту 5432 (Docker), замените `-p 5433` на `-p 5432`.

### Через Docker (если БД в контейнере)

```bash
docker exec -i komek-postgres psql -U komek_user -d komek_db < backend/migrations/000_create_users_table.sql
# затем 001–005 по тому же образцу
```

### Через pgAdmin / DBeaver

Откройте каждый файл `000_…sql` … `005_…sql` по очереди и выполните в клиенте.

## Миграции

### 000_create_users_table.sql (**выполнить первой**)

Создаёт таблицу `users`, если её нет: id, email, firstName, lastName, account_id, google_id, google_avatar, createdAt, updatedAt. Без неё миграции 001–005 падают с «relation "users" does not exist».

### 001_add_user_profile_fields.sql

Добавляет следующие поля в таблицу `users`:
- `phone` - номер телефона клиента
- `document_photo` - URL или путь к фото удостоверения личности
- `rating` - рейтинг пользователя (0.0 - 5.0)
- `account_id` - ID аккаунта для платежей и мониторинга

### 004_add_specialist_fields.sql

Добавляет возможность пользователю быть специалистом (в одном аккаунте — и заказчик, и специалист):
- `is_specialist` - флаг «пользователь зарегистрирован как специалист»
- `specialist_bio` - описание услуг для карточки специалиста
- `specialist_since` - дата регистрации в качестве специалиста

### 005_add_specialist_specialties.sql

Добавляет выбор специальностей у специалиста (чекбоксы из списка):
- `specialist_specialties` - массив кодов выбранных специальностей (TEXT[])

### 007_add_specialist_city.sql

Добавляет город специалиста для поиска и карточки:
- `specialist_city` - город специалиста (VARCHAR)

### 008_create_organizations_table.sql

Создаёт раздел организаций:
- Таблица `organizations`: id, name, description, city, address, phone, email, created_at, updated_at

### 009_create_cities_table.sql

Создаёт справочник городов:
- Таблица `cities`: id, name, country_code (статичный список городов РК)
