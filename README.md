# DockSlot

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
