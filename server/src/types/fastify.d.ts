import type { Role } from '@estimat/shared';

export interface RequestUser {
  id: string;
  email: string;
  fullName: string;
  orgId: string | null;
  role: Role;
  isActive: boolean;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role?: string; type?: string };
    user: RequestUser;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    db: import('drizzle-orm/node-postgres').NodePgDatabase;
    pool: import('pg').Pool;
  }
  interface FastifyRequest {
    currentUser: RequestUser;
    accessTokenExp?: number;
  }
}
