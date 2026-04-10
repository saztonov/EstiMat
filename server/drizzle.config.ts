import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  dialect: 'postgresql',
  out: './src/db/schema',
  dbCredentials: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'estimat',
    user: process.env.DB_USER || 'estimat',
    password: process.env.DB_PASSWORD || 'estimat_secret',
  },
});
