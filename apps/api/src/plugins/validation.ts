import type { FastifyReply, FastifyRequest } from 'fastify';

type Schema<T> = { parse(value: unknown): T };

export function parseBody<T>(schema: Schema<T>, body: unknown): T {
  return schema.parse(body);
}

export function requestOrigin(request: FastifyRequest): string | undefined {
  const origin = request.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
}

export function formatError(error: unknown, reply: FastifyReply): void {
  // Handle Zod validation errors
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    reply.code(400).send({ code: 'INVALID_INPUT', message: 'Invalid request' });
    return;
  }

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'INTERNAL_ERROR';

  const status =
    code === 'INVALID_CREDENTIALS' || code === 'EMAIL_NOT_VERIFIED' || code === 'INVALID_TOKEN'
      ? 401
      : code === 'EMAIL_ALREADY_REGISTERED'
        ? 409
        : code === 'RATE_LIMITED'
          ? 429
          : code === 'ORIGIN_FORBIDDEN'
            ? 403
            : 500;

  reply.code(status).send({
    code,
    message: status < 500 ? code.replaceAll('_', ' ').toLowerCase() : 'Request failed',
  });
}
