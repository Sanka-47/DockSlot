import http from 'http';
import app from '../index';
import { prisma } from '../config/db.config';
import { BookingStatus } from '@prisma/client';

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

    // Fetch Colombo Warehouse record from DB
    const colomboWarehouse = await prisma.warehouse.findFirst({
      where: { name: 'Colombo DC' },
      include: { docks: true },
    });
    if (!colomboWarehouse) throw new Error('Colombo DC warehouse not found in DB!');

    const jebelAliWarehouse = await prisma.warehouse.findFirst({
      where: { name: 'Jebel Ali Hub' },
    });
    if (!jebelAliWarehouse) throw new Error('Jebel Ali Hub warehouse not found in DB!');

    const rotterdamWarehouse = await prisma.warehouse.findFirst({
      where: { name: 'Rotterdam Port DC' },
    });
    if (!rotterdamWarehouse) throw new Error('Rotterdam Port DC warehouse not found in DB!');

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
    // TEST 2: Operating Hours & Closed Days
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Operating Hours & Closed Days ---');

    // 2.1 Sunday check for Colombo DC (Mon-Sat open, Sunday closed)
    // 2026-10-18 is Sunday
    console.log('2.1 Checking slots on Sunday (Closed day: 2026-10-18)...');
    const sundayRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=2026-10-18`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const sundayData = (await sundayRes.json()) as any;
    console.log(`   Status: ${sundayRes.status}, Returned slots count: ${sundayData.data?.length}`);
    if (sundayRes.status !== 200 || !Array.isArray(sundayData.data) || sundayData.data.length !== 0) {
      throw new Error('Expected empty array for warehouse closed on Sunday.');
    }

    // 2.2 Weekday check for Colombo DC (Thursday: 2026-10-15)
    // Hours: 08:00 - 18:00 (10 hrs), 30 min slots -> 20 slots per dock
    // Docks: 3 active, 1 maintenance (Dock C4 is MAINTENANCE, must be ignored)
    console.log('2.2 Checking slots on Open Weekday (Thursday: 2026-10-15)...');
    const openDayRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=2026-10-15`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const openDayData = (await openDayRes.json()) as any;
    console.log(`   Status: ${openDayRes.status}, Active docks returned: ${openDayData.data?.length}`);

    if (openDayRes.status !== 200 || openDayData.data.length !== 3) {
      throw new Error(`Expected 3 active docks for Colombo DC, got ${openDayData.data?.length}`);
    }

    // Verify maintenance dock is not included
    const hasMaintenanceDock = openDayData.data.some((d: any) => d.dockName.includes('C4'));
    if (hasMaintenanceDock) {
      throw new Error('Maintenance dock C4 was incorrectly included in available slots!');
    }

    // Verify slot count per dock (20 slots)
    const dockC1Slots = openDayData.data[0].slots;
    console.log(`   Dock "${openDayData.data[0].dockName}" generated ${dockC1Slots.length} slots.`);
    if (dockC1Slots.length !== 20) {
      throw new Error(`Expected 20 slots between 08:00-18:00 with 30m intervals, got ${dockC1Slots.length}`);
    }

    // Verify first slot localization for Colombo (Asia/Colombo = UTC+5:30)
    // 08:00 Colombo time = 02:30 UTC
    const firstSlot = dockC1Slots[0];
    console.log('   First slot details:', firstSlot);
    if (
      firstSlot.localStartTime !== '08:00' ||
      firstSlot.localEndTime !== '08:30' ||
      !firstSlot.slotStartTime.includes('02:30:00') ||
      !firstSlot.slotEndTime.includes('03:00:00')
    ) {
      throw new Error('Slot localization did not match expected Asia/Colombo UTC offset (+05:30)!');
    }

    // -------------------------------------------------------------
    // TEST 3: Booking Filtering (Booked vs Available Slots)
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Booking Filtering ---');

    const dockC1 = colomboWarehouse.docks.find((d) => d.name.includes('C1'))!;
    const dockC2 = colomboWarehouse.docks.find((d) => d.name.includes('C2'))!;
    const dockC3 = colomboWarehouse.docks.find((d) => d.name.includes('C3'))!;

    // 3.1 Create a BOOKED slot on Dock C1 for 08:00-08:30 (UTC 02:30:00)
    console.log('3.1 Inserting BOOKED booking on Dock C1 at 08:00...');
    const booking1 = await prisma.booking.create({
      data: {
        dockId: dockC1.id,
        carrierOrgId,
        slotStartTime: new Date(firstSlot.slotStartTime),
        slotEndTime: new Date(firstSlot.slotEndTime),
        status: BookingStatus.BOOKED,
      },
    });

    // 3.2 Create an ARRIVED booking on Dock C2 for 09:00-09:30
    console.log('3.2 Inserting ARRIVED booking on Dock C2 at 09:00...');
    const slot0900Utc = new Date(dockC1Slots[2].slotStartTime); // index 2 is 09:00
    const slot0930Utc = new Date(dockC1Slots[2].slotEndTime);
    const booking2 = await prisma.booking.create({
      data: {
        dockId: dockC2.id,
        carrierOrgId,
        slotStartTime: slot0900Utc,
        slotEndTime: slot0930Utc,
        status: BookingStatus.ARRIVED,
      },
    });

    // 3.3 Create a CANCELLED booking on Dock C3 for 08:00-08:30 (should NOT block slot)
    console.log('3.3 Inserting CANCELLED booking on Dock C3 at 08:00...');
    const booking3 = await prisma.booking.create({
      data: {
        dockId: dockC3.id,
        carrierOrgId,
        slotStartTime: new Date(firstSlot.slotStartTime),
        slotEndTime: new Date(firstSlot.slotEndTime),
        status: BookingStatus.CANCELLED,
      },
    });

    // Query slots again
    const filteredRes = await fetch(`${baseUrl}/warehouses/${colomboWarehouse.id}/slots?date=2026-10-15`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const filteredData = (await filteredRes.json()) as any;

    const resDockC1 = filteredData.data.find((d: any) => d.dockId === dockC1.id);
    const resDockC2 = filteredData.data.find((d: any) => d.dockId === dockC2.id);
    const resDockC3 = filteredData.data.find((d: any) => d.dockId === dockC3.id);

    console.log(`   Dock C1 remaining slots: ${resDockC1.slots.length} (expected 19)`);
    console.log(`   Dock C2 remaining slots: ${resDockC2.slots.length} (expected 19)`);
    console.log(`   Dock C3 remaining slots: ${resDockC3.slots.length} (expected 20)`);

    // Verify 08:00 is absent from Dock C1
    const c1Has0800 = resDockC1.slots.some((s: any) => s.localStartTime === '08:00');
    if (c1Has0800 || resDockC1.slots.length !== 19) {
      throw new Error('Dock C1 08:00 slot was NOT properly filtered out by BOOKED status!');
    }

    // Verify 09:00 is absent from Dock C2
    const c2Has0900 = resDockC2.slots.some((s: any) => s.localStartTime === '09:00');
    if (c2Has0900 || resDockC2.slots.length !== 19) {
      throw new Error('Dock C2 09:00 slot was NOT properly filtered out by ARRIVED status!');
    }

    // Verify 08:00 IS STILL PRESENT on Dock C3 because status was CANCELLED
    const c3Has0800 = resDockC3.slots.some((s: any) => s.localStartTime === '08:00');
    if (!c3Has0800 || resDockC3.slots.length !== 20) {
      throw new Error('Dock C3 slot was incorrectly blocked by a CANCELLED booking!');
    }

    // -------------------------------------------------------------
    // TEST 4: Multi-Timezone Slot Generation (Dubai & Amsterdam)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Multi-Timezone Slot Localization ---');

    // 4.1 Jebel Ali Hub (Asia/Dubai = UTC+4), 45-min slots, Sun-Thu 07:00-19:00
    // Test on Sunday 2026-10-18 (Open in Dubai!)
    console.log('4.1 Testing Jebel Ali Hub (Asia/Dubai) on Sunday 2026-10-18...');
    const dubaiRes = await fetch(`${baseUrl}/warehouses/${jebelAliWarehouse.id}/slots?date=2026-10-18`, {
      headers: { Authorization: `Bearer ${whAdminToken}` },
    });
    const dubaiData = (await dubaiRes.json()) as any;
    console.log(`   Dubai active docks: ${dubaiData.data?.length}`);

    // Dock J3 is in MAINTENANCE, so 2 active docks
    if (dubaiData.data.length !== 2) {
      throw new Error(`Expected 2 active docks for Dubai, got ${dubaiData.data.length}`);
    }

    const dubaiSlots = dubaiData.data[0].slots;
    console.log(`   Dubai slots count: ${dubaiSlots.length}`);
    // 07:00 to 19:00 (12 hrs = 720 min) / 45 min = 16 slots
    if (dubaiSlots.length !== 16) {
      throw new Error(`Expected 16 slots of 45min for Dubai, got ${dubaiSlots.length}`);
    }

    // First slot: 07:00 Dubai time = 03:00 UTC (+04:00 offset)
    const dubaiFirst = dubaiSlots[0];
    console.log('   Dubai first slot:', dubaiFirst);
    if (
      dubaiFirst.localStartTime !== '07:00' ||
      dubaiFirst.localEndTime !== '07:45' ||
      !dubaiFirst.slotStartTime.includes('03:00:00')
    ) {
      throw new Error('Dubai timezone slot generation failed to calculate UTC+4 offset!');
    }

    // 4.2 Rotterdam Port DC (Europe/Amsterdam = UTC+2 in October), 60-min slots, Mon-Fri 06:00-22:00
    // Test on Monday 2026-10-19
    console.log('4.2 Testing Rotterdam Port DC (Europe/Amsterdam) on Monday 2026-10-19...');
    const amsRes = await fetch(`${baseUrl}/warehouses/${rotterdamWarehouse.id}/slots?date=2026-10-19`, {
      headers: { Authorization: `Bearer ${dispatcherToken}` },
    });
    const amsData = (await amsRes.json()) as any;
    console.log(`   Rotterdam active docks: ${amsData.data?.length}`);

    // Dock R4 is in MAINTENANCE, so 3 active docks
    if (amsData.data.length !== 3) {
      throw new Error(`Expected 3 active docks for Rotterdam, got ${amsData.data.length}`);
    }

    const amsSlots = amsData.data[0].slots;
    console.log(`   Rotterdam slots count: ${amsSlots.length}`);
    // 06:00 to 22:00 (16 hrs) / 60 min = 16 slots
    if (amsSlots.length !== 16) {
      throw new Error(`Expected 16 slots of 60min for Rotterdam, got ${amsSlots.length}`);
    }

    // First slot: 06:00 Amsterdam time = 04:00 UTC (CEST is UTC+2)
    const amsFirst = amsSlots[0];
    console.log('   Rotterdam first slot:', amsFirst);
    if (
      amsFirst.localStartTime !== '06:00' ||
      amsFirst.localEndTime !== '07:00' ||
      !amsFirst.slotStartTime.includes('04:00:00')
    ) {
      throw new Error('Amsterdam timezone slot generation failed to calculate CEST UTC+2 offset!');
    }

    // Cleanup test bookings
    await prisma.booking.deleteMany({
      where: { id: { in: [booking1.id, booking2.id, booking3.id] } },
    });

    console.log('\n🎉 ALL SLOT ENGINE & AVAILABILITY TESTS PASSED SUCCESSFULLY!');
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
