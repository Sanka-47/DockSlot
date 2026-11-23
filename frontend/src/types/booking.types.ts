/**
 * Booking Types derived from OpenAPI 3.0 Specification
 */

export type BookingStatus =
  'PENDING_PAYMENT' | 'BOOKED' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export type PaymentStatus =
  'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

import type { WarehousePolicy } from './warehouse.types';

export interface PaymentSummary {
  id: number;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  checkoutUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface CheckoutSession {
  url: string;
  sessionId: string;
  expiresAt: string;
}

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
  paymentExpiresAt?: string | null;
  payment?: PaymentSummary | null;
  checkout?: CheckoutSession;
  createdAt: string;
  updatedAt?: string;
  dock: BookingDock;
  carrierOrg: BookingCarrierOrg;
}

export interface CreateBookingResponse extends Booking {
  checkout?: CheckoutSession;
}

export interface PaymentStatusResponse {
  bookingId: number;
  bookingStatus: BookingStatus;
  paymentExpiresAt: string | null;
  payment: PaymentSummary | null;
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
