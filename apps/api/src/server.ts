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
import { createRuntime } from './runtime.js';
import type { RuntimeEnvironment, RuntimeOverrides } from './runtime.js';
import { registerPricingRoutes } from './modules/pricing/routes.js';
import { registerCheckoutRoutes } from './modules/payments/routes.js';
import type { PricingService } from './modules/pricing/service.js';
import type { CheckoutService } from './modules/payments/service.js';
import type { WebhookService } from './modules/payments/webhook-service.js';
import { registerWebhookRoutes } from './modules/payments/webhook-routes.js';
import { registerEntitlementRoutes } from './modules/payments/entitlement-routes.js';
import { registerHealthRoutes } from './health.js';

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
  pricing?: PricingService;
  checkout?: CheckoutService;
  webhook?: WebhookService;
  webhookSecret?: string;
  entitlementLookup?: (userId: string, productVersionId: string) => Promise<Array<{ productVersionId: string; status: 'active' | 'revoked' }>>;
  /** Dependency probe for readiness. Omitted for in-memory test servers. */
  readinessCheck?: () => Promise<void>;
  checkRequiredDependencies?: () => Promise<void>;
};

/**
 * Builds the API and mounts the customer auth, account-link, and admin routes,
 * so a server started from this factory exposes the same endpoints the tests
 * exercise. Health checks remain unauthenticated and side-effect free. When no
 * approved verifier is supplied, linking fails closed.
 */
export function buildServer(options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  registerHealthRoutes(app, {
    checkDatabase: options.readinessCheck ?? (async () => { throw new Error('DATABASE_NOT_CONFIGURED'); }),
    checkRequiredDependencies: options.checkRequiredDependencies ?? (async () => {
      if (!options.oauth) throw new Error('OAUTH_NOT_CONFIGURED');
      if (!options.entitlementLookup) throw new Error('ENTITLEMENT_LOOKUP_NOT_CONFIGURED');
    }),
  });
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

  if (options.pricing) {
    registerPricingRoutes(app, {
      pricing: options.pricing,
      authenticate: async (request) => {
        const token = sessionTokenFromRequest(request);
        return token ? options.auth.authenticateSession(token) : null;
      },
      allowedOrigin: options.allowedOrigin,
    });
  }
  const authenticate = async (request: Parameters<typeof sessionTokenFromRequest>[0]) => {
    const token = sessionTokenFromRequest(request);
    return token ? options.auth.authenticateSession(token) : null;
  };
  if (options.checkout) {
    registerCheckoutRoutes(app, {
      checkout: options.checkout,
      authenticate,
      allowedOrigin: options.allowedOrigin,
    });
  }
  if (options.webhook) {
    registerWebhookRoutes(app, { secret: options.webhookSecret ?? '', process: (input) => options.webhook!.process(input) });
  }
  if (options.entitlementLookup) {
    registerEntitlementRoutes(app, { authenticate, getForUser: (userId) => options.entitlementLookup!(userId, 'mark1-v1') });
  }

  if (options.oauth) {
    registerOAuthRoutes(app, {
      oauth: options.oauth,
      allowedOrigin: options.allowedOrigin,
      authenticate: cookieAuthenticator((token) => options.auth.authenticateSession(token)),
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
  const app = buildServer({
    auth: runtime.auth,
    allowedOrigin: runtime.allowedOrigin,
    ...(runtime.linkDatabase ? { linkDatabase: runtime.linkDatabase } : {}),
    verifier: runtime.verifier,
    subjectHmacSecret: runtime.subjectHmacSecret,
    ...(runtime.oauth ? { oauth: runtime.oauth } : {}),
    ...(runtime.pricing ? { pricing: runtime.pricing } : {}),
    ...(runtime.checkout ? { checkout: runtime.checkout } : {}),
    ...(runtime.webhook ? { webhook: runtime.webhook } : {}),
    ...(runtime.entitlementLookup ? { entitlementLookup: runtime.entitlementLookup } : {}),
    webhookSecret: environment.RAZORPAY_WEBHOOK_SECRET?.trim() ?? '',
    ...(runtime.prisma ? { readinessCheck: async () => { await runtime.prisma!.$queryRaw`SELECT 1`; } } : {}),
    checkRequiredDependencies: async () => {
      if (!runtime.oauth) throw new Error('OAUTH_NOT_CONFIGURED');
      if (!runtime.entitlementLookup) throw new Error('ENTITLEMENT_LOOKUP_NOT_CONFIGURED');
    },
  });
  return app;
}
