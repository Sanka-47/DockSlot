import React, { useState, useEffect } from 'react';
import {
  Users,
  UserX,
  UserCheck,
  UserPlus,
  X,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Shield,
} from 'lucide-react';
import { userApi } from '../api/user.api';
import type { User } from '../types/user.types';
import { useConfirm } from '../hooks/useConfirm';
import toast from 'react-hot-toast';

interface TeamManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUserId: number;
  currentUserRole: string;
  organizationName?: string;
}

export const TeamManagementModal: React.FC<TeamManagementModalProps> = ({
  isOpen,
  onClose,
  currentUserId,
  currentUserRole,
  organizationName,
}) => {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [isInviting, setIsInviting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await userApi.getUsers();
      if (res?.data) {
        setUsers(res.data);
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Failed to load organization team members.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      setErrorMessage(null);
      setSuccessMessage(null);
      setInviteEmail('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDeactivate = async (targetUser: User) => {
    const confirmed = await confirm({
      title: 'Deactivate team member',
      message: (
        <>
          Are you sure you want to deactivate <strong>{targetUser.email}</strong>? Their active
          sessions will be terminated immediately.
        </>
      ),
      confirmLabel: 'Deactivate',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeactivatingId(targetUser.id);
    try {
      // A toast tracks the whole lifecycle: loading -> success/error.
      await toast.promise(
        userApi.deactivateUser(targetUser.id).then(async (res) => {
          await fetchUsers();
          return res;
        }),
        {
          loading: `Deactivating ${targetUser.email}...`,
          success: (res) => res?.message || `User ${targetUser.email} has been deactivated.`,
          error: (err: any) => err?.response?.data?.message || 'Failed to deactivate user.',
        }
      );
    } catch {
      // The error toast already surfaced the failure; swallow to avoid an
      // unhandled rejection from the click handler.
    } finally {
      setDeactivatingId(null);
    }
  };

  const handleReactivate = async (targetUser: User) => {
    const confirmed = await confirm({
      title: 'Reactivate team member',
      message: (
        <>
          Are you sure you want to reactivate <strong>{targetUser.email}</strong>? They will be
          allowed to log in and access the system.
        </>
      ),
      confirmLabel: 'Reactivate',
      variant: 'default',
    });
    if (!confirmed) return;

    setReactivatingId(targetUser.id);
    try {
      await toast.promise(
        userApi.reactivateUser(targetUser.id).then(async (res) => {
          await fetchUsers();
          return res;
        }),
        {
          loading: `Reactivating ${targetUser.email}...`,
          success: (res) => res?.message || `User ${targetUser.email} has been reactivated.`,
          error: (err: any) => err?.response?.data?.message || 'Failed to reactivate user.',
        }
      );
    } catch {
      // The error toast already surfaced the failure; swallow to avoid an
      // unhandled rejection from the click handler.
    } finally {
      setReactivatingId(null);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsInviting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await userApi.inviteUser({ email: inviteEmail.trim() });
      setSuccessMessage(res.message || `Invitation successfully sent to ${inviteEmail}.`);
      setInviteEmail('');
      await fetchUsers();
    } catch (err: any) {
      setErrorMessage(err.response?.data?.message || 'Failed to send invitation.');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <Users className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold tracking-tight">Organization Team & Access Control</h2>
              <p className="text-xs text-gray-300">
                {organizationName || 'Workspace'} • {currentUserRole}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banners */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Invite Section */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center space-x-1.5">
              <UserPlus className="w-4 h-4 text-[#2F4F4F]" />
              <span>Invite New Team Member</span>
            </h3>
            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                placeholder="colleague@organization.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
              />
              <button
                type="submit"
                disabled={isInviting || !inviteEmail.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-md transition-colors flex items-center space-x-1.5"
              >
                {isInviting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Send Invite</span>
              </button>
            </form>
          </div>

          {/* Users List Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center space-x-1.5">
                <Shield className="w-4 h-4 text-[#2F4F4F]" />
                <span>Active & Deactivated Members</span>
              </h3>
              <button
                onClick={fetchUsers}
                disabled={isLoading}
                className="text-xs text-[#2F4F4F] hover:underline flex items-center space-x-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {isLoading && users.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
                Loading team members...
              </div>
            ) : users.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                No users found.
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                {users.map((u) => {
                  const isDeactivated = u.isActive === false;
                  const isSelf = u.id === currentUserId;

                  return (
                    <div
                      key={u.id}
                      className="p-3.5 flex items-center justify-between hover:bg-gray-50/80 transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                            isDeactivated
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {u.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-gray-900">{u.email}</span>
                            {isSelf && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">
                                You
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 mt-0.5">
                            <span className="text-[11px] text-gray-500">{u.role}</span>
                            <span className="text-gray-300">•</span>
                            <span
                              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center space-x-1 ${
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

                      <div>
                        {isSelf ? (
                          <span className="text-[11px] text-gray-400">Current Session</span>
                        ) : isDeactivated ? (
                          <button
                            onClick={() => handleReactivate(u)}
                            disabled={reactivatingId === u.id}
                            className="px-2.5 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 rounded transition-colors disabled:opacity-50 flex items-center space-x-1"
                          >
                            {reactivatingId === u.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <UserCheck className="w-3 h-3" />
                            )}
                            <span>Reactivate</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleDeactivate(u)}
                            disabled={deactivatingId === u.id}
                            className="px-2.5 py-1 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 hover:bg-red-50 rounded transition-colors disabled:opacity-50 flex items-center space-x-1"
                          >
                            {deactivatingId === u.id ? (
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
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {confirmDialog}
    </div>
  );
};

export default TeamManagementModal;
