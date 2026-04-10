import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const client = new pg.Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
  });

  await client.connect();
  console.log('Connected to database');

  try {
    const sql = readFileSync(join(__dirname, 'migrations', '0001_initial.sql'), 'utf-8');
    await client.query(sql);
    console.log('Migration 0001_initial applied successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
