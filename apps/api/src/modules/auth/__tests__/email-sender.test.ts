import { describe, expect, it } from 'vitest';
import { createEmailSender } from '../email-sender.js';

describe('email sender configuration', () => {
  it('selects local mail capture from configured SMTP URL', () => {
    const sender = createEmailSender({
      NODE_ENV: 'development',
      EMAIL_FROM: 'customer@example.test',
      SMTP_URL: 'smtp://localhost:1025',
    });
    expect(sender.constructor.name).toBe('SmtpEmailSender');
  });

  it('fails closed in production when SMTP settings are missing', () => {
    expect(() => createEmailSender({ NODE_ENV: 'production' })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });

  it('rejects unsafe or malformed SMTP configuration', () => {
    expect(() => createEmailSender({
      NODE_ENV: 'production',
      EMAIL_FROM: 'sender@example.test',
      SMTP_URL: 'not-a-valid-url',
    })).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });
});
