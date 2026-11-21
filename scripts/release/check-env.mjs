const required = ['DATABASE_URL', 'WEB_ORIGIN', 'LINK_SUBJECT_HMAC_SECRET'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  process.stderr.write(`Missing required release configuration: ${missing.join(', ')}\n`);
  process.exit(1);
}
for (const name of ['LINK_SUBJECT_HMAC_SECRET']) {
  const value = process.env[name] ?? '';
  if (value.length < 32 || /^(change-me|replace|example|test)/i.test(value)) {
    process.stderr.write(`Invalid release secret: ${name} must be a unique value of at least 32 characters.\n`);
    process.exitCode = 1;
  }
}
try {
  const databaseUrl = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) throw new Error();
} catch {
  process.stderr.write('DATABASE_URL must be a valid PostgreSQL connection URL.\n');
  process.exitCode = 1;
}
try {
  const origin = new URL(process.env.WEB_ORIGIN);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== process.env.WEB_ORIGIN.replace(/\/$/, '')) throw new Error();
  if (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') throw new Error();
} catch {
  process.stderr.write('WEB_ORIGIN must be an exact HTTP(S) origin; production requires HTTPS.\n');
  process.exitCode = 1;
}
if (process.env.NODE_ENV === 'production') {
  for (const name of ['OAUTH_CLIENT_ID', 'OAUTH_REDIRECT_URIS', 'EMAIL_FROM', 'SMTP_URL']) {
    if (!process.env[name]?.trim()) {
      process.stderr.write(`Missing required release configuration: ${name}\n`);
      process.exitCode = 1;
    }
  }
}
