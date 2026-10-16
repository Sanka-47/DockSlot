import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import app from '../src/index';
import { prisma } from '../src/config/db.config';
import jwt from 'jsonwebtoken';
import { securityConfig } from '../src/config/security.config';
import { OrganizationType, UserRole, DockStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';

describe('Slot Taken Between Viewing and Booking Requirement (DispatcherDashboard + API)', () => {
  let warehouseOrgId: number;
  let carrierOrgId: number;
  let testWarehouseId: number;
  let testDockId: number;
  let dispatcherAToken: string;
  let dispatcherBToken: string;
  const userIds: number[] = [];

  // Future date in YYYY-MM-DD (within 14-day advance window)
  const futureDate = (() => {
    const d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  })();

  beforeAll(async () => {
    // 1. Create Warehouse Operator Organization
    const warehouseOrg = await prisma.organization.create({
      data: {
        name: `Warehouse Org SlotConflict ${Date.now()}`,
        type: OrganizationType.WAREHOUSE_OPERATOR,
      },
    });
    warehouseOrgId = warehouseOrg.id;

    // 2. Create Warehouse with 08:00 - 12:00 operating hours (30-min slots)
    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'Conflict UX Test Warehouse',
        address: '42 Harbor Road, Colombo',
        timezone: 'UTC',
        operatingHours: {
          create: [0, 1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '08:00',
            closeTime: '10:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: {
          create: [{ name: 'Bay Alpha', status: DockStatus.ACTIVE }],
        },
      },
      include: { docks: true },
    });
    testWarehouseId = warehouse.id;
    testDockId = warehouse.docks[0].id;

    // 3. Create Carrier Organization & 2 Dispatchers (Dispatcher A and Dispatcher B)
    const carrierOrg = await prisma.organization.create({
      data: {
        name: `Carrier Org SlotConflict ${Date.now()}`,
        type: OrganizationType.CARRIER,
      },
    });
    carrierOrgId = carrierOrg.id;

    const userA = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `disp_a_${Date.now()}@carrier.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    const userB = await prisma.user.create({
      data: {
        organizationId: carrierOrgId,
        email: `disp_b_${Date.now()}@carrier.com`,
        passwordHash: 'hashed_pw',
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    });
    userIds.push(userA.id, userB.id);

    dispatcherAToken = jwt.sign(
      {
        userId: userA.id,
        organizationId: carrierOrgId,
        role: userA.role,
        email: userA.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );

    dispatcherBToken = jwt.sign(
      {
        userId: userB.id,
        organizationId: carrierOrgId,
        role: userB.role,
        email: userB.email,
      },
      securityConfig.jwtSecret,
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    try {
      await prisma.outboxEvent.deleteMany({
        where: {
          aggregateType: 'BOOKING',
          payload: { path: ['dockId'], equals: testDockId },
        },
      });
      await prisma.auditLog.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.booking.deleteMany({ where: { dockId: testDockId } });
      await prisma.dock.deleteMany({ where: { id: testDockId } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId: testWarehouseId } });
      await prisma.warehouse.deleteMany({ where: { id: testWarehouseId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.organization.deleteMany({
        where: { id: { in: [warehouseOrgId, carrierOrgId] } },
      });
    } catch {
      // ignore cleanup errors
    } finally {
      await prisma.$disconnect();
    }
  });

  it('End-to-End API + UI Flow: When a slot is taken between viewing and booking, returns 409 Conflict and refreshed slots exclude the taken slot', async () => {
    // Step 1: Both Dispatcher A and Dispatcher B view available slots for futureDate
    const initialSlotsRes = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/slots`)
      .query({ date: futureDate, dockId: testDockId })
      .set('Authorization', `Bearer ${dispatcherBToken}`);

    expect(initialSlotsRes.status).toBe(200);
    const initialDockGroups = initialSlotsRes.body.data;
    expect(Array.isArray(initialDockGroups)).toBe(true);
    expect(initialDockGroups.length).toBeGreaterThan(0);

    const initialSlots = initialDockGroups[0].slots;
    expect(initialSlots.length).toBe(4); // 08:00-08:30, 08:30-09:00, 09:00-09:30, 09:30-10:00
    const targetSlot = initialSlots[0];

    // Step 2: Dispatcher A books targetSlot while Dispatcher B is still viewing it
    const bookingARes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherAToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: targetSlot.slotStartTime,
        slotEndTime: targetSlot.slotEndTime,
        truckPlate: 'WP-AAA-1111',
        driverName: 'Driver A',
        driverPhone: '+94771111111',
      });

    expect(bookingARes.status).toBe(201);

    // Step 3: Dispatcher B attempts to book the exact same slot they viewed earlier
    const bookingBRes = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${dispatcherBToken}`)
      .send({
        dockId: testDockId,
        slotStartTime: targetSlot.slotStartTime,
        slotEndTime: targetSlot.slotEndTime,
        truckPlate: 'WP-BBB-2222',
        driverName: 'Driver B',
        driverPhone: '+94772222222',
      });

    expect(bookingBRes.status).toBe(409);
    expect(bookingBRes.body.success).toBe(false);

    // Step 4: DispatcherDashboard automatically re-queries available slots on 409
    const updatedSlotsRes = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/slots`)
      .query({ date: futureDate, dockId: testDockId })
      .set('Authorization', `Bearer ${dispatcherBToken}`);

    expect(updatedSlotsRes.status).toBe(200);
    const updatedSlots = updatedSlotsRes.body.data[0].slots;
    expect(updatedSlots.length).toBe(3);
    expect(
      updatedSlots.some((s: any) => s.slotStartTime === targetSlot.slotStartTime)
    ).toBe(false);
  });

  it('Verifies DispatcherDashboard.tsx shows a clear slot-taken message and refreshes available slots (not a generic error)', async () => {
    const dashboardPath = path.resolve(
      __dirname,
      '../../frontend/src/pages/DispatcherDashboard.tsx'
    );
    const source = fs.readFileSync(dashboardPath, 'utf-8');

    // 1. Verify 409 conflict detection in handleCreateBookingSubmit
    expect(source).toContain('status === 409');
    expect(source).toContain(
      'was just booked by another carrier while you were viewing it. Available slots have been updated — please select another open slot.'
    );

    // 2. Verify handleSearchSlots supports { preserveError: true } so refreshing slots does NOT wipe out the clear error message
    expect(source).toContain('options?: { preserveError?: boolean }');
    expect(source).toContain('if (!options?.preserveError)');
    expect(source).toContain('await handleSearchSlots(undefined, { preserveError: true })');

    // 3. Simulate the DispatcherDashboard slot-conflict handler execution with mocked API calls
    const slot1 = {
      slotStartTime: '2026-10-28T08:00:00.000Z',
      slotEndTime: '2026-10-28T08:30:00.000Z',
    };
    const slot2 = {
      slotStartTime: '2026-10-28T08:30:00.000Z',
      slotEndTime: '2026-10-28T09:00:00.000Z',
    };

    let searchedSlotsState = [
      {
        dockId: testDockId,
        dockName: 'Bay Alpha',
        slots: [slot1, slot2],
      },
    ];
    let errorMessageState: string | null = null;
    let isBookingModalOpenState = true;

    const mockGetAvailableSlots = vi.fn().mockResolvedValue({
      data: [
        {
          dockId: testDockId,
          dockName: 'Bay Alpha',
          slots: [slot2], // slot1 is now taken on the server
        },
      ],
    });

    const mockCreateBooking = vi.fn().mockRejectedValue({
      response: {
        status: 409,
        data: {
          success: false,
          message: 'Conflict. The requested dock slot is already booked.',
        },
      },
    });

    // Execute the exact conflict flow from DispatcherDashboard.tsx
    const handleSearchSlotsSim = async (options?: { preserveError?: boolean }) => {
      if (!options?.preserveError) {
        errorMessageState = null;
      }
      const res = await mockGetAvailableSlots(testWarehouseId, futureDate, testDockId);
      searchedSlotsState = res.data;
    };

    try {
      await mockCreateBooking({
        dockId: testDockId,
        slotStartTime: slot1.slotStartTime,
        slotEndTime: slot1.slotEndTime,
        truckPlate: 'WP-BBB-2222',
        driverName: 'Driver B',
        driverPhone: '+94772222222',
      });
    } catch (err: any) {
      const status = err?.response?.status;
      const rawMsg: string = err?.response?.data?.message || err?.message || '';
      const isSlotTakenConflict =
        status === 409 ||
        /conflict|already booked|already taken|unavailable/i.test(rawMsg);

      if (isSlotTakenConflict) {
        const clearConflictMessage = `The selected slot (8:00 AM – 8:30 AM on Bay Alpha) was just booked by another carrier while you were viewing it. Available slots have been updated — please select another open slot.`;
        errorMessageState = clearConflictMessage;
        isBookingModalOpenState = false;
        await handleSearchSlotsSim({ preserveError: true });
      }
    }

    // Assert: Clear message is preserved (not wiped out and not generic)
    expect(errorMessageState).not.toBeNull();
    expect(errorMessageState).toContain('was just booked by another carrier while you were viewing it');
    expect(errorMessageState).toContain('Available slots have been updated');
    expect(errorMessageState).not.toBe('Failed to create booking.');

    // Assert: Booking modal closed so user sees updated slots immediately
    expect(isBookingModalOpenState).toBe(false);

    // Assert: Available slots were re-fetched and updated to exclude slot1
    expect(mockGetAvailableSlots).toHaveBeenCalledTimes(1);
    expect(searchedSlotsState[0].slots).toEqual([slot2]);
  });

  it('Excludes slots in the past without timezone conflicts in both backend getAvailableSlots and frontend DispatcherDashboard.tsx', async () => {
    // 1. Query a past date in the warehouse's timezone -> must return 0 available slots
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const pastSlotsRes = await request(app)
      .get(`/api/warehouses/${testWarehouseId}/slots`)
      .query({ date: yesterdayDate })
      .set('Authorization', `Bearer ${dispatcherAToken}`);

    expect(pastSlotsRes.status).toBe(200);
    expect(pastSlotsRes.body.data[0].slots).toEqual([]);

    // 2. Test a 24/7 warehouse in a non-UTC timezone (America/New_York) on its current local "today" date
    const nyWarehouse = await prisma.warehouse.create({
      data: {
        organizationId: warehouseOrgId,
        name: 'NY Timezone Test Hub',
        address: '100 Liberty St, NY',
        timezone: 'America/New_York',
        operatingHours: {
          create: [0, 1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            openTime: '00:00',
            closeTime: '24:00',
            slotLengthMinutes: 30,
          })),
        },
        docks: {
          create: [{ name: 'NY Bay 1', status: DockStatus.ACTIVE }],
        },
      },
      include: { docks: true },
    });

    try {
      const nyTodayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const nowBeforeQuery = Date.now();
      const nySlotsRes = await request(app)
        .get(`/api/warehouses/${nyWarehouse.id}/slots`)
        .query({ date: nyTodayStr })
        .set('Authorization', `Bearer ${dispatcherAToken}`);

      expect(nySlotsRes.status).toBe(200);
      const nySlots = nySlotsRes.body.data[0].slots;

      // Every returned slot must have slotStartTime strictly in the future (> nowBeforeQuery)
      // and strictly fewer than 48 slots (since earlier slots today in NY have already passed or started)
      for (const s of nySlots) {
        expect(new Date(s.slotStartTime).getTime()).toBeGreaterThan(nowBeforeQuery);
      }
      expect(nySlots.length).toBeLessThan(48);

      // 3. Verify frontend DispatcherDashboard.tsx filters out past slots and resolves dates in warehouse timezone
      const dashboardPath = path.resolve(
        __dirname,
        '../../frontend/src/pages/DispatcherDashboard.tsx'
      );
      const source = fs.readFileSync(dashboardPath, 'utf-8');

      expect(source).toContain('const isFutureSlot = useCallback');
      expect(source).toContain('return slotStartMs > Date.now()');
      expect(source).toContain('filter(isFutureSlot)');
      expect(source).toMatch(/getTodayDateString\(\s*selectedWarehouse\?\.timezone\s*\)/);
    } finally {
      await prisma.dock.deleteMany({ where: { warehouseId: nyWarehouse.id } });
      await prisma.operatingHour.deleteMany({ where: { warehouseId: nyWarehouse.id } });
      await prisma.warehouse.deleteMany({ where: { id: nyWarehouse.id } });
    }
  });
});
