import http from 'http';
import app from '../index';
import { prisma } from '../config/db.config';
import { BookingStatus } from '@prisma/client';
import { mapJsDayToIsoDay, getDayOfWeekInTimeZone } from '../utils/time.utils';

async function runSlotEngineTests() {
  console.log('🧪 Starting Slot Generation & Availability Engine Integration Tests...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5096, () => resolve()));
  const baseUrl = 'http://localhost:5096/api';

  try {
    // -------------------------------------------------------------
    // SETUP: Log in users with different roles
    // -------------------------------------------------------------
    console.log('\n--- SETUP: Logging in test users ---');

    // Warehouse Admin
    const whAdminLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'warehouse_admin@apex.com', password: '12345678' }),
    });
    const whAdminData = (await whAdminLoginRes.json()) as any;
    const whAdminToken = whAdminData.data.token;

    // Carrier Dispatcher
    const dispatcherLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dispatcher@swiftfreight.com', password: '12345678' }),
    });
    const dispatcherData = (await dispatcherLoginRes.json()) as any;
    const dispatcherToken = dispatcherData.data.token;
    const carrierOrgId = dispatcherData.data.user.organizationId;
    console.log(`Users authenticated: Warehouse Admin & Carrier Dispatcher (Org: ${carrierOrgId})`);

    // Fetch Warehouses
    const colomboWarehouse = await prisma.warehouse.findFirst({
      where: { name: 'Colombo DC' },
      include: { docks: true },
    });
    if (!colomboWarehouse) throw new Error('Colombo DC warehouse not found in DB!');

    const rotterdamWarehouse = await prisma.warehouse.findFirst({
      where: { name: 'Rotterdam Port DC' },
      include: { docks: true },
    });
    if (!rotterdamWarehouse) throw new Error('Rotterdam Port DC warehouse not found in DB!');

    // Set up Rotterdam Port DC as a 24/7 facility in DB:
    // Mon-Sun (days 1-7), openTime: "00:00", closeTime: "24:00", slotLengthMinutes: 60
    await prisma.operatingHour.deleteMany({
      where: { warehouseId: rotterdamWarehouse.id },
    });
    await prisma.operatingHour.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
        warehouseId: rotterdamWarehouse.id,
        dayOfWeek,
        openTime: '00:00',
        closeTime: '24:00',
        slotLengthMinutes: 60,
      })),
    });
    console.log('Rotterdam Port DC configured as 24/7 facility (days 1-7, 00:00-24:00, 60m slots).');

    // -------------------------------------------------------------
    // TEST 1: Request Validation & Auth Guards
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Request Validation & Auth Guards ---');

    // 1.1 Unauthenticated request
    console.log('1.1 Testing unauthenticated request rejection...');
    const unauthRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=2026-10-15`);
    if (unauthRes.status !== 401) {
      throw new Error(`Expected HTTP 401 for unauthenticated request, got ${unauthRes.status}`);
    }

    // 1.2 Missing date parameter
    console.log('1.2 Testing missing date parameter...');
    const missingDateRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const missingDateData = (await missingDateRes.json()) as any;
    console.log(`   Status: ${missingDateRes.status}, Message: "${missingDateData.message}"`);
    if (missingDateRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for missing date, got ${missingDateRes.status}`);
    }

    // 1.3 Invalid date format
    console.log('1.3 Testing invalid date format...');
    const badDateRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=invalid-date`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    if (badDateRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for invalid date string, got ${badDateRes.status}`);
    }

    // 1.4 Non-existent warehouse
    console.log('1.4 Testing non-existent warehouse...');
    const noWhRes = await fetch(`${baseUrl}/warehouses/999999/slots?date=2026-10-15`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    if (noWhRes.status !== 404) {
      throw new Error(`Expected HTTP 404 for non-existent warehouse, got ${noWhRes.status}`);
    }

    // -------------------------------------------------------------
    // TEST 2: Day-of-Week Mapping Reconciliation (1 = Mon ... 7 = Sun)
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Day-of-Week Mapping Reconciliation ---');

    // 2.1 Unit tests for mapJsDayToIsoDay
    if (mapJsDayToIsoDay(0) !== 7) throw new Error('mapJsDayToIsoDay(0) should be 7 for Sunday');
    if (mapJsDayToIsoDay(1) !== 1) throw new Error('mapJsDayToIsoDay(1) should be 1 for Monday');
    if (mapJsDayToIsoDay(6) !== 6) throw new Error('mapJsDayToIsoDay(6) should be 6 for Saturday');
    console.log('   mapJsDayToIsoDay unit tests passed (Sunday=7, Monday=1, Saturday=6).');

    // 2.2 Date-based day of week
    // 2026-10-18 is Sunday (day 7)
    // 2026-10-19 is Monday (day 1)
    // 2026-10-17 is Saturday (day 6)
    const sundayDay = getDayOfWeekInTimeZone('2026-10-18', 'Asia/Colombo');
    const mondayDay = getDayOfWeekInTimeZone('2026-10-19', 'Asia/Colombo');
    const saturdayDay = getDayOfWeekInTimeZone('2026-10-17', 'Asia/Colombo');

    console.log(`   2026-10-18 (Sun) -> day ${sundayDay} (expected 7)`);
    console.log(`   2026-10-19 (Mon) -> day ${mondayDay} (expected 1)`);
    console.log(`   2026-10-17 (Sat) -> day ${saturdayDay} (expected 6)`);

    if (sundayDay !== 7 || mondayDay !== 1 || saturdayDay !== 6) {
      throw new Error('Day-of-week conversion failed ISO standard 1-7 mapping!');
    }

    // 2.3 Closed day check: Colombo DC is closed on Sunday (no day 7 operating hours)
    console.log('2.3 Checking slots on Sunday for Colombo DC (Closed day)...');
    const sundayRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=2026-10-18`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const sundayData = (await sundayRes.json()) as any;
    console.log(`   Status: ${sundayRes.status}, Returned slots count: ${sundayData.data?.length}`);
    if (sundayRes.status !== 200 || !Array.isArray(sundayData.data) || sundayData.data.length !== 0) {
      throw new Error('Expected empty array for warehouse closed on Sunday.');
    }

    // -------------------------------------------------------------
    // TEST 3: 24/7 Warehouse Operating Hours & Full Midnight Cycle
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: 24/7 Warehouse Operating Hours (Rotterdam Port DC) ---');

    // 3.1 Query slots for Rotterdam Port DC on Monday 2026-10-19 (24/7, 60m slots)
    console.log('3.1 Querying 24/7 slots for Rotterdam Port DC on 2026-10-19...');
    const rotterdamRes = await fetch(`${baseUrl}/warehouses/${rotterdamWarehouse.id}/slots?date=2026-10-19`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const rotterdamData = (await rotterdamRes.json()) as any;
    console.log(`   Status: ${rotterdamRes.status}, Active docks: ${rotterdamData.data?.length}`);

    // Docks R1, R2, R3 active (R4 in MAINTENANCE)
    if (rotterdamData.data.length !== 3) {
      throw new Error(`Expected 3 active docks for Rotterdam Port DC, got ${rotterdamData.data?.length}`);
    }

    const dockR1Slots = rotterdamData.data[0].slots;
    console.log(`   Dock "${rotterdamData.data[0].dockName}" generated ${dockR1Slots.length} slots for the 24-hr cycle.`);

    // 24 hours / 60 min = exactly 24 slots
    if (dockR1Slots.length !== 24) {
      throw new Error(`Expected 24 slots for 24/7 warehouse with 60m slot length, got ${dockR1Slots.length}`);
    }

    // First slot: 00:00 to 01:00
    const r1First = dockR1Slots[0];
    console.log('   First slot:', r1First);
    if (r1First.localStartTime !== '00:00' || r1First.localEndTime !== '01:00') {
      throw new Error(`Expected first slot 00:00 - 01:00, got ${r1First.localStartTime} - ${r1First.localEndTime}`);
    }

    // Last slot: 23:00 to 24:00
    const r1Last = dockR1Slots[23];
    console.log('   Last slot (midnight span):', r1Last);
    if (r1Last.localStartTime !== '23:00' || r1Last.localEndTime !== '24:00') {
      throw new Error(`Expected last slot 23:00 - 24:00, got ${r1Last.localStartTime} - ${r1Last.localEndTime}`);
    }

    // Verify UTC end time of last slot is strictly after start time (+1 hr)
    const lastStartMs = new Date(r1Last.slotStartTime).getTime();
    const lastEndMs = new Date(r1Last.slotEndTime).getTime();
    if (lastEndMs <= lastStartMs || (lastEndMs - lastStartMs) !== 3600000) {
      throw new Error(`Last slot interval is invalid! End time (${r1Last.slotEndTime}) must be 1hr after start time (${r1Last.slotStartTime})`);
    }
    console.log('   Verified last slot correctly spans until midnight of the following day without early truncation.');

    // 3.2 Verify Sunday (day 7) for 24/7 facility also returns full-day availability (24 slots)
    console.log('3.2 Querying Sunday (2026-10-18, day 7) on 24/7 facility...');
    const rotterdamSundayRes = await fetch(`${baseUrl}/warehouses/${rotterdamWarehouse.id}/slots?date=2026-10-18`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const rotterdamSundayData = (await rotterdamSundayRes.json()) as any;
    if (rotterdamSundayData.data[0].slots.length !== 24) {
      throw new Error(`Expected 24 slots on Sunday for 24/7 warehouse, got ${rotterdamSundayData.data[0].slots.length}`);
    }
    console.log('   Sunday full-day availability verified for 24/7 warehouse.');

    // -------------------------------------------------------------
    // TEST 4: 30-Minute Slot Length for 24/7 Facility (48 slots)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: 30-Minute Slot Length for 24/7 Hub ---');
    // Temporarily update Monday to 30-min slots
    await prisma.operatingHour.updateMany({
      where: { warehouseId: rotterdamWarehouse.id, dayOfWeek: 1 },
      data: { slotLengthMinutes: 30 },
    });

    const rotterdam30Res = await fetch(`${baseUrl}/warehouses/${rotterdamWarehouse.id}/slots?date=2026-10-19`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const rotterdam30Data = (await rotterdam30Res.json()) as any;
    const slots30Count = rotterdam30Data.data[0].slots.length;
    console.log(`   30-minute slot count for 24/7 day: ${slots30Count} (expected 48)`);

    if (slots30Count !== 48) {
      throw new Error(`Expected 48 slots for 24/7 warehouse with 30m slots, got ${slots30Count}`);
    }
    const last30Slot = rotterdam30Data.data[0].slots[47];
    if (last30Slot.localStartTime !== '23:30' || last30Slot.localEndTime !== '24:00') {
      throw new Error(`Expected last 30m slot 23:30 - 24:00, got ${last30Slot.localStartTime} - ${last30Slot.localEndTime}`);
    }

    // Revert Monday back to 60-min slots
    await prisma.operatingHour.updateMany({
      where: { warehouseId: rotterdamWarehouse.id, dayOfWeek: 1 },
      data: { slotLengthMinutes: 60 },
    });

    // -------------------------------------------------------------
    // TEST 5: Booking Filtering on 24/7 Facility (Midnight Span Slot)
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Booking Filtering on Midnight Span Slot ---');

    const dockR1 = rotterdamWarehouse.docks.find((d) => d.name.includes('R1'))!;

    // Book the 23:00 - 24:00 slot on Dock R1
    console.log('5.1 Booking 23:00 - 24:00 slot on Dock R1...');
    const bookingMidnight = await prisma.booking.create({
      data: {
        dockId: dockR1.id,
        carrierOrgId,
        slotStartTime: new Date(r1Last.slotStartTime),
        slotEndTime: new Date(r1Last.slotEndTime),
        status: BookingStatus.BOOKED,
      },
    });

    const filteredRotterdamRes = await fetch(`${baseUrl}/warehouses/${rotterdamWarehouse.id}/slots?date=2026-10-19`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const filteredRotterdamData = (await filteredRotterdamRes.json()) as any;
    const r1FilteredSlots = filteredRotterdamData.data.find((d: any) => d.dockId === dockR1.id).slots;

    console.log(`   Dock R1 remaining slots: ${r1FilteredSlots.length} (expected 23)`);
    if (r1FilteredSlots.length !== 23) {
      throw new Error(`Expected 23 slots after booking midnight slot, got ${r1FilteredSlots.length}`);
    }

    const hasMidnightSlot = r1FilteredSlots.some((s: any) => s.localStartTime === '23:00');
    if (hasMidnightSlot) {
      throw new Error('23:00 - 24:00 slot was NOT filtered out by BOOKED booking!');
    }

    // Cleanup test booking
    await prisma.booking.delete({ where: { id: bookingMidnight.id } });

    console.log('\n🎉 ALL 24/7 AND DAY-OF-WEEK RECONCILIATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runSlotEngineTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
