import { createTransport } from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailSender {
  sendVerificationEmail(input: { to: string; verificationUrl: string; expiresAt: Date }): Promise<void>;
  sendPasswordResetEmail(input: { to: string; resetUrl: string; expiresAt: Date }): Promise<void>;
}

export class MemoryEmailSender implements EmailSender {
  readonly verificationEmails: Array<{ to: string; verificationUrl: string; expiresAt: Date }> = [];
  readonly passwordResetEmails: Array<{ to: string; resetUrl: string; expiresAt: Date }> = [];
  failNext = false;

  async sendVerificationEmail(input: { to: string; verificationUrl: string; expiresAt: Date }): Promise<void> {
    if (this.failNext) {
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
    this.verificationEmails.push(input);
  }

  async sendPasswordResetEmail(input: { to: string; resetUrl: string; expiresAt: Date }): Promise<void> {
    if (this.failNext) {
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
    this.passwordResetEmails.push(input);
  }
}

export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  async sendVerificationEmail(input: { to: string; verificationUrl: string; expiresAt: Date }): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: 'Verify your MARK-1 account',
      text: [
        'Verify your MARK-1 Customer account using the link below.',
        input.verificationUrl,
        `This link expires at ${input.expiresAt.toISOString()}.`,
      ].join('\n\n'),
    });
  }

  async sendPasswordResetEmail(input: { to: string; resetUrl: string; expiresAt: Date }): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: input.to,
      subject: 'Reset your MARK-1 password',
      text: [
        'Reset your MARK-1 Customer account password using the link below.',
        input.resetUrl,
        `This link expires at ${input.expiresAt.toISOString()}.`,
        'If you did not request this, ignore this message.',
      ].join('\n\n'),
    });
  }
}

export type EmailEnvironment = {
  NODE_ENV?: string | undefined;
  EMAIL_FROM?: string | undefined;
  SMTP_URL?: string | undefined;
  /** Optional explicit transport security setting; defaults are inferred safely from the URL. */
  SMTP_SECURE?: string | undefined;
};

const PLACEHOLDER_PREFIX = 'replace-with';

function configuredValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith(PLACEHOLDER_PREFIX)) {
    return null;
  }
  return trimmed;
}

/**
 * Selects the configured email adapter. Missing, placeholder, or malformed
 * delivery configuration fails closed instead of silently discarding
 * verification or reset messages. Production requires TLS. Callers surface
 * EMAIL_PROVIDER_NOT_CONFIGURED without exposing any token.
 */
export function createEmailSender(environment: EmailEnvironment): EmailSender {
  const smtpUrl = configuredValue(environment.SMTP_URL);
  const from = configuredValue(environment.EMAIL_FROM);
  if (!smtpUrl || !from) {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }

  let parsed: URL;
  try {
    parsed = new URL(smtpUrl);
  } catch {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  const secureOverride = environment.SMTP_SECURE?.trim().toLowerCase();
  if (secureOverride && secureOverride !== 'true' && secureOverride !== 'false') {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  const secure = parsed.protocol === 'smtps:' || parsed.searchParams.get('secure') === 'true' || secureOverride === 'true';
  if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  if (parsed.protocol === 'smtps:' && secureOverride === 'false') {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  if (environment.NODE_ENV === 'production' && !secure) {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  if (environment.NODE_ENV === 'production' && (!parsed.username || !parsed.password)) {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }

  const port = Number(parsed.port || (secure ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
  }
  const secureTransport = secure && (port === 465 || port === 2465 || parsed.protocol === 'smtps:');
  return new SmtpEmailSender(createTransport({
    host: parsed.hostname,
    port,
    secure: secureTransport,
    requireTLS: !secureTransport && secure,
    auth: parsed.username || parsed.password ? {
      user: decodeURIComponent(parsed.username),
      pass: decodeURIComponent(parsed.password),
    } : undefined,
  }), from);
}
