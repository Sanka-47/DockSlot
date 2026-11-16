import { describe, expect, it } from 'vitest';
import {
  canManageTeam,
  isCarrierRole,
  isDispatcherRole,
  isDockManagerRole,
  isWarehouseRole,
  resolveDashboardView,
} from './dashboardView';

describe('resolveDashboardView', () => {
  it('uses the role when no view was requested', () => {
    expect(resolveDashboardView('CARRIER_ADMIN', 'auto')).toBe('carrier');
    expect(resolveDashboardView('DISPATCHER', 'auto')).toBe('carrier');
    expect(resolveDashboardView('WAREHOUSE_ADMIN', 'auto')).toBe('warehouse');
    expect(resolveDashboardView('DOCK_MANAGER', 'auto')).toBe('dock-manager');
  });

  it('honors a requested view only when the role supports it', () => {
    expect(resolveDashboardView('CARRIER_ADMIN', 'warehouse')).toBe('carrier');
    expect(resolveDashboardView('WAREHOUSE_ADMIN', 'carrier')).toBe('warehouse');
    expect(resolveDashboardView('DOCK_MANAGER', 'carrier')).toBe('dock-manager');
    expect(resolveDashboardView('DOCK_MANAGER', 'warehouse')).toBe('dock-manager');
  });

  it('allows supported explicit navigation', () => {
    expect(resolveDashboardView('CARRIER_ADMIN', 'carrier')).toBe('carrier');
    expect(resolveDashboardView('WAREHOUSE_ADMIN', 'warehouse')).toBe('warehouse');
  });
});

describe('role helpers', () => {
  it('classifies carrier and warehouse roles consistently', () => {
    expect(isCarrierRole('CARRIER_ADMIN')).toBe(true);
    expect(isCarrierRole('DISPATCHER')).toBe(true);
    expect(isCarrierRole('WAREHOUSE_ADMIN')).toBe(false);
    expect(isDispatcherRole('DISPATCHER')).toBe(true);
    expect(isDockManagerRole('DOCK_MANAGER')).toBe(true);
    expect(isWarehouseRole('WAREHOUSE_ADMIN')).toBe(true);
    expect(isWarehouseRole('DOCK_MANAGER')).toBe(true);
    expect(isWarehouseRole('CARRIER_ADMIN')).toBe(false);
  });

  it('only exposes team management to organization admins', () => {
    expect(canManageTeam('CARRIER_ADMIN')).toBe(true);
    expect(canManageTeam('WAREHOUSE_ADMIN')).toBe(true);
    expect(canManageTeam('DISPATCHER')).toBe(false);
    expect(canManageTeam('DOCK_MANAGER')).toBe(false);
  });
});
