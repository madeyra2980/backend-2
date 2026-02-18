#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
const config = connectionString
  ? { connectionString, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'komek_db',
      user: process.env.DB_USER || 'komek_user',
      password: process.env.DB_PASSWORD || '',
      ssl: false,
    };
const pool = new Pool(config);

const migrationsDir = path.join(__dirname, 'migrations');

const migrationFiles = fs
  .readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();

const dbName = config.database || 'komek_db';

async function ensureDatabase() {
  if (connectionString) return; // DATABASE_URL — не трогаем
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== '3D000') throw err; // не "database does not exist"
    console.log(`База "${dbName}" не найдена. Пытаюсь создать...`);
    const adminConfig = {
      host: config.host,
      port: config.port,
      database: 'postgres',
      user: config.user,
      password: config.password,
      ssl: config.ssl,
    };
    const adminPool = new Pool(adminConfig);
    try {
      await adminPool.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`  База "${dbName}" создана.`);
    } catch (createErr) {
      await adminPool.end();
      console.error('\n❌ Не удалось создать базу автоматически.');
      console.error('   Создайте пользователя и базу вручную (под суперпользователем postgres или своим системным пользователем):');
      console.error(`   psql -p ${config.port} -d postgres -c "CREATE USER ${config.user} WITH PASSWORD 'ВАШ_ПАРОЛЬ';"`);
      console.error(`   psql -p ${config.port} -d postgres -c "CREATE DATABASE ${dbName} OWNER ${config.user};"`);
      console.error('   Затем снова: npm run migrate\n');
      throw createErr;
    }
    await adminPool.end();
  }
}

async function run() {
  await ensureDatabase();
  const client = await pool.connect();
  try {
    for (const file of migrationFiles) {
      console.log(`Running ${file}...`);
      const sql = fs.readFileSync(
        path.join(migrationsDir, file),
        'utf8'
      );
      await client.query(sql);
      console.log('  OK');
    }
    console.log('✅ All migrations applied');
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
