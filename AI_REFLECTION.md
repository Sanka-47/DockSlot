1. Describe three times the AI was wrong or missed details. How did you notice?

Inline vs. Modular Code Structure

What happened: When I asked about the health check endpoint, the AI suggested writing a quick, inline Express route (app.get('/health')).

How I noticed: I caught it immediately because it didn't fit our clean project layout. I had to remind it to use our separated controller and route structure (though to be fair, my initial prompt was a little unclear and probably caused it to take that shortcut).

Assuming Database Refresh Tokens

What happened: While talking about login and token expiration, the AI assumed my database table had a column for refresh tokens.

How I noticed: I knew my database schema didn't have that. I had to correct it and explain that we handle auth using secure cookies and Redis-backed session versioning instead of database columns.

Skipping Docker Health Checks

What happened: When we set up Docker Compose, the AI treated the backend health check as an optional extra rather than using our actual /health endpoint.

How I noticed: Since I had just built that /health endpoint, I wanted Docker to actually use it to check container startup. I pointed it out so we could update the Compose file to use it properly.

2. When the AI tried to add an unneeded name field to the User model and introduced redundant payload names like orgName and orgType, I shut it down and had it stick to our existing organizationName and organizationType instead.

Why: The AI has a bad habit of reaching for additive solutions (extra fields, new aliases, redundant naming) that create clutter and schema drift. I overruled it because keeping our interfaces clean and single-sourced is way more important than buying into unnecessary backwards-compatibility or duplication.


3. I didn't type the application logic — that was the AI's. What I wrote was the spec and the schema: every feature came in as a numbered spec I authored, and I supplied the actual Prisma models (IdempotencyRecord, AuditLog, DockClosure, Invitation) and index DDL as code. I owned the architecture — a routes/controllers/services split I enforced even when the AI tried inline shortcuts. I owned the contracts: the /api/namespace, the registration payload fields, and the changePassword signature. And I owned the data model decisions, like auth via secure cookies + Redis session versioning rather than refresh-token columns. Where I 'heavily rewrote' was actually at the feature level — I reverted and discarded entire AI deliverables twice when the approach drifted, and I fixed the schema drift that left behind.


4. I would never hand over authentication route guards, multi-tenant data scoping, time-zone slot arithmetic, booking concurrency logic, security configurations, database migrations, or secrets and destructive operations to an AI without close human review. These areas require absolute precision because unsupervised mistakes lead to severe, silent, or irreversible consequences—such as broken security boundaries, cross-tenant data leaks, double-booked docks, production crashes, or catastrophic data loss.

5. I gave the AI context by referencing specific files and line numbers, anchoring features to existing code patterns, establishing open-api.json as the authoritative API contract, feeding back raw error logs, and supplying detailed numbered specs with exact payloads and database schemas. Next time, I would do things differently by codifying rules directly in-repo rather than tool-private memory, turning architectural invariants into automated tests, automating API contract generation,