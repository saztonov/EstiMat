import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export default fp(async (fastify) => {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: 20,
  });

  const db = drizzle(pool);

  fastify.decorate('db', db);
  fastify.decorate('pool', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
});
