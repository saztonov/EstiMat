// Re-export for convenience when importing db outside of Fastify context
// Inside routes, use fastify.db instead
export { drizzle } from 'drizzle-orm/node-postgres';
