# DockSlot Engineering Notes

A curated reference of design patterns, good programming practices, and
distributed-systems concepts that are useful in interviews and future projects.

The notes cover ideas used in DockSlot as well as adjacent patterns worth
knowing. Entries marked **DockSlot:** describe how this repository applies the
idea. Unmarked entries are general interview knowledge.

> A useful interview answer usually follows this shape:
> **problem → pattern → mechanics → trade-offs → project example → failure modes.**

## Contents

- [Frontend and React](#frontend-and-react)
- [Backend and API Design](#backend-and-api-design)
- [Authentication, Security, and Sessions](#authentication-security-and-sessions)
- [Data, Consistency, and Domain Modeling](#data-consistency-and-domain-modeling)
- [Architecture and Code Quality](#architecture-and-code-quality)
- [Testing and Quality Engineering](#testing-and-quality-engineering)
- [DevOps, Observability, and Performance](#devops-observability-and-performance)
- [Common Pitfalls](#common-pitfalls)
- [Interview Quick Reference](#interview-quick-reference)

## Frontend and React

### Rendering and loading

- **Error Boundaries:** React components that catch JavaScript errors anywhere in
  their child component tree, log those errors, and display a fallback UI instead
  of crashing the entire application.
  - They catch render, lifecycle, and constructor errors. They do **not** catch
    event-handler errors, async errors, or errors thrown outside React.
  - **DockSlot:** `frontend/src/components/common/ErrorBoundary.tsx` wraps the
    application shell so a render failure does not leave a blank page.

- **Suspense:** A React feature that lets components "wait" for something before
  rendering, such as data or code splitting, by showing a fallback UI until the
  asynchronous operation completes.
  - **DockSlot:** lazy routes and modals are wrapped in `Suspense` with
    accessible page/modal fallbacks.

- **Lazy Loading / Code Splitting:** Deferring non-critical JavaScript until it is
  needed. Route-level splitting keeps the initial shell small; component-level
  splitting is useful for heavy modals and rarely used screens.
  - **DockSlot:** dashboards, password-recovery pages, and team/security modals
    are loaded on demand.

- **Vendor Chunking:** Splitting stable third-party dependencies into separate
  chunks so application code changes do not invalidate the entire vendor cache.
  - **DockSlot:** `frontend/vite.config.ts` groups React, Axios, date libraries,
    Lucide icons, and remaining dependencies.

- **Portals:** Rendering a component outside its parent DOM hierarchy while
  preserving React state and event handling. Commonly used for modals, tooltips,
  and toasts.
  - Portals solve stacking-context problems, but focus management and
    accessibility remain the component's responsibility.

- **Error, Loading, and Empty States:** Every asynchronous view should explicitly
  handle four states: loading, success, empty, and error. Missing one of these is
  a common source of confusing UI.

- **Progressive Enhancement:** Build the core experience so it works without
  optional enhancements, then layer on richer behavior. Useful for slow networks,
  older browsers, and accessibility.

### State and data flow

- **Custom Hooks:** Functions that extract reusable stateful logic from
  components. They keep components smaller and make behavior independently
  testable.
  - **DockSlot:** `useDialogA11y`, `useConfirm`, `useNow`, and `useAuth`.

- **Context Provider:** A React pattern for sharing cross-cutting state without
  prop drilling. Context is best for low-frequency, app-wide values such as auth,
  theme, or feature flags; it is not a replacement for a full state manager.
  - **DockSlot:** `AuthProvider` exposes session state and auth actions.

- **Compound Components:** A pattern where related components share implicit
  state through context, such as `Tabs`, `Tabs.List`, and `Tabs.Panel`. It keeps
  markup flexible while preserving consistent behavior.

- **Controlled vs Uncontrolled Components:** Controlled inputs derive their value
  from React state; uncontrolled inputs keep value in the DOM and are read through
  refs. Controlled components are easier to validate and coordinate; uncontrolled
  components can be simpler and faster for large forms.

- **Derived State:** Compute values from existing state during render instead of
  storing a duplicate copy. Duplicated state can drift and cause bugs.

- **State Colocation:** Keep state as close as possible to the components that
  need it. Lift state only when multiple components must coordinate.

- **Memoization:** Caching a computed value or function identity with `useMemo`,
  `useCallback`, or `React.memo`. Use it when profiling shows a real cost, not by
  default; unnecessary memoization adds complexity and memory overhead.

- **Effect Cleanup:** Return a cleanup function from `useEffect` to remove
  listeners, clear timers, cancel requests, or close resources. Missing cleanup
  causes memory leaks and stale callbacks.

- **Race Condition / Stale Response Guard:** When multiple requests can complete
  out of order, ignore results that belong to an older request. Use a request ID,
  an `AbortController`, or compare the current state/epoch before applying a
  response.

- **AbortController:** A browser API for cancelling asynchronous work such as
  `fetch` requests. Cancellation prevents wasted work and avoids applying results
  after a component has unmounted or a newer request has started.
  - **DockSlot:** used for cancellable outbound work (password-breach check,
    webhook delivery) and is the standard tool for cancelling component-scoped
    fetches.

- **Optimistic UI:** Updating the interface immediately as if a request succeeded,
  then rolling back if the server rejects it. Great for low-risk, high-frequency
  actions; risky for payments or irreversible operations.

- **Single-Flight Request:** A concurrency guard that shares one in-flight
  promise among identical callers instead of launching duplicate requests.
  - **DockSlot:** `frontend/src/api/client.ts` shares one refresh promise across
    concurrent `401` responses; `authContext.service.ts` shares one session
    restore request across React StrictMode remounts.

- **Request Debounce:** A technique that postpones an action until a quiet period
  has elapsed without new trigger events. Common for search-as-you-type and
  auto-save. Always clean up the timer on unmount.

- **Throttle:** A technique that allows an action to run at most once per time
  interval. Common for scroll, resize, and pointer-move handlers.

- **Debounce vs Throttle:** Debounce waits for silence; throttle limits frequency.
  Use debounce when the final value matters, throttle when continuous feedback
  matters.

- **Cross-Tab Synchronization:** Keeping multiple browser tabs consistent using
  `BroadcastChannel`, `storage` events, or a `SharedWorker`.
  - **DockSlot:** logout is broadcast across tabs, with a local storage marker so
    a failed server logout cannot silently restore the session on the next load.

- **Session Epoch (client):** A monotonic counter that increments on logout or
  hard session clear. An in-flight refresh captures the epoch before starting and
  refuses to write a token if the epoch changed, preventing a logged-out session
  from being silently resurrected.
  - **DockSlot:** `frontend/src/utils/authToken.ts` and the API client use this
    guard.

### UX and accessibility

- **Accessibility (a11y):** Designing interfaces usable by keyboard, screen
  reader, and assistive-technology users. Core practices include semantic HTML,
  labels, focus visibility, keyboard operability, and meaningful ARIA only when
  native semantics are insufficient.

- **Focus Management / Focus Trap:** Moving focus into a dialog when it opens,
  keeping Tab navigation inside it, closing on Escape, and restoring focus to the
  trigger on close.
  - **DockSlot:** `useDialogA11y` handles dialog focus, Escape, body scroll lock,
    and focus restoration.

- **Semantic HTML:** Use native elements (`button`, `nav`, `main`, `label`,
  `table`) before adding ARIA. Native elements come with keyboard and screen
  reader behavior for free.

- **Keyboard Navigation:** Every interactive feature should be usable without a
  mouse. Tabs, menus, and dialogs need explicit arrow-key, Home/End, Enter, and
  Escape behavior.

- **Responsive Design:** Layouts should adapt to viewport and input constraints
  rather than assuming a desktop mouse. Test at narrow widths and with zoom.

- **Design Tokens / Utility CSS:** Centralize spacing, colors, typography, and
  states so components stay visually consistent. Tailwind utility classes are a
  form of design-token application.

## Backend and API Design

### API contracts

- **REST:** A resource-oriented API style using HTTP methods and URLs to represent
  operations. Use plural nouns for collections, avoid verbs in paths, and let
  HTTP semantics carry meaning.

- **HTTP Semantics:** `GET` is safe and should not mutate state. `PUT` and `DELETE`
  are idempotent. `POST` is neither safe nor inherently idempotent. `PATCH`
  partially updates a resource.

- **HTTP Status Codes:** Use the narrowest accurate code: `200` success, `201`
  created, `204` no content, `400` malformed request, `401` unauthenticated, `403`
  authenticated but forbidden, `404` missing, `409` conflict, `422` semantic
  validation failure, `429` rate limited, `500` unexpected server error, `503`
  temporarily unavailable.

- **Error Envelope:** Return a consistent error shape, such as
  `{ message, code?, details? }`. Do not leak stack traces, SQL, secrets, or
  internal identifiers. Log the internal detail with a correlation ID instead.

- **OpenAPI / Swagger:** A machine-readable API contract. It powers documentation,
  client generation, validation, and contract tests.
  - **DockSlot:** the Express API exposes an OpenAPI 3.0 document and Swagger UI.

- **API Versioning:** Introduce breaking changes under a new version (`/v1`,
  media type, or header). Prefer additive changes and deprecation windows over
  breaking existing clients.

- **Pagination:** Offset pagination is simple but unstable when rows change.
  Cursor pagination is better for large or frequently changing datasets because it
  avoids skipped/duplicated rows and scales with indexes.

- **Filtering and Sorting:** Whitelist allowed fields and directions; never pass
  raw user input into SQL or ORM field names. Combine with indexes and limits.

- **CORS (Cross-Origin Resource Sharing):** Browser policy that controls which
  origins may read responses. With credentials, the server must use an explicit
  allowlist and cannot use `*`.
  - **DockSlot:** `CORS_ORIGIN` is configurable and validated for production.

- **Cache-Control:** HTTP caching policy. Use `no-store` for auth, health, and
  sensitive responses; use long-lived immutable caching for content-hashed static
  assets; keep `index.html` revalidated.

- **Correlation ID / Request ID:** A unique ID attached to a request and propagated
  through logs, services, and background work so one user action can be traced
  end to end.
  - **DockSlot:** request IDs flow through `AsyncLocalStorage` into logs and outbox
    payloads.

- **Content Negotiation:** Serving different representations based on `Accept`
  headers. Useful for JSON/HTML/CSV variants; keep defaults predictable.

- **ETag / Conditional Requests:** An `ETag` identifies a resource version.
  `If-None-Match` can return `304 Not Modified` to save bandwidth; `If-Match`
  supports optimistic concurrency.

- **GraphQL:** A client-specified query language and runtime. It solves
  over-fetching and under-fetching, but adds authorization, caching, and N+1
  complexity. Use batching/DataLoader for nested resolvers.

- **gRPC:** A binary RPC framework using Protocol Buffers. Efficient for
  service-to-service calls and strong schemas; less convenient for browsers.

- **WebSocket:** A persistent full-duplex connection for real-time updates.
  Requires connection management, authentication, scaling, and reconnect logic.

- **Server-Sent Events (SSE):** A one-way server-to-client stream over HTTP.
  Simpler than WebSockets for notifications and live feeds; automatic reconnect is
  built into browsers.

- **Webhook:** A server-to-server callback triggered by an event. Treat delivery
  as at-least-once: sign payloads, verify signatures, retry with backoff, and
  deduplicate on a stable event ID.

### Correctness under retries

- **Idempotency Key:** A unique identifier sent by a client with a request (often
  in an HTTP header) to ensure retried operations are processed only once,
  preventing duplicate side effects.
  - The key must be scoped to a user/client and operation.
  - Store a request fingerprint so the same key with a different payload is
    rejected instead of silently returning the wrong result.
  - Store the final status and response body with a TTL.
  - Use a database unique constraint or atomic "in progress" record to handle two
    concurrent requests with the same key.
  - **DockSlot:** booking creation accepts `Idempotency-Key`; the middleware
    replays cached `2xx` responses for 24 hours and returns `X-Cache-Lookup: HIT`.

- **Idempotent HTTP Methods:** `GET`, `HEAD`, `PUT`, and `DELETE` are idempotent by
  contract; repeating them should have the same effect as one call. `POST` needs
  an explicit idempotency mechanism for safe retries.

- **Idempotency Record:** A persisted row keyed by idempotency key containing the
  request hash, status, response, timestamps, and expiry. Clean it up
  asynchronously so the table does not grow without bound.

- **Webhook Idempotency:** A sender includes a stable event ID or idempotency key;
  the receiver deduplicates it. Retries are expected, so the receiver must be
  idempotent.
  - **DockSlot:** the outbox worker sends the event ID as both `X-Event-Id` and
    `Idempotency-Key`; the mock carrier deduplicates on it.

- **At-Least-Once vs Exactly-Once:** Most distributed systems deliver at least
  once. Exactly-once _effects_ are usually achieved with at-least-once delivery
  plus idempotent consumers, not by claiming the transport is perfect.

- **Retry Safety:** Only retry transient failures (`408`, `429`, `5xx`, network
  timeouts) and only when the operation is idempotent. Do not retry validation
  errors or non-idempotent side effects blindly.

### Concurrency and resilience

- **Singleflight Guard / Request Coalescing:** A concurrency pattern that
  suppresses duplicate concurrent executions by sharing the result of an ongoing
  in-flight request among identical callers instead of running multiple redundant
  backend queries.
  - It coalesces only concurrent work; it is not a cache. A later request starts
    a new flight unless a cache sits in front.
  - Errors must be shared with all waiters; otherwise one caller can hang.
  - **DockSlot:** used on the frontend for token refresh and session restore.

- **Request Debounce:** A client-side technique that waits for a quiet period
  before issuing a request. It reduces load but is not a correctness control; the
  server still needs validation, idempotency, and rate limiting.

- **Rate Limiting:** Restricting how many requests an identity may make in a time
  window. Common algorithms: fixed window, sliding window, token bucket, and
  leaky bucket. Use Redis for distributed counters and atomic increments.
  - Key by user ID when authenticated, IP otherwise, and consider route-specific
    budgets.
  - Return `429` with `Retry-After`; do not reveal whether an account exists.
  - **DockSlot:** Redis-backed global, auth, login, refresh, booking, password
    reset, and 2FA limiters.

- **Throttling vs Rate Limiting:** Rate limiting rejects excess requests;
  throttling smooths or delays processing. Both protect capacity, but they produce
  different client behavior.

- **Retry with Exponential Backoff and Jitter:** Retry transient failures with
  increasing delays plus randomness so many clients do not retry in lockstep.
  Cap attempts and total time; classify retryable errors.
  - **DockSlot:** the outbox worker retries failed webhook deliveries with
    exponential backoff and a maximum retry count.

- **Timeout:** Every network call should have a deadline. A missing timeout can
  hold connections, threads, and worker slots indefinitely. Combine with
  cancellation where possible.

- **Circuit Breaker:** Stop calling a failing dependency after a threshold, fail
  fast while open, then allow a limited probe in the half-open state. Prevents
  cascading failures and gives the dependency time to recover.

- **Bulkhead:** Isolate resources (connection pools, worker pools, queues) per
  dependency or tenant so one failing area cannot consume all capacity.

- **Backpressure:** Slow producers when consumers are saturated. Use bounded
  queues, concurrency limits, `429`/`503` responses, and load shedding instead of
  unbounded memory growth.
  - **DockSlot:** the outbox worker bounds batch size, concurrency, and work per
    tick.

- **Graceful Degradation:** Preserve a reduced but useful experience when a
  dependency fails. For security-critical paths, prefer fail-closed behavior over
  silent degradation.
  - **DockSlot:** Redis has an in-memory fallback for local development, but
    production requires Redis so instances do not diverge.

- **Thundering Herd:** Many clients or workers retry or refresh at the same moment,
  overwhelming a recovering service. Mitigate with jitter, singleflight, cache
  locking, and rate limits.

- **Transactional Outbox:** Write the business change and an outbox event in the
  same database transaction. A background worker delivers the event later. This
  avoids the dual-write problem where the database commits but the message broker
  does not (or vice versa).
  - Delivery is at-least-once; consumers must be idempotent.
  - Claim rows with a lease so multiple workers do not process the same event.
  - Retry with backoff; park permanently failed events for inspection.
  - **DockSlot:** booking creation writes an outbox row; `OutboxWorker` claims,
    delivers, retries, and marks events completed/failed.

- **Worker Lease / Claim:** A time-limited ownership marker on a queue row. If the
  worker dies, the lease expires and another worker can recover the event.

- **Distributed Lock:** A lock shared across processes, often implemented with
  Redis or a database. Always use a lease/TTL, an ownership token, and a
  fencing mechanism; a lock without expiry can deadlock after a crash.

- **Fencing Token:** A monotonically increasing token issued with a lock. Storage
  systems reject writes from an older token, preventing a paused worker from
  writing after its lease expired.

- **Dead-Letter Queue (DLQ):** A holding area for messages that cannot be
  processed after the retry budget. It prevents poison messages from blocking the
  queue and preserves them for investigation.

- **Queue vs Synchronous Work:** Synchronous work is simpler and gives immediate
  feedback; queues decouple slow/fragile work, absorb spikes, and enable retries.
  Use queues for side effects that do not need to block the user response.

## Authentication, Security, and Sessions

### Tokens and sessions

- **Authentication vs Authorization:** Authentication proves identity ("who are
  you?"); authorization decides permissions ("what may you do?"). Never confuse
  the two in code or interview answers.

- **JWT Access Token:** A signed, short-lived bearer token containing claims such
  as user ID, organization, role, issuer, audience, expiry, and token version.
  Verify signature, algorithm, issuer, audience, and expiry on every use.
  - Store access tokens in memory when possible; `localStorage` is readable by XSS.
  - **DockSlot:** access tokens live in a module-scoped variable, never in
    `localStorage` or a JS-readable cookie.

- **Opaque Token:** A random identifier with no embedded claims. The server must
  look it up/introspect it. Easy to revoke, but requires shared state on every
  request.

- **OAuth 2.0:** A delegated authorization framework. For browser/mobile clients,
  use the authorization code flow with PKCE. Scopes limit what a client may do.

- **OpenID Connect (OIDC):** An identity layer on top of OAuth 2.0. It adds an ID
  token and standard user-info endpoint, enabling federated login and single
  sign-on.

- **PKCE (Proof Key for Code Exchange):** An OAuth extension for public clients.
  The client sends a hashed verifier with the authorization request and proves
  possession of the original verifier when exchanging the code, preventing code
  interception.

- **Refresh Token:** A longer-lived credential exchanged for a new access token.
  It should be stored in an `HttpOnly` cookie, rotated on use, hashed at rest, and
  revocable server-side.

- **Refresh Token Rotation:** Every successful refresh issues a new refresh token
  and revokes the old one. If an old token is reused, the server can detect theft.

- **Refresh Token Family:** A chain of rotated tokens belonging to one login
  session. If reuse is detected, revoke the whole family rather than only the
  replayed token.

- **Reuse Detection:** Detecting a previously rotated refresh token being
  presented again. This indicates a stolen token or a race. Revoke the family and
  force re-authentication.

- **Grace Window:** A short period during which a concurrent refresh using the
  just-rotated token can receive the replacement session instead of triggering
  reuse detection. This prevents false positives from multiple tabs or network
  retries.

- **Refresh Storm:** Many concurrent refreshes happening at once, often after a
  tab wakes up or many requests receive `401`. It can cause rotation races,
  database load, and accidental family revocation.
  - Mitigate with client singleflight, server grace windows, jitter, proactive
    refresh, and rate limiting.
  - **DockSlot:** the frontend shares one refresh promise; the backend allows a
    short concurrent-refresh grace window.

- **Zombie Sessions:** Sessions or authentication state records that persist in
  storage (Redis, databases, or JWT blocklists) long after a user has logged out,
  their token expired, or their account was deactivated. They are a security risk
  because they may still grant access or consume resources.
  - Prevent with server-side revocation, short access-token TTLs, idle and
    absolute session lifetimes, `tokenVersion`/session epochs, cleanup jobs, and
    cache invalidation.
  - **DockSlot:** logout revokes the refresh session; logout-all, password reset,
    password change, and deactivation increment `tokenVersion` and revoke all
    refresh sessions.

- **Session Epoch:** A mechanism or timestamp used to version user sessions,
  allowing all active sessions to be invalidated at once by incrementing an epoch
  counter. A token carrying an older epoch is rejected.
  - **Backend:** DockSlot uses a durable `tokenVersion` on the user plus a
    short-lived Redis cache. Sensitive events increment it and clear the cache.
  - **Frontend:** `sessionEpoch` is a monotonic counter used to ignore in-flight
    refresh results after logout.

- **Token Version:** A durable integer in the database included in JWTs. The auth
  middleware compares the token's version with the current version. Incrementing
  it invalidates every previously issued access and refresh token.

- **Session Revocation:** Invalidating a session before its natural expiry. Use
  server-side state (session table, token version, deny list, or family ID) rather
  than relying only on short TTLs.

- **Idle Timeout vs Absolute Timeout:** Idle timeout expires after a period of
  inactivity; absolute timeout expires after a fixed maximum lifetime regardless
  of activity. Use both for defense in depth.

- **Session Fixation:** An attacker forces a victim to use a known session ID.
  Prevent by issuing a fresh session/token after login and rotating on privilege
  changes.

- **Logout:** A complete logout revokes the server-side session, clears the
  refresh cookie, clears local tokens, and bumps the local session epoch. Other
  tabs should be notified.

- **Step-Up Authentication:** Requiring a stronger proof (password, MFA, or
  re-authentication) before sensitive actions such as changing security settings
  or disabling 2FA.

### Browser security

- **HttpOnly Cookie:** A cookie inaccessible to JavaScript, reducing token theft
  from XSS. Pair it with `Secure`, `SameSite`, and an appropriate `Path`.

- **Secure Cookie:** Sent only over HTTPS. Required for production refresh cookies
  and for `SameSite=None`.

- **SameSite Cookie:** Controls when cookies are sent on cross-site requests.
  `Lax` is a good default; `Strict` is stronger but can break flows; `None`
  requires `Secure` and explicit CSRF protection.

- **CSRF (Cross-Site Request Forgery):** An attacker causes a logged-in browser to
  send an unwanted state-changing request. Defend with `SameSite`, Origin/Referer
  validation, CSRF tokens, and avoiding state changes on `GET`.
  - **DockSlot:** cookie-authenticated refresh/logout routes use
    `requireTrustedOrigin`.

- **Origin Validation:** Checking the `Origin` header on state-changing requests.
  In production, reject missing or untrusted origins for cookie-backed endpoints.

- **CORS vs CSRF:** CORS controls whether a browser lets one origin _read_
  another origin's response. CSRF is about unauthorized _state-changing_ requests.
  CORS is not a CSRF defense by itself.

- **XSS (Cross-Site Scripting):** Injecting attacker-controlled script into a
  page. Defend with output encoding, React's escaping, CSP, avoiding
  `dangerouslySetInnerHTML`, and keeping sensitive tokens out of JS-readable
  storage.

- **CSP (Content Security Policy):** A response header that restricts which
  scripts, styles, images, and connections a page may load. Use nonces or hashes
  for inline scripts and avoid `unsafe-inline` in production.

- **Security Headers:** Helmet-style headers such as HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`, and CSP. They are defense in depth, not a substitute for
  correct authorization.

- **Token Storage:** Prefer in-memory access tokens plus `HttpOnly` refresh
  cookies. Avoid `localStorage` for long-lived credentials because any XSS can
  read it.

- **Cross-Tab Logout:** A logout in one tab should invalidate other tabs. Use
  `BroadcastChannel`, `storage` events, or a server-driven session check.

### Credentials and MFA

- **Password Hashing:** Store passwords with bcrypt, scrypt, or Argon2 using a
  unique salt and an appropriate work factor. Never encrypt or store plaintext
  passwords. Compare using the library's constant-time verification.

- **Password Policy:** Favor length over arbitrary complexity rules. Check for
  breached passwords, rate-limit attempts, and avoid forcing periodic rotation
  unless there is evidence of compromise.

- **HIBP k-Anonymity:** Check passwords against Have I Been Pwned without sending
  the full password: send the first five SHA-1 characters and compare the returned
  suffix locally.
  - **DockSlot:** optional breach check in `backend/src/utils/passwordBreach.ts`.

- **MFA / TOTP:** Multi-factor authentication using time-based one-time passwords.
  Encrypt TOTP secrets at rest, rate-limit verification, prevent replay, and
  provide recovery codes.

- **TOTP Encryption:** Encrypt TOTP secrets with a key from the environment.
  DockSlot uses AES-256-GCM, which provides confidentiality and integrity.

- **Account Enumeration:** Avoid revealing whether an email exists. Use generic
  responses for login, forgot-password, and resend-verification flows, and keep
  timing reasonably consistent.

- **Timing Attacks:** Attackers infer secrets from response-time differences. Use
  constant-time comparison for tokens, hashes, and signatures; avoid early exits
  in sensitive comparisons.

- **Rate Limiting and Account Lockout:** Slow brute-force attempts with per-email
  and per-IP limits. Prefer temporary lockout/backoff over permanent lockout to
  reduce denial-of-service risk. Do not consume the failed-login budget on
  successful logins.

- **Audit Logging:** Record security-relevant events (login, logout, password
  change, role change, MFA changes) with actor, action, target, timestamp, and
  outcome. Redact secrets and tokens.

- **Secrets Management:** Keep secrets out of source control. Use environment
  variables or a secret manager, separate values per environment, validate at
  startup, and rotate on compromise.

### Authorization and common attacks

- **RBAC (Role-Based Access Control):** Permissions are grouped into roles
  (`DISPATCHER`, `DOCK_MANAGER`, `WAREHOUSE_ADMIN`, `CARRIER_ADMIN`). Check
  permissions on the server, never only in the UI.

- **Tenant Isolation:** Every query for tenant-owned data must include the
  authenticated organization ID. Never trust a tenant ID supplied by the client.

- **Least Privilege:** Give users and services only the permissions they need.
  Default to deny and grant explicitly.

- **Defense in Depth:** Layer controls (validation, authorization, rate limits,
  headers, logging) so one failure does not become a full compromise.

- **Fail Closed:** For security-critical checks, deny access when a dependency is
  unavailable. Availability-friendly fallbacks must never silently weaken auth.

- **IDOR / BOLA:** Insecure Direct Object Reference / Broken Object Level
  Authorization. Always verify that the authenticated user may access the specific
  object, not just that they are logged in.

- **Mass Assignment:** Do not pass raw request bodies into database updates.
  Whitelist fields and use explicit DTOs or schemas.

- **SQL Injection:** Use parameterized queries or an ORM. Never concatenate
  untrusted input into SQL. DockSlot uses Prisma.

- **SSRF (Server-Side Request Forgery):** Validate outbound URLs, allowlist hosts
  where possible, and block metadata/private-network addresses.

- **OWASP Top 10 Quick Map:**
  - Broken access control → RBAC, tenant scoping, object-level checks.
  - Cryptographic failures → TLS, bcrypt/Argon2, AES-GCM, secret management.
  - Injection → parameterized queries, validation, output encoding.
  - Insecure design → threat modeling, rate limits, least privilege.
  - Security misconfiguration → headers, CORS, secure defaults, env validation.
  - Vulnerable components → dependency scanning and updates.
  - Auth failures → MFA, lockout, rotation, revocation, secure sessions.
  - Integrity failures → CI signing, trusted artifacts, dependency pinning.
  - Logging/monitoring failures → audit logs, alerts, redaction.
  - SSRF → allowlists and network egress controls.

## Data, Consistency, and Domain Modeling

- **ACID:** Atomicity, Consistency, Isolation, Durability. Transactions either
  commit fully or roll back; isolation controls concurrent visibility; durability
  survives crashes.

- **CAP Theorem:** In a distributed system experiencing a network partition, you
  must choose consistency or availability. Partition tolerance is not optional in
  real networks; design for the partition behavior you can tolerate.

- **PACELC:** Extends CAP: during a partition (P), choose availability or
  consistency (A/C); otherwise (E), choose latency or consistency (L/C). Useful for
  reasoning about replicated databases and caches.

- **BASE:** Basically Available, Soft state, Eventually consistent. A distributed
  alternative to strict ACID that accepts temporary inconsistency in exchange for
  availability and scale.

- **Transaction:** A group of operations treated as one unit. Use transactions for
  invariants that span multiple writes, such as creating a booking and its outbox
  event together.

- **Isolation Levels:** Read uncommitted, read committed, repeatable read, and
  serializable. Stronger isolation reduces anomalies but increases contention and
  deadlock risk. Know your database default.

- **Race Condition:** A bug where correctness depends on timing. Classic example:
  two requests both see a slot as free and both book it. Guard with transactions,
  locks, unique constraints, or atomic updates.

- **Pessimistic Locking:** Lock rows before reading/updating (`SELECT ... FOR
UPDATE`). Strong consistency, but contention and deadlocks increase. Use short
  transactions.

- **Optimistic Concurrency:** Read a version number, then update only if the
  version still matches. On conflict, retry or return `409`. Good for low-contention
  updates.

- **Unique Constraint as Concurrency Guard:** Let the database enforce an
  invariant, such as one booking per dock/time range or one idempotency key.
  Catch the duplicate-key error and translate it to a domain response.

- **Repository Pattern:** Encapsulate persistence behind a collection-like API.
  Services stay independent of ORM details and are easier to test.
  - **DockSlot:** `backend/src/repositories/*` wraps Prisma access.

- **Unit of Work:** Track changes and commit them as one transaction. Prisma's
  interactive transactions provide the same idea.

- **Data Mapper:** Map database rows to domain objects without coupling the domain
  model to the schema. Prisma models are the practical mapper here.

- **Domain State Machine:** Explicitly define allowed transitions. DockSlot booking
  states are `BOOKED`, `ARRIVED`, `COMPLETED`, `CANCELLED`, and `NO_SHOW`;
  invalid transitions should be rejected and audited.

- **Multi-Tenancy:** One application/database serving multiple organizations.
  Shared-schema multi-tenancy requires a tenant key on every row and scoping in
  every query.

- **Tenant Isolation Testing:** Include tests that attempt cross-tenant reads and
  writes. A missing `organizationId` filter is a serious security bug.

- **Soft Delete:** Mark rows as deleted (`deletedAt`) instead of removing them.
  Preserves history but complicates uniqueness, queries, and retention policies.

- **Audit Trail:** An append-only history of domain changes: who changed what,
  when, and from which state to which state. Keep it separate from application
  logs.

- **Timezone Handling:** Store instants in UTC. Store the warehouse's IANA time
  zone (for example `America/New_York`) and convert at the boundary. Never use a
  fixed UTC offset for local scheduling.

- **DST (Daylight Saving Time):** A local day can have 23 or 25 hours. Slot
  generation, operating hours, and date-only values must handle DST transitions
  explicitly.

- **ISO 8601:** Use standard date/time strings (`2026-11-16T14:30:00Z`) for APIs
  and logs. Distinguish a date-only value from an instant.

- **N+1 Query Problem:** Loading a list then issuing one query per row. Fix with
  joins, `include`/`select`, batching, or a DataLoader. Watch for it when adding
  nested API responses.

- **Indexing:** Index foreign keys and common filter/sort columns. Composite index
  order matters. Avoid functions on indexed columns in `WHERE` clauses.

- **Normalization vs Denormalization:** Normalize for integrity; denormalize
  deliberately for read performance. Every denormalized field needs an update and
  reconciliation strategy.

- **Migration:** A versioned schema change. Prefer backward-compatible
  expand/contract migrations so old and new application versions can coexist
  during rollout.

- **Seed Data:** Deterministic demo/test data. Keep it separate from migrations and
  never rely on it in production.

- **Cache-Aside:** Read from cache; on miss, load from the database and populate
  the cache. Invalidate or update on writes. Add TTLs to bound staleness.

- **Cache Invalidation:** The hard part of caching. Use explicit invalidation for
  critical data, TTLs for tolerable staleness, and versioned keys when formats
  change.

- **Cache Stampede / Thundering Herd:** Many requests miss the same key and hit the
  database simultaneously. Use singleflight, a short lock, stale-while-revalidate,
  or jittered TTLs.

- **Eventual Consistency:** Caches, replicas, and asynchronous workers may lag.
  Design UX and retries for it; use idempotent consumers and reconciliation jobs.

- **CQRS:** Command Query Responsibility Segregation: separate write and read
  models. Useful for complex read/write asymmetry, but adds synchronization and
  operational complexity. Not used in DockSlot.

- **Saga:** A distributed transaction pattern using local transactions plus
  compensating actions. Useful across services; unnecessary inside one database.

- **Event Sourcing:** Persist every state change as an event and rebuild state from
  the event log. Powerful auditability, high complexity. Not used in DockSlot.

## Architecture and Code Quality

### Architecture styles and patterns

- **Layered Architecture:** Separate presentation/controllers, application
  services, domain logic, and infrastructure/repositories. Dependencies should
  point inward toward business rules.

- **Modular Monolith:** One deployable unit with clear internal modules. Simpler
  than microservices, easier to keep consistent, and a good default until scaling
  or team boundaries justify distribution.
  - **DockSlot:** Express API + Prisma/MySQL + Redis + React SPA, with a background
    outbox worker.

- **Hexagonal Architecture / Ports and Adapters:** Keep the domain core isolated
  from frameworks and I/O. Define ports (interfaces) and implement adapters for
  HTTP, databases, queues, and email.

- **Clean Architecture:** Similar dependency rule: entities/use cases at the
  center; frameworks and databases at the edge. The goal is testable business
  logic, not folder ceremony.

- **Microservices:** Independently deployable services around business
  capabilities. Benefits: independent scaling and team autonomy. Costs: network
  failures, distributed transactions, observability, and operational overhead.
  Do not start here without a concrete reason.

- **Event-Driven Architecture:** Components communicate through events. Useful for
  decoupling and async workflows; requires idempotency, ordering decisions, and
  dead-letter handling.

- **BFF (Backend for Frontend):** A backend tailored to a specific client. Useful
  when multiple clients need different aggregations; adds another deployable.

- **API Gateway:** A single entry point for routing, auth, rate limiting, and
  observability. Useful at scale; can become a bottleneck or a distributed
  monolith if overloaded.

- **Strangler Fig:** Incrementally replace a legacy system by routing pieces of
  traffic to new implementations until the old system can be removed.

### Design patterns

- **Strategy Pattern:** Encapsulate interchangeable algorithms behind a common
  interface. Examples: rate-limit stores, notification channels, pricing rules.

- **Adapter Pattern:** Wrap an incompatible interface so the rest of the code can
  use a stable abstraction. Useful when replacing a library or preserving
  compatibility during a refactor.

- **Facade Pattern:** Provide a simple interface over a complex subsystem. Service
  classes often act as facades over repositories and domain rules.

- **Factory Pattern:** Centralize object creation and configuration. Useful when
  setup is non-trivial or when tests need controlled variants.

- **Singleton Pattern:** One shared instance for the process, such as a Prisma
  client, Redis client, or service object. Be careful with global state and test
  isolation.

- **Repository Pattern:** See the data section. It is both a domain pattern and a
  testability boundary.

- **Unit of Work:** See the data section. It defines the transaction boundary.

- **Middleware / Chain of Responsibility:** Process a request through a sequence
  of handlers, each able to act, transform, or stop. Express middleware is the
  canonical example: auth, rate limiting, validation, logging, error handling.

- **Observer Pattern:** Objects subscribe to events from a subject. React state
  subscriptions, `BroadcastChannel`, and event emitters are practical examples.

- **Provider Pattern:** A component supplies shared dependencies/state to its
  subtree. React Context is the common implementation.

- **Custom Hook Pattern:** Extract reusable stateful behavior into a function that
  composes other hooks. Prefer hooks over HOCs and render props for most modern
  React code.

- **Compound Component Pattern:** Related components share implicit state through
  context. Good for flexible UI primitives such as tabs, menus, and dialogs.

- **Higher-Order Component (HOC):** A function that takes a component and returns
  an enhanced component. Useful in legacy code; hooks usually replace it.

- **Render Props:** A component receives a function as a prop/child to control
  rendering. Flexible but can create nested render trees; hooks usually replace it.

- **Container / Presentational Components:** Separate data fetching/coordination
  from rendering. Modern hooks blur the boundary, but the separation of concerns
  remains useful.

- **Dependency Injection:** Pass dependencies in rather than constructing them
  internally. Improves testability and makes side effects explicit.

### Programming principles and practices

- **Separation of Concerns:** Each module should have one clear responsibility.
  Controllers handle HTTP, services handle use cases, repositories handle
  persistence, utilities stay pure where possible.

- **SOLID:**
  - **Single Responsibility:** One reason to change.
  - **Open/Closed:** Extend behavior without modifying stable code.
  - **Liskov Substitution:** A subtype must honor the base contract.
  - **Interface Segregation:** Prefer small, focused interfaces.
  - **Dependency Inversion:** Depend on abstractions, not concrete infrastructure.

- **DRY (Don't Repeat Yourself):** One authoritative source of truth. But do not
  abstract coincidental similarity; wrong abstractions are worse than small
  duplication.

- **KISS (Keep It Simple):** Choose the simplest design that satisfies current
  requirements. Complexity must pay rent.

- **YAGNI (You Aren't Gonna Need It):** Do not build speculative features or
  abstractions. Add them when a real requirement appears.

- **Composition over Inheritance:** Combine small behaviors instead of building
  deep class hierarchies. React hooks and service composition are examples.

- **Guard Clauses:** Handle invalid conditions early and return. This reduces
  nesting and makes the happy path obvious.

- **Fail Fast:** Validate configuration, inputs, and invariants at the boundary.
  A clear startup failure is better than a silent insecure default.

- **Parse, Don't Validate:** Convert untrusted input into a typed domain value
  once, then let downstream code rely on the type. Avoid re-checking the same
  condition everywhere.

- **Make Illegal States Unrepresentable:** Use discriminated unions, required
  fields, and state machines so invalid combinations cannot be constructed.

- **Command-Query Separation:** A method should either mutate state or return a
  result, not both. This makes behavior easier to reason about.

- **Pure Functions:** Same input produces the same output with no side effects.
  Pure functions are easy to test, cache, and compose.

- **Side-Effect Isolation:** Keep I/O (HTTP, database, filesystem, clock) at the
  edges. Core business rules should be deterministic and testable.

- **Immutability:** Prefer creating new values over mutating shared state. It
  prevents surprising aliasing bugs and works naturally with React.

- **Error Handling:** Do not swallow errors. Preserve the cause, add context, and
  translate to the correct boundary response. Expected validation errors are not
  the same as unexpected failures.

- **Null / Undefined Safety:** Enable TypeScript strictness, avoid `any`, use
  explicit optional types, and handle empty states deliberately.

- **TypeScript Strict Mode:** `strict`, `noImplicitAny`, and related checks catch
  whole classes of bugs before runtime. Prefer `unknown` over `any` at boundaries.

- **Naming:** Use intention-revealing names. Booleans read as `is/has/can/should`.
  Avoid abbreviations that require a decoder ring.

- **Small Functions:** A function should do one thing at one level of abstraction.
  Extract when a function needs comments to explain its sections.

- **Comments:** Explain _why_, not _what_. Document invariants, trade-offs, and
  non-obvious security decisions. Let code explain the mechanics.

- **Boy Scout Rule:** Leave the code cleaner than you found it. Small continuous
  improvements beat occasional large rewrites.

- **Law of Demeter:** Talk to immediate collaborators, not distant internals.
  Avoid long `a.b.c.d` chains that couple you to another object's structure.

- **Principle of Least Astonishment:** Behavior and naming should match
  expectations. Surprising side effects are bugs even if tests pass.

- **Backward Compatibility:** During refactors, keep thin adapters or re-exports
  until callers migrate. Deprecate explicitly, then remove.

- **Dead Code Removal:** Delete unused files, exports, and branches. Version
  control preserves history; commented-out code and unused abstractions rot.

- **Configuration as Code:** Centralize configuration, validate it at startup, and
  avoid magic constants scattered through the codebase.

- **12-Factor App:** Store config in the environment, keep processes stateless,
  treat logs as event streams, maximize dev/prod parity, and make processes
  disposable.

- **Feature Flags:** Decouple deployment from release. Useful for gradual rollout
  and kill switches; remove stale flags to avoid combinatorial complexity.

## Testing and Quality Engineering

- **Test Pyramid:** Many fast unit tests, fewer integration tests, and a small
  number of end-to-end tests. It optimizes for speed and failure localization.

- **Testing Trophy:** A web-oriented alternative that emphasizes integration tests
  because they provide more confidence per test than isolated unit tests. DockSlot
  uses an integration-heavy backend plus focused frontend unit tests.

- **Unit Test:** Tests one function/component in isolation with dependencies
  controlled. Fast and precise, but can miss integration bugs.

- **Integration Test:** Tests multiple real components together, often including
  the HTTP layer and database. Slower but catches contract and wiring problems.

- **End-to-End Test:** Drives the real system through the UI or public API. Highest
  confidence, slowest and most brittle. Reserve for critical user journeys.

- **Contract Test:** Verifies that a consumer and provider agree on an interface
  (often OpenAPI or Pact). Catches breaking API changes without full E2E tests.

- **Arrange-Act-Assert:** Structure tests into setup, action, and verification.
  Keeps tests readable and focused.

- **Given-When-Then:** A behavior-oriented test structure: preconditions, action,
  expected outcome. Useful for acceptance criteria.

- **Test Doubles:** Stubs return canned data, mocks verify expectations, spies
  record calls, and fakes are lightweight working implementations. Prefer fakes
  over deep mock hierarchies.

- **Test Isolation:** Each test should create its own data and clean up. Tests that
  depend on order or shared mutable state become flaky and hide real bugs.

- **Deterministic Tests:** Control time, randomness, network, and database state.
  Use fixed clocks or dynamically derived dates; never hardcode a date that will
  become stale.

- **Dynamic Test Dates:** Derive future dates from the current time (for example
  `now + 7 days`) so tests do not expire. Use timezone-aware helpers.

- **Factories and Fixtures:** Centralize test data creation so tests express only
  what matters. Avoid enormous shared fixtures that hide dependencies.

- **Coverage:** A useful signal, not a goal. High coverage with weak assertions can
  still miss bugs. Focus on critical paths, edge cases, and failure modes.

- **Flaky Tests:** Tests that pass/fail nondeterministically. Fix the root cause
  (time, order, shared state, async waits) instead of retrying blindly.

- **Regression Test:** A test added for a fixed bug so it cannot silently return.
  Name it after the behavior, not the ticket number.

- **Accessibility Testing:** Check keyboard flows, labels, focus order, contrast,
  and screen-reader semantics. Automated tools help but do not replace manual
  keyboard testing.

- **Performance Testing:** Measure latency, throughput, memory, and bundle size.
  Use budgets and compare against a baseline; avoid optimizing by intuition.

- **Lint / Format / Typecheck:** Static checks catch style drift, unsafe patterns,
  and type errors before runtime. They should run in CI and locally.

- **CI Quality Gates:** A change is not done until typecheck, lint, format, tests,
  and production build pass. Add dependency and security scanning where possible.

- **Build Verification:** Run the production build, not only the dev server.
  Build-time env validation and chunking issues often appear only in production.

## DevOps, Observability, and Performance

- **Docker Multi-Stage Build:** Use a build stage with compilers/toolchains and a
  smaller runtime stage with only production artifacts. Improves image size,
  startup time, and attack surface.

- **Health Checks:** Liveness checks whether the process is alive; readiness checks
  whether it can serve traffic; startup checks handle slow initialization. Keep
  probes independent of auth and rate limiting.
  - **DockSlot:** health routes bypass the API rate limiter and return `no-store`.

- **Email Provider Abstraction:** Hide delivery mechanics behind a provider so
  local development can use Mailhog while deployed environments use an
  authenticated SMTP relay or an HTTPS API.
  - **DockSlot:** `backend/src/services/email.service.ts` supports `smtp`,
    `resend`, and `brevo`; `EMAIL_PROVIDER` selects the transport. HTTPS APIs are
    the practical option when a free PaaS blocks outbound SMTP.

- **Build-Time Static Host Headers:** Generate host-specific security headers from
  the same validated configuration used by the bundle instead of maintaining a
  second copy that can drift.
  - **DockSlot:** `frontend/vite.config.ts` emits `dist/_headers` for Cloudflare
    Workers from `VITE_API_URL`; `frontend/wrangler.jsonc` enables the SPA
    fallback with `not_found_handling: "single-page-application"`.

- **Cold Starts on Free PaaS:** Scale-to-zero services trade cost for latency.
  Warm critical services before a demo, document the delay, and keep a local
  Docker Compose fallback.

- **Graceful Shutdown:** Stop accepting new work, drain in-flight requests and
  worker cycles, close database/Redis connections, then exit. Use a hard timeout
  so a stuck dependency cannot hang the process forever.

- **Stateless Service:** Store session/request state outside the process so any
  instance can handle any request. Enables horizontal scaling and rolling
  deployments.
  - **DockSlot:** access tokens are client-side; business state lives in MySQL,
    with shared Redis for rate limits and short-lived caches.

- **Horizontal vs Vertical Scaling:** Scale out by adding instances; scale up by
  adding resources to one machine. Stateless services scale out more easily.

- **Load Balancing:** Distributes traffic across instances. Common strategies:
  round robin, least connections, IP hash, and consistent hashing. Use health
  checks and avoid sticky sessions unless state cannot be externalized.

- **Consistent Hashing:** Maps keys to nodes so adding/removing a node moves only
  a fraction of keys. Useful for distributed caches and sharded data.

- **Sharding / Partitioning:** Splitting data across databases or nodes by a key.
  Watch for hot partitions and make resharding a planned operation, not an
  emergency.

- **Read Replicas:** Scale reads by serving from replicas. Expect replication lag;
  use read-your-writes routing for operations that must see fresh data.

- **Load Balancer / Proxy Trust:** Behind a proxy, configure trusted proxy hops so
  `req.ip`, rate limiting, and logs use the real client address. Never trust
  arbitrary `X-Forwarded-For` headers.
  - **DockSlot:** `parseTrustProxy` configures Express trust.

- **Redis:** In-memory data store used for caching, rate limiting, distributed
  counters, and short-lived session state. It is not the source of truth for
  durable business data.

- **Cache-Aside / TTL:** Read through the cache, populate on miss, and expire
  entries. Use explicit invalidation for data that must be fresh.

- **Structured Logging:** Emit machine-readable logs (often JSON) with level,
  timestamp, request ID, user/tenant ID, route, status, and duration. Avoid
  unstructured string concatenation for production logs.

- **Correlation ID:** A request/event ID propagated through logs, queues, and
  downstream calls. It is the backbone of debugging distributed flows.

- **Log Redaction:** Never log passwords, tokens, cookies, authorization headers,
  secrets, or full PII. Redact URL query parameters such as reset tokens.

- **Metrics:** Counters, gauges, and histograms. RED metrics (Rate, Errors,
  Duration) for services; USE metrics (Utilization, Saturation, Errors) for
  resources.

- **Tracing:** Distributed spans showing where time is spent across services and
  queues. Propagate trace context through HTTP headers and async jobs.

- **SLI / SLO / SLA:** SLI is a measured indicator (latency, error rate); SLO is an
  internal target; SLA is a contractual promise. Error budgets make reliability
  trade-offs explicit.

- **Alerting:** Alert on user-visible symptoms and SLO burn, not every internal
  metric. Every alert should be actionable and have a runbook.

- **Migrations and Rollbacks:** Apply schema changes in a backward-compatible
  order, back up critical data, and have a rollback or forward-fix plan.

- **Blue/Green and Canary Deployments:** Blue/green switches traffic between two
  environments; canary sends a small percentage to the new version. Both reduce
  deployment risk; feature flags can decouple release from deploy.

- **CDN / Static Caching:** Serve hashed static assets with long-lived immutable
  caching; keep `index.html` short-lived so new deployments are picked up. Set
  security headers at the edge as well as the app.

- **Bundle Splitting:** Split application and vendor code into cacheable chunks.
  Lazy-load routes and heavy components; avoid shipping the entire app on first
  paint.

- **Web Vitals:** LCP (loading), INP (interaction responsiveness), and CLS (layout
  stability). Track real-user metrics and set performance budgets.

- **Performance Budget:** A hard limit on bundle size, image weight, or request
  latency. It turns performance into a reviewable constraint instead of a
  best-effort goal.

- **Compression:** Use gzip/Brotli for text responses and images in modern formats.
  Compression reduces transfer size but costs CPU; let the CDN/proxy handle it.

- **Connection Pooling:** Reuse database/HTTP connections instead of opening one
  per request. Tune pool size to database capacity; an oversized pool can be worse
  than a small one.

- **Async Processing:** Move slow, retryable, or non-critical work to a queue or
  worker. Keep the request path focused on validation, persistence, and response.

## Common Pitfalls

- **Idempotency key without a request fingerprint:** The same key with a different
  body can return the wrong cached response. Store and compare a request hash.
- **Idempotency race:** Two concurrent requests with the same key both execute
  before the record is stored. Use an atomic in-progress row or unique constraint.
- **Singleflight without error sharing:** One failed flight can leave other waiters
  hanging. Share both success and failure.
- **Debounce without cleanup:** Timers fire after unmount and update stale state.
  Clear them in the effect cleanup.
- **Retrying non-idempotent operations:** Blind retries can duplicate side effects.
  Require idempotency or a safe operation.
- **Refresh rotation without a grace window:** Concurrent tabs can trigger false
  reuse detection and revoke a valid session.
- **Zombie sessions:** Logout only clears the client while the server token remains
  valid. Revoke server-side and bump the session epoch/token version.
- **Cache stampede:** Many misses hit the database at once. Use singleflight,
  locking, stale-while-revalidate, or jitter.
- **Assuming SMTP works everywhere:** Some PaaS free tiers block outbound SMTP
  ports. Use an HTTPS email API or a host that permits SMTP, and test delivery in
  the target environment rather than only locally.
- **Rate limiting by IP only:** Behind a proxy, all users can appear as one IP.
  Configure trusted proxies and prefer user IDs when authenticated.
- **Trusting a client-supplied tenant ID:** Always derive the tenant from the
  authenticated principal and scope every query.
- **JWT in `localStorage`:** Any XSS can exfiltrate it. Prefer in-memory access
  tokens plus `HttpOnly` refresh cookies.
- **Using an Error Boundary for async errors:** Boundaries do not catch event
  handlers, promises, or async callbacks. Handle those explicitly.
- **Suspense without an Error Boundary:** A lazy-load failure can crash the tree.
  Pair Suspense with an error boundary.
- **`useEffect` race conditions:** Older requests can overwrite newer state. Use
  cancellation, request IDs, or an epoch guard.
- **Hardcoded future dates in tests:** Tests expire. Derive dates dynamically and
  control the clock.
- **Secrets in logs:** Tokens, cookies, passwords, and reset links must be redacted.
- **Missing `no-store` on auth responses:** Proxies/browsers may cache sensitive
  data. Set `Cache-Control: no-store`.
- **CORS reflecting any origin with credentials:** This defeats origin isolation.
  Use an explicit allowlist in production.
- **Outbox without an idempotent consumer:** At-least-once delivery will eventually
  duplicate. Consumers must deduplicate.
- **Claiming exactly-once delivery:** Be precise: at-least-once delivery plus
  idempotent effects.
- **Premature abstraction:** A shared helper for two coincidentally similar cases
  can become a worse coupling than duplication.
- **Overusing `useMemo`/`useCallback`:** Memoization has a cost and can hide
  unnecessary renders. Profile first.
- **Order-dependent tests:** Shared state makes tests flaky. Isolate data and clean
  up.
- **Mocking everything:** Too many mocks test the mocks, not the integration. Use
  real boundaries where practical.
- **Ignoring time zones and DST:** Fixed offsets break twice a year. Store UTC and
  use IANA zones.
- **Unbounded queries:** Always paginate/limit list endpoints and background jobs.
- **No timeouts:** A slow dependency can exhaust the worker pool. Set deadlines.
- **No backpressure:** Unbounded queues turn a traffic spike into an outage.
- **No cleanup jobs:** Expired idempotency records, sessions, and outbox rows grow
  forever. Schedule pruning.
- **No observability:** If you cannot trace a request or see error rates, you
  cannot operate the system.

## Interview Quick Reference

### Problem → pattern

| Problem                             | Pattern / practice                                        | Key trade-off                                  |
| ----------------------------------- | --------------------------------------------------------- | ---------------------------------------------- |
| Duplicate booking from a retry      | Idempotency key + request fingerprint + unique constraint | Storage/TTL cost vs duplicate side effects     |
| Many tabs refreshing at once        | Client singleflight + server grace window                 | Slight complexity vs refresh storms            |
| Logout must kill all sessions       | Token version / session epoch + refresh-family revocation | Durable state/DB write vs immediate revocation |
| Webhook delivery can fail           | Transactional outbox + retries + idempotent consumer      | Async complexity vs reliable side effects      |
| Double booking under concurrency    | Transaction + lock/unique constraint                      | Contention vs correctness                      |
| Slow dependency                     | Timeout + circuit breaker + fallback                      | Availability vs consistency                    |
| Traffic spike                       | Rate limiting + backpressure + queue                      | Rejected requests vs overload                  |
| Cache stampede                      | Singleflight + TTL jitter + stale-while-revalidate        | Staleness vs database load                     |
| Cross-tenant data leak              | Tenant scoping in every query + authorization tests       | Query complexity vs isolation                  |
| Huge initial JS bundle              | Route lazy loading + vendor chunks + tree shaking         | Extra requests vs faster first paint           |
| Async UI failure                    | Error boundary + explicit error state                     | Recovery UI vs silent failure                  |
| Stale response overwrites new state | AbortController / request ID / epoch guard                | Cancellation complexity vs correctness         |
| Brute-force login                   | Rate limit + lockout + generic errors + MFA               | UX friction vs account safety                  |
| No production visibility            | Structured logs + correlation IDs + metrics + traces      | Instrumentation cost vs operability            |

### Answer framework

1. **Clarify the requirement:** consistency, latency, availability, security, or
   cost.
2. **Name the pattern:** idempotency, singleflight, outbox, token version, etc.
3. **Explain the mechanics:** where state lives, who writes it, what happens on
   retry/failure.
4. **State the trade-offs:** complexity, storage, latency, staleness, operational
   burden.
5. **Give a project example:** what DockSlot does and why.
6. **Discuss failure modes:** duplicate delivery, partial failure, race conditions,
   cache invalidation, and recovery.

### High-value talking points

- **Idempotency is not just a header:** it needs a fingerprint, atomic reservation,
  cached response, TTL, and cleanup.
- **Singleflight is not a cache:** it coalesces concurrent work only; add a cache
  for cross-request reuse.
- **Debounce is not a server-side correctness control:** the server still needs
  validation, rate limits, and idempotency.
- **Refresh rotation needs a grace window:** otherwise concurrent tabs cause false
  reuse detection.
- **Session revocation needs server-side state:** short TTLs alone leave zombie
  sessions.
- **Outbox solves dual writes, not duplicate delivery:** consumers must be
  idempotent.
- **JWT vs server session:** JWT scales statelessly but revocation is harder;
  server sessions revoke easily but need shared state. DockSlot uses a hybrid:
  short-lived JWT access tokens + stateful refresh sessions + token version.
- **Optimistic vs pessimistic locking:** optimistic is better for low contention;
  pessimistic is simpler when conflicts are frequent.
- **Monolith vs microservices:** start with a modular monolith; distribute only
  when team, scaling, or failure-isolation needs justify the operational cost.
- **Testing with a real database** catches transaction, constraint, and ORM bugs
  that mocks hide. Keep tests deterministic with dynamic dates and isolated data.
