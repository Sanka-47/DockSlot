import http from 'http';
import app from '../index';
import { prisma } from '../config/db.config';

async function runWarehouseAndDockTests() {
  console.log('🧪 Starting Warehouse & Dock Management Integration Tests...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(5097, () => resolve()));
  const baseUrl = 'http://localhost:5097/api';

  try {
    // -------------------------------------------------------------
    // SETUP: Log in as Warehouse Admin (Apex), GMT Admin, and Carrier
    // -------------------------------------------------------------
    console.log('\n--- SETUP: Logging in test users ---');

    // Apex Warehouse Admin
    const apexLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'warehouse_admin@apex.com', password: '12345678' }),
    });
    const apexLogin = (await apexLoginRes.json()) as any;
    const apexToken = apexLogin.data.token;
    const apexOrgId = apexLogin.data.user.organizationId;
    console.log(`Apex Admin logged in. OrgId: ${apexOrgId}`);

    // GMT Warehouse Admin (Cross-tenant user)
    const gmtLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@gmtlogistics.com', password: '12345678' }),
    });
    const gmtLogin = (await gmtLoginRes.json()) as any;
    const gmtToken = gmtLogin.data.token;
    const gmtOrgId = gmtLogin.data.user.organizationId;
    console.log(`GMT Admin logged in. OrgId: ${gmtOrgId}`);

    // Carrier Admin (Unauthorized role for warehouse management)
    const carrierLoginRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'carrier_admin@swiftfreight.com', password: '12345678' }),
    });
    const carrierLogin = (await carrierLoginRes.json()) as any;
    const carrierToken = carrierLogin.data.token;
    console.log(`Carrier Admin logged in. Role: ${carrierLogin.data.user.role}`);

    // -------------------------------------------------------------
    // TEST 1: RBAC - Carrier Rejected from Warehouse Management
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: RBAC Enforcement for Warehouse Routes ---');
    const carrierCreateRes = await fetch(`${baseUrl}/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${carrierToken}`,
      },
      body: JSON.stringify({
        name: 'Carrier Illegal Warehouse',
        address: '123 Highway St',
        timezone: 'UTC',
      }),
    });
    const carrierCreateData = (await carrierCreateRes.json()) as any;
    console.log(`Carrier create warehouse status: ${carrierCreateRes.status}, message: "${carrierCreateData.message}"`);
    if (carrierCreateRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for carrier warehouse creation, got ${carrierCreateRes.status}`);
    }

    // -------------------------------------------------------------
    // TEST 2: Validation on Warehouse Creation
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Warehouse Creation Validation ---');

    // 2.1 Missing fields
    console.log('2.1 Testing missing fields validation...');
    const missingRes = await fetch(`${baseUrl}/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({ name: 'Incomplete Warehouse' }),
    });
    const missingData = (await missingRes.json()) as any;
    console.log(`Missing fields status: ${missingRes.status}, message: "${missingData.message}"`);
    if (missingRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for missing fields, got ${missingRes.status}`);
    }

    // 2.2 Invalid IANA timezone
    console.log('2.2 Testing invalid IANA timezone string...');
    const invalidTzRes = await fetch(`${baseUrl}/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({
        name: 'Bad Timezone Warehouse',
        address: '456 Dock Way',
        timezone: 'Mars/Curiosity_Rover',
      }),
    });
    const invalidTzData = (await invalidTzRes.json()) as any;
    console.log(`Invalid timezone status: ${invalidTzRes.status}, message: "${invalidTzData.message}"`);
    if (invalidTzRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for invalid timezone, got ${invalidTzRes.status}`);
    }

    // 2.3 Valid warehouse creation
    console.log('2.3 Creating warehouse with valid IANA timezone (America/New_York)...');
    const validCreateRes = await fetch(`${baseUrl}/warehouses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({
        name: 'Apex Newark Distribution Center',
        address: '789 Logistics Blvd, Newark, NJ 07102',
        timezone: 'America/New_York',
      }),
    });
    const validCreateData = (await validCreateRes.json()) as any;
    console.log(`Valid warehouse creation status: ${validCreateRes.status}`);
    if (validCreateRes.status !== 201 || !validCreateData.data?.id) {
      throw new Error(`Failed to create warehouse: ${JSON.stringify(validCreateData)}`);
    }
    const createdWarehouse = validCreateData.data;
    console.log(`Created warehouse ID: ${createdWarehouse.id}, Name: "${createdWarehouse.name}"`);

    // -------------------------------------------------------------
    // TEST 3: List Warehouses for Organization (GET /api/warehouses)
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: List Organization Warehouses ---');
    const listRes = await fetch(`${baseUrl}/warehouses`, {
      headers: { Authorization: `Bearer ${apexToken}` },
    });
    const listData = (await listRes.json()) as any;
    console.log(`List status: ${listRes.status}, Total warehouses found: ${listData.data?.length}`);
    if (listRes.status !== 200 || !Array.isArray(listData.data)) {
      throw new Error('Failed to list organization warehouses.');
    }
    const foundCreated = listData.data.some((w: any) => w.id === createdWarehouse.id);
    if (!foundCreated) {
      throw new Error('Created warehouse not found in organization list.');
    }

    // -------------------------------------------------------------
    // TEST 4: Single Warehouse & Tenant Isolation
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Get Warehouse & Cross-Tenant Isolation ---');
    // 4.1 Apex admin gets their own warehouse
    const getOwnRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}`, {
      headers: { Authorization: `Bearer ${apexToken}` },
    });
    if (getOwnRes.status !== 200) {
      throw new Error(`Apex admin failed to fetch own warehouse: ${getOwnRes.status}`);
    }

    // 4.2 GMT admin attempts to get Apex's warehouse (Cross-tenant)
    const getCrossRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}`, {
      headers: { Authorization: `Bearer ${gmtToken}` },
    });
    const getCrossData = (await getCrossRes.json()) as any;
    console.log(`Cross-tenant get warehouse status: ${getCrossRes.status}, message: "${getCrossData.message}"`);
    if (getCrossRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-tenant warehouse access, got ${getCrossRes.status}`);
    }

    // -------------------------------------------------------------
    // TEST 5: Dock Creation (POST /api/warehouses/:warehouseId/docks)
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Dock Creation & Tenant Isolation ---');

    // 5.1 Cross-tenant dock creation: GMT admin attempts to add dock to Apex warehouse
    console.log('5.1 Cross-tenant dock creation attempt...');
    const crossDockRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}/docks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmtToken}`,
      },
      body: JSON.stringify({ name: 'GMT Illegal Dock' }),
    });
    const crossDockData = (await crossDockRes.json()) as any;
    console.log(`Cross-tenant dock creation status: ${crossDockRes.status}, message: "${crossDockData.message}"`);
    if (crossDockRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-tenant dock creation, got ${crossDockRes.status}`);
    }

    // 5.2 Invalid dock payload (missing name)
    console.log('5.2 Testing missing dock name validation...');
    const badDockRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}/docks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({}),
    });
    if (badDockRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for missing dock name, got ${badDockRes.status}`);
    }

    // 5.3 Valid dock creation
    console.log('5.3 Creating physical dock for Apex warehouse...');
    const createDockRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}/docks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({
        name: 'Dock Bay 101 (Refrigerated)',
        status: 'ACTIVE',
      }),
    });
    const createDockData = (await createDockRes.json()) as any;
    console.log(`Dock creation status: ${createDockRes.status}, Dock ID: ${createDockData.data?.id}`);
    if (createDockRes.status !== 201 || !createDockData.data?.id) {
      throw new Error(`Failed to create dock: ${JSON.stringify(createDockData)}`);
    }
    const createdDock = createDockData.data;

    // -------------------------------------------------------------
    // TEST 6: List Docks (GET /api/warehouses/:warehouseId/docks)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: List Docks & Cross-Tenant Guard ---');

    // 6.1 Apex admin fetches docks
    const listDocksRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}/docks`, {
      headers: { Authorization: `Bearer ${apexToken}` },
    });
    const listDocksData = (await listDocksRes.json()) as any;
    console.log(`List docks status: ${listDocksRes.status}, Docks count: ${listDocksData.data?.length}`);
    if (listDocksRes.status !== 200 || !listDocksData.data?.some((d: any) => d.id === createdDock.id)) {
      throw new Error('Created dock not present in docks list.');
    }

    // 6.2 GMT admin tries to list Apex warehouse docks
    const crossListDocksRes = await fetch(`${baseUrl}/warehouses/${createdWarehouse.id}/docks`, {
      headers: { Authorization: `Bearer ${gmtToken}` },
    });
    console.log(`Cross-tenant list docks status: ${crossListDocksRes.status}`);
    if (crossListDocksRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-tenant dock list, got ${crossListDocksRes.status}`);
    }

    // -------------------------------------------------------------
    // TEST 7: Update Dock Status (PATCH /api/warehouses/docks/:dockId/status)
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Update Dock Status (Maintenance Toggle) ---');

    // 7.1 Cross-tenant update: GMT admin tries to change Apex dock status
    console.log('7.1 Cross-tenant dock status update attempt...');
    const crossUpdateRes = await fetch(`${baseUrl}/warehouses/docks/${createdDock.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gmtToken}`,
      },
      body: JSON.stringify({ status: 'MAINTENANCE' }),
    });
    const crossUpdateData = (await crossUpdateRes.json()) as any;
    console.log(`Cross-tenant dock status update: ${crossUpdateRes.status}, message: "${crossUpdateData.message}"`);
    if (crossUpdateRes.status !== 403) {
      throw new Error(`Expected HTTP 403 for cross-tenant dock update, got ${crossUpdateRes.status}`);
    }

    // 7.2 Invalid status value
    console.log('7.2 Testing invalid dock status value...');
    const badStatusRes = await fetch(`${baseUrl}/warehouses/docks/${createdDock.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({ status: 'DESTROYED' }),
    });
    if (badStatusRes.status !== 400) {
      throw new Error(`Expected HTTP 400 for invalid status, got ${badStatusRes.status}`);
    }

    // 7.3 Valid status update: Toggle to MAINTENANCE
    console.log('7.3 Updating dock status to MAINTENANCE...');
    const toMaintenanceRes = await fetch(`${baseUrl}/warehouses/docks/${createdDock.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({ status: 'MAINTENANCE' }),
    });
    const toMaintenanceData = (await toMaintenanceRes.json()) as any;
    console.log(`Status update result: ${toMaintenanceRes.status}, Dock status: ${toMaintenanceData.data?.status}`);
    if (toMaintenanceRes.status !== 200 || toMaintenanceData.data?.status !== 'MAINTENANCE') {
      throw new Error(`Failed to update dock status to MAINTENANCE: ${JSON.stringify(toMaintenanceData)}`);
    }

    // Verify database record
    const dbDock = await prisma.dock.findUnique({ where: { id: createdDock.id } });
    if (dbDock?.status !== 'MAINTENANCE') {
      throw new Error(`Database dock status expected to be MAINTENANCE, got: ${dbDock?.status}`);
    }
    console.log('Verified database reflects dock status = MAINTENANCE.');

    // 7.4 Toggle back to ACTIVE
    console.log('7.4 Updating dock status back to ACTIVE...');
    const toActiveRes = await fetch(`${baseUrl}/warehouses/docks/${createdDock.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apexToken}`,
      },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    const toActiveData = (await toActiveRes.json()) as any;
    console.log(`Status update result: ${toActiveRes.status}, Dock status: ${toActiveData.data?.status}`);
    if (toActiveRes.status !== 200 || toActiveData.data?.status !== 'ACTIVE') {
      throw new Error(`Failed to update dock status back to ACTIVE: ${JSON.stringify(toActiveData)}`);
    }

    console.log('\n🎉 ALL WAREHOUSE AND DOCK MANAGEMENT TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  }
}

runWarehouseAndDockTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
