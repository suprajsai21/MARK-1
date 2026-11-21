import type { AuthService } from './modules/auth/service.js';
import { AuthService as AuthServiceClass } from './modules/auth/service.js';
import type { EmailSender } from './modules/auth/email-sender.js';
import { createEmailSender } from './modules/auth/email-sender.js';
import type { AuthDatabase, AuthRepository, PrismaLinkDatabaseClient, PrismaOAuthDatabase, PrismaPaymentDatabaseClient } from '@mark-1/db';
import { createPrismaClient, PrismaAuthRepository, PrismaLinkDatabase, PrismaOAuthStore, PrismaPaymentDatabase } from '@mark-1/db';
import { OAuthService } from './modules/oauth/service.js';
import type { LinkDatabase, PlatformLinkVerifier } from './modules/links/service.js';
import type { PriceDatabase } from './modules/pricing/service.js';
import { PricingService } from './modules/pricing/service.js';
import type { CheckoutDatabase, CheckoutService as CheckoutServiceType } from './modules/payments/service.js';
import { CheckoutService } from './modules/payments/service.js';
import type { RazorpayClient } from './modules/payments/razorpay-client.js';
import { HttpRazorpayClient } from './modules/payments/razorpay-client.js';
import { WebhookService } from './modules/payments/webhook-service.js';
import type { WebhookDatabase } from './modules/payments/webhook-service.js';
import { RazorpayEventVerifier } from './modules/payments/signature.js';

export type RuntimeEnvironment = {
  DATABASE_URL?: string | undefined;
  WEB_ORIGIN?: string | undefined;
  NODE_ENV?: string | undefined;
  EMAIL_FROM?: string | undefined;
  SMTP_URL?: string | undefined;
  LINK_SUBJECT_HMAC_SECRET?: string | undefined;
  OAUTH_CLIENT_ID?: string | undefined;
  OAUTH_REDIRECT_URIS?: string | undefined;
  RAZORPAY_KEY_ID?: string | undefined;
  RAZORPAY_KEY_SECRET?: string | undefined;
  RAZORPAY_WEBHOOK_SECRET?: string | undefined;
};

type EntitlementLookup = (userId: string, productVersionId: string) => Promise<Array<{ productVersionId: string; status: 'active' | 'revoked' }>>;
type PaymentWebhookDatabase = WebhookDatabase & { getEntitlementsForUser: EntitlementLookup };

function isWebhookDatabase(value: unknown): value is WebhookDatabase {
  return typeof value === 'object' && value !== null && 'processEvent' in value && typeof value.processEvent === 'function';
}
function hasEntitlementLookup(value: unknown): value is { getEntitlementsForUser: EntitlementLookup } {
  return typeof value === 'object' && value !== null && 'getEntitlementsForUser' in value && typeof value.getEntitlementsForUser === 'function';
}

export type RuntimeOverrides = {
  repository?: AuthRepository;
  emailSender?: EmailSender;
  linkDatabase?: LinkDatabase;
  verifier?: PlatformLinkVerifier | null;
  subjectHmacSecret?: string;
  oauthService?: OAuthService;
  paymentDatabase?: PriceDatabase & CheckoutDatabase & { hasLinkedAccount(userId: string): Promise<boolean> };
  webhookDatabase?: PaymentWebhookDatabase;
  razorpayClient?: RazorpayClient;
  webhookService?: WebhookService;
  pricingService?: PricingService;
  checkoutService?: CheckoutServiceType;
  entitlementLookup?: (userId: string, productVersionId: string) => Promise<Array<{ productVersionId: string; status: 'active' | 'revoked' }>>;
};

export type Runtime = {
  auth: AuthService;
  allowedOrigin: string;
  linkDatabase?: LinkDatabase;
  verifier: PlatformLinkVerifier | null;
  subjectHmacSecret: string;
  oauth?: OAuthService;
  pricing?: PricingService;
  checkout?: CheckoutServiceType;
  webhook?: WebhookService;
  entitlementLookup?: (userId: string, productVersionId: string) => Promise<Array<{ productVersionId: string; status: 'active' | 'revoked' }>>;
  prisma?: ReturnType<typeof createPrismaClient>;
};

/**
 * Builds the API's runtime dependencies from environment configuration.
 * Missing required values fail closed; nothing falls back to a permissive
 * in-memory store or a silent email adapter in a deployed environment.
 */
export function createRuntime(environment: RuntimeEnvironment, overrides: RuntimeOverrides = {}): Runtime {
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL_REQUIRED');
  }
  const allowedOrigin = environment.WEB_ORIGIN?.trim();
  if (!allowedOrigin) {
    throw new Error('WEB_ORIGIN_REQUIRED');
  }

  const emailSender = overrides.emailSender ?? createEmailSender(environment);
  const subjectHmacSecret = overrides.subjectHmacSecret ?? environment.LINK_SUBJECT_HMAC_SECRET?.trim() ?? '';
  // Extension client configuration is deployment data. Either both values are
  // present (OAuth mounted) or neither is (extension authorization disabled).
  const oauthClientId = environment.OAUTH_CLIENT_ID?.trim();
  const oauthRedirectUris = environment.OAUTH_REDIRECT_URIS?.split(',').map((uri) => uri.trim()).filter(Boolean) ?? [];
  if (oauthClientId && oauthRedirectUris.length === 0) throw new Error('OAUTH_REDIRECT_URIS_REQUIRED');
  if (!oauthClientId && oauthRedirectUris.length > 0) throw new Error('OAUTH_CLIENT_ID_REQUIRED');
  for (const uri of oauthRedirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error('OAUTH_REDIRECT_URI_INVALID');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.toString() !== uri) {
      throw new Error('OAUTH_REDIRECT_URI_INVALID');
    }
  }
  const razorpayKeyId = environment.RAZORPAY_KEY_ID?.trim();
  const razorpayKeySecret = environment.RAZORPAY_KEY_SECRET?.trim();
  const razorpayWebhookSecret = environment.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (Boolean(razorpayKeyId) !== Boolean(razorpayKeySecret)) {
    throw new Error(razorpayKeyId ? 'RAZORPAY_KEY_SECRET_REQUIRED' : 'RAZORPAY_KEY_ID_REQUIRED');
  }
  if (razorpayWebhookSecret && !razorpayKeyId) throw new Error('RAZORPAY_KEYS_REQUIRED');
  const productVersionId = 'mark1-v1';
  // Never select an external verifier from an unreviewed environment string.
  const verifier = overrides.verifier ?? null;

  if (overrides.repository) {
    const paymentDatabase = overrides.paymentDatabase;
    const pricing = overrides.pricingService ?? (paymentDatabase
      ? new PricingService({ database: paymentDatabase, productVersionId }) : undefined);
    const provider = overrides.razorpayClient;
    const injectedDatabase = overrides.webhookDatabase ?? overrides.paymentDatabase;
    const webhookDatabase = isWebhookDatabase(injectedDatabase) ? injectedDatabase : undefined;
    const entitlementDatabase = hasEntitlementLookup(injectedDatabase) ? injectedDatabase : undefined;
    const webhook = overrides.webhookService ?? (webhookDatabase && razorpayWebhookSecret
      ? new WebhookService({ verifier: new RazorpayEventVerifier(), secret: razorpayWebhookSecret, database: webhookDatabase }) : undefined);
    const entitlementLookup = overrides.entitlementLookup ?? (entitlementDatabase
      ? (userId: string, versionId: string) => entitlementDatabase.getEntitlementsForUser(userId, versionId) : undefined);
    const checkout = overrides.checkoutService ?? (paymentDatabase && pricing && provider && razorpayKeyId
      ? new CheckoutService({
        database: paymentDatabase,
        provider,
        productVersionId,
        checkoutKeyId: razorpayKeyId,
        hasLinkedAccount: (userId) => paymentDatabase.hasLinkedAccount(userId),
      }) : undefined);
    if (razorpayKeyId && (!paymentDatabase || !pricing || !provider || !checkout)) {
      throw new Error('PAYMENT_DATABASE_REQUIRED');
    }
    return {
      auth: new AuthServiceClass({
        repository: overrides.repository,
        emailSender,
        webOrigin: allowedOrigin,
      }),
      allowedOrigin,
      ...(overrides.linkDatabase ? { linkDatabase: overrides.linkDatabase } : {}),
      ...(overrides.oauthService ? { oauth: overrides.oauthService } : {}),
      ...(pricing ? { pricing } : {}),
      ...(checkout ? { checkout } : {}),
      ...(webhook ? { webhook } : {}),
      ...(entitlementLookup ? { entitlementLookup } : {}),
      verifier,
      subjectHmacSecret,
    };
  }

  const prisma = createPrismaClient(databaseUrl);
  const paymentDatabase = overrides.paymentDatabase ?? new PrismaPaymentDatabase(prisma as unknown as PrismaPaymentDatabaseClient);
  const pricing = overrides.pricingService ?? new PricingService({ database: paymentDatabase, productVersionId });
  const provider = overrides.razorpayClient ?? (razorpayKeyId && razorpayKeySecret
    ? new HttpRazorpayClient({ keyId: razorpayKeyId, keySecret: razorpayKeySecret }) : undefined);
  const webhookDatabase = overrides.webhookDatabase ?? (isWebhookDatabase(paymentDatabase) ? paymentDatabase : undefined);
  const entitlementDatabase = hasEntitlementLookup(paymentDatabase) ? paymentDatabase : undefined;
  const webhook = overrides.webhookService ?? (webhookDatabase && razorpayWebhookSecret
    ? new WebhookService({ verifier: new RazorpayEventVerifier(), secret: razorpayWebhookSecret, database: webhookDatabase }) : undefined);
  const entitlementLookup = overrides.entitlementLookup ?? (entitlementDatabase
    ? (userId: string, versionId: string) => entitlementDatabase.getEntitlementsForUser(userId, versionId) : undefined);
  const checkout = overrides.checkoutService ?? (pricing && provider && razorpayKeyId
    ? new CheckoutService({
      database: paymentDatabase,
      provider,
      productVersionId,
      checkoutKeyId: razorpayKeyId,
      hasLinkedAccount: (userId) => paymentDatabase.hasLinkedAccount(userId),
    }) : undefined);
  return {
    auth: new AuthServiceClass({
      repository: new PrismaAuthRepository(prisma as unknown as AuthDatabase),
      emailSender,
      webOrigin: allowedOrigin,
    }),
    allowedOrigin,
    linkDatabase: overrides.linkDatabase ?? new PrismaLinkDatabase(prisma as unknown as PrismaLinkDatabaseClient),
    ...(overrides.oauthService ? { oauth: overrides.oauthService } : oauthClientId ? {
      oauth: new OAuthService({
        store: new PrismaOAuthStore(prisma as unknown as PrismaOAuthDatabase),
        clientId: oauthClientId,
        redirectUris: oauthRedirectUris,
      }),
    } : {}),
    ...(pricing ? { pricing } : {}),
    ...(checkout ? { checkout } : {}),
    ...(webhook ? { webhook } : {}),
    ...(entitlementLookup ? { entitlementLookup } : {}),
    verifier,
    subjectHmacSecret,
    prisma,
  };
}
