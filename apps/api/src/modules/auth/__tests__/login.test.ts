import { describe, expect, it } from 'vitest';
import { AuthService } from '../service.js';
import { MemoryEmailSender } from '../email-sender.js';
import { MemoryAuthRepository } from './fixtures.js';

describe('auth.login', () => {
  it('returns identical generic error for unknown email and wrong password', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    let unknownErr: string | undefined;
    try {
      await service.login({ email: 'missing@example.com', password: 'correct horse battery staple' });
    } catch (err) {
      unknownErr = (err as Error).message;
    }

    await service.register({ email: 'existing@example.com', password: 'correct horse battery staple' });
    // Manually mark verified for testing login password check
    const user = repository.users.get('existing@example.com')!;
    repository.users.set('existing@example.com', { ...user, emailVerified: true });

    let wrongPasswordErr: string | undefined;
    try {
      await service.login({ email: 'existing@example.com', password: 'wrong password 1234' });
    } catch (err) {
      wrongPasswordErr = (err as Error).message;
    }

    expect(unknownErr).toBe('INVALID_CREDENTIALS');
    expect(wrongPasswordErr).toBe('INVALID_CREDENTIALS');
  });

  it('rejects login for unverified customer and creates no session', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    await service.register({ email: 'unverified@example.com', password: 'correct horse battery staple' });

    await expect(
      service.login({ email: 'unverified@example.com', password: 'correct horse battery staple' }),
    ).rejects.toThrow('EMAIL_NOT_VERIFIED');

    expect(repository.sessions.size).toBe(0);
  });

  it('does not include the session cookie value in JSON returned to caller', async () => {
    const repository = new MemoryAuthRepository();
    const emailSender = new MemoryEmailSender();
    const service = new AuthService({ repository, emailSender, webOrigin: 'https://portal.example.test' });

    await service.register({ email: 'verified@example.com', password: 'correct horse battery staple' });
    const user = repository.users.get('verified@example.com')!;
    repository.users.set('verified@example.com', { ...user, emailVerified: true });

    const result = await service.login({ email: 'verified@example.com', password: 'correct horse battery staple' });
    expect(result.user.email).toBe('verified@example.com');
    expect(result.sessionCookie).toContain('mark1_session=');
    expect(result.sessionCookie).toContain('HttpOnly');
    expect(result.sessionCookie).toContain('Secure');
    expect(result.sessionCookie).toContain('SameSite=Lax');

    // JSON representation of result.user must not have sessionCookie or passwordHash
    const userJson = JSON.stringify(result.user);
    expect(userJson).not.toContain('mark1_session');
    expect(userJson).not.toContain('passwordHash');
  });
});
