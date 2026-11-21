import type { AuthService } from './modules/auth/service.js';
import { AuthService as AuthServiceClass } from './modules/auth/service.js';
import type { EmailSender } from './modules/auth/email-sender.js';
import { createEmailSender } from './modules/auth/email-sender.js';
import type { AuthDatabase, AuthRepository, PrismaLinkDatabaseClient, PrismaOAuthDatabase, PrismaMailDatabaseClient, MailDatabase } from '@mark-1/db';
import { createPrismaClient, PrismaAuthRepository, PrismaLinkDatabase, PrismaOAuthStore, PrismaMailDatabase, validateEncryptionKey } from '@mark-1/db';
import { OAuthService } from './modules/oauth/service.js';
import type { LinkDatabase, PlatformLinkVerifier } from './modules/links/service.js';
import { MailService } from './modules/mail/service.js';
import type { GoogleOAuthClient } from './modules/mail/google-client.js';
import { FetchGoogleOAuthClient } from './modules/mail/google-client.js';

export type RuntimeEnvironment = {
  DATABASE_URL?: string | undefined;
  WEB_ORIGIN?: string | undefined;
  NODE_ENV?: string | undefined;
  EMAIL_FROM?: string | undefined;
  SMTP_URL?: string | undefined;
  LINK_SUBJECT_HMAC_SECRET?: string | undefined;
  OAUTH_CLIENT_ID?: string | undefined;
  OAUTH_REDIRECT_URIS?: string | undefined;
  MAIL_TOKEN_ENCRYPTION_KEY?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GOOGLE_REDIRECT_URI?: string | undefined;
};

export type RuntimeOverrides = {
  repository?: AuthRepository;
  emailSender?: EmailSender;
  linkDatabase?: LinkDatabase;
  verifier?: PlatformLinkVerifier | null;
  subjectHmacSecret?: string;
  oauthService?: OAuthService;
  mailDatabase?: MailDatabase;
  mailService?: MailService;
  googleClient?: GoogleOAuthClient;
  mailEncryptionKey?: Buffer;
};

export type Runtime = {
  auth: AuthService;
  allowedOrigin: string;
  linkDatabase?: LinkDatabase;
  verifier: PlatformLinkVerifier | null;
  subjectHmacSecret: string;
  oauth?: OAuthService;
  mail?: MailService;
  mailDatabase?: MailDatabase;
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

  const mailClientId = environment.GOOGLE_CLIENT_ID?.trim();
  const mailClientSecret = environment.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const mailRedirectUri = environment.GOOGLE_REDIRECT_URI?.trim() || `${allowedOrigin}/mail/callback`;

  let mailEncryptionKey = overrides.mailEncryptionKey;
  if (!mailEncryptionKey && environment.MAIL_TOKEN_ENCRYPTION_KEY?.trim()) {
    mailEncryptionKey = validateEncryptionKey(environment.MAIL_TOKEN_ENCRYPTION_KEY);
  }

  if (environment.NODE_ENV === 'production' && mailClientId && !mailEncryptionKey) {
    throw new Error('MAIL_TOKEN_ENCRYPTION_KEY_REQUIRED');
  }

  const googleClient = overrides.googleClient ?? new FetchGoogleOAuthClient();

  const buildMailService = (db: MailDatabase): MailService | undefined => {
    if (overrides.mailService) return overrides.mailService;
    if (mailEncryptionKey && mailClientId) {
      return new MailService({
        database: db,
        googleClient,
        encryptionKey: mailEncryptionKey,
        clientId: mailClientId,
        clientSecret: mailClientSecret,
        defaultRedirectUri: mailRedirectUri,
      });
    }
    return undefined;
  };

  if (overrides.repository) {
    const mailDb = overrides.mailDatabase;
    const mail = mailDb ? buildMailService(mailDb) : overrides.mailService;
    return {
      auth: new AuthServiceClass({
        repository: overrides.repository,
        emailSender,
        webOrigin: allowedOrigin,
      }),
      allowedOrigin,
      ...(overrides.linkDatabase ? { linkDatabase: overrides.linkDatabase } : {}),
      ...(overrides.oauthService ? { oauth: overrides.oauthService } : {}),
      ...(mail ? { mail } : {}),
      ...(mailDb ? { mailDatabase: mailDb } : {}),
      verifier,
      subjectHmacSecret,
    };
  }

  const prisma = createPrismaClient(databaseUrl);
  const mailDb = overrides.mailDatabase ?? new PrismaMailDatabase(prisma as unknown as PrismaMailDatabaseClient);
  const mail = buildMailService(mailDb);

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
    ...(mail ? { mail } : {}),
    mailDatabase: mailDb,
    verifier,
    subjectHmacSecret,
    prisma,
  };
}
