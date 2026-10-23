import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Truck,
  Users,
  UserPlus,
  UserX,
  UserCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  Building2,
  Search,
} from 'lucide-react';
import { carrierAdminDashboardService } from '../services/carrierAdminDashboard.service';
import type {
  UserRoleFilter,
  UserStatusFilter,
} from '../services/carrierAdminDashboard.service';
import { getApiErrorMessage } from '../services/errors';
import { useAuth } from '../hooks/useAuth';
import { useConfirm } from '../hooks/useConfirm';
import type { User } from '../types/user.types';
import toast from 'react-hot-toast';

export const CarrierAdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Active Tab: 'users' | 'profile'
  const [activeTab, setActiveTab] = useState<'users' | 'profile'>('users');

  // User Management State
  const [organizationUsers, setOrganizationUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false);
  const [deactivatingUserId, setDeactivatingUserId] = useState<number | null>(null);
  const [reactivatingUserId, setReactivatingUserId] = useState<number | null>(null);

  // Invite Modal State
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [isSendingInvite, setIsSendingInvite] = useState<boolean>(false);

  // Filter & Search State
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('ALL');
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>('ALL');

  // Notifications / Banners
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const triggerSuccess = (msg: string) => {
    setSuccessBanner(msg);
    setTimeout(() => {
      setSuccessBanner(null);
    }, 4500);
  };

  // Fetch Users belonging to the carrier organization
  const fetchUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    setErrorBanner(null);
    try {
      setOrganizationUsers(await carrierAdminDashboardService.fetchUsers());
    } catch (err: unknown) {
      setErrorBanner(
        getApiErrorMessage(err, 'Failed to load organization team members.')
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Invite Dispatcher / Staff Handler
  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsSendingInvite(true);
    setErrorBanner(null);
    try {
      const result = await carrierAdminDashboardService.inviteUser(inviteEmail);
      triggerSuccess(result.message);
      setInviteEmail('');
      setIsInviteModalOpen(false);
      await fetchUsers();
    } catch (err: unknown) {
      setErrorBanner(getApiErrorMessage(err, 'Failed to send invitation.'));
    } finally {
      setIsSendingInvite(false);
    }
  };

  // Deactivate User Handler
  const handleDeactivateUser = async (targetUser: User) => {
    const confirmed = await confirm({
      title: 'Deactivate team member',
      message: (
        <>
          Are you sure you want to deactivate <strong>{targetUser.email}</strong>? Their active
          sessions will be terminated immediately via Redis token revocation.
        </>
      ),
      confirmLabel: 'Deactivate',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeactivatingUserId(targetUser.id);
    try {
      // A toast tracks the whole lifecycle: loading -> success/error.
      await toast.promise(
        carrierAdminDashboardService.deactivateUser(targetUser.id).then(async (res) => {
          await fetchUsers();
          return res;
        }),
        {
          loading: `Deactivating ${targetUser.email}...`,
          success: (res) => res?.message || `User ${targetUser.email} has been deactivated.`,
          error: (err: unknown) => getApiErrorMessage(err, 'Failed to deactivate user.'),
        }
      );
    } catch {
      // The error toast already surfaced the failure; swallow to avoid an
      // unhandled rejection from the click handler.
    } finally {
      setDeactivatingUserId(null);
    }
  };

  // Reactivate User Handler
  const handleReactivateUser = async (targetUser: User) => {
    const confirmed = await confirm({
      title: 'Reactivate team member',
      message: (
        <>
          Are you sure you want to reactivate <strong>{targetUser.email}</strong>? They will be
          permitted to log in and resume booking activities.
        </>
      ),
      confirmLabel: 'Reactivate',
      variant: 'default',
    });
    if (!confirmed) return;

    setReactivatingUserId(targetUser.id);
    try {
      await toast.promise(
        carrierAdminDashboardService.reactivateUser(targetUser.id).then(async (res) => {
          await fetchUsers();
          return res;
        }),
        {
          loading: `Reactivating ${targetUser.email}...`,
          success: (res) => res?.message || `User ${targetUser.email} has been reactivated.`,
          error: (err: unknown) => getApiErrorMessage(err, 'Failed to reactivate user.'),
        }
      );
    } catch {
      // The error toast already surfaced the failure; swallow to avoid an
      // unhandled rejection from the click handler.
    } finally {
      setReactivatingUserId(null);
    }
  };

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return carrierAdminDashboardService.filterUsers(organizationUsers, {
      searchTerm,
      statusFilter,
      roleFilter,
    });
  }, [organizationUsers, searchTerm, statusFilter, roleFilter]);

  // Statistics Cards
  const stats = useMemo(() => {
    return carrierAdminDashboardService.computeStats(organizationUsers);
  }, [organizationUsers]);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Page Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[#2F4F4F]/10 rounded-lg">
              <Truck className="w-6 h-6 text-[#2F4F4F]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                Carrier Admin Management
              </h1>
              <p className="text-xs text-gray-500">
                Manage organization dispatchers, fleet personnel access, and live warehouse dock scheduling.
              </p>
            </div>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsInviteModalOpen(true)}
            className="flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite Dispatcher</span>
          </button>

          <button
            onClick={fetchUsers}
            disabled={isLoadingUsers}
            className="flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-300 rounded-lg transition-colors disabled:opacity-50"
            title="Refresh organization team list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingUsers ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Global Alerts */}
      {errorBanner && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl px-4 pt-2 shadow-sm space-x-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'users'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Management</span>
          <span
            className={`ml-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              activeTab === 'users'
                ? 'bg-[#2F4F4F]/10 text-[#2F4F4F]'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {stats.total}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'profile'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Carrier Profile & Organization</span>
        </button>
      </div>

      {/* Tab Content 1: User Management */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 p-6 space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block">
                Total Team Members
              </span>
              <span className="text-2xl font-bold text-gray-900 mt-1 block">
                {stats.total}
              </span>
            </div>

            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <span className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider block">
                Active Dispatchers
              </span>
              <span className="text-2xl font-bold text-emerald-800 mt-1 block">
                {stats.dispatchers}
              </span>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <span className="text-[11px] font-semibold text-blue-700 uppercase tracking-wider block">
                Carrier Admins
              </span>
              <span className="text-2xl font-bold text-blue-800 mt-1 block">
                {stats.admins}
              </span>
            </div>

            <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
              <span className="text-[11px] font-semibold text-red-700 uppercase tracking-wider block">
                Deactivated Accounts
              </span>
              <span className="text-2xl font-bold text-red-800 mt-1 block">
                {stats.deactivated}
              </span>
            </div>
          </div>

          {/* Section Header & Search / Filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#2F4F4F]" />
                <span>Organization Members & Access Control</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Invite new dispatchers, monitor active accounts, and revoke credentials instantly using Redis token invalidation.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
                />
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="py-1.5 px-3 text-xs bg-gray-50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="DEACTIVATED">Deactivated Only</option>
              </select>

              {/* Role Filter */}
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="py-1.5 px-3 text-xs bg-gray-50 border border-gray-300 rounded-lg text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
              >
                <option value="ALL">All Roles</option>
                <option value="CARRIER_ADMIN">Carrier Admins</option>
                <option value="DISPATCHER">Dispatchers</option>
              </select>
            </div>
          </div>

          {/* User List */}
          {isLoadingUsers ? (
            <div className="py-16 text-center text-xs text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
              Loading carrier organization members...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              {organizationUsers.length === 0
                ? 'No organization users found.'
                : 'No users match your search and filter criteria.'}
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {filteredUsers.map((u) => {
                const isDeactivated = u.isActive === false;
                const isSelf = u.id === user?.id;

                return (
                  <div
                    key={u.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-gray-50/70 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                          isDeactivated
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {u.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-gray-900">{u.email}</span>
                          {isSelf && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">
                              You
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className="text-[11px] font-semibold text-gray-500">
                            {u.role === 'CARRIER_ADMIN' ? 'Carrier Admin' : 'Dispatcher'}
                          </span>
                          <span className="text-gray-300">•</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center space-x-1 ${
                              isDeactivated
                                ? 'bg-red-50 text-red-600 border border-red-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {isDeactivated ? (
                              <>
                                <UserX className="w-2.5 h-2.5" />
                                <span>Deactivated</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-2.5 h-2.5" />
                                <span>Active</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div>
                      {isSelf ? (
                        <span className="text-xs text-gray-400 font-medium">Current Session</span>
                      ) : isDeactivated ? (
                        <button
                          onClick={() => handleReactivateUser(u)}
                          disabled={reactivatingUserId === u.id}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded-lg transition-colors flex items-center space-x-1 disabled:opacity-50"
                        >
                          {reactivatingUserId === u.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserCheck className="w-3 h-3" />
                          )}
                          <span>Reactivate</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeactivateUser(u)}
                          disabled={deactivatingUserId === u.id}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors flex items-center space-x-1 disabled:opacity-50"
                        >
                          {deactivatingUserId === u.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserX className="w-3 h-3" />
                          )}
                          <span>Deactivate</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab Content 2: Carrier Organization Profile */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-b-xl shadow-sm border border-t-0 border-gray-200 p-6 space-y-6">
          <div className="border-b pb-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-[#2F4F4F]" />
              <span>Carrier Fleet & Organization Profile</span>
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Review company details and security settings for this carrier workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-5 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center space-x-2">
                <Truck className="w-4 h-4 text-[#2F4F4F]" />
                <span>Organization Details</span>
              </h4>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500">Company Name:</span>
                  <strong className="text-gray-900">{user?.organization?.name || 'Carrier Fleet'}</strong>
                </div>

                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500">Organization Type:</span>
                  <span className="inline-block px-2 py-0.5 bg-[#2F4F4F]/10 text-[#2F4F4F] font-bold rounded">
                    CARRIER
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500">Administrator:</span>
                  <span className="text-gray-800">{user?.email}</span>
                </div>

                <div className="flex justify-between py-1">
                  <span className="text-gray-500">Default Invite Role:</span>
                  <span className="text-emerald-700 font-semibold">DISPATCHER</span>
                </div>
              </div>
            </div>

           
          </div>
        </div>
      )}

      {/* Modal: Invite Team Member */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Invite Team Member</span>
              </h3>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="text-gray-300 hover:text-white"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInviteUser} className="p-6 space-y-4">
              <div>
                <label htmlFor="carrier-invite-email" className="block text-xs font-semibold text-gray-700 mb-1">
                  Team Member Email Address
                </label>
                <input
                  id="carrier-invite-email"
                  type="email"
                  placeholder="dispatcher@swiftlogistics.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Invited users to a Carrier organization will automatically be designated the{' '}
                  <strong>DISPATCHER</strong> role.
                </p>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingInvite}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center space-x-1.5"
                >
                  {isSendingInvite && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Send Invitation</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
};

export default CarrierAdminDashboard;
