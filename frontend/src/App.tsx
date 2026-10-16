import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './hooks/useAuth';
import { AuthPage } from './pages/AuthPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { CarrierDashboard } from './pages/CarrierDashboard';
import { WarehouseDashboard } from './pages/WarehouseDashboard';
import { DockManagerDashboard } from './pages/DockManagerDashboard';
import { TeamManagementModal } from './components/TeamManagementModal';
import { Warehouse, LogOut, Users, ShieldAlert } from 'lucide-react';

const AppContent: React.FC = () => {
  const { user, isAuthenticated, logout, logoutAll, isLoading } = useAuth();
  const [activeView, setActiveView] = useState<'auto' | 'carrier' | 'warehouse'>('auto');
  const [isTeamModalOpen, setIsTeamModalOpen] = useState<boolean>(false);

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

  // Handle URL paths for Password Reset & Forgot Password
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const searchParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const urlToken = searchParams.get('token') || undefined;

  if (
    pathname.includes('reset-password') ||
    (urlToken && !pathname.includes('accept-invite') && !pathname.includes('verify'))
  ) {
    return (
      <ResetPasswordPage
        token={urlToken}
        onBackToSignIn={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
        }}
        onSuccess={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
        }}
      />
    );
  }

  if (pathname.includes('forgot-password')) {
    return (
      <ForgotPasswordPage
        onBackToSignIn={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/';
          }
        }}
      />
    );
  }

  // Handle invitation link: /accept-invite?token=...
  if (pathname.includes('accept-invite')) {
    return (
      <AuthPage
        initialTab="signin"
        inviteToken={urlToken}
        showInviteModal={true}
        onNavigate={(route) => setActiveView(route)}
      />
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <AuthPage
        resetToken={urlToken}
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
      <header className="bg-[#2F4F4F] text-white px-3 sm:px-6 py-3 sm:py-3.5 flex flex-wrap items-center justify-between gap-2.5 shadow-md">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="p-1.5 bg-white/10 rounded-md shrink-0">
            <Warehouse className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="font-bold text-base sm:text-lg tracking-tight">DockSlot</span>
            <span className="text-[11px] sm:text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium truncate max-w-[200px] sm:max-w-none">
              {user.organization?.name || 'Workspace'} ({user.role})
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:space-x-3">
          <span className="text-xs text-gray-200 hidden lg:inline">
            Logged in as <strong className="text-white">{user.email}</strong>
          </span>

          {(user.role === 'CARRIER_ADMIN' || user.role === 'WAREHOUSE_ADMIN') && (
            <button
              onClick={() => setIsTeamModalOpen(true)}
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-md transition-colors shadow-sm"
              title="Manage organization team members and deactivations"
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xs:inline sm:inline">Team & Access</span>
              <span className="xs:hidden sm:hidden">Team</span>
            </button>
          )}

          <button
            onClick={async () => {
              const confirmed = window.confirm(
                'Are you sure you want to log out of all devices? This will invalidate all active sessions across every browser and device.'
              );
              if (confirmed) {
                await logoutAll();
              }
            }}
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-amber-600/30 hover:bg-amber-600/50 text-amber-100 border border-amber-400/30 rounded-md transition-colors"
            title="Invalidate all active sessions across all devices"
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Log Out All Devices</span>
            <span className="sm:hidden">Logout All</span>
          </button>

          <button
            onClick={logout}
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard View */}
      <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto">
        {isCarrier ? (
          <CarrierDashboard />
        ) : user.role === 'DOCK_MANAGER' ? (
          <DockManagerDashboard />
        ) : (
          <WarehouseDashboard />
        )}
      </main>

      {/* Admin Team & Session Control Modal */}
      {isTeamModalOpen && (
        <TeamManagementModal
          isOpen={isTeamModalOpen}
          onClose={() => setIsTeamModalOpen(false)}
          currentUserId={user.id}
          currentUserRole={user.role}
          organizationName={user.organization?.name}
        />
      )}
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
