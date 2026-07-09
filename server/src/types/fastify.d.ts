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
    rdPortal: import('../plugins/rd-portal.js').RdPortal | null;
    storage: import('../plugins/s3.js').Storage | null;
    outbox: import('../lib/integration/outbox-worker.js').OutboxWorker;
    publishEstimateChanged(event: import('@estimat/shared').EstimateChangedEvent): Promise<void>;
  }
  interface FastifyRequest {
    currentUser: RequestUser;
    accessTokenExp?: number;
  }
}
