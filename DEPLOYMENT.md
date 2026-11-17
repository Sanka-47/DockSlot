# Free Demo Deployment

This guide describes a zero-cost demo deployment for DockSlot. It is intentionally
optimized for a public interview/demo environment, not for production traffic.

## Recommended topology

| Layer        | Service                     | Free-tier role                               |
| ------------ | --------------------------- | -------------------------------------------- |
| Frontend     | Cloudflare Workers (assets) | Static Vite SPA, TLS, SPA fallback           |
| Backend      | Render Free Web Service     | Existing Docker image, API + outbox worker   |
| Database     | TiDB Cloud Starter          | MySQL-compatible Prisma database             |
| Redis        | Render Key Value Free       | Rate limiting and short-lived auth caches    |
| Email        | Resend or Brevo HTTPS API   | Optional; required when the host blocks SMTP |
| Mock carrier | Same Render container       | Internal webhook receiver on port 4001       |

```text
Browser
  -> Cloudflare Workers (React SPA static assets)
  -> Render Free Web Service (Express API + outbox worker + mock carrier)
       -> TiDB Cloud Starter (MySQL)
       -> Render Key Value (Redis)
       -> Resend/Brevo HTTPS API (optional email)
```

## Why this topology

- The backend is a long-running Node process with an in-process outbox worker, so
  it does not fit a serverless-function deployment model.
- The existing root `Dockerfile` builds both the API and the mock carrier.
- TiDB Cloud Starter speaks the MySQL protocol, so Prisma keeps
  `provider = "mysql"` and no schema rewrite is needed.
- Redis is required in production for distributed rate limiting and the
  `tokenVersion` cache. Render Key Value provides a free Redis-compatible
  instance.
- Cloudflare Workers static assets serve the Vite build and apply the generated
  `_headers` file at the edge.

## Free-tier limits and trade-offs

| Limit                                                     | Impact                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Render free services sleep after 15 minutes idle          | First request can take 30-60 seconds                                  |
| Render free services block outbound SMTP ports 25/465/587 | Use Resend/Brevo HTTPS APIs or seeded accounts                        |
| Render Key Value free is 25 MB and in-memory              | Rate limits/cache reset on restart; durable auth state stays in MySQL |
| TiDB free plan is performance-limited                     | Suitable for a demo; monitor request-unit usage                       |
| Free providers can change quotas                          | Verify before a live demo and keep Docker Compose as a fallback       |

The seeded demo accounts are pre-verified. Login and dashboard demos therefore
work even if email delivery is disabled.

## Prerequisites

- A GitHub repository containing the branch to deploy
- Cloudflare account
- Render account connected to GitHub
- TiDB Cloud account
- Optional: Resend or Brevo account

Some providers may ask for card verification. Stay on the free plan and set any
available spending limit to `$0`.

## 1. Provision the MySQL-compatible database

1. Create a TiDB Cloud Starter instance in the region closest to Render.
2. Create a database named `dockslot_db`.
3. Create a dedicated user (do not use `root`).
4. Copy the connection string. It should look like:

```text
mysql://USER:PASSWORD@HOST:4000/dockslot_db?sslaccept=strict&connection_limit=5
```

If the password contains URL-reserved characters, URL-encode it.

5. If TiDB requires an IP allowlist, allow your local IP for schema setup and
   Render egress for runtime. For a demo with dynamic egress, `0.0.0.0/0` is the
   pragmatic choice; use a strong password and TLS.
6. Apply the schema and seed the demo data once from your machine:

```sh
cd backend
# Put the TiDB URL in backend/.env as DATABASE_URL
npx prisma db push
npx prisma db seed
```

Do **not** add `prisma db push` or `prisma db seed` to the Render start command.
The seed is destructive, and free services restart/sleep. Run it only when you
intentionally want to reset the demo data.

## 2. Provision Redis

Create a free Render Key Value instance in the same region as the backend. Copy
the internal `REDIS_URL`.

If Render Key Value is unavailable, Upstash Redis Free is a fallback. Use the
`rediss://` URL it provides.

## 3. Deploy the backend on Render

Create a new Web Service with:

- Repository: the DockSlot repository
- Branch: the branch to deploy
- Runtime: Docker
- Root directory: repository root
- Dockerfile path: `./Dockerfile`
- Health check path: `/health`
- Instance type: Free
- Start command: use the mock-carrier command below, or `node dist/index.js`

To run the mock carrier inside the API container:

```sh
sh -c "node dist/mock-carrier/server.js & sleep 1; exec node dist/index.js"
```

Render only routes external traffic to the API port. The mock carrier remains
internal on port 4001.

### Backend environment variables

| Variable                        | Value                                              |
| ------------------------------- | -------------------------------------------------- |
| `NODE_ENV`                      | `production`                                       |
| `DATABASE_URL`                  | TiDB connection string                             |
| `REDIS_URL`                     | Render Key Value internal URL                      |
| `JWT_ACCESS_SECRET`             | 32+ random characters                              |
| `JWT_REFRESH_SECRET`            | different 32+ random characters                    |
| `TOTP_ENCRYPTION_KEY`           | base64/hex value decoding to exactly 32 bytes      |
| `JWT_ISSUER`                    | `dockslot-api`                                     |
| `JWT_AUDIENCE`                  | `dockslot-web`                                     |
| `CORS_ORIGIN`                   | `https://dockslot.<account-subdomain>.workers.dev` |
| `COOKIE_SAME_SITE`              | `none`                                             |
| `COOKIE_SECURE`                 | `true`                                             |
| `TRUST_PROXY`                   | `1`                                                |
| `APP_URL`                       | `https://<render-service>.onrender.com`            |
| `FRONTEND_URL`                  | `https://dockslot.<account-subdomain>.workers.dev` |
| `CARRIER_NOTIFY_URL`            | `http://127.0.0.1:4001/notify`                     |
| `OUTBOX_WORKER_ENABLED`         | `true`                                             |
| `MOCK_CARRIER_SIMULATE_CHAOS`   | `false` for a smooth demo; `true` to show retries  |
| `LOG_LEVEL`                     | `info`                                             |
| `PASSWORD_BREACH_CHECK_ENABLED` | `false`                                            |
| `HEALTH_CHECK_TIMEOUT_MS`       | `3000`                                             |

Generate secrets independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Do not set `PORT`; Render injects it.

If the Worker URL is not known yet, set `CORS_ORIGIN` to a temporary HTTPS
placeholder and update it after step 4. If you attach a custom domain, use that
origin instead of the `workers.dev` URL.

## 4. Deploy the frontend on Cloudflare Workers

Connect the repository and configure:

- Root directory: `frontend`
- Build command: `npm ci && npm run build`
- Deploy command: `npx wrangler deploy`
- Output directory: `dist`
- Environment variable: `VITE_API_URL=https://<render-service>.onrender.com/api`
- `NODE_VERSION=22`

`VITE_API_URL` is baked into the build. If the Render URL changes, rebuild the
frontend.

The production build writes `dist/_headers` from the same validated API origin,
so the CSP `connect-src` cannot drift from `VITE_API_URL`. `frontend/wrangler.jsonc`
configures Workers static assets with:

```jsonc
"assets": {
  "directory": "./dist",
  "not_found_handling": "single-page-application"
}
```

That setting is the SPA fallback and keeps deep links such as `/reset-password`
and `/accept-invite` working. Do **not** add `/* /index.html 200` to a
`_redirects` file for Workers: Cloudflare rejects it as an infinite rewrite loop.
If you deploy with Cloudflare Pages instead, remove/ignore `wrangler.jsonc` and
use `frontend/public/_redirects` with `/* /index.html 200`.

After the first Workers deploy:

1. Set Render `CORS_ORIGIN`, `APP_URL`, and `FRONTEND_URL` to the real URLs.
2. Redeploy the backend.
3. Rebuild/redeploy the frontend if the API origin changed.

## 5. Configure email delivery

Email is optional for the seeded demo. To enable real delivery, choose one of
the following.

### HTTPS API on Render free

```text
EMAIL_PROVIDER=resend
EMAIL_FROM="DockSlot <no-reply@your-verified-domain>"
RESEND_API_KEY=...
```

or:

```text
EMAIL_PROVIDER=brevo
EMAIL_FROM="DockSlot <no-reply@your-verified-domain>"
BREVO_API_KEY=...
```

Resend/Brevo require a verified sender domain for reliable delivery. For a quick
test, follow the provider's test-sender instructions.

### Authenticated SMTP on a VM

```text
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_IGNORE_TLS=false
SMTP_REQUIRE_TLS=true
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM="DockSlot <no-reply@your-verified-domain>"
```

Render free blocks these SMTP ports. This option is for a VM or another host
that permits outbound SMTP.

## 6. Verify the deployment

Backend health:

```sh
curl -i https://<render-service>.onrender.com/health
```

Expected: `200` with `"status":"UP"` and `"database":"connected"`.

CORS preflight:

```sh
curl -i -X OPTIONS https://<render-service>.onrender.com/api/auth/login \
  -H "Origin: https://dockslot.<account-subdomain>.workers.dev" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `access-control-allow-origin` and
`access-control-allow-credentials: true`.

SPA deep link:

```sh
curl -I "https://dockslot.<account-subdomain>.workers.dev/reset-password?token=test"
```

Expected: `200` HTML, not `404`.

Browser checklist:

- Log in with a seeded warehouse admin.
- Reload the page and confirm the session persists.
- Check the `refreshToken` cookie: `HttpOnly`, `Secure`, `SameSite=None`,
  `Path=/api/auth`.
- Create a booking as a carrier and confirm it appears for the dock manager.
- Check Render logs for outbox and mock-carrier activity.
- Confirm there are no CSP errors in the browser console.
- Confirm `Strict-Transport-Security` and CSP headers are present on the Worker
  response.

## 7. Demo hardening

- Treat the seeded credentials as public. Reset the data after a public demo, or
  protect the site with Cloudflare Access.
- CORS is not access control. A public API can still be called directly.
- Keep real data out of the demo environment.
- Set the TiDB spending limit to `$0`.
- Frontend and API are on different sites (`workers.dev` and `onrender.com`), so
  the refresh cookie is third-party. Chrome/Firefox generally accept
  `SameSite=None; Secure`, but Safari may block it. If refresh fails there, add a
  same-origin `/api` proxy in a Worker or put both hosts under one registrable
  custom domain.
- Warm the Render service before an interview:

```sh
curl https://<render-service>.onrender.com/health
```

- Keep `docker compose up --build` as a local fallback.

## Alternative: always-on free VM

If cold starts or SMTP are unacceptable, use an Oracle Cloud Always Free ARM VM:

- Install Docker and Docker Compose.
- Run the existing `docker-compose.yml` for MySQL, Redis, the backend, and the
  mock carrier.
- Put Caddy or Nginx in front for HTTPS, or use Cloudflare Tunnel.
- Use a free DuckDNS domain or a Cloudflare-managed domain.
- Configure authenticated SMTP or the HTTPS email provider above.

This removes cold starts and keeps MySQL/Redis local, but requires patching,
backups, TLS, and more operational work. Oracle capacity and signup verification
are the main risks.

The Compose backend currently runs `prisma db push` and `prisma db seed` on every
boot. For a persistent VM demo, split that into a one-shot init service or remove
the seed from the normal startup command.

## Troubleshooting

| Symptom                                     | Likely cause                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Render deploy exits on startup              | Missing `CORS_ORIGIN`, JWT secrets, TOTP key, or invalid `DATABASE_URL`                 |
| `/health` returns 503                       | TiDB unreachable, wrong TLS settings, or IP allowlist blocking Render                   |
| Login works but refresh fails               | `COOKIE_SAME_SITE`/`COOKIE_SECURE` incorrect, or CORS origin mismatch                   |
| Login works but refresh fails in Safari     | Third-party cookies blocked; use a same-origin `/api` proxy or one custom domain        |
| Browser reports CSP `connect-src` violation | Rebuild the frontend with the correct `VITE_API_URL`                                    |
| Deep links return 404                       | `frontend/wrangler.jsonc` is missing the SPA `not_found_handling` setting               |
| `Invalid _redirects configuration`          | Remove `/* /index.html 200`; Workers uses `not_found_handling` for SPA fallback         |
| Email sends fail on Render                  | SMTP is blocked; use Resend/Brevo HTTPS or seeded accounts                              |
| Outbox events retry                         | Mock carrier is not running; set `OUTBOX_WORKER_ENABLED=false` or use the start command |
