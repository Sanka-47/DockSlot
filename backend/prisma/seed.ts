import { PrismaClient, OrganizationType, UserRole, DockStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/**
 * Builds operating-hours rows for a set of weekdays.
 *
 * Day convention matches the slot engine (`src/utils/time.utils.ts` and
 * `warehouse.service.ts`): 1 = Monday ... 7 = Sunday.
 */
function operatingHoursFor(
  days: number[],
  openTime: string,
  closeTime: string,
  slotLengthMinutes: number
) {
  return days.map((dayOfWeek) => ({ dayOfWeek, openTime, closeTime, slotLengthMinutes }));
}

async function main() {
  console.log('🌱 Starting DockSlot database seed...');

  // 1. Clean up existing data in reverse relation order
  console.log('🧹 Cleaning existing data...');
  await prisma.outboxEvent.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.operatingHour.deleteMany();
  await prisma.dock.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // 2. Hash default password for all users ("12345678")
  const defaultPassword = '12345678';
  const passwordHash = await bcrypt.hash(defaultPassword, 10);

  // 3. Create Organizations
  console.log('🏢 Creating organizations...');
  // Warehouse Operators
  const lankaOrg = await prisma.organization.create({
    data: {
      name: 'Lanka Logistics Parks',
      type: OrganizationType.WAREHOUSE_OPERATOR,
    },
  });

  const maasOrg = await prisma.organization.create({
    data: {
      name: 'Maas Distribution',
      type: OrganizationType.WAREHOUSE_OPERATOR,
    },
  });

  // Carriers
  const ceylonOrg = await prisma.organization.create({
    data: {
      name: 'Ceylon Freight',
      type: OrganizationType.CARRIER,
    },
  });

  const gulfOrg = await prisma.organization.create({
    data: {
      name: 'Gulf Haulage',
      type: OrganizationType.CARRIER,
    },
  });

  // 4. Create Pre-registered Users
  console.log('👥 Creating users...');
  // Lanka Logistics Parks Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: lankaOrg.id,
        email: 'warehouse_admin@lankalogistics.com',
        passwordHash,
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: lankaOrg.id,
        email: 'dock_manager@lankalogistics.com',
        passwordHash,
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // Maas Distribution Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: maasOrg.id,
        email: 'warehouse_admin@maasdistribution.com',
        passwordHash,
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: maasOrg.id,
        email: 'dock_manager@maasdistribution.com',
        passwordHash,
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // Ceylon Freight Users (1 Carrier Admin, 2 Dispatchers)
  await prisma.user.createMany({
    data: [
      {
        organizationId: ceylonOrg.id,
        email: 'carrier_admin@ceylonfreight.com',
        passwordHash,
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: ceylonOrg.id,
        email: 'dispatcher1@ceylonfreight.com',
        passwordHash,
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: ceylonOrg.id,
        email: 'dispatcher2@ceylonfreight.com',
        passwordHash,
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // Gulf Haulage Users (1 Carrier Admin, 1 Dispatcher)
  await prisma.user.createMany({
    data: [
      {
        organizationId: gulfOrg.id,
        email: 'carrier_admin@gulfhaulage.com',
        passwordHash,
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: gulfOrg.id,
        email: 'dispatcher@gulfhaulage.com',
        passwordHash,
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // 5. Create Warehouses in different IANA time zones
  console.log('🏭 Creating warehouses with docks and operating hours...');

  // Warehouse 1: Colombo DC (Asia/Colombo) under Lanka Logistics Parks
  const colomboWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: lankaOrg.id,
      name: 'Colombo DC',
      address: 'Port Access Road, Peliyagoda, Colombo 11010, Sri Lanka',
      timezone: 'Asia/Colombo',
      slotLengthMinutes: 60,
      docks: {
        create: [
          { name: 'Dock C1 (Inbound General)', status: DockStatus.ACTIVE },
          { name: 'Dock C2 (Cold Storage)', status: DockStatus.ACTIVE },
          { name: 'Dock C3 (Outbound Express)', status: DockStatus.ACTIVE },
          { name: 'Dock C4 (Heavy Machinery Bay)', status: DockStatus.ACTIVE },
        ],
      },
      // Mon-Sat: 06:00 - 22:00, 60 min slots
      operatingHours: {
        create: operatingHoursFor([1, 2, 3, 4, 5, 6], '06:00', '22:00', 60),
      },
    },
  });

  // Warehouse 2: Jebel Ali Hub (Asia/Dubai) under Lanka Logistics Parks
  const jebelAliWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: lankaOrg.id,
      name: 'Jebel Ali Hub',
      address: 'Gate 4, JAFZA North, Jebel Ali Freezone, Dubai, UAE',
      timezone: 'Asia/Dubai',
      slotLengthMinutes: 30,
      docks: {
        create: [
          { name: 'Dock J1 (Fast Freight)', status: DockStatus.ACTIVE },
          { name: 'Dock J2 (Standard Cross-Dock)', status: DockStatus.ACTIVE },
          { name: 'Dock J3 (Dangerous Goods)', status: DockStatus.ACTIVE },
        ],
      },
      // Every day: 07:00 - 19:00, 30 min slots
      operatingHours: {
        create: operatingHoursFor([1, 2, 3, 4, 5, 6, 7], '07:00', '19:00', 30),
      },
    },
  });

  // Warehouse 3: Rotterdam Port DC (Europe/Amsterdam) under Maas Distribution
  const rotterdamWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: maasOrg.id,
      name: 'Rotterdam Port DC',
      address: 'Maasvlakte 2, Europaweg 905, 3199 LC Rotterdam, Netherlands',
      timezone: 'Europe/Amsterdam',
      slotLengthMinutes: 60,
      docks: {
        create: [
          { name: 'Dock R1 (Deep Sea Container Bay)', status: DockStatus.ACTIVE },
          { name: 'Dock R2 (Reefer Temperature-Controlled)', status: DockStatus.ACTIVE },
          { name: 'Dock R3 (Intermodal Rail/Truck)', status: DockStatus.ACTIVE },
          { name: 'Dock R4 (High-Speed Automated Bay)', status: DockStatus.ACTIVE },
          { name: 'Dock R5 (Bulk Cargo Bay)', status: DockStatus.ACTIVE },
          { name: 'Dock R6 (Oversized Project Cargo)', status: DockStatus.ACTIVE },
        ],
      },
      // 24/7: 00:00 - 24:00, 60 min slots
      operatingHours: {
        create: operatingHoursFor([1, 2, 3, 4, 5, 6, 7], '00:00', '24:00', 60),
      },
    },
  });

  console.log('\n✅ Seeding complete!');
  console.log('----------------------------------------------------');
  console.log('Seeded Organizations:');
  console.log(` - ${lankaOrg.name} (WAREHOUSE_OPERATOR)`);
  console.log(` - ${maasOrg.name} (WAREHOUSE_OPERATOR)`);
  console.log(` - ${ceylonOrg.name} (CARRIER)`);
  console.log(` - ${gulfOrg.name} (CARRIER)`);
  console.log('\nSeeded Warehouses:');
  console.log(` - ${colomboWarehouse.name} (${colomboWarehouse.timezone})`);
  console.log(` - ${jebelAliWarehouse.name} (${jebelAliWarehouse.timezone})`);
  console.log(` - ${rotterdamWarehouse.name} (${rotterdamWarehouse.timezone})`);
  console.log('\nSeeded User Accounts (Default password for all: 12345678):');
  console.log(' [Warehouse Admins]');
  console.log('  - warehouse_admin@lankalogistics.com');
  console.log('  - warehouse_admin@maasdistribution.com');
  console.log(' [Dock Managers]');
  console.log('  - dock_manager@lankalogistics.com');
  console.log('  - dock_manager@maasdistribution.com');
  console.log(' [Carrier Admins]');
  console.log('  - carrier_admin@ceylonfreight.com');
  console.log('  - carrier_admin@gulfhaulage.com');
  console.log(' [Dispatchers]');
  console.log('  - dispatcher1@ceylonfreight.com');
  console.log('  - dispatcher2@ceylonfreight.com');
  console.log('  - dispatcher@gulfhaulage.com');
  console.log('----------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Error during database seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
