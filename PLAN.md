# PLAN.md: DockSlot Project Plan

## 1. Understanding of the Problem
DockSlot is a multi-tenant B2B platform connecting two distinct organization types with strict data isolation:
- **Warehouse Operators:** Manage warehouses, physical docks, operating hours, slot durations, and view/manage truck arrivals.
- **Carriers (Dispatchers & Admins):** Search available dock slots across warehouses in local time, book slots for trucks, and manage their organization's bookings.

The core technical challenges involve:
- **Strict Concurrency Control:** Preventing double-booking under high contention when multiple dispatchers attempt to book the exact same slot simultaneously.
- **Time Zone Handling:** Generating accurate slot schedules based on each warehouse's local time zone (e.g., Asia/Colombo, Europe/Amsterdam) regardless of server or user browser time zones.
- **Asynchronous Resilience:** Communicating booking events to an unstable third-party webhook (Carrier Notify API) with random delays, failures, and hangs without degrading user-facing booking performance.

---

## 2. Questions for the Product Owner
1. **Anti-Hogging Rules (W5):** What is the exact mathematical threshold or rule for "hogging" warehouse slots (e.g., maximum active bookings per carrier per day/week)? *Assumption for now: Implement a configurable soft/hard limit per carrier per day per warehouse.*
2. **Notification Retries (N3):** For guaranteed eventual delivery without duplicates, should we implement an outbox pattern with an internal background worker job, or a simple database-backed retry queue? *Assumption: Use a lightweight transactional outbox table with periodic background polling/retry.*
3. **Rescheduling Conflicts (B5):** When rescheduling a booking, does it release the old slot atomically within the same transaction as booking the new slot? *Assumption: Yes, wrapped in a serializable or repeatable-read database transaction.*

---

## 3. Top Risks
1. **Race Conditions in Slot Booking:** Two dispatchers clicking "Book" at the exact same millisecond could result in a double-booking if database isolation levels or locking mechanisms are insufficient.
   - *Mitigation:* Use database-level unique constraints on `(dock_id, slot_start_time)` combined with explicit row-level locking (`SELECT ... FOR UPDATE`) or optimistic concurrency control.
2. **Unreliable Third-Party Notify API:** The fake notify service has 20% failures, 5% 30-second hangs, and random 1–5s latency. Synchronous calls would break user experience.
   - *Mitigation:* Decouple notifications using an asynchronous queue/outbox worker so web responses return instantly (`N2`).
3. **Time Zone Offset Discrepancies:** Storing slot timestamps incorrectly in UTC vs. local time can lead to off-by-one-hour errors during daylight saving transitions or multi-region queries.
   - *Mitigation:* Store all timestamps as UTC in the database, but compute and query slot boundaries strictly relative to the warehouse's IANA time zone.

---

## 4. Architecture Sketch

┌────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                               │
│     ┌────────────────────────┐      ┌────────────────────────────┐     │
│     │ Warehouse Operator Web │      │ Carrier Dispatcher Web/App │     │
│     └───────────┬────────────┘      └─────────────┬──────────────┘     │
└─────────────────┼─────────────────────────────────┼────────────────────┘
                  │ HTTPS (TLS)                     │ HTTPS (TLS)
                  ▼                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EDGE & LOAD BALANCER TIER                       │
│                       [ Nginx / Reverse Proxy ]                        │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ Balanced Traffic
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
┌──────────────────────────────────┐              ┌──────────────────────────────────┐
│      App Instance 1 (Node)       │              │      App Instance 2 (Node)       │
│  ┌────────────────────────────┐  │              │  ┌────────────────────────────┐  │
│  │ JWT Auth & Tenant RBAC     │  │              │  │ JWT Auth & Tenant RBAC     │  │
│  ├────────────────────────────┤  │              │  ├────────────────────────────┤  │
│  ├────────────────────────────┤  │              │  ├────────────────────────────┤  │
│  │ Time Zone Slot Engine      │  │              │  │ Time Zone Slot Engine      │  │
│  ├────────────────────────────┤  │              │  ├────────────────────────────┤  │
│  │ Concurrency / Lock Manager │  │              │  │ Concurrency / Lock Manager │  │
│  └──────────────┬─────────────┘  │              │  └──────────────┬─────────────┘  │
└─────────────────┼────────────────┘              └─────────────────┼────────────────┘
                  │                                                 │
                  └────────────────────────┬────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE & CONCURRENCY LAYER                     │
│               [ PostgreSQL / MySQL Relational Database ]               │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐ │
│  │ Strict Tenant-Id     │  │ Row-Level Locking    │  │ Unique Slot   │ │
│  │ Scoped Indexes       │  │ (`SELECT ... FOR     │  │ Constraints   │ │
│  │ (Data Isolation)     │  │  UPDATE`)            │  │ (No Doubles)  │ │
│  └──────────────────────┘  └──────────────────────┘  └───────────────┘ │
└──────────────────────────────────────────┬─────────────────────────────┘
                                           │ Transactional Outbox
                                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     ASYNCHRONOUS NOTIFICATION TIER                     │
│      [ Background Poll Worker / Outbox Dispatcher (Idempotent) ]       │
└──────────────────────────────────────────┬─────────────────────────────┘
                                           │ HTTP Post (Retries & Backoff)
                                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        EXTERNAL INTEGRATION TIER                       │
│                     [ Mock Carrier Notify API ]                        │
│          (Simulates 1-5s Latency, 20% Errors, & 30s Hangs)             │
└────────────────────────────────────────────────────────────────────────┘

## 5. Build Order & Implementation Phases

- **Phase 1: Foundation & Auth (PO)**
  - Set up Docker Compose (`app`, database, Mailpit/mail catcher, fake notify service).
  - Implement database schema (Organizations, Users, Warehouses, Docks, Bookings, Audit/Outbox logs).
  - Build email/password auth, role-based access control (RBAC), and email verification.
- **Phase 2: Core Warehouse & Slot Engine (PO)**
  - Warehouse & dock management for Warehouse Admins.
  - Slot generator algorithm handling warehouse local time zones, operating hours, and slot lengths.
  - Slot search API and frontend view (`B1`, `U1`, `U2`).
- **Phase 3: Bookings & Concurrency Control (PO)**
  - Booking creation endpoint with strict double-booking prevention (`B3`).
  - Automated concurrency test script firing concurrent requests to prove zero double-bookings.
  - Cancellation flow and inventory release.
- **Phase 4: Notifications & Asynchronous Reliability (PO/P1)**
  - Build the fake Carrier Notify API service matching spec (`5.1`).
  - Implement asynchronous webhook dispatch / outbox pattern to ensure user actions stay fast (`N2`).
- **Phase 5: UI Refinements & P1 Features**
  - Implement loading, empty, and error states across all screens (`U4`).
  - Add rescheduling (`B5`), maintenance dock closures (`W3`), and input validation.
  - Document API endpoints and seed data logins in `README.md`.