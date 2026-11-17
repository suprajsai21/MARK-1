import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { AuthService } from './modules/auth/service.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { createRuntime } from './runtime.js';
import type { RuntimeEnvironment, RuntimeOverrides } from './runtime.js';

export type ServerOptions = {
  auth: AuthService;
  allowedOrigin: string;
  rateLimit?: { max: number; windowMs: number };
};

/**
 * Builds the API and mounts the customer auth routes, so a server started from
 * this factory exposes the same endpoints the tests exercise. Health checks
 * remain unauthenticated and side-effect free.
 */
export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health/live', async () => ({ status: 'ok' }));
  registerAuthRoutes(app, options);
  return app;
}

/** Builds a server from environment configuration (durable adapters by default). */
export function buildConfiguredServer(
  environment: RuntimeEnvironment,
  overrides: RuntimeOverrides = {},
): FastifyInstance {
  const runtime = createRuntime(environment, overrides);
  return buildServer({ auth: runtime.auth, allowedOrigin: runtime.allowedOrigin });
}
