# MARK-1 auth email delivery with Resend SMTP

MARK-1 sends verification and password-reset email through its existing Nodemailer SMTP transport. Resend's SMTP interface works with this transport; no provider-specific API adapter or extra runtime dependency is needed.

## 1. Prepare Resend

1. Create/sign in to your Resend account.
2. Add a domain you own under **Domains**. Do not use an address/domain you do not control.
3. Publish the exact DNS records Resend displays at your DNS host. Resend commonly requests DKIM and SPF records; use its current dashboard values as authoritative. Add DMARC according to your domain policy.
4. Wait for Resend to mark the sending domain verified.
5. Create an API key with the minimum sending permissions offered for the verified domain. Keep the key private; it is an SMTP password.

Resend Free has been checked as 3,000 transactional emails/month with a 100/day limit. Quotas and policies can change; recheck Resend pricing before launch.

## 2. Configure MARK-1

Set these in the API host's secret/environment settings (Railway Variables for the API service), never in Git, a browser extension, or chat:

| Variable | Value |
| --- | --- |
| `EMAIL_FROM` | `MARK-1 <auth@your-verified-domain.example>` using your verified domain |
| `SMTP_URL` | `smtp://resend:<URL-ENCODED-RESEND-API-KEY>@smtp.resend.com:587` |
| `SMTP_SECURE` | `true` |

Port 587 uses STARTTLS. For implicit TLS, port 465 is also supported: use `smtp://resend:<URL-ENCODED-RESEND-API-KEY>@smtp.resend.com:465` and `SMTP_SECURE=true`. The API interprets 465 as implicit TLS and other secure SMTP ports as STARTTLS.

If the API key contains URL-reserved characters, percent-encode the username/password components before building `SMTP_URL`. Do not put quotes around Railway variable values unless they are part of the actual value. Avoid printing the full SMTP URL in shell output because it contains the secret.

Local development remains `SMTP_URL=smtp://localhost:1025`, `EMAIL_FROM=no-reply@example.test`, and unset `SMTP_SECURE`; production refuses non-TLS SMTP.

## 3. Verify without exposing the key

1. Restart/redeploy only the API service after saving variables.
2. Check service logs privately for startup errors; never copy SMTP URLs or authorization headers into tickets/chat.
3. Use the existing registration or password-reset flow with an address you control. Confirm delivery, sender identity, and links target the expected HTTPS site.
4. Check Resend's delivery events for accepted/delivered/bounced status. Do not mark email delivery complete based only on a successful HTTP/API health probe.
5. Verify that a wrong or missing SMTP configuration fails closed in production; `GET /health/ready` should not reveal configuration or secret values.

## Still required before public production

- A verified sender domain and DNS records.
- Railway access to add the API variables and redeploy; none are stored in this repository.
- A real delivery test to an address you control, plus bounce/suppression and sender-domain checks.
- Production `WEB_ORIGIN` and HTTPS redirect/callback configuration.

The setup guide does not claim that Resend has been configured or that a live email was sent. Provider credentials belong in the deployment secret store only.
