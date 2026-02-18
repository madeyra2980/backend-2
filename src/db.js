import pg from 'pg';

const { Pool } = pg;

// Локально: DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD. На Render: DATABASE_URL
const connectionString = process.env.DATABASE_URL;
const config = 
  {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'komek_db',
      user: process.env.DB_USER || 'komek_user',
      password: String(process.env.DB_PASSWORD ?? ''),
    }

const pool = new Pool(config);
console.log('DB:', connectionString ? 'DATABASE_URL' : `${config.host}:${config.port}/${config.database}`);
export { pool };

export async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}
