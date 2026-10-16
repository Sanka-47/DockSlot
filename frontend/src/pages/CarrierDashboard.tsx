import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { CarrierAdminDashboard } from './CarrierAdminDashboard';
import { DispatcherDashboard } from './DispatcherDashboard';
import { Settings, Calendar } from 'lucide-react';

export const CarrierDashboard: React.FC = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'admin' | 'operations'>('admin');

  // If user is a standard DISPATCHER, render DispatcherDashboard directly
  if (user?.role === 'DISPATCHER') {
    return <DispatcherDashboard />;
  }

  // If user is CARRIER_ADMIN, render CarrierAdminDashboard with view switcher
  return (
    <div className="space-y-4">
      {/* View Switcher Sub-header for Carrier Admins */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 sm:pl-2">
            Carrier View:
          </span>
          <div className="grid grid-cols-2 sm:inline-flex rounded-md shadow-sm w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setViewMode('admin')}
              className={`inline-flex items-center justify-center px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-l-md text-xs font-medium border transition-colors ${
                viewMode === 'admin'
                  ? 'bg-[#2F4F4F] text-white border-[#2F4F4F]'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Settings className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Admin Console</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('operations')}
              className={`inline-flex items-center justify-center px-2.5 sm:px-3.5 py-2 sm:py-1.5 rounded-r-md text-xs font-medium border-t border-b border-r transition-colors ${
                viewMode === 'operations'
                  ? 'bg-[#2F4F4F] text-white border-[#2F4F4F]'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <span className="truncate">Dispatch & Bookings</span>
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-400 hidden lg:block pr-2">
          {viewMode === 'admin'
            ? 'Manage carrier dispatchers, access credentials & organization profile'
            : 'Search available warehouse slots and manage dock appointments'}
        </div>
      </div>

      {viewMode === 'admin' ? <CarrierAdminDashboard /> : <DispatcherDashboard />}
    </div>
  );
};

export default CarrierDashboard;
