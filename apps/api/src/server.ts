import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { AuthService } from './modules/auth/service.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerAdminRoutes } from './modules/admin/routes.js';
import type { LinkDatabase, PlatformLinkVerifier } from './modules/links/service.js';
import { LinkService } from './modules/links/service.js';
import { registerLinkRoutes } from './modules/links/routes.js';
import { sessionTokenFromRequest } from './plugins/auth.js';
import { cookieAuthenticator, registerOAuthRoutes } from './modules/oauth/routes.js';
import type { OAuthService } from './modules/oauth/service.js';
import { registerMailRoutes } from './modules/mail/routes.js';
import type { MailService } from './modules/mail/service.js';
import { createRuntime } from './runtime.js';
import type { RuntimeEnvironment, RuntimeOverrides } from './runtime.js';

export type ServerOptions = {
  auth: AuthService;
  allowedOrigin: string;
  rateLimit?: { max: number; windowMs: number };
  links?: LinkService;
  linkDatabase?: LinkDatabase;
  /** Approved external verifier. Omitted means account linking is disabled. */
  verifier?: PlatformLinkVerifier | null;
  subjectHmacSecret?: string;
  oauth?: OAuthService;
  mail?: MailService;
};

/**
 * Builds the API and mounts the customer auth, account-link, and admin routes,
 * so a server started from this factory exposes the same endpoints the tests
 * exercise. Health checks remain unauthenticated and side-effect free. When no
 * approved verifier is supplied, linking fails closed.
 */
export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health/live', async () => ({ status: 'ok' }));
  registerAuthRoutes(app, options);

  if (options.linkDatabase || options.links) {
    const links =
      options.links ??
      new LinkService({
        database: options.linkDatabase!,
        verifier: options.verifier ?? null,
        subjectHmacSecret: options.subjectHmacSecret ?? '',
      });
    registerLinkRoutes(app, { links, auth: options.auth, allowedOrigin: options.allowedOrigin });
    const authenticate = async (request: Parameters<typeof sessionTokenFromRequest>[0]) => {
      const token = sessionTokenFromRequest(request);
      return token ? options.auth.authenticateSession(token) : null;
    };
    registerAdminRoutes(app, {
      database: options.linkDatabase ?? unreachableDatabase,
      authenticate,
      allowedOrigin: options.allowedOrigin,
    });
  }

  if (options.oauth) {
    registerOAuthRoutes(app, {
      oauth: options.oauth,
      allowedOrigin: options.allowedOrigin,
      authenticate: cookieAuthenticator((token) => options.auth.authenticateSession(token)),
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    });
  }

  if (options.mail) {
    registerMailRoutes(app, {
      mail: options.mail,
      auth: options.auth,
      allowedOrigin: options.allowedOrigin,
      ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}),
    });
  }

  return app;
}

/** Admin routes always receive a database; a prebuilt service is the only case without one. */
const unreachableDatabase = new Proxy({} as LinkDatabase, {
  get() {
    throw new Error('LINK_DATABASE_REQUIRED');
  },
});

/** Builds a server from environment configuration (durable adapters by default). */
export function buildConfiguredServer(
  environment: RuntimeEnvironment,
  overrides: RuntimeOverrides = {},
): FastifyInstance {
  const runtime = createRuntime(environment, overrides);
  return buildServer({
    auth: runtime.auth,
    allowedOrigin: runtime.allowedOrigin,
    ...(runtime.linkDatabase ? { linkDatabase: runtime.linkDatabase } : {}),
    verifier: runtime.verifier,
    subjectHmacSecret: runtime.subjectHmacSecret,
    ...(runtime.oauth ? { oauth: runtime.oauth } : {}),
    ...(runtime.mail ? { mail: runtime.mail } : {}),
  });
}
