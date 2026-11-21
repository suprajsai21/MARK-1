import { describe, expect, it } from 'vitest';
import {
  decryptToken,
  encryptToken,
  validateEncryptionKey,
} from '../crypto.js';

describe('Token encryption and decryption', () => {
  const validHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex chars = 32 bytes
  const validBase64Key = Buffer.from('12345678901234567890123456789012').toString('base64'); // 32 bytes base64

  it('validates a 32-byte hex key correctly', () => {
    const key = validateEncryptionKey(validHexKey);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('validates a 32-byte base64 key correctly', () => {
    const key = validateEncryptionKey(validBase64Key);
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('rejects missing or empty encryption key', () => {
    expect(() => validateEncryptionKey(undefined)).toThrowError(/MAIL_TOKEN_ENCRYPTION_KEY/);
    expect(() => validateEncryptionKey('')).toThrowError(/MAIL_TOKEN_ENCRYPTION_KEY/);
    expect(() => validateEncryptionKey('   ')).toThrowError(/MAIL_TOKEN_ENCRYPTION_KEY/);
  });

  it('rejects an invalid length key', () => {
    expect(() => validateEncryptionKey('too-short')).toThrowError(/32 bytes/);
    expect(() => validateEncryptionKey('0123456789abcdef')).toThrowError(/32 bytes/);
  });

  it('encrypts and decrypts a token successfully with authenticated AES-256-GCM', () => {
    const key = validateEncryptionKey(validHexKey);
    const plaintext = 'ya29.a0AfH6SM...secret_oauth_token_12345';

    const envelope = encryptToken(plaintext, key);
    expect(envelope).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

    const decrypted = decryptToken(envelope, key);
    expect(decrypted).toBe(plaintext);
  });

  it('generates unique IVs and ciphertexts for identical plaintexts (IND-CPA)', () => {
    const key = validateEncryptionKey(validHexKey);
    const plaintext = 'same_secret_token';

    const enc1 = encryptToken(plaintext, key);
    const enc2 = encryptToken(plaintext, key);

    expect(enc1).not.toBe(enc2);
    expect(decryptToken(enc1, key)).toBe(plaintext);
    expect(decryptToken(enc2, key)).toBe(plaintext);
  });

  it('fails decryption if ciphertext is tampered with (integrity violation)', () => {
    const key = validateEncryptionKey(validHexKey);
    const plaintext = 'sensitive_refresh_token';
    const envelope = encryptToken(plaintext, key);

    const parts = envelope.split(':');
    const ciphertext = parts[3]!;
    const tamperedCiphertext = ciphertext.slice(0, -2) + (ciphertext.endsWith('a') ? 'b' : 'a');
    const tamperedEnvelope = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCiphertext}`;

    expect(() => decryptToken(tamperedEnvelope, key)).toThrowError(/decryption.*failed|tamper/i);
  });

  it('fails decryption if auth tag is tampered with', () => {
    const key = validateEncryptionKey(validHexKey);
    const plaintext = 'sensitive_refresh_token';
    const envelope = encryptToken(plaintext, key);

    const parts = envelope.split(':');
    const tag = parts[2]!;
    const tamperedTag = tag.slice(0, -2) + (tag.endsWith('a') ? 'b' : 'a');
    const tamperedEnvelope = `${parts[0]}:${parts[1]}:${tamperedTag}:${parts[3]}`;

    expect(() => decryptToken(tamperedEnvelope, key)).toThrowError(/decryption.*failed|tamper/i);
  });

  it('fails decryption if wrong key is used', () => {
    const key1 = validateEncryptionKey(validHexKey);
    const key2 = validateEncryptionKey('fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210');
    const plaintext = 'confidential_token';

    const envelope = encryptToken(plaintext, key1);
    expect(() => decryptToken(envelope, key2)).toThrowError(/decryption.*failed|tamper/i);
  });

  it('fails decryption on malformed envelopes', () => {
    const key = validateEncryptionKey(validHexKey);
    expect(() => decryptToken('not-a-valid-envelope', key)).toThrowError(/Malformed/i);
    expect(() => decryptToken('v2:invalid:envelope:token', key)).toThrowError(/version/i);
  });
});
