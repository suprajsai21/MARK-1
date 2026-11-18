import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '@mark-1/contracts';
import { LinkPolicySchema } from '@mark-1/contracts';
import { authorizeAdmin } from './authorization.js';
import type { LinkDatabase, LinkPolicy } from '../links/service.js';

export function registerAdminRoutes(
  app: FastifyInstance,
  options: {
    database: LinkDatabase;
    authenticate: (request: FastifyRequest) => Promise<AuthUser | null>;
    allowedOrigin: string;
  },
): void {
  const sendError = (reply: FastifyReply, status: number, code: string) =>
    reply.code(status).send({ code, message: code.replaceAll('_', ' ').toLowerCase() });

  const admin = async (request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    const actor = await options.authenticate(request);
    try {
      return authorizeAdmin(actor);
    } catch (error) {
      const code = (error as { code?: string }).code;
      sendError(reply, code === 'UNAUTHENTICATED' ? 401 : 403, code ?? 'ADMIN_REQUIRED');
      return null;
    }
  };

  const originAllowed = (request: FastifyRequest): boolean =>
    Boolean(options.allowedOrigin) && request.headers.origin === options.allowedOrigin;

  app.get('/v1/admin/link-policy', async (request, reply) => {
    if (!(await admin(request, reply))) return;
    return reply.send(await options.database.getPolicy());
  });

  app.put('/v1/admin/link-policy', async (request, reply) => {
    const actor = await admin(request, reply);
    if (!actor) return;
    if (!originAllowed(request)) {
      return sendError(reply, 403, 'ORIGIN_FORBIDDEN');
    }
    const parsed = LinkPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'INVALID_INPUT');
    }
    const policy: LinkPolicy = parsed.data;
    await options.database.setPolicy(policy, {
      actorId: actor.id,
      action: 'policy_change',
      targetId: 'link-policy',
    });
    return reply.send(policy);
  });
}
