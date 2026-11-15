import { describe, expect, it } from 'vitest';
import { resolveDashboardView } from './dashboardView';

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
