/**
 * Warehouse and Dock Types derived from OpenAPI 3.0 Specification
 */

export type DockStatus = 'ACTIVE' | 'MAINTENANCE';

export interface Dock {
  id: number;
  warehouseId: number;
  name: string;
  status: DockStatus;
  effectiveStatus?: DockStatus;
  createdAt?: string;
  updatedAt?: string;
  warehouse?: {
    id: number;
    name: string;
    timezone?: string;
    address?: string;
  };
}

export interface OperatingHour {
  id: number;
  warehouseId: number;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  slotLengthMinutes: number;
}

export interface WarehousePolicy {
  id: number;
  warehouseId: number;
  maxConcurrentBookings: number;
  maxAdvanceDays: number;
  bookingLockWindowHours: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateWarehousePolicyRequest {
  maxConcurrentBookings?: number;
  maxAdvanceDays?: number;
  bookingLockWindowHours?: number;
}

export interface CreateWarehouseRequest {
  name: string;
  address: string;
  timezone: string;
  slotLengthMinutes?: number;
}

export interface UpdateWarehouseRequest {
  name?: string;
  address?: string;
  timezone?: string;
  slotLengthMinutes?: number;
}

export interface CreateDockRequest {
  name: string;
  status?: DockStatus;
}

export interface UpdateDockRequest {
  name?: string;
  status?: DockStatus;
}

export interface Warehouse {
  id: number;
  organizationId: number;
  name: string;
  address: string;
  timezone: string;
  slotLengthMinutes: number;
  createdAt?: string;
  updatedAt?: string;
  docks?: Dock[];
  operatingHours?: OperatingHour[];
  policy?: WarehousePolicy;
}

export interface DockClosure {
  id: number;
  dockId: number;
  startTime: string;
  endTime: string;
  reason?: string | null;
  createdAt?: string;
  dock?: Dock;
}

export interface CreateDockClosureRequest {
  startTime: string;
  endTime: string;
  reason: string;
}

export interface UpdateDockStatusRequest {
  status: DockStatus;
}

export interface AvailableSlot {
  slotStartTime: string;
  slotEndTime: string;
  localStartTime?: string;
  localEndTime?: string;
  isAvailable?: boolean;
  dockId?: number;
  dockName?: string;
}

export interface AvailableDockSlots {
  dockId: number;
  dockName: string;
  slots: AvailableSlot[];
}
