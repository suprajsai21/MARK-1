import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  AuthUserSchema,
  LoginInputSchema,
  RegisterInputSchema,
} from '../auth';

describe('RegisterInput', () => {
  it('trims and lowercases a valid email', () => {
    expect(RegisterInputSchema.parse({ email: '  Customer@Example.COM  ', password: 'long-enough-password' })).toEqual({
      email: 'customer@example.com',
      password: 'long-enough-password',
    });
  });

  it('rejects invalid email addresses and email values over 254 characters', () => {
    expect(RegisterInputSchema.safeParse({ email: 'not-an-email', password: 'long-enough-password' }).success).toBe(false);
    expect(RegisterInputSchema.safeParse({ email: `${'a'.repeat(243)}@example.com`, password: 'long-enough-password' }).success).toBe(false);
  });

  it('enforces the 12–128 character password bounds without transforming it', () => {
    expect(RegisterInputSchema.safeParse({ email: 'user@example.com', password: 'short' }).success).toBe(false);
    expect(RegisterInputSchema.safeParse({ email: 'user@example.com', password: 'a'.repeat(129) }).success).toBe(false);
    expect(RegisterInputSchema.parse({ email: 'user@example.com', password: ' 1234567890 ' }).password).toBe(' 1234567890 ');
  });

  it('rejects unknown properties', () => {
    expect(RegisterInputSchema.safeParse({ email: 'user@example.com', password: 'long-enough-password', extra: true }).success).toBe(false);
  });
});

describe('LoginInput', () => {
  it('normalizes email but preserves password and enforces password bounds', () => {
    expect(LoginInputSchema.parse({ email: ' USER@Example.com ', password: 'long-enough-password' })).toEqual({
      email: 'user@example.com',
      password: 'long-enough-password',
    });
    expect(LoginInputSchema.safeParse({ email: 'user@example.com', password: 'short' }).success).toBe(false);
    expect(LoginInputSchema.safeParse({ email: 'user@example.com', password: 'a'.repeat(129) }).success).toBe(false);
  });

  it('rejects unknown properties', () => {
    expect(LoginInputSchema.safeParse({ email: 'user@example.com', password: 'long-enough-password', extra: true }).success).toBe(false);
  });
});

describe('AuthUser', () => {
  it('accepts the strict customer identity shape', () => {
    expect(AuthUserSchema.parse({ id: 'user-1', email: 'user@example.com', emailVerified: true, role: 'customer' })).toEqual({
      id: 'user-1', email: 'user@example.com', emailVerified: true, role: 'customer',
    });
  });

  it('rejects invalid roles, non-normalized emails, and unknown properties', () => {
    expect(AuthUserSchema.safeParse({ id: 'user-1', email: 'user@example.com', emailVerified: true, role: 'owner' }).success).toBe(false);
    expect(AuthUserSchema.safeParse({ id: 'user-1', email: ' USER@example.com ', emailVerified: true, role: 'admin' }).success).toBe(false);
    expect(AuthUserSchema.safeParse({ id: 'user-1', email: 'user@example.com', emailVerified: true, role: 'admin', extra: true }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('accepts a structured error with a stable uppercase code', () => {
    expect(ApiErrorSchema.parse({ code: 'INVALID_INPUT', message: 'Invalid request' })).toEqual({
      code: 'INVALID_INPUT', message: 'Invalid request',
    });
  });

  it('rejects malformed codes, empty or oversized messages, and unknown fields', () => {
    expect(ApiErrorSchema.safeParse({ code: 'invalid-input', message: 'Invalid request' }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: 'INVALID_INPUT', message: '' }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: 'INVALID_INPUT', message: 'x'.repeat(501) }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ code: 'INVALID_INPUT', message: 'Invalid request', details: {} }).success).toBe(false);
  });
});
