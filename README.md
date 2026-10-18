# DockSlot

## Prioritization & Scope Execution Flow

1. **Phase 1 (P0 Baseline):** I built and verified all mandatory P0 requirements (`A1-A4, A6, W1-W2, B1-B4, N1-N2, Q1-Q2, Q4-Q6, U1-U5`) to ensure a fully functional multi-tenant scheduling core with strict RBAC, localized time handling, and atomic booking constraints.
2. **Phase 2 (Selected P1 Enhancements):** We then implemented high-impact P1 features that solve real-world logistical bottlenecks:
   - **Idempotency (`B6` / `U6`):** Prevents duplicate bookings from mobile retry loops.
   - **Transactional Outbox (`N3`):** Guarantees reliable asynchronous delivery despite slow or failing carrier notification webhooks.
   - **Lock Window (`W4`):** Protects warehouse labor schedules by enforcing a 24-hour modification cutoff.
   - **Rescheduling (`B5`):** Allows flexible adjustments for delayed transport.
3. **Phase 3 (Deferred Architecture Notes):** Remaining P1 and P2 items (such as 2FA `A9`, audit logs `B7`, and maintenance closures `W3`) have comprehensive architectural design briefs documented in `DECISIONS.md`.

Multi-tenant dock slot booking platform for warehouse operators and carriers.

Start the full local stack with:

```sh
docker compose up --build
```

The backend container applies the schema and loads the demo data on boot
(`prisma db push` + `prisma db seed`). See `docker-compose.yml` for the services
and host port overrides.

## Seeded demo accounts

All seeded accounts are pre-verified and share the same password:

| Email | Password | Role | Organization |
| --- | --- | --- | --- |
| `warehouse_admin@lankalogistics.com` | `12345678` | Warehouse Admin | Lanka Logistics Parks |
| `dock_manager@lankalogistics.com` | `12345678` | Dock Manager | Lanka Logistics Parks |
| `warehouse_admin@maasdistribution.com` | `12345678` | Warehouse Admin | Maas Distribution |
| `dock_manager@maasdistribution.com` | `12345678` | Dock Manager | Maas Distribution |
| `carrier_admin@ceylonfreight.com` | `12345678` | Carrier Admin | Ceylon Freight |
| `dispatcher1@ceylonfreight.com` | `12345678` | Dispatcher | Ceylon Freight |
| `dispatcher2@ceylonfreight.com` | `12345678` | Dispatcher | Ceylon Freight |
| `carrier_admin@gulfhaulage.com` | `12345678` | Carrier Admin | Gulf Haulage |
| `dispatcher@gulfhaulage.com` | `12345678` | Dispatcher | Gulf Haulage |

> The seed is destructive: it clears and recreates the demo data on every run.
> Use `docker compose down -v` to start from a clean database.

## Seeded warehouses

| Warehouse | Operator | Timezone | Operating hours | Slot length | Docks |
| --- | --- | --- | --- | --- | --- |
| Colombo DC | Lanka Logistics Parks | `Asia/Colombo` | Mon–Sat 06:00–22:00 | 60 min | 4 |
| Jebel Ali Hub | Lanka Logistics Parks | `Asia/Dubai` | Every day 07:00–19:00 | 30 min | 3 |
| Rotterdam Port DC | Maas Distribution | `Europe/Amsterdam` | 24/7 | 60 min | 6 |

## Running tests

The suite is integration-level: it boots the real Express app and exercises a
real MySQL database through Prisma — nothing is mocked. One command applies the
schema and runs **all** tests against that database:

```sh
cd backend
npm run test:db
```

`test:db` runs `prisma db push` (to sync the schema with `DATABASE_URL`) and then
the full Vitest suite.

If the schema is already applied and you only want to re-run the tests:

```sh
cd backend
npm test
```

Prerequisites: installed dependencies (`npm ci`), a generated Prisma client
(`npx prisma generate`), and a reachable MySQL — the same `DATABASE_URL` the app
uses (see `backend/.env`). The tests are stateful, so point `DATABASE_URL` at a
dedicated test database for deterministic results; the bundled stack's database
can be reset with `docker compose down -v`.

Top 3 risks if this went to production next week

What happens: In production, the in-memory fallback for Redis is disabled, meaning any Redis outage causes every /api route to throw a 500 error. The Redis client stops attempting to reconnect after just two tries, and the /health endpoint only pings MySQL.

The impact: If Redis goes down, the entire API breaks, but because MySQL remains healthy, the /health endpoint continues to report 200 UP. Orchestrators (like Docker or Kubernetes) will not restart the container, resulting in a silent, permanent outage requiring manual intervention.

The fix: Implement High Availability for Redis, fix the client retry strategy to keep backing off, and expand the /health probe to actively check Redis connectivity.

What is not done - all the main requirements are full filled
i did not messure time exactly, i think i reached the 24 h mark in the proxy configuration area.

Issue i faced - 

in the final day i attempted to export the session after the run because i hit the limit on my model, but when I list sessions with space factory session list the session no longer appeared. I retried the export and many other thing but the CLI returned no file. but all the ai sessions upto that point are available 