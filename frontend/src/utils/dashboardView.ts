import type { UserRole } from '../types/user.types';

export type RequestedDashboardView = 'auto' | 'carrier' | 'warehouse';
export type DashboardView = 'carrier' | 'dock-manager' | 'warehouse';

export const isCarrierRole = (role: UserRole): boolean =>
  role === 'CARRIER_ADMIN' || role === 'DISPATCHER';

export const isDispatcherRole = (role: UserRole): boolean => role === 'DISPATCHER';

export const isDockManagerRole = (role: UserRole): boolean => role === 'DOCK_MANAGER';

export const isWarehouseRole = (role: UserRole): boolean =>
  role === 'WAREHOUSE_ADMIN' || isDockManagerRole(role);

/** Only organization admins can manage team membership and access. */
export const canManageTeam = (role: UserRole): boolean =>
  role === 'CARRIER_ADMIN' || role === 'WAREHOUSE_ADMIN';

/**
 * Resolves the dashboard a signed-in user is allowed to see. A view chosen
 * before sign-in is only honored when the authenticated role has that
 * capability; it can never override the role.
 */
export function resolveDashboardView(
  role: UserRole,
  requestedView: RequestedDashboardView,
): DashboardView {
  if (requestedView === 'carrier' && isCarrierRole(role)) return 'carrier';
  if (requestedView === 'warehouse' && isWarehouseRole(role)) {
    return isDockManagerRole(role) ? 'dock-manager' : 'warehouse';
  }

  if (isCarrierRole(role)) return 'carrier';
  if (isDockManagerRole(role)) return 'dock-manager';
  return 'warehouse';
}
