import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { dockService } from '../src/services/dock.service';

const jwtSecret = securityConfig.jwtSecret || process.env.JWT_SECRET || 'your_jwt_secret_key';

describe('Real-Time Dynamic Dock Status Evaluation & Active Closure Enforcement Tests', () => {
  let warehouseOrgId: number;
  let warehouseId: number;
  let dockActiveId: number;
  let dockWithActiveClosureId: number;
  let dockBaseMaintenanceId: number;

  let warehouseAdminToken: string;
  let carrierOrgId: number;
  let dispatcherToken: string;

  const testSalt = Date.now();

  beforeAll(async () => {
    // 1. Create Warehouse Operator Organization
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Dynamic Status Warehouse Org ${testSalt}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    // 2. Create Warehouse Admin User
    const adminPasswordHash = await bcrypt.hash('SecurePass123!', 10);
    const adminUser = await prisma.user.create({
      data: {
        email: `dynamic_admin_${testSalt}@dockslot.local`,
        passwordHash: adminPasswordHash,
        role: UserRole.WAREHOUSE_ADMIN,
        organizationId: warehouseOrgId,
        isActive: true,
        isEmailVerified: true,
      },
    });
    warehouseAdminToken = jwt.sign(
      { userId: adminUser.id, email: adminUser.email, role: adminUser.role, organizationId: warehouseOrgId },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 3. Create Carrier Org & Dispatcher User
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Dynamic Status Carrier Org ${testSalt}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const dispatcherUser = await prisma.user.create({
      data: {
        email: `dynamic_dispatcher_${testSalt}@carrier.local`,
        passwordHash: adminPasswordHash,
        role: UserRole.DISPATCHER,
        organizationId: carrierOrgId,
        isActive: true,
        isEmailVerified: true,
      },
    });
    dispatcherToken = jwt.sign(
      { userId: dispatcherUser.id, email: dispatcherUser.email, role: dispatcherUser.role, organizationId: carrierOrgId },
      jwtSecret,
      { expiresIn: '1h' }
    );

    // 4. Create Warehouse with 24/7 operating hours
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: `Dynamic Evaluation Facility ${testSalt}`,
        address: '123 Harbor Parkway, Colombo',
        timezone: 'Asia/Colombo',
        slotLengthMinutes: 30,
        operatingHours: {
          create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '23:59',
            slotLengthMinutes: 30,
          })),
        },
        policy: {
          create: {
            maxConcurrentBookings: 10,
            maxAdvanceDays: 30,
            bookingLockWindowHours: 1,
          },
        },
      },
    });
    warehouseId = warehouse.id;

    // 5. Create Docks:
    // Dock 1: Base ACTIVE, no closures
    const dock1 = await prisma.dock.create({
      data: {
        warehouseId,
        name: 'Bay 1 - Pure Active',
        status: DockStatus.ACTIVE,
      },
    });
    dockActiveId = dock1.id;

    // Dock 2: Base ACTIVE, but has active time-bounded maintenance closure right now
    const dock2 = await prisma.dock.create({
      data: {
        warehouseId,
        name: 'Bay 2 - Active Closure Target',
        status: DockStatus.ACTIVE,
      },
    });
    dockWithActiveClosureId = dock2.id;

    // Dock 3: Base MAINTENANCE in database
    const dock3 = await prisma.dock.create({
      data: {
        warehouseId,
        name: 'Bay 3 - Manual Maintenance',
        status: DockStatus.MAINTENANCE,
      },
    });
    dockBaseMaintenanceId = dock3.id;

    // 6. Schedule an ACTIVE maintenance closure on Dock 2 spanning the current
    //    timestamp and well beyond tomorrow (now - 1h to now + 72h), so the
    //    "active maintenance" assertions hold no matter what wall-clock time the
    //    suite runs at.
    const now = new Date();
    const activeStart = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const activeEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 3 days ahead

    await prisma.dockClosure.create({
      data: {
        dockId: dockWithActiveClosureId,
        startTime: activeStart,
        endTime: activeEnd,
        reason: 'Emergency hydraulic lift inspection',
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    const dockIds = [dockActiveId, dockWithActiveClosureId, dockBaseMaintenanceId].filter(Boolean);
    if (dockIds.length > 0) {
      await prisma.dockClosure.deleteMany({
        where: { dockId: { in: dockIds } },
      });
      await prisma.booking.deleteMany({
        where: { dockId: { in: dockIds } },
      });
      await prisma.dock.deleteMany({
        where: { id: { in: dockIds } },
      });
    }
    if (warehouseId) {
      await prisma.operatingHour.deleteMany({ where: { warehouseId } });
      await prisma.warehousePolicy.deleteMany({ where: { warehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
    }
    await prisma.user.deleteMany({ where: { email: { contains: `dynamic_` } } });
    const orgIds = [warehouseOrgId, carrierOrgId].filter(Boolean);
    if (orgIds.length > 0) {
      await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    }
  });

  it('evaluates effectiveStatus in real-time when listing warehouse docks via GET /api/warehouses/:id/docks', async () => {
    const res = await request(app)
      .get(`/api/warehouses/${warehouseId}/docks`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    const dock1 = res.body.data.find((d: any) => d.id === dockActiveId);
    expect(dock1).toBeDefined();
    expect(dock1.status).toBe('ACTIVE');
    expect(dock1.effectiveStatus).toBe('ACTIVE');

    // Dock 2 has base status ACTIVE in DB, but has an active closure right now -> MUST evaluate to MAINTENANCE
    const dock2 = res.body.data.find((d: any) => d.id === dockWithActiveClosureId);
    expect(dock2).toBeDefined();
    expect(dock2.status).toBe('ACTIVE');
    expect(dock2.effectiveStatus).toBe('MAINTENANCE');

    // Dock 3 has base status MAINTENANCE in DB -> MUST evaluate to MAINTENANCE
    const dock3 = res.body.data.find((d: any) => d.id === dockBaseMaintenanceId);
    expect(dock3).toBeDefined();
    expect(dock3.status).toBe('MAINTENANCE');
    expect(dock3.effectiveStatus).toBe('MAINTENANCE');
  });

  it('evaluates effectiveStatus directly using dockService.getDockEffectiveStatus helper', async () => {
    const status1 = await dockService.getDockEffectiveStatus(dockActiveId);
    expect(status1.effectiveStatus).toBe('ACTIVE');
    expect(status1.dock.status).toBe('ACTIVE');

    const status2 = await dockService.getDockEffectiveStatus(dockWithActiveClosureId);
    expect(status2.effectiveStatus).toBe('MAINTENANCE');
    expect(status2.dock.status).toBe('ACTIVE');
    expect(status2.activeClosure).toBeDefined();
    expect(status2.activeClosure.reason).toBe('Emergency hydraulic lift inspection');

    const status3 = await dockService.getDockEffectiveStatus(dockBaseMaintenanceId);
    expect(status3.effectiveStatus).toBe('MAINTENANCE');
    expect(status3.dock.status).toBe('MAINTENANCE');
  });

  it('slot generation (B1) automatically excludes docks currently undergoing active maintenance', async () => {
    // Generate target date for *tomorrow* in the warehouse timezone
    // (Asia/Colombo UTC+5:30). Using a full future day guarantees available
    // slots regardless of how late in the day this suite happens to run; the
    // Dock 2 closure above spans this day too.
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Colombo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const targetDate = formatter.format(tomorrow);

    const res = await request(app)
      .get(`/api/warehouses/${warehouseId}/slots?targetDate=${targetDate}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dockIdsReturned = res.body.data.map((d: any) => d.dockId);

    // Dock 1 (Active) must have available slots returned
    expect(dockIdsReturned).toContain(dockActiveId);
    const dock1Slots = res.body.data.find((d: any) => d.dockId === dockActiveId);
    expect(dock1Slots.slots.length).toBeGreaterThan(0);

    // Dock 2 (currently undergoing maintenance) must be hidden / excluded from active slot generation
    expect(dockIdsReturned).not.toContain(dockWithActiveClosureId);

    // Dock 3 (base MAINTENANCE) must be hidden / excluded from active slot generation
    expect(dockIdsReturned).not.toContain(dockBaseMaintenanceId);
  });

  it('booking creation (B2) rejects booking attempt on a dock currently undergoing maintenance (400 Bad Request)', async () => {
    // Attempt to book Dock 2 while it is in active closure
    const slotStart = new Date(Date.now() + 30 * 60 * 1000); // 30 mins from now (inside active closure)
    // Round to nearest 30 mins for slot length alignment
    slotStart.setMinutes(slotStart.getMinutes() >= 30 ? 30 : 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({
        dockId: dockWithActiveClosureId,
        slotStartTime: slotStart.toISOString(),
        slotEndTime: slotEnd.toISOString(),
        truckPlate: 'WP-CAD-8844',
        driverName: 'Saman Perera',
        driverPhone: '+94771234567',
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe('Dock is currently under maintenance and cannot be booked.');
  });

  it('docks with past or future closures correctly evaluate to effectiveStatus: ACTIVE at current time', async () => {
    const now = new Date();

    // Add a past closure to Dock 1 (ended 30 minutes ago)
    const pastClosure = await prisma.dockClosure.create({
      data: {
        dockId: dockActiveId,
        startTime: new Date(now.getTime() - 90 * 60 * 1000),
        endTime: new Date(now.getTime() - 30 * 60 * 1000),
        reason: 'Past maintenance already concluded',
      },
    });

    // Add a future closure to Dock 1 (starts in 3 hours)
    const futureClosure = await prisma.dockClosure.create({
      data: {
        dockId: dockActiveId,
        startTime: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        endTime: new Date(now.getTime() + 5 * 60 * 60 * 1000),
        reason: 'Scheduled maintenance for tomorrow',
      },
    });

    const statusCheck = await dockService.getDockEffectiveStatus(dockActiveId);
    expect(statusCheck.effectiveStatus).toBe('ACTIVE');

    const res = await request(app)
      .get(`/api/warehouses/${warehouseId}/docks`)
      .set('Authorization', `Bearer ${warehouseAdminToken}`);

    const dock1 = res.body.data.find((d: any) => d.id === dockActiveId);
    expect(dock1.effectiveStatus).toBe('ACTIVE');

    // Clean up temporary closures
    await prisma.dockClosure.deleteMany({
      where: { id: { in: [pastClosure.id, futureClosure.id] } },
    });
  });

  it('verifies composite index dock_closures_active_check_idx is present on dock_closures table', async () => {
    const indexes: any = await prisma.$queryRawUnsafe('SHOW INDEX FROM `dock_closures`');
    const compositeIndexRows = indexes.filter(
      (idx: any) => idx.Key_name === 'dock_closures_active_check_idx'
    );

    expect(compositeIndexRows.length).toBe(3);
    const columns = compositeIndexRows.map((r: any) => r.Column_name);
    expect(columns).toEqual(['dockId', 'startTime', 'endTime']);
  });
});
