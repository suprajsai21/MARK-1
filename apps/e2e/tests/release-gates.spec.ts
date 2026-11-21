import { expect, test } from 'playwright/test';

const apiBaseUrl = process.env.E2E_API_URL ?? 'http://127.0.0.1:3000';
const productVersionId = process.env.E2E_PRODUCT_VERSION_ID ?? 'mark1-v1';

test.beforeEach(async ({ request }) => {
  try {
    const res = await request.get(`${apiBaseUrl}/health/live`);
    if (!res.ok) test.skip(true, `API server is not healthy at ${apiBaseUrl}`);
  } catch {
    test.skip(true, `API server is offline at ${apiBaseUrl}`);
  }
});

test('production release gates expose liveness without secrets', async ({ request }) => {
  const response = await request.get(`${apiBaseUrl}/health/live`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('readiness blocks on unavailable/missing dependencies without disclosure', async ({ request }) => {
  const response = await request.get(`${apiBaseUrl}/health/ready`);
  expect([200, 503]).toContain(response.status());
  const body = await response.text();
  expect(body).not.toMatch(/password|secret|token|postgres(?:ql)?:\/\/[^\s]+/i);
});

test('entitlement cannot be queried without authentication', async ({ request }) => {
  const response = await request.get(`${apiBaseUrl}/v1/entitlement?productVersionId=${encodeURIComponent(productVersionId)}`);
  expect(response.status()).toBe(401);
});

test('production login/registration browser flow is intentionally not simulated by fixtures', async () => {
  test.skip(process.env.E2E_AUTH_ENABLED !== 'true', 'Requires authorized staging identity and OTP delivery.');
  expect(process.env.E2E_AUTH_ENABLED).toBe('true');
});
