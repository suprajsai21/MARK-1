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
