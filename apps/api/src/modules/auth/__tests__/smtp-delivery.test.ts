import { describe, expect, it } from 'vitest';
import type { Transporter } from 'nodemailer';
import { SmtpEmailSender } from '../email-sender.js';

type SentMail = { from: string; to: string; subject: string; text: string };

function fakeTransport(sent: SentMail[]): Transporter {
  return {
    sendMail: async (message: SentMail) => {
      sent.push(message);
      return { messageId: 'test' };
    },
  } as unknown as Transporter;
}

const expiresAt = new Date('2026-11-18T00:00:00.000Z');

describe('SMTP email delivery', () => {
  it('sends the verification link through the configured transport', async () => {
    const sent: SentMail[] = [];
    const sender = new SmtpEmailSender(fakeTransport(sent), 'no-reply@example.test');

    await sender.sendVerificationEmail({
      to: 'customer@example.test',
      verificationUrl: 'https://portal.example.test/verify?token=opaque',
      expiresAt,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe('no-reply@example.test');
    expect(sent[0]!.to).toBe('customer@example.test');
    expect(sent[0]!.subject).toContain('Verify');
    expect(sent[0]!.text).toContain('https://portal.example.test/verify?token=opaque');
    expect(sent[0]!.text).toContain(expiresAt.toISOString());
  });

  it('sends the password-reset link through the configured transport', async () => {
    const sent: SentMail[] = [];
    const sender = new SmtpEmailSender(fakeTransport(sent), 'no-reply@example.test');

    await sender.sendPasswordResetEmail({
      to: 'customer@example.test',
      resetUrl: 'https://portal.example.test/reset?token=opaque',
      expiresAt,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain('Reset');
    expect(sent[0]!.text).toContain('https://portal.example.test/reset?token=opaque');
  });

  it('propagates transport failures so registration can stay recoverable', async () => {
    const sender = new SmtpEmailSender(
      {
        sendMail: async () => {
          throw new Error('SMTP_UNAVAILABLE');
        },
      } as unknown as Transporter,
      'no-reply@example.test',
    );

    await expect(
      sender.sendVerificationEmail({
        to: 'customer@example.test',
        verificationUrl: 'https://portal.example.test/verify?token=opaque',
        expiresAt,
      }),
    ).rejects.toThrow('SMTP_UNAVAILABLE');
  });
});
