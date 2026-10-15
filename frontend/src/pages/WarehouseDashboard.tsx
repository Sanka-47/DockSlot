import React, { useState } from 'react';
import { WarehouseAdminDashboard } from './WarehouseAdminDashboard';
import { DockManagerDashboard } from './DockManagerDashboard';
import { Settings, Calendar } from 'lucide-react';

export const WarehouseDashboard: React.FC = () => {
  const [viewMode, setViewMode] = useState<'admin' | 'operations'>('admin');

  return (
    <div className="space-y-4">
      {/* View Switcher Sub-header */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 pl-2">
            Warehouse View:
          </span>
          <div className="inline-flex rounded-md shadow-sm">
            <button
              type="button"
              onClick={() => setViewMode('admin')}
              className={`inline-flex items-center px-3.5 py-1.5 rounded-l-md text-xs font-medium border transition-colors ${
                viewMode === 'admin'
                  ? 'bg-[#2F4F4F] text-white border-[#2F4F4F]'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Settings className="w-3.5 h-3.5 mr-1.5" />
              Administration & Policy Console
            </button>
            <button
              type="button"
              onClick={() => setViewMode('operations')}
              className={`inline-flex items-center px-3.5 py-1.5 rounded-r-md text-xs font-medium border-t border-b border-r transition-colors ${
                viewMode === 'operations'
                  ? 'bg-[#2F4F4F] text-white border-[#2F4F4F]'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 mr-1.5" />
              Live Bay & Operational Schedule
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-400 hidden sm:block pr-2">
          {viewMode === 'admin'
            ? 'Manage warehouses, docks, slot durations, booking policies & team'
            : 'Monitor real-time dock bookings, truck arrivals & bay assignments'}
        </div>
      </div>

      {/* Render selected dashboard */}
      {viewMode === 'admin' ? <WarehouseAdminDashboard /> : <DockManagerDashboard />}
    </div>
  );
};

export default WarehouseDashboard;

