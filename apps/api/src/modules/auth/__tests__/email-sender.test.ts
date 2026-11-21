import { describe, expect, it, vi } from 'vitest';
import { createTransport } from 'nodemailer';
import { createEmailSender } from '../email-sender.js';

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

describe('createEmailSender', () => {
  it('uses Resend STARTTLS on port 587 with its API-key SMTP auth', () => {
    createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'MARK-1 <auth@mail.example.com>',
      SMTP_URL: 'smtp://resend:re_test_value@smtp.resend.com:587',
      SMTP_SECURE: 'true',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.resend.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'resend', pass: 're_test_value' },
    });
  });

  it('uses implicit TLS when the Resend endpoint uses port 465', () => {
    createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'MARK-1 <auth@mail.example.com>',
      SMTP_URL: 'smtp://resend:re_test_value@smtp.resend.com:465',
      SMTP_SECURE: 'true',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'resend', pass: 're_test_value' },
    });
  });

  it('rejects production SMTP settings without authentication', () => {
    expect(() => createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'MARK-1 <auth@mail.example.com>',
      SMTP_URL: 'smtp://smtp.resend.com:587',
      SMTP_SECURE: 'true',
    })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });

  it('rejects an invalid SMTP_SECURE value', () => {
    expect(() => createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'MARK-1 <auth@mail.example.com>',
      SMTP_URL: 'smtp://resend:re_test_value@smtp.resend.com:587',
      SMTP_SECURE: 'sometimes',
    })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });

  it('fails closed without production SMTP settings', () => {
    expect(() => createEmailSender({ NODE_ENV: 'production' })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
    expect(() => createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'auth@example.com',
      SMTP_URL: 'smtp://localhost:1025',
    })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });
});
