import { DockStatus } from '@prisma/client';
import { prisma } from '../config/db.config';

export interface CreateWarehouseInput {
  name: string;
  address: string;
  timezone: string;
}

export interface UpdateWarehouseInput {
  name?: string;
  address?: string;
  timezone?: string;
}

export interface CreateDockInput {
  name: string;
  status?: DockStatus;
}

/**
 * Validates whether a given string is a valid IANA time zone.
 * Uses Intl.DateTimeFormat which throws a RangeError for invalid time zone identifiers.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

export class WarehouseService {
  /**
   * Creates a new warehouse for the specified organization.
   * Validates that the provided timezone is a valid IANA time zone string.
   */
  async createWarehouse(organizationId: number, data: CreateWarehouseInput) {
    if (!organizationId) {
      throw { status: 400, message: 'Organization ID is required.' };
    }

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw { status: 400, message: 'Warehouse name is required.' };
    }

    if (!data.address || typeof data.address !== 'string' || !data.address.trim()) {
      throw { status: 400, message: 'Warehouse address is required.' };
    }

    if (!data.timezone || typeof data.timezone !== 'string' || !data.timezone.trim()) {
      throw { status: 400, message: 'Timezone is required.' };
    }

    const trimmedTimezone = data.timezone.trim();
    if (!isValidIanaTimeZone(trimmedTimezone)) {
      throw { status: 400, message: `Invalid IANA timezone string: '${trimmedTimezone}'.` };
    }

    // Verify organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw { status: 404, message: 'Organization not found.' };
    }

    const warehouse = await prisma.warehouse.create({
      data: {
        organizationId,
        name: data.name.trim(),
        address: data.address.trim(),
        timezone: trimmedTimezone,
      },
      include: {
        docks: true,
      },
    });

    return warehouse;
  }

  /**
   * Retrieves all warehouses belonging to the specified organization.
   */
  async getWarehouses(organizationId: number) {
    if (!organizationId) {
      throw { status: 400, message: 'Organization ID is required.' };
    }

    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId },
      include: {
        docks: true,
        operatingHours: true,
      },
      orderBy: { id: 'asc' },
    });

    return warehouses;
  }

  /**
   * Retrieves a specific warehouse by ID, enforcing strict tenant isolation.
   */
  async getWarehouseById(warehouseId: number, organizationId: number) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        docks: true,
        operatingHours: true,
      },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have access to this warehouse.' };
    }

    return warehouse;
  }

  /**
   * Updates an existing warehouse with tenant isolation check.
   */
  async updateWarehouse(warehouseId: number, organizationId: number, data: UpdateWarehouseInput) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const existing = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!existing) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (existing.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to update this warehouse.' };
    }

    if (data.timezone) {
      const trimmedTz = data.timezone.trim();
      if (!isValidIanaTimeZone(trimmedTz)) {
        throw { status: 400, message: `Invalid IANA timezone string: '${trimmedTz}'.` };
      }
    }

    const updated = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: {
        ...(data.name && { name: data.name.trim() }),
        ...(data.address && { address: data.address.trim() }),
        ...(data.timezone && { timezone: data.timezone.trim() }),
      },
      include: {
        docks: true,
      },
    });

    return updated;
  }

  /**
   * Creates a dock for a warehouse, strictly verifying warehouse ownership.
   */
  async createDock(warehouseId: number, organizationId: number, data: CreateDockInput) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw { status: 400, message: 'Dock name is required.' };
    }

    if (data.status && !Object.values(DockStatus).includes(data.status)) {
      throw { status: 400, message: `Invalid dock status: '${data.status}'. Must be ACTIVE or MAINTENANCE.` };
    }

    // Verify warehouse exists and belongs to the caller's organization
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to manage this warehouse.' };
    }

    const dock = await prisma.dock.create({
      data: {
        warehouseId,
        name: data.name.trim(),
        status: data.status || DockStatus.ACTIVE,
      },
    });

    return dock;
  }

  /**
   * Lists docks for a warehouse, enforcing strict tenant isolation.
   */
  async getDocks(warehouseId: number, organizationId: number) {
    if (!warehouseId || isNaN(warehouseId)) {
      throw { status: 400, message: 'Invalid warehouse ID.' };
    }

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
    });

    if (!warehouse) {
      throw { status: 404, message: 'Warehouse not found.' };
    }

    if (warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have access to docks for this warehouse.' };
    }

    const docks = await prisma.dock.findMany({
      where: { warehouseId },
      orderBy: { id: 'asc' },
    });

    return docks;
  }

  /**
   * Updates dock status (e.g. toggling between ACTIVE and MAINTENANCE),
   * enforcing strict tenant isolation through the parent warehouse.
   */
  async updateDockStatus(dockId: number, organizationId: number, status: DockStatus) {
    if (!dockId || isNaN(dockId)) {
      throw { status: 400, message: 'Invalid dock ID.' };
    }

    if (!status || !Object.values(DockStatus).includes(status)) {
      throw { status: 400, message: `Invalid dock status: '${status}'. Must be ACTIVE or MAINTENANCE.` };
    }

    const dock = await prisma.dock.findUnique({
      where: { id: dockId },
      include: { warehouse: true },
    });

    if (!dock) {
      throw { status: 404, message: 'Dock not found.' };
    }

    if (dock.warehouse.organizationId !== organizationId) {
      throw { status: 403, message: 'Forbidden. You do not have permission to modify this dock.' };
    }

    const updatedDock = await prisma.dock.update({
      where: { id: dockId },
      data: { status },
    });

    return updatedDock;
  }
}

export const warehouseService = new WarehouseService();
