import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@estimat/shared';

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.currentUser || !roles.includes(request.currentUser.role)) {
      return reply.status(403).send({ error: 'Доступ запрещён' });
    }
  };
}
