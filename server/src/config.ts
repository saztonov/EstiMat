import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing env variable: ${key}`);
  return value;
}

export const config = {
  port: Number(env('PORT', '3000')),
  nodeEnv: env('NODE_ENV', 'development'),
  isProduction: env('NODE_ENV', 'development') === 'production',

  db: {
    host: env('DB_HOST', 'localhost'),
    port: Number(env('DB_PORT', '5432')),
    database: env('DB_NAME', 'estimat'),
    user: env('DB_USER', 'estimat'),
    password: env('DB_PASSWORD', 'estimat_secret'),
  },

  jwt: {
    secret: env('JWT_SECRET', 'dev-jwt-secret-change-in-production-32ch'),
    refreshSecret: env('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-in-prod-32ch'),
    accessTtl: 15 * 60,       // 15 minutes in seconds
    refreshTtl: 7 * 24 * 3600, // 7 days in seconds
  },

  cors: {
    origin: env('CORS_ORIGIN', 'http://localhost:5173'),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'ru-central-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    bucket: process.env.S3_BUCKET || 'estimat-files',
  },
} as const;
