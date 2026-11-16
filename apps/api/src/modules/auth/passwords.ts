import { randomBytes, timingSafeEqual } from 'node:crypto';
import crypto from 'node:crypto';

const PARAMETERS = {
  parallelism: 2,
  tagLength: 32,
  memory: 19_456,
  passes: 2,
};

function derive(password: string, nonce: Buffer, parameters = PARAMETERS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Node.js 24 has crypto.argon2
    const argon2Fn = (crypto as unknown as {
      argon2: (
        algorithm: string,
        options: Record<string, unknown>,
        callback: (error: Error | null, derived: Buffer) => void,
      ) => void;
    }).argon2;

    argon2Fn('argon2id', { ...parameters, message: password, nonce }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const derived = await derive(password, nonce);
  return `$argon2id$v=19$m=${PARAMETERS.memory},t=${PARAMETERS.passes},p=${PARAMETERS.parallelism}$${nonce.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
  if (!match) return false;
  const [, memoryText, passesText, parallelismText, nonceText, digestText] = match;
  const memory = Number(memoryText);
  const passes = Number(passesText);
  const parallelism = Number(parallelismText);
  const nonce = Buffer.from(nonceText!, 'base64url');
  const expected = Buffer.from(digestText!, 'base64url');
  if (nonce.length < 8 || expected.length < 16 || memory < 8 * parallelism || passes < 1 || parallelism < 1) {
    return false;
  }
  try {
    const actual = await derive(password, nonce, {
      ...PARAMETERS,
      memory,
      passes,
      parallelism,
      tagLength: expected.length,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
