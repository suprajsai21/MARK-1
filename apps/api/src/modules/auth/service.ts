import type { AuthUser, LoginInput, RegisterInput } from '@mark-1/contracts';
import { RegisterInputSchema } from '@mark-1/contracts';
import type { AuthRepository, StoredUser } from '@mark-1/db';
import type { EmailSender } from './email-sender.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  newOpaqueToken,
  PASSWORD_RESET_TTL_MS,
  SESSION_TTL_MS,
  tokenHash,
  VERIFICATION_TTL_MS,
} from './sessions.js';

export class AuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuthError';
  }
}

export class AuthService {
  private readonly lastVerificationDispatch = new Map<string, number>();

  constructor(private readonly options: {
    repository: AuthRepository;
    emailSender: EmailSender;
    webOrigin: string;
    now?: () => Date;
    resendCooldownMs?: number;
  }) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  async register(input: RegisterInput): Promise<{ userId: string; verificationDispatchAttempted: true }> {
    // Validate bounds and normalization via RegisterInputSchema
    const validated = RegisterInputSchema.parse(input);
    const email = validated.email;

    let user: StoredUser;
    try {
      user = await this.options.repository.createUser({
        email,
        passwordHash: await hashPassword(validated.password),
      });
    } catch (error) {
      if ((error as Error).message === 'DUPLICATE_EMAIL' || (error as { code?: string }).code === 'P2002') {
        throw new AuthError('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }

    await this.dispatchVerification(user);
    return { userId: user.id, verificationDispatchAttempted: true };
  }

  async resendVerification(email: string): Promise<{ accepted: true }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.options.repository.findUserByEmail(normalizedEmail);
    if (!user || user.emailVerified) {
      return { accepted: true };
    }
    const now = this.now().getTime();
    const last = this.lastVerificationDispatch.get(normalizedEmail);
    if (last !== undefined && now - last < (this.options.resendCooldownMs ?? 60_000)) {
      throw new AuthError('RATE_LIMITED');
    }
    await this.dispatchVerification(user);
    return { accepted: true };
  }

  private async dispatchVerification(user: StoredUser): Promise<void> {
    const now = this.now();
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + VERIFICATION_TTL_MS);
    await this.options.repository.storeVerificationToken(user.id, tokenHash(token), expiresAt);
    try {
      await this.options.emailSender.sendVerificationEmail({
        to: user.email,
        verificationUrl: `${this.options.webOrigin}/verify-email?token=${encodeURIComponent(token)}`,
        expiresAt,
      });
      this.lastVerificationDispatch.set(user.email, now.getTime());
    } catch {
      // Keep the user unverified. Resend remains available; never expose the token in an API response.
    }
  }

  async login(input: LoginInput): Promise<{ user: AuthUser; sessionCookie: string }> {
    const user = await this.options.repository.findUserByEmail(input.email.trim().toLowerCase());
    const validPassword = user ? await verifyPassword(input.password, user.passwordHash) : false;
    if (!validPassword) {
      throw new AuthError('INVALID_CREDENTIALS');
    }
    if (!user!.emailVerified) {
      throw new AuthError('EMAIL_NOT_VERIFIED');
    }
    const token = newOpaqueToken();
    await this.options.repository.createSession(
      user!.id,
      tokenHash(token),
      new Date(this.now().getTime() + SESSION_TTL_MS),
    );
    return {
      user: publicUser(user!),
      sessionCookie: `mark1_session=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_MS / 1000}`,
    };
  }

  async verifyEmail(input: { token: string }): Promise<{ verified: true }> {
    const user = await this.options.repository.consumeVerificationToken(tokenHash(input.token), this.now());
    if (!user) {
      throw new AuthError('INVALID_TOKEN');
    }
    return { verified: true };
  }

  async requestPasswordReset(input: { email: string }): Promise<{ accepted: true }> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const user = await this.options.repository.findUserByEmail(normalizedEmail);
    if (!user) {
      return { accepted: true };
    }
    const now = this.now();
    const token = newOpaqueToken();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
    await this.options.repository.storeResetToken(user.id, tokenHash(token), expiresAt);
    try {
      await this.options.emailSender.sendPasswordResetEmail({
        to: user.email,
        resetUrl: `${this.options.webOrigin}/password/reset?token=${encodeURIComponent(token)}`,
        expiresAt,
      });
    } catch {
      // Keep the response indistinguishable from unknown email and allow a later request.
    }
    return { accepted: true };
  }

  async resetPassword(input: { token: string; newPassword: string }): Promise<{ changed: true }> {
    const userId = await this.options.repository.consumeResetToken(tokenHash(input.token), this.now());
    if (!userId) {
      throw new AuthError('INVALID_TOKEN');
    }
    await this.options.repository.updatePassword(userId, await hashPassword(input.newPassword));
    return { changed: true };
  }

  async authenticateSession(rawToken: string): Promise<AuthUser | null> {
    const now = this.now();
    const session = await this.options.repository.findSession(tokenHash(rawToken), now);
    if (!session) {
      return null;
    }
    const user = await this.options.repository.findUserById(session.userId);
    return user ? publicUser(user) : null;
  }

  async logout(rawToken: string): Promise<void> {
    await this.options.repository.deleteSession(tokenHash(rawToken));
  }
}

export function publicUser(user: StoredUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
  };
}
