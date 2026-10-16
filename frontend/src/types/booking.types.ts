/**
 * Booking Types derived from OpenAPI 3.0 Specification
 */

export type BookingStatus =
  | 'BOOKED'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

import type { WarehousePolicy } from './warehouse.types';

export interface BookingDockWarehouse {
  id: number;
  name: string;
  address?: string;
  timezone?: string;
  policy?: WarehousePolicy;
}

export interface BookingDock {
  id: number;
  warehouseId: number;
  name: string;
  status: 'ACTIVE' | 'MAINTENANCE';
  warehouse?: BookingDockWarehouse;
}

export interface BookingCarrierOrg {
  id: number;
  name: string;
  type: string;
}

export interface Booking {
  id: number;
  dockId: number;
  carrierOrgId: number;
  slotStartTime: string;
  slotEndTime: string;
  truckPlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  cargoNote: string | null;
  status: BookingStatus;
  createdAt: string;
  updatedAt?: string;
  dock: BookingDock;
  carrierOrg: BookingCarrierOrg;
}

export interface UpdateBookingStatusRequest {
  status: 'ARRIVED' | 'NO_SHOW' | 'COMPLETED';
}

export interface CreateBookingRequest {
  dockId: number;
  slotStartTime: string;
  slotEndTime: string;
  truckPlate: string;
  driverName: string;
  driverPhone: string;
  cargoNote?: string;
}

export interface AuditLogActor {
  userId: number;
  name: string;
  role: string;
  email?: string;
  organizationId?: number;
  organizationName?: string;
}

export interface BookingAuditLog {
  id: number;
  bookingId: number;
  action: 'CREATED' | 'UPDATED' | 'RESCHEDULED' | 'CANCELLED' | 'STATUS_CHANGED' | string;
  actionType?: 'CREATED' | 'MODIFIED' | 'CANCELLED' | string;
  summary?: string;
  details?: Record<string, any> | null;
  createdAt: string;
  userId: number;
  actor?: AuditLogActor;
  user?: {
    id: number;
    email: string;
    role: string;
    name?: string;
    organizationId?: number;
    organization?: {
      id: number;
      name: string;
      type: string;
    };
  };
}
