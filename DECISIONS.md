# DockSlot Project Decisions

## D-01: Choosing Prisma for Database Management
Status: built and tested
Problem: We needed a reliable way to manage database changes and write queries. Writing raw SQL gives full control but is hard to update safely as the project grows.
Options considered:
- Option A: Raw SQL migrations (Pros: Total control. Cons: No type safety, hard to track).
- Option B: Sequelize ORM (Pros: Popular. Cons: Verbose, weaker TypeScript support).
- Option C: Prisma (Pros: Clean migrations, auto-generated type safety, easy schemas. Cons: Heavy abstraction).
Decision: I chose Prisma because it balances speed and type safety while still letting us write raw SQL when we need special database features.
What would make me change it: If we needed advanced custom SQL triggers or stored procedures for extreme scaling.
How I checked it: Ran `prisma migrate dev` and tested database queries in TypeScript.
Sources: Prisma documentation.
AI involvement: AI suggested Prisma; I kept it and planned raw SQL overrides for edge cases.

---

## D-02: Choosing Vitest and Supertest over Jest
Status: built and tested
Problem: Jest requires complicated configuration for TypeScript and modern Node.js, which slows down testing.
Options considered:
- Option A: Jest + ts-jest (Pros: Industry standard. Cons: Slow, complex setup).
- Option B: Vitest + Supertest (Pros: Fast startup, native TypeScript support, easy HTTP API testing. Cons: Newer ecosystem).
Decision: I chose Vitest and Supertest because they run instantly and work smoothly with modern TypeScript.
What would make me change it: If enterprise testing rules required legacy test tools.
How I checked it: Ran test suites locally and verified all tests passed.
Sources: Vitest documentation.
AI involvement: AI recommended Vitest; I adopted it for speed and simplicity.

---

## D-03: Balancing 24-Hour Locks with Rescheduling and Booking Limits
Status: built and tested
Problem: Strict 24-hour locks block all changes, but real trucks get delayed by traffic. However, total last-minute cancellations ruin warehouse labor planning.
Options considered:
- Option A: Complete Lockout (Pros: Predictable labor. Cons: Unrealistic when trucks hit traffic).
- Option B: Flexible Policy (Pros: Allows rescheduling delayed trucks to help warehouses, while blocking last-minute cancellations).
Decision: I chose to hard-lock cancellations within 24 hours to protect warehouse labor, but allow rescheduling anytime for delayed trucks. We also added limits (max 3 active bookings per carrier per warehouse and a 14-day advance booking limit) to prevent booking hoarding.
What would make me change it: If warehouse operators demanded complete rigidity or required refunds for late cancellations.
How I checked it: Tested booking rules and time windows against validation tests.
Sources: Logistics management best practices.
AI involvement: AI helped discuss trade-offs; I defined the final rules.

---

## D-04: Restricting Warehouse and Dock Updates When Active Bookings Exist
Status: built and tested
Problem: Changing warehouse operating hours or dock details while active bookings exist causes scheduling conflicts and confusion.
Options considered:
- Option A: Allow Unrestricted Edits (Pros: Easy code. Cons: Messes up existing bookings).
- Option B: Block Updates When Active Bookings Exist (Pros: Protects data accuracy).
Decision: I chose to block warehouse and dock updates if there are active bookings in that time frame.
What would make me change it: If the system needed live, instant schedule changes without checking existing bookings.
How I checked it: Tested update routes against mock databases with active bookings.
Sources: Database design patterns.
AI involvement: AI pointed out race conditions; I specified the validation rule to block updates when active bookings exist.

---

## D-05: Frontend UI Stack Selection
Status: built and tested
Problem: Heavy UI libraries fight custom styling, while writing plain CSS from scratch takes too long. We needed a clean industrial look (Slate Blue and Light Silver).
Options considered:
- Option A: Material-UI / Ant Design (Pros: Ready-made components. Cons: Heavy, hard to customize colors).
- Option B: Tailwind CSS + shadcn/ui + Lucide React (Pros: Lightweight, full code ownership, easy custom hex colors).
Decision: I chose Tailwind CSS with shadcn/ui and Lucide React to easily build custom industrial UI themes without framework bloat.
What would make me change it: If strict corporate design guidelines required a different UI framework.
How I checked it: Built and styled the dashboard screens locally.
Sources: Tailwind CSS and shadcn/ui docs.
AI involvement: AI recommended Tailwind and shadcn/ui; I approved it for the industrial theme.

---

## D-06: Using the Outbox Pattern for Reliable Webhooks
Status: built and tested
Problem: Sending webhook notifications directly inside an HTTP database transaction can cause lost notifications if the external receiver is down.
Options considered:
- Option A: Direct HTTP calls (Pros: Simple. Cons: Fails if the receiver is down).
- Option B: Heavy Message Brokers like Kafka (Pros: Highly scalable. Cons: Too complex for our MVP).
- Option C: Transactional Outbox Pattern with MySQL and a background worker (Pros: Guarantees reliable delivery using our existing database).
Decision: I chose the Outbox Pattern (saving events in an outbox table inside the same transaction as the booking) with a background worker to guarantee webhook delivery safely.
What would make me change it: If the system scaled to millions of events per second requiring dedicated event streaming.
How I checked it: Tested booking creation with the mock carrier offline and verified the background worker retried and delivered successfully once online.
Sources: Enterprise integration patterns.
AI involvement: AI suggested the outbox pattern; I implemented the database schema and worker polling loop.

---

## D-07: End-to-End Request Tracing via `X-Request-ID`
Status: built and tested
Problem: Debugging background tasks (like webhooks) and matching them back to original user requests is hard without a tracking ID.
Options considered:
- Option A: No tracking (Pros: None. Cons: Hard to debug asynchronous errors).
- Option B: Paid APM tools (Pros: Automated. Cons: Expensive and heavy).
- Option C: Middleware-driven `X-Request-ID` propagation (Pros: Lightweight, free, full control).
Decision: I chose middleware-driven request tracing where a unique request ID is passed through HTTP headers, saved in outbox events, and printed in worker logs.
What would make me change it: If the app adopted a full native cloud observability suite like OpenTelemetry.
How I checked it: Sent custom headers via `curl` and verified matching trace IDs across request logs and worker logs.
Sources: Distributed logging best practices.
AI involvement: AI proposed the tracing architecture; I integrated it into Express middleware and worker logs.

---

## D-08: Redis-Backed Token Versioning and Caching
Status: built and tested
Problem: Checking user status or revoking tokens instantly requires database lookups, which slow down API requests.
Options considered:
- Option A: Query MySQL on every request (Pros: Always fresh. Cons: Slow and high database load).
- Option B: Pure stateless JWT (Pros: Fast. Cons: Impossible to instantly log out a user).
- Option C: Redis caching for active status and token versions (Pros: Super fast lookups, instant revocation).
Decision: I chose Redis caching for user active states and token versions, checking cache first with a database fallback for fast authentication and instant logout.
What would make me change it: If Redis became unreliable without a backup cache layer.
How I checked it: Monitored Redis keys using `redis-cli` and tested instant token rejection after updating versions.
Sources: Redis documentation.
AI involvement: AI suggested the Redis token versioning pattern; I implemented the middleware verification checks.

---

## D-09: Choosing TypeScript, Node.js/Express, and React
Status: built and tested
Problem: We needed a robust, type-safe language stack across both frontend and backend to catch bugs early and speed up development.
Options considered:
- Option A: Python (FastAPI/Django) + React (Pros: Great for data science. Cons: Switching languages between backend and frontend).
- Option B: Java / Spring Boot + React (Pros: Enterprise standard. Cons: Too much boilerplate code).
- Option C: TypeScript with Node.js/Express and React (Pros: End-to-end type safety, single language ecosystem).
Decision: I chose TypeScript across the entire stack because it provides strong type safety and shares data structures smoothly between the database, backend, and UI.
What would make me change it: If company rules strictly required Java or C# for backend services.
How I checked it: Compiled with `tsc` and tested full-stack integration.
Sources: TypeScript documentation.
AI involvement: AI helped configure TypeScript setups; I wrote all business logic and UI components.

---

## D-10: Choosing HTTP Session Cookies with Redis Validation
Status: built and tested
Problem: Storing tokens in client-side `localStorage` leaves them open to XSS theft, but checking traditional server sessions against MySQL on every request causes lag.
Options considered:
- Option A: Stateless JWT in `localStorage` (Pros: Simple. Cons: Vulnerable to XSS).
- Option B: SQL-backed cookies (Pros: Secure. Cons: Slows down API responses by hitting MySQL constantly).
- Option C: HTTP session cookies with Redis validation (Pros: `HttpOnly` cookies block XSS theft, while Redis gives sub-millisecond session checks and instant logout).
Decision: I chose HTTP session cookies combined with Redis session validation to keep user sessions secure from script theft while allowing lightning-fast request checks and instant logout.
What would make me change it: If the app moved to a mobile app or multi-region setup where cookies are less practical.
How I checked it: Verified `HttpOnly` cookie delivery in browser network tabs and tested instant session clearance via Redis.
Sources: OWASP session guidelines.
AI involvement: AI explained cookie security flags; I configured the session middleware and Redis lookup flow.

---

## D-11: Rejecting the Prototype AI-Generated Slot Generator
Status: built and tested
Problem: A prototype AI-generated slot generator contained serious bugs: it was time-zone blind (using native JS `Date`), had a day-of-week index mismatch (treating Sunday as `0`), and used flawed hour-loop math that broke for non-hourly slots like 45 minutes.
Options considered:
- Option A: Patch the prototype code (Pros: Keep original code. Cons: Native date timezone bugs require a full rewrite anyway).
- Option B: Throw it away and write a robust, timezone-aware service (Pros: Eliminates timezone bugs and handles custom slot intervals correctly).
Decision: I chose to throw away the prototype snippet entirely because its timezone blindness and broken math made it unreliable for production logistics, replacing it with a robust timezone-aware scheduling service.
What would make me change it: If the app only operated in a single fixed timezone with uniform hourly slots.
How I checked it: Unit tested slot generation across multiple timezones and slot lengths (30 and 45 minutes).
Sources: JavaScript Date object pitfalls.
AI involvement: An earlier AI tool generated the flawed prototype; I identified its bugs, rejected it, and built a robust replacement.