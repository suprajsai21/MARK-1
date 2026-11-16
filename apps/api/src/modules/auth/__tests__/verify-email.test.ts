import { describe, expect, it } from 'vitest';
import { AuthService } from '../service.js';
import { MemoryEmailSender } from '../email-sender.js';
import { MemoryAuthRepository } from './fixtures.js';

describe('auth.verifyEmail and password reset', () => {
  it('rejects expired email-verification tokens', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    let clock = new Date('2026-11-16T12:00:00.000Z');
    const service = new AuthService({
      repository,
      emailSender,
      webOrigin: 'https://portal.example.test',
      now: () => clock,
    });

    await service.register({ email: 'user@example.com', password: 'correct horse battery staple' });
    const verificationUrl = emailSender.verificationEmails[0]!.verificationUrl;
    const token = new URL(verificationUrl).searchParams.get('token')!;

    // Advance clock past 24 hours (24h + 1s)
    clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000 + 1000);

    await expect(service.verifyEmail({ token })).rejects.toThrow('INVALID_TOKEN');
    expect(repository.users.get('user@example.com')?.emailVerified).toBe(false);
  });

  it('rejects replayed / one-use email-verification tokens', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    await service.register({ email: 'user@example.com', password: 'correct horse battery staple' });
    const token = new URL(emailSender.verificationEmails[0]!.verificationUrl).searchParams.get('token')!;

    // First use succeeds
    const verified = await service.verifyEmail({ token });
    expect(verified).toEqual({ verified: true });
    expect(repository.users.get('user@example.com')?.emailVerified).toBe(true);

    // Replay / second use fails
    await expect(service.verifyEmail({ token })).rejects.toThrow('INVALID_TOKEN');
  });

  it('provides generic password-reset request response regardless of email existence', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    // Non-existent email
    const nonExistent = await service.requestPasswordReset({ email: 'nobody@example.com' });
    expect(nonExistent).toEqual({ accepted: true });
    expect(emailSender.passwordResetEmails).toHaveLength(0);

    // Existing email
    await service.register({ email: 'customer@example.com', password: 'correct horse battery staple' });
    const existing = await service.requestPasswordReset({ email: 'customer@example.com' });
    expect(existing).toEqual({ accepted: true });
    expect(emailSender.passwordResetEmails).toHaveLength(1);
  });

  it('rejects expired and replayed password-reset tokens (30m limit)', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    let clock = new Date('2026-11-16T12:00:00.000Z');
    const service = new AuthService({
      repository,
      emailSender,
      webOrigin: 'https://portal.example.test',
      now: () => clock,
    });

    await service.register({ email: 'customer@example.com', password: 'correct horse battery staple' });
    await service.requestPasswordReset({ email: 'customer@example.com' });
    const token = new URL(emailSender.passwordResetEmails[0]!.resetUrl).searchParams.get('token')!;

    // Advance clock past 30 minutes (30m + 1s)
    clock = new Date(clock.getTime() + 30 * 60 * 1000 + 1000);

    await expect(
      service.resetPassword({ token, newPassword: 'new password value 1234' }),
    ).rejects.toThrow('INVALID_TOKEN');

    // Reset clock back and request a fresh token
    clock = new Date('2026-11-16T13:00:00.000Z');
    await service.requestPasswordReset({ email: 'customer@example.com' });
    const freshToken = new URL(emailSender.passwordResetEmails[1]!.resetUrl).searchParams.get('token')!;

    // First use succeeds
    const reset = await service.resetPassword({ token: freshToken, newPassword: 'new password value 1234' });
    expect(reset).toEqual({ changed: true });

    // Second use (replay) fails
    await expect(
      service.resetPassword({ token: freshToken, newPassword: 'another password value' }),
    ).rejects.toThrow('INVALID_TOKEN');
  });
});
