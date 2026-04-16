import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const { Pool } = pg;

async function runMigrations(pool: pg.Pool, log: (msg: string) => void) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Если 0001 уже был применён до появления учёта миграций — регистрируем задним числом.
    const { rows: legacy } = await client.query(
      `SELECT to_regclass('public.organizations') IS NOT NULL AS has_tables`,
    );
    if (legacy[0].has_tables) {
      await client.query(
        `INSERT INTO schema_migrations (name) VALUES ('0001_initial.sql')
         ON CONFLICT DO NOTHING`,
      );
    }

    const __dirname = dirname(fileURLToPath(import.meta.url));
    // plugins/ is next to db/; migrations live at ../db/migrations/ from plugins.
    // В dev (tsx) __dirname указывает на src/plugins; в prod — на dist/plugins.
    // В обоих случаях относительный путь один.
    const migrationsDir = join(__dirname, '..', 'db', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [file],
      );
      if (rows.length > 0) continue;

      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      log(`Applying migration: ${file}`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      log(`Applied: ${file}`);
    }
  } finally {
    client.release();
  }
}

export default fp(async (fastify) => {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: 20,
    ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
  });

  // Автоприменение миграций при старте (идемпотентно)
  try {
    await runMigrations(pool, (m) => fastify.log.info(m));
  } catch (err) {
    fastify.log.error({ err }, 'Migration failed');
    throw err;
  }

  const db = drizzle(pool);

  fastify.decorate('db', db);
  fastify.decorate('pool', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
