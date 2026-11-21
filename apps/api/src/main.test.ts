import { describe, expect, it } from 'vitest';
import { assertRequiredConfig, readListenConfig } from './main.js';

const base = {
  DATABASE_URL: 'postgresql://op:secret@localhost:5432/mark1',
  WEB_ORIGIN: 'https://app.example',
};

describe('API production startup configuration', () => {
  it('refuses to start without a database URL', () => {
    expect(() => assertRequiredConfig({ ...base, DATABASE_URL: '  ' })).toThrow('DATABASE_URL_REQUIRED');
  });

  it('refuses to start without the web origin', () => {
    expect(() => assertRequiredConfig({ ...base, WEB_ORIGIN: undefined })).toThrow('WEB_ORIGIN_REQUIRED');
  });

  it('refuses a half-configured Razorpay pair', () => {
    expect(() => assertRequiredConfig({ ...base, RAZORPAY_KEY_ID: 'rzp_test_x' }))
      .toThrow('RAZORPAY_CREDENTIALS_INCOMPLETE');
    expect(() => assertRequiredConfig({ ...base, RAZORPAY_KEY_SECRET: 'secret' }))
      .toThrow('RAZORPAY_CREDENTIALS_INCOMPLETE');
  });

  it('accepts a complete configuration', () => {
    expect(() => assertRequiredConfig({
      ...base,
      RAZORPAY_KEY_ID: 'rzp_test_x',
      RAZORPAY_KEY_SECRET: 'secret',
    })).not.toThrow();
  });

  it('validates and defaults the listen address', () => {
    expect(readListenConfig({})).toEqual({ host: '0.0.0.0', port: 3000 });
    expect(readListenConfig({ PORT: '8080', HOST: '127.0.0.1' })).toEqual({ host: '127.0.0.1', port: 8080 });
    expect(() => readListenConfig({ PORT: 'abc' })).toThrow('PORT_INVALID');
    expect(() => readListenConfig({ PORT: '70000' })).toThrow('PORT_INVALID');
  });
});
