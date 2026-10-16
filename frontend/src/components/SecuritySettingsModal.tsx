import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { TwoFactorSettings } from './TwoFactorSettings';
import type { User } from '../types/user.types';

export interface SecuritySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  /** Refreshes the authenticated user so navbar/dashboard see the new 2FA flag. */
  onStatusChange?: (isTwoFactorEnabled: boolean) => void;
}

/**
 * Account security settings surface. Currently hosts the optional TOTP
 * two-factor authentication panel.
 */
export const SecuritySettingsModal: React.FC<SecuritySettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  onStatusChange,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Account security settings"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg my-8 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-[#2F4F4F] text-white">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="p-1.5 bg-white/10 rounded-md shrink-0">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight">Account Settings</h2>
              <p className="text-[11px] text-gray-200 truncate">
                {user?.email || 'Signed in user'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close account settings"
            className="p-1.5 rounded-md hover:bg-white/15 transition-colors focus:outline-none shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              Security
            </h3>
            <p className="text-xs text-gray-500 mt-1 leading-snug">
              Protect your DockSlot account and the bookings, docks and carrier data your workspace
              manages.
            </p>
          </div>

          <TwoFactorSettings onStatusChange={onStatusChange} />
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SecuritySettingsModal;
