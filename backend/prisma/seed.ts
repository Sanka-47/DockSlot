import { PrismaClient, OrganizationType, UserRole, DockStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
  const apexOrg = await prisma.organization.create({
    data: {
      name: 'Apex Logistics Hubs',
      type: OrganizationType.WAREHOUSE_OPERATOR,
    },
  });

  const gmtOrg = await prisma.organization.create({
    data: {
      name: 'Global Maritime Terminals',
      type: OrganizationType.WAREHOUSE_OPERATOR,
    },
  });

  // Carriers
  const swiftOrg = await prisma.organization.create({
    data: {
      name: 'SwiftFreight Transport',
      type: OrganizationType.CARRIER,
    },
  });

  const falconOrg = await prisma.organization.create({
    data: {
      name: 'Falcon Express Haulage',
      type: OrganizationType.CARRIER,
    },
  });

  // 4. Create Pre-registered Users
  console.log('👥 Creating users...');
  // Apex Logistics Hubs Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: apexOrg.id,
        email: 'warehouse_admin@apex.com',
        passwordHash,
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: apexOrg.id,
        email: 'dock_manager@apex.com',
        passwordHash,
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // Global Maritime Terminals Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: gmtOrg.id,
        email: 'admin@gmtlogistics.com',
        passwordHash,
        role: UserRole.WAREHOUSE_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: gmtOrg.id,
        email: 'dock_manager@gmtlogistics.com',
        passwordHash,
        role: UserRole.DOCK_MANAGER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // SwiftFreight Transport Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: swiftOrg.id,
        email: 'carrier_admin@swiftfreight.com',
        passwordHash,
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: swiftOrg.id,
        email: 'dispatcher@swiftfreight.com',
        passwordHash,
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // Falcon Express Haulage Users
  await prisma.user.createMany({
    data: [
      {
        organizationId: falconOrg.id,
        email: 'carrier_admin@falconexpress.com',
        passwordHash,
        role: UserRole.CARRIER_ADMIN,
        isActive: true,
        isEmailVerified: true,
      },
      {
        organizationId: falconOrg.id,
        email: 'dispatcher@falconexpress.com',
        passwordHash,
        role: UserRole.DISPATCHER,
        isActive: true,
        isEmailVerified: true,
      },
    ],
  });

  // 5. Create Warehouses in different IANA time zones
  console.log('🏭 Creating warehouses with docks and operating hours...');

  // Warehouse 1: Colombo DC (Asia/Colombo) under Apex
  const colomboWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: apexOrg.id,
      name: 'Colombo DC',
      address: 'Port Access Road, Peliyagoda, Colombo 11010, Sri Lanka',
      timezone: 'Asia/Colombo',
      docks: {
        create: [
          { name: 'Dock C1 (Inbound General)', status: DockStatus.ACTIVE },
          { name: 'Dock C2 (Cold Storage)', status: DockStatus.ACTIVE },
          { name: 'Dock C3 (Outbound Express)', status: DockStatus.ACTIVE },
          { name: 'Dock C4 (Heavy Machinery Bay)', status: DockStatus.MAINTENANCE },
        ],
      },
      operatingHours: {
        create: [
          // Mon-Fri: 08:00 - 18:00, 30 min slots
          { dayOfWeek: 1, openTime: '08:00', closeTime: '18:00', slotLengthMinutes: 30 },
          { dayOfWeek: 2, openTime: '08:00', closeTime: '18:00', slotLengthMinutes: 30 },
          { dayOfWeek: 3, openTime: '08:00', closeTime: '18:00', slotLengthMinutes: 30 },
          { dayOfWeek: 4, openTime: '08:00', closeTime: '18:00', slotLengthMinutes: 30 },
          { dayOfWeek: 5, openTime: '08:00', closeTime: '18:00', slotLengthMinutes: 30 },
          // Sat: 08:00 - 13:00, 30 min slots
          { dayOfWeek: 6, openTime: '08:00', closeTime: '13:00', slotLengthMinutes: 30 },
        ],
      },
    },
  });

  // Warehouse 2: Jebel Ali Hub (Asia/Dubai) under Apex
  const jebelAliWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: apexOrg.id,
      name: 'Jebel Ali Hub',
      address: 'Gate 4, JAFZA North, Jebel Ali Freezone, Dubai, UAE',
      timezone: 'Asia/Dubai',
      docks: {
        create: [
          { name: 'Dock J1 (Fast Freight)', status: DockStatus.ACTIVE },
          { name: 'Dock J2 (Standard Cross-Dock)', status: DockStatus.ACTIVE },
          { name: 'Dock J3 (Dangerous Goods)', status: DockStatus.MAINTENANCE },
        ],
      },
      operatingHours: {
        create: [
          // Sun-Thu: 07:00 - 19:00, 45 min slots
          { dayOfWeek: 0, openTime: '07:00', closeTime: '19:00', slotLengthMinutes: 45 },
          { dayOfWeek: 1, openTime: '07:00', closeTime: '19:00', slotLengthMinutes: 45 },
          { dayOfWeek: 2, openTime: '07:00', closeTime: '19:00', slotLengthMinutes: 45 },
          { dayOfWeek: 3, openTime: '07:00', closeTime: '19:00', slotLengthMinutes: 45 },
          { dayOfWeek: 4, openTime: '07:00', closeTime: '19:00', slotLengthMinutes: 45 },
          // Sat: 08:00 - 14:00, 45 min slots
          { dayOfWeek: 6, openTime: '08:00', closeTime: '14:00', slotLengthMinutes: 45 },
        ],
      },
    },
  });

  // Warehouse 3: Rotterdam Port DC (Europe/Amsterdam) under GMT
  const rotterdamWarehouse = await prisma.warehouse.create({
    data: {
      organizationId: gmtOrg.id,
      name: 'Rotterdam Port DC',
      address: 'Maasvlakte 2, Europaweg 905, 3199 LC Rotterdam, Netherlands',
      timezone: 'Europe/Amsterdam',
      docks: {
        create: [
          { name: 'Dock R1 (Deep Sea Container Bay)', status: DockStatus.ACTIVE },
          { name: 'Dock R2 (Reefer Temperature-Controlled)', status: DockStatus.ACTIVE },
          { name: 'Dock R3 (Intermodal Rail/Truck)', status: DockStatus.ACTIVE },
          { name: 'Dock R4 (High-Speed Automated Bay)', status: DockStatus.MAINTENANCE },
        ],
      },
      operatingHours: {
        create: [
          // Mon-Fri: 06:00 - 22:00, 60 min slots
          { dayOfWeek: 1, openTime: '06:00', closeTime: '22:00', slotLengthMinutes: 60 },
          { dayOfWeek: 2, openTime: '06:00', closeTime: '22:00', slotLengthMinutes: 60 },
          { dayOfWeek: 3, openTime: '06:00', closeTime: '22:00', slotLengthMinutes: 60 },
          { dayOfWeek: 4, openTime: '06:00', closeTime: '22:00', slotLengthMinutes: 60 },
          { dayOfWeek: 5, openTime: '06:00', closeTime: '22:00', slotLengthMinutes: 60 },
          // Sat: 07:00 - 15:00, 60 min slots
          { dayOfWeek: 6, openTime: '07:00', closeTime: '15:00', slotLengthMinutes: 60 },
        ],
      },
    },
  });

  console.log('\n✅ Seeding complete!');
  console.log('----------------------------------------------------');
  console.log('Seeded Organizations:');
  console.log(` - ${apexOrg.name} (WAREHOUSE_OPERATOR)`);
  console.log(` - ${gmtOrg.name} (WAREHOUSE_OPERATOR)`);
  console.log(` - ${swiftOrg.name} (CARRIER)`);
  console.log(` - ${falconOrg.name} (CARRIER)`);
  console.log('\nSeeded Warehouses:');
  console.log(` - ${colomboWarehouse.name} (${colomboWarehouse.timezone})`);
  console.log(` - ${jebelAliWarehouse.name} (${jebelAliWarehouse.timezone})`);
  console.log(` - ${rotterdamWarehouse.name} (${rotterdamWarehouse.timezone})`);
  console.log('\nSeeded User Accounts (Default password for all: 12345678):');
  console.log(' [Warehouse Admins]');
  console.log('  - warehouse_admin@apex.com');
  console.log('  - admin@gmtlogistics.com');
  console.log(' [Dock Managers]');
  console.log('  - dock_manager@apex.com');
  console.log('  - dock_manager@gmtlogistics.com');
  console.log(' [Carrier Admins]');
  console.log('  - carrier_admin@swiftfreight.com');
  console.log('  - carrier_admin@falconexpress.com');
  console.log(' [Dispatchers]');
  console.log('  - dispatcher@swiftfreight.com');
  console.log('  - dispatcher@falconexpress.com');
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
