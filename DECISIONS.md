# DECISIONS.md

## D-01: Choosing Prisma for Database Management
* **Status:** built and tested
* **Problem:** We needed a reliable way to manage database changes and write queries. Writing raw SQL gives full control but is hard to update safely as the project grows.
* **Options considered:**
  * Option A: Raw SQL migrations (Pros: Total control. Cons: No type safety, hard to track).
  * Option B: Sequelize ORM (Pros: Popular. Cons: Verbose, weaker TypeScript support).
  * Option C: Prisma (Pros: Clean migrations, auto-generated type safety, easy schemas. Cons: Heavy abstraction).
* **Decision:** I chose Prisma because it balances speed and type safety while still letting us write raw SQL when we need special database features.
* **What would make me change it:** If we needed advanced custom SQL triggers or stored procedures for extreme scaling.
* **How I checked it:** Ran `prisma migrate dev` and tested database queries in TypeScript.
* **Sources:** Prisma documentation.
* **AI involvement:** AI suggested Prisma; I kept it and planned raw SQL overrides for edge cases.

---

## D-02: Choosing Vitest and Supertest over Jest
* **Status:** built and tested
* **Problem:** Jest requires complicated configuration for TypeScript and modern Node.js, which slows down testing.
* **Options considered:**
  * Option A: Jest + ts-jest (Pros: Industry standard. Cons: Slow, complex setup).
  * Option B: Vitest + Supertest (Pros: Fast startup, native TypeScript support, easy HTTP API testing. Cons: Newer ecosystem).
* **Decision:** I chose Vitest and Supertest because they run instantly and work smoothly with modern TypeScript.
* **What would make me change it:** If enterprise testing rules required legacy test tools.
* **How I checked it:** Ran test suites locally and verified all tests passed.
* **Sources:** Vitest documentation.
* **AI involvement:** AI recommended Vitest; I adopted it for speed and simplicity.

---

## D-03: Balancing 24-Hour Locks with Rescheduling and Booking Limits
* **Status:** built and tested
* **Problem:** Strict 24-hour locks block all changes, but real trucks get delayed by traffic. However, total last-minute cancellations ruin warehouse labor planning.
* **Options considered:**
  * Option A: Complete Lockout (Pros: Predictable labor. Cons: Unrealistic when trucks hit traffic).
  * Option B: Flexible Policy (Pros: Allows rescheduling delayed trucks to help warehouses, while blocking last-minute cancellations).
* **Decision:** I chose to hard-lock cancellations within 24 hours to protect warehouse labor, but allow rescheduling anytime for delayed trucks. We also added limits (max 3 active bookings per carrier per warehouse and a 14-day advance booking limit) to prevent booking hoarding.
* **What would make me change it:** If warehouse operators demanded complete rigidity or required refunds for late cancellations.
* **How I checked it:** Tested booking rules and time windows against validation tests.
* **Sources:** Logistics management best practices.
* **AI involvement:** AI helped discuss trade-offs; I defined the final rules.

---

## D-04: Restricting Warehouse and Dock Updates When Active Bookings Exist
* **Status:** built and tested
* **Problem:** Changing warehouse operating hours or dock details while active bookings exist causes scheduling conflicts and confusion.
* **Options considered:**
  * Option A: Allow Unrestricted Edits (Pros: Easy code. Cons: Messes up existing bookings).
  * Option B: Block Updates When Active Bookings Exist (Pros: Protects data accuracy).
* **Decision:** I chose to block warehouse and dock updates if there are active bookings in that time frame.
* **What would make me change it:** If the system needed live, instant schedule changes without checking existing bookings.
* **How I checked it:** Tested update routes against mock databases with active bookings.
* **Sources:** Database design patterns.
* **AI involvement:** AI pointed out race conditions; I specified the validation rule to block updates when active bookings exist.

---

## D-05: Frontend UI Stack Selection
* **Status:** built and tested
* **Problem:** Heavy UI libraries fight custom styling, while writing plain CSS from scratch takes too long. We needed a clean industrial look (Slate Blue and Light Silver).
* **Options considered:**
  * Option A: Material-UI / Ant Design (Pros: Ready-made components. Cons: Heavy, hard to customize colors).
  * Option B: Tailwind CSS + shadcn/ui + Lucide React (Pros: Lightweight, full code ownership, easy custom hex colors).
* **Decision:** I chose Tailwind CSS with shadcn/ui and Lucide React to easily build custom industrial UI themes without framework bloat.
* **What would make me change it:** If strict corporate design guidelines required a different UI framework.
* **How I checked it:** Built and styled the dashboard screens locally.
* **Sources:** Tailwind CSS and shadcn/ui docs.
* **AI involvement:** AI recommended Tailwind and shadcn/ui; I approved it for the industrial theme.

---

## D-06: Using the Outbox Pattern for Reliable Webhooks
* **Status:** built and tested
* **Problem:** Sending webhook notifications directly inside an HTTP database transaction can cause lost notifications if the external receiver is down.
* **Options considered:**
  * Option A: Direct HTTP calls (Pros: Simple. Cons: Fails if the receiver is down).
  * Option B: Heavy Message Brokers like Kafka (Pros: Highly scalable. Cons: Too complex for our MVP).
  * Option C: Transactional Outbox Pattern with MySQL and a background worker (Pros: Guarantees reliable delivery using our existing database).
* **Decision:** I chose the Outbox Pattern (saving events in an outbox table inside the same transaction as the booking) with a background worker to guarantee webhook delivery safely.
* **What would make me change it:** If the system scaled to millions of events per second requiring dedicated event streaming.
* **How I checked it:** Tested booking creation with the mock carrier offline and verified the background worker retried and delivered successfully once online.
* **Sources:** Enterprise integration patterns.
* **AI involvement:** AI suggested the outbox pattern; I implemented the database schema and worker polling loop.

---

## D-07: End-to-End Request Tracing via X-Request-ID
* **Status:** built and tested
* **Problem:** Debugging background tasks (like webhooks) and matching them back to original user requests is hard without a tracking ID.
* **Options considered:**
  * Option A: No tracking (Pros: None. Cons: Hard to debug asynchronous errors).
  * Option B: Paid APM tools (Pros: Automated. Cons: Expensive and heavy).
  * Option C: Middleware-driven X-Request-ID propagation (Pros: Lightweight, free, full control).
* **Decision:** I chose middleware-driven request tracing where a unique request ID is passed through HTTP headers, saved in outbox events, and printed in worker logs.
* **What would make me change it:** If the app adopted a full native cloud observability suite like OpenTelemetry.
* **How I checked it:** Sent custom headers via curl and verified matching trace IDs across request logs and worker logs.
* **Sources:** Distributed logging best practices.
* **AI involvement:** AI proposed the tracing architecture; I integrated it into Express middleware and worker logs.

---

## D-08: Redis-Backed Token Versioning and Caching
* **Status:** built and tested
* **Problem:** Checking user status or revoking tokens instantly requires database lookups, which slow down API requests.
* **Options considered:**
  * Option A: Query MySQL on every request (Pros: Always fresh. Cons: Slow and high database load).
  * Option B: Pure stateless JWT (Pros: Fast. Cons: Impossible to instantly log out a user).
  * Option C: Redis caching for active status and token versions (Pros: Super fast lookups, instant revocation).
* **Decision:** I chose Redis caching for user active states and token versions, checking cache first with a database fallback for fast authentication and instant logout.
* **What would make me change it:** If Redis became unreliable without a backup cache layer.
* **How I checked it:** Monitored Redis keys using `redis-cli` and tested instant token rejection after updating versions.
* **Sources:** Redis documentation.
* **AI involvement:** AI suggested the Redis token versioning pattern; I implemented the middleware verification checks.

---

## D-09: Choosing TypeScript, Node.js/Express, and React
* **Status:** built and tested
* **Problem:** We needed a robust, type-safe language stack across both frontend and backend to catch bugs early and speed up development.
* **Options considered:**
  * Option A: Python (FastAPI/Django) + React (Pros: Great for data science. Cons: Switching languages between backend and frontend).
  * Option B: Java / Spring Boot + React (Pros: Enterprise standard. Cons: Too much boilerplate code).
  * Option C: TypeScript with Node.js/Express and React (Pros: End-to-end type safety, single language ecosystem).
* **Decision:** I chose TypeScript across the entire stack because it provides strong type safety and shares data structures smoothly between the database, backend, and UI.
* **What would make me change it:** If company rules strictly required Java or C# for backend services.
* **How I checked it:** Compiled with `tsc` and tested full-stack integration.
* **Sources:** TypeScript documentation.
* **AI involvement:** AI helped configure TypeScript setups; I wrote all business logic and UI components.

---

## D-10: Choosing HTTP Session Cookies with Redis Validation
* **Status:** built and tested
* **Problem:** Storing tokens in client-side `localStorage` leaves them open to XSS theft, but checking traditional server sessions against MySQL on every request causes lag.
* **Options considered:**
  * Option A: Stateless JWT in localStorage (Pros: Simple. Cons: Vulnerable to XSS).
  * Option B: SQL-backed cookies (Pros: Secure. Cons: Slows down API responses by hitting MySQL constantly).
  * Option C: HTTP session cookies with Redis validation (Pros: HttpOnly cookies block XSS theft, while Redis gives sub-millisecond session checks and instant logout).
* **Decision:** I chose HTTP session cookies combined with Redis session validation to keep user sessions secure from script theft while allowing lightning-fast request checks and instant logout.
* **What would make me change it:** If the app moved to a mobile app or multi-region setup where cookies are less practical.
* **How I checked it:** Verified `HttpOnly` cookie delivery in browser network tabs and tested instant session clearance via Redis.
* **Sources:** OWASP session guidelines.
* **AI involvement:** AI explained cookie security flags; I configured the session middleware and Redis lookup flow.

---

## D-11: Rejecting the Prototype AI-Generated Slot Generator (Starter Code 5.3)
* **Status:** built and tested
* **Problem:** A prototype AI-generated slot generator contained serious bugs: it was time-zone blind (using native JS `Date`), had a day-of-week index mismatch (treating Sunday as 0), and used flawed hour-loop math that broke for non-hourly slots like 45 minutes.
* **Options considered:**
  * Option A: Patch the prototype code (Pros: Keep original code. Cons: Native date timezone bugs require a full rewrite anyway).
  * Option B: Throw it away and write a robust, timezone-aware service (Pros: Eliminates timezone bugs and handles custom slot intervals correctly).
* **Decision:** I chose to throw away the prototype snippet entirely because its timezone blindness and broken math made it unreliable for production logistics, replacing it with a robust timezone-aware scheduling service.
* **What would make me change it:** If the app only operated in a single fixed timezone with uniform hourly slots.
* **How I checked it:** Unit tested slot generation across multiple timezones and slot lengths (30 and 45 minutes).
* **Sources:** JavaScript Date object pitfalls.
* **AI involvement:** An earlier AI tool generated the flawed prototype; I identified its bugs, rejected it, and built a robust replacement.

---

## D-12: Managing Top Production Security Risks (Secrets, CORS, and Headers)
* **Status:** built and tested
* **Problem:** Default configuration values and overly permissive CORS policies can expose the API to unauthorized cross-origin requests or allow attackers to forge admin tokens using default secrets.
* **Options considered:**
  * Option A: Hardcoded default secrets for ease of local developer setup (Pros: Simple `docker compose up`. Cons: Catastrophic security risk if deployed to production without changes).
  * Option B: Fail-fast environment validation with explicit production allowlists (Pros: Prevents accidental insecure deployments. Cons: Requires strict configuration before booting).
* **Decision:** I chose to enforce strict environment validation for production secrets (`JWT_SECRET`, database credentials) and required explicit CORS allowlists instead of reflecting wildcard origins with credentials enabled.
* **What would make me change it:** If the application moved to a fully managed secrets manager service like AWS Secrets Manager or Vault.
* **How I checked it:** Tested container startup behavior with missing environment variables and verified CORS rejection headers in browser dev tools.
* **Sources:** OWASP Top 10 API Security Risks, Express Security Best Practices.
* **AI involvement:** AI suggested permissive defaults; I overwrote them with strict production-gated checks and explicit origin validations.

---

## D-13: Resolving Unclear and Conflicting Requirements
* **Status:** built and tested
* **Problem:** Certain business rules in logistics had ambiguous edge cases—such as handling 24/7 operating schedules crossing midnight (`00:00` to `24:00`), or balancing warehouse labor protection with carrier rescheduling needs.
* **Options considered:**
  * Option A: Strict rigid rejection of any overnight schedules or late changes (Pros: Simple code. Cons: Fails real-world logistics operations where trucks get delayed).
  * Option B: Context-aware boundary rules (Pros: Accommodates overnight shifts and carrier delays while protecting labor planning via a 24-hour cancellation lock).
* **Decision:** I resolved conflicting requirements by implementing explicit midnight-spanning slot logic and separating cancellation rules (locked 24 hours prior) from rescheduling rules (allowed anytime for delayed transport).
* **What would make me change it:** If warehouse operators required complete operational rigidity with zero rescheduling exceptions.
* **How I checked it:** Unit tested slot generation across overnight time boundaries and verified cancellation vs. rescheduling permission checks.
* **Sources:** Warehouse management operations guides and domain feedback.
* **AI involvement:** AI proposed simplistic slot loops that broke at midnight; I redesigned the time-interval logic to correctly handle overnight operating hours.

---

## P1 & P2 Implemented Items

### D-14 (P1): Admin User Invites (Requirement A5)
* **Status:** built and tested
* **Problem:** Organization admins need a secure way to invite new staff members (Dispatchers, Dock Managers) without manually sharing pre-set passwords.
* **Options considered:**
  * Option A: Admin creates user with a temporary password (Pros: Easy. Cons: Unsecure credential sharing).
  * Option B: Secure tokenized invitation email link (Pros: User sets their own password. Cons: Requires invitation expiration tracking).
* **Decision:** Implemented a tokenized invite flow where an Admin generates an invite with a 48-hour TTL token, sending an email via Mailhog/SMTP containing a registration completion link.
* **What would make me change it:** If organization onboarding was strictly single-user per tenant.
* **How I checked it:** Tested invite email token generation and registration completion flow via unit and integration tests.
* **Sources:** OWASP Account Registration Guidelines.
* **AI involvement:** AI outlined basic invite schemas; I implemented and tested the end-to-end token validation flow.

### D-15 (P1): Password Guessing Protection and Rate Limiting (Requirement A7)
* **Status:** built and tested
* **Problem:** Login and password reset endpoints are vulnerable to brute-force credential stuffing and enumeration attacks.
* **Options considered:**
  * Option A: No rate limiting (Pros: Simple. Cons: Highly vulnerable to brute-force).
  * Option B: Redis-backed sliding window rate limiter (Pros: Blocks automated attacks efficiently. Cons: Requires Redis dependency).
* **Decision:** Implemented `express-rate-limit` backed by Redis on `/api/auth/login` to lock out IPs after 5 consecutive failed attempts for 15 minutes.
* **What would make me change it:** If an API gateway or WAF handled rate limiting externally.
* **How I checked it:** Tested rate limiter locks after simulating multiple failed login attempts against the endpoint.
* **Sources:** OWASP Brute Force Protection Guide.
* **AI involvement:** AI suggested basic middleware; I integrated and verified Redis rate-limiting rules.

### D-16 (P1): "Log out of all devices" and User Deactivation (Requirement A8)
* **Status:** built and tested
* **Problem:** Compromised accounts or terminated employees need immediate session revocation across all active browser and mobile instances.
* **Options considered:**
  * Option A: Stateless JWTs (Pros: Fast. Cons: Impossible to revoke without expiration).
  * Option B: Redis session versioning / token blacklist (Pros: Instant revocation. Cons: Requires Redis lookup).
* **Decision:** Leveraged our existing Redis token version counter: incrementing the user's `tokenVersion` instantly invalidates all previously issued session cookies across every device.
* **What would make me change it:** If moving away from Redis architecture.
* **How I checked it:** Tested incrementing `tokenVersion` in Redis and verified instant session rejection on subsequent requests.
* **Sources:** Redis Session Management Patterns.
* **AI involvement:** AI assisted with token version concepts; I wrote and verified the revocation middleware.

### D-17 (P2): TOTP Two-Factor Authentication (Requirement A9)
* **Status:** built and tested
* **Problem:** High-privilege warehouse admin accounts require enhanced security beyond standard passwords.
* **Options considered:**
  * Option A: SMS OTP (Pros: Familiar. Cons: Expensive and vulnerable to SIM-swapping).
  * Option B: Time-based One-Time Password (TOTP) via authenticator apps (Pros: Secure and free. Cons: Requires QR code generation UI).
* **Decision:** Integrated the `speakeasy` library to generate secret keys, display QR codes, and validate 6-digit TOTP codes during login.
* **What would make me change it:** If enterprise SSO (OAuth/SAML) was required instead.
* **How I checked it:** Verified QR code generation and successful 6-digit TOTP code validation during login tests.
* **Sources:** RFC 6238 (TOTP Standard).
* **AI involvement:** AI provided code snippets for speakeasy; I integrated and tested the complete 2FA verification flow.

### D-18 (P1): Maintenance Dock Closures (Requirement W3)
* **Status:** built and tested
* **Problem:** Docks occasionally require physical maintenance, meaning slots during maintenance windows should be blocked from booking.
* **Options considered:**
  * Option A: Delete slots manually (Pros: Simple. Cons: Destructive and prone to error).
  * Option B: DockClosure entity that dynamically filters out overlapping slots (Pros: Clean and non-destructive. Cons: Requires query adjustments).
* **Decision:** Implemented the `DockClosure` model with start/end timestamps and reason codes, filtering them out dynamically during slot search queries.
* **What would make me change it:** If docks never underwent physical maintenance.
* **How I checked it:** Tested that active dock closures successfully block slot creation and filter out results during slot searches.
* **Sources:** Warehouse scheduling domain models.
* **AI involvement:** AI generated initial Prisma models; I integrated service-layer filtering and validations.

### D-19 (P2): Carrier Slot Hog Limits (Requirement W5)
* **Status:** built and tested
* **Problem:** A single aggressive carrier could monopolize all available warehouse loading slots, locking out other carriers.
* **Options considered:**
  * Option A: Unrestricted bookings (Pros: Flexible. Cons: Leads to monopoly/slot hoarding).
  * Option B: Max active bookings quota per carrier per warehouse (Pros: Fair distribution. Cons: Requires counting active bookings per query).
* **Decision:** Added a validation rule in `booking.service.ts` checking `count({ where: { organizationId, warehouseId, status: 'CONFIRMED' } }) < MAX_BOOKINGS_PER_CARRIER` (max 3 active slots).
* **What would make me change it:** If warehouses operate with excess capacity where hoarding is impossible.
* **How I checked it:** Tested maximum active booking limits per carrier per warehouse in booking service test suites.
* **Sources:** Logistics capacity management principles.
* **AI involvement:** AI suggested count queries; I implemented and tested the carrier quota enforcement logic.

### D-20 (P2): Dynamic Slot Length Changes per Warehouse (Requirement W7)
* **Status:** built and tested
* **Problem:** Different warehouses handle different cargo types, requiring variable slot durations (e.g., 30 mins vs. 60 mins).
* **Options considered:**
  * Option A: Global static slot length (Pros: Easy math. Cons: Unrealistic for multi-tenant warehouses).
  * Option B: Warehouse-level configurable `slotIntervalMinutes` (Pros: Fully flexible. Cons: Dynamic slot generation complexity).
* **Decision:** Stored `slotIntervalMinutes` on the `Warehouse` table and passed it dynamically into the time-generation utility.
* **What would make me change it:** If all warehouses standardized on 30-minute intervals.
* **How I checked it:** Tested changing warehouse slot length from 60 to 30 minutes while ensuring existing bookings retain their original times.
* **Sources:** Time-interval scheduling algorithms.
* **AI involvement:** AI proposed static intervals; I built dynamic interval selectors and interval handlers.

### D-21 (P1): Comprehensive Audit Logs (Requirement B7)
* **Status:** built and tested
* **Problem:** Enterprise systems require compliance tracking for every critical state change (bookings created, cancelled, status overrides).
* **Options considered:**
  * Option A: Rely on database query logs (Pros: Automatic. Cons: Hard to read and lacks business context).
  * Option B: Dedicated `AuditLog` table capturing actor, action, timestamp, and payload diffs (Pros: Clean compliance trail. Cons: Increases database write overhead).
* **Decision:** Populated the `AuditLog` Prisma model inside critical service transactions to record user ID, IP address, action type, and JSON metadata.
* **What would make me change it:** If external APM tracing fully covered compliance auditing.
* **How I checked it:** Verified AuditLog table records actor, IP, and payload diffs across critical booking and status change transactions.
* **Sources:** SOC2 / ISO 27001 Logging Requirements.
* **AI involvement:** AI suggested database audit triggers; I implemented application-level transaction logging and verification tests.
