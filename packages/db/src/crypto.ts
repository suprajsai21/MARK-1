import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits authentication tag
const VERSION_PREFIX = 'v1';

export class CryptoError extends Error {
  constructor(
    readonly code: 'ENCRYPTION_KEY_REQUIRED' | 'ENCRYPTION_KEY_INVALID' | 'DECRYPTION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Validates that an encryption key is present and strictly 32 bytes (256 bits).
 * Accepts hex (64 chars) or base64 (44 chars) or raw 32 bytes string.
 */
export function validateEncryptionKey(keyInput?: string | undefined): Buffer {
  if (!keyInput || !keyInput.trim()) {
    throw new CryptoError(
      'ENCRYPTION_KEY_REQUIRED',
      'MAIL_TOKEN_ENCRYPTION_KEY is required and cannot be empty.',
    );
  }

  const trimmed = keyInput.trim();
  let buffer: Buffer;

  // Hex: 64 characters
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    buffer = Buffer.from(trimmed, 'hex');
  } else if (/^[A-Za-z0-9+/=]{43,44}$/.test(trimmed)) {
    buffer = Buffer.from(trimmed, 'base64');
  } else {
    buffer = Buffer.from(trimmed, 'utf8');
  }

  if (buffer.length !== 32) {
    throw new CryptoError(
      'ENCRYPTION_KEY_INVALID',
      `MAIL_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (got ${buffer.length} bytes). Use 64 hex characters or 32 bytes base64.`,
    );
  }

  return buffer;
}

/**
 * Encrypts a plaintext secret string using AES-256-GCM authenticated encryption.
 * Generates a fresh cryptographically random 12-byte IV for every invocation.
 * Returns a serialized envelope format: `v1:<iv-base64url>:<tag-base64url>:<ciphertext-base64url>`.
 */
export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new CryptoError(
      'ENCRYPTION_KEY_INVALID',
      'Encryption key must be exactly 32 bytes for AES-256-GCM.',
    );
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return `${VERSION_PREFIX}:${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/**
 * Decrypts a token encrypted with `encryptToken`.
 * Authenticates the envelope using GCM authentication tag before returning plaintext.
 * Throws a CryptoError if tampered with or if decryption fails.
 */
export function decryptToken(envelope: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new CryptoError(
      'ENCRYPTION_KEY_INVALID',
      'Encryption key must be exactly 32 bytes for AES-256-GCM.',
    );
  }

  const parts = envelope.split(':');
  if (parts.length !== 4) {
    throw new CryptoError('DECRYPTION_FAILED', 'Malformed encrypted token envelope.');
  }

  const [version, ivStr, tagStr, ciphertextStr] = parts;
  if (!version || !ivStr || !tagStr || !ciphertextStr) {
    throw new CryptoError('DECRYPTION_FAILED', 'Malformed encrypted token envelope.');
  }

  if (version !== VERSION_PREFIX) {
    throw new CryptoError('DECRYPTION_FAILED', `Unsupported encrypted envelope version: ${version}`);
  }

  try {
    const iv = Buffer.from(ivStr, 'base64url');
    const authTag = Buffer.from(tagStr, 'base64url');
    const ciphertext = Buffer.from(ciphertextStr, 'base64url');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid IV or tag dimensions');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch {
    throw new CryptoError(
      'DECRYPTION_FAILED',
      'Token decryption failed: payload authentication error or data tampering detected.',
    );
  }
}
