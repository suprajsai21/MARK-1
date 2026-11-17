import type { AuthService } from './modules/auth/service.js';
import { AuthService as AuthServiceClass } from './modules/auth/service.js';
import type { EmailSender } from './modules/auth/email-sender.js';
import { createEmailSender } from './modules/auth/email-sender.js';
import type { AuthDatabase, AuthRepository, PrismaLinkDatabaseClient } from '@mark-1/db';
import { createPrismaClient, PrismaAuthRepository, PrismaLinkDatabase } from '@mark-1/db';
import type { LinkDatabase, PlatformLinkVerifier } from './modules/links/service.js';

export type RuntimeEnvironment = {
  DATABASE_URL?: string | undefined;
  WEB_ORIGIN?: string | undefined;
  NODE_ENV?: string | undefined;
  EMAIL_FROM?: string | undefined;
  SMTP_URL?: string | undefined;
  LINK_SUBJECT_HMAC_SECRET?: string | undefined;
};

export type RuntimeOverrides = {
  repository?: AuthRepository;
  emailSender?: EmailSender;
  linkDatabase?: LinkDatabase;
  verifier?: PlatformLinkVerifier | null;
  subjectHmacSecret?: string;
};

export type Runtime = {
  auth: AuthService;
  allowedOrigin: string;
  linkDatabase?: LinkDatabase;
  verifier: PlatformLinkVerifier | null;
  subjectHmacSecret: string;
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
    verifier,
    subjectHmacSecret,
    prisma,
  };
}
