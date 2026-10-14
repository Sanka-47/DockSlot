import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { AuthPage } from './pages/AuthPage';
import { CarrierDashboard } from './pages/CarrierDashboard';
import { WarehouseDashboard } from './pages/WarehouseDashboard';
import { Warehouse, LogOut } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, isAuthenticated, logout, isLoading } = useAuth();
  const [activeView, setActiveView] = useState<'auto' | 'carrier' | 'warehouse'>('auto');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#D9D9D9] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-4 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-[#2F4F4F]">Loading DockSlot...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <AuthPage
        onNavigate={(route) => setActiveView(route)}
      />
    );
  }

  // Determine dashboard based on user role and organization
  const isCarrier =
    activeView === 'carrier' ||
    (activeView === 'auto' &&
      (user.role === 'CARRIER_ADMIN' ||
        user.role === 'DISPATCHER' ||
        user.organization?.type === 'CARRIER'));

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-[#2F4F4F] text-white px-6 py-3.5 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-white/10 rounded-md">
            <Warehouse className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight">DockSlot</span>
            <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">
              {user.organization?.name || 'Workspace'} ({user.role})
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <span className="text-xs text-gray-200 hidden sm:inline">
            Logged in as <strong className="text-white">{user.email}</strong>
          </span>
          <button
            onClick={logout}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard View */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        {isCarrier ? <CarrierDashboard /> : <WarehouseDashboard />}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
