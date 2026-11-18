import type { AuthService } from './modules/auth/service.js';
import { AuthService as AuthServiceClass } from './modules/auth/service.js';
import type { EmailSender } from './modules/auth/email-sender.js';
import { createEmailSender } from './modules/auth/email-sender.js';
import type { AuthDatabase, AuthRepository, PrismaLinkDatabaseClient, PrismaOAuthDatabase } from '@mark-1/db';
import { createPrismaClient, PrismaAuthRepository, PrismaLinkDatabase, PrismaOAuthStore } from '@mark-1/db';
import { OAuthService } from './modules/oauth/service.js';
import type { LinkDatabase, PlatformLinkVerifier } from './modules/links/service.js';

export type RuntimeEnvironment = {
  DATABASE_URL?: string | undefined;
  WEB_ORIGIN?: string | undefined;
  NODE_ENV?: string | undefined;
  EMAIL_FROM?: string | undefined;
  SMTP_URL?: string | undefined;
  LINK_SUBJECT_HMAC_SECRET?: string | undefined;
  OAUTH_CLIENT_ID?: string | undefined;
  OAUTH_REDIRECT_URIS?: string | undefined;
};

export type RuntimeOverrides = {
  repository?: AuthRepository;
  emailSender?: EmailSender;
  linkDatabase?: LinkDatabase;
  verifier?: PlatformLinkVerifier | null;
  subjectHmacSecret?: string;
  oauthService?: OAuthService;
};

export type Runtime = {
  auth: AuthService;
  allowedOrigin: string;
  linkDatabase?: LinkDatabase;
  verifier: PlatformLinkVerifier | null;
  subjectHmacSecret: string;
  oauth?: OAuthService;
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
  // Never select an external verifier from an unreviewed environment string.
  const verifier = overrides.verifier ?? null;

  if (overrides.repository) {
    return {
      auth: new AuthServiceClass({
        repository: overrides.repository,
        emailSender,
        webOrigin: allowedOrigin,
      }),
      allowedOrigin,
      ...(overrides.linkDatabase ? { linkDatabase: overrides.linkDatabase } : {}),
      ...(overrides.oauthService ? { oauth: overrides.oauthService } : {}),
      verifier,
      subjectHmacSecret,
    };
  }

  const prisma = createPrismaClient(databaseUrl);
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
    verifier,
    subjectHmacSecret,
    prisma,
  };
}
