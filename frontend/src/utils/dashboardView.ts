import type { UserRole } from '../types/user.types';

export type RequestedDashboardView = 'auto' | 'carrier' | 'warehouse';
export type DashboardView = 'carrier' | 'dock-manager' | 'warehouse';

/**
 * Resolves the dashboard a signed-in user is allowed to see. A view chosen
 * before sign-in is only honored when the authenticated role has that
 * capability; it can never override the role.
 */
export function resolveDashboardView(
  role: UserRole,
  requestedView: RequestedDashboardView,
): DashboardView {
  const isCarrierRole = role === 'CARRIER_ADMIN' || role === 'DISPATCHER';
  const isDockManagerRole = role === 'DOCK_MANAGER';
  const isWarehouseRole = role === 'WAREHOUSE_ADMIN' || isDockManagerRole;

  if (requestedView === 'carrier' && isCarrierRole) return 'carrier';
  if (requestedView === 'warehouse' && isWarehouseRole) {
    return isDockManagerRole ? 'dock-manager' : 'warehouse';
  }

  if (isCarrierRole) return 'carrier';
  if (isDockManagerRole) return 'dock-manager';
  return 'warehouse';
}
