import type { FastifyInstance } from 'fastify';
import { buildConfiguredServer } from './server.js';

/**
 * Production entrypoint. Configuration failures are fatal and reported before
 * the process serves traffic: a server missing DATABASE_URL, WEB_ORIGIN, or a
 * matched Razorpay key pair must never start healthy.
 */
export type MainEnvironment = Record<string, string | undefined>;

export type StartedServer = {
  app: FastifyInstance;
  close(): Promise<void>;
};

/**
 * Trust exactly the immediate reverse proxy only when explicitly enabled.
 * Do not use `true` for arbitrary public deployments; it would allow clients to
 * spoof forwarded IP headers. For Cloudflare Tunnel, one hop is cloudflared.
 */

export function readListenConfig(environment: MainEnvironment): { host: string; port: number } {
  const rawPort = environment.PORT?.trim() || '3000';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT_INVALID');
  const host = environment.HOST?.trim() || '0.0.0.0';
  return { host, port };
}

/** Required settings must be present and non-empty; nothing is silently defaulted. */
export function assertRequiredConfig(environment: MainEnvironment): void {
  if (!environment.DATABASE_URL?.trim()) throw new Error('DATABASE_URL_REQUIRED');
  if (!environment.WEB_ORIGIN?.trim()) throw new Error('WEB_ORIGIN_REQUIRED');
  const keyId = environment.RAZORPAY_KEY_ID?.trim();
  const keySecret = environment.RAZORPAY_KEY_SECRET?.trim();
  if (Boolean(keyId) !== Boolean(keySecret)) throw new Error('RAZORPAY_CREDENTIALS_INCOMPLETE');
}

export async function startServer(environment: MainEnvironment): Promise<StartedServer> {
  assertRequiredConfig(environment);
  const { host, port } = readListenConfig(environment);
  const app = buildConfiguredServer(environment, {}, { trustProxy: environment.TRUST_PROXY === '1' });
  await app.listen({ host, port });

  return {
    app,
    async close() {
      await app.close();
    },
  };
}

async function main(): Promise<void> {
  const started = await startServer(process.env);

  const shutdown = async (signal: string) => {
    process.stdout.write(`received ${signal}; closing server\n`);
    try {
      await started.close();
      process.exit(0);
    } catch (error) {
      process.stderr.write(`shutdown failed: ${(error as Error).message}\n`);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('/main.js') ?? false;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(1);
  });
}
