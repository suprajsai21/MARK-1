import { describe, expect, it } from 'vitest';
import { AuthService } from '../service.js';
import { MemoryEmailSender } from '../email-sender.js';
import { MemoryAuthRepository } from './fixtures.js';

describe('auth.register', () => {
  it('normalizes email and rejects duplicate registration with normalized duplicate error', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    const first = await service.register({
      email: ' Customer@Example.COM ',
      password: 'correct horse battery staple',
    });
    expect(first).toEqual({ userId: expect.any(String), verificationDispatchAttempted: true });

    // Re-registration with different casing/whitespace must be rejected
    await expect(
      service.register({
        email: 'customer@example.com',
        password: 'another password 1234',
      }),
    ).rejects.toThrow('EMAIL_ALREADY_REGISTERED');

    expect(repository.users.has('customer@example.com')).toBe(true);
    expect(repository.users.size).toBe(1);
  });

  it('rejects passwords outside 12-128 character bounds', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'short',
      }),
    ).rejects.toThrow();

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'a'.repeat(129),
      }),
    ).rejects.toThrow();
  });

  it('hashes passwords with Argon2id and never returns the verification token in responses', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    const result = await service.register({
      email: 'customer@example.com',
      password: 'correct horse battery staple',
    });

    expect(result).toEqual({ userId: expect.any(String), verificationDispatchAttempted: true });
    expect(JSON.stringify(result)).not.toContain('token');

    const user = repository.users.get('customer@example.com');
    expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user?.passwordHash).not.toContain('correct horse battery staple');
  });

  it('keeps account unverified and recoverable when email delivery fails', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    emailSender.failNext = true;
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    const result = await service.register({
      email: 'customer@example.com',
      password: 'correct horse battery staple',
    });

    expect(result.verificationDispatchAttempted).toBe(true);
    expect(JSON.stringify(result)).not.toContain('token');

    const user = repository.users.get('customer@example.com');
    expect(user?.emailVerified).toBe(false);

    // Resend recovers verification
    emailSender.failNext = false;
    await service.resendVerification('customer@example.com');
    expect(emailSender.verificationEmails).toHaveLength(1);
  });
});
