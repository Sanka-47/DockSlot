import React, { lazy, Suspense, useState } from 'react';
import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/pages/AuthPage';
import { LoadingState } from '@/components/common/LoadingState';
import { PageLoadingFallback } from '@/components/common/PageLoadingFallback';
import { Warehouse, LogOut, Users, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import {
  consumeAuthTokenFromUrl,
  isAcceptInvitePath,
  isForgotPasswordPath,
  isResetPasswordPath,
} from '@/utils/urlToken';
import { resolveDashboardView } from '@/utils/dashboardView';

const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage'));
const CarrierDashboard = lazy(() => import('@/pages/CarrierDashboard'));
const WarehouseDashboard = lazy(() => import('@/pages/WarehouseDashboard'));
const DockManagerDashboard = lazy(() => import('@/pages/DockManagerDashboard'));
const TeamManagementModal = lazy(() => import('@/components/TeamManagementModal'));
const SecuritySettingsModal = lazy(() => import('@/components/SecuritySettingsModal'));

/**
 * Email-link tokens are read and removed from the address bar exactly once,
 * before any component renders. Keeping the value in module scope avoids
 * React StrictMode's double-invoked state initializers.
 */
const initialAuthToken = consumeAuthTokenFromUrl();

const ModalLoadingFallback: React.FC = () => (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
    <div className="rounded-xl bg-white p-2 shadow-2xl">
      <LoadingState message="Loading dialog..." />
    </div>
  </div>
);

const AppContent: React.FC = () => {
  const { user, isAuthenticated, logout, logoutAll, refreshUser, isLoading } = useAuth();
  const [activeView, setActiveView] = useState<'auto' | 'carrier' | 'warehouse'>('auto');
  const [isTeamModalOpen, setIsTeamModalOpen] = useState<boolean>(false);
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState<boolean>(false);

  if (isLoading) {
    return <PageLoadingFallback />;
  }

  // Handle URL paths for Password Reset & Forgot Password
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

  if (isResetPasswordPath(pathname)) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <ResetPasswordPage
          token={initialAuthToken}
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
      </Suspense>
    );
  }

  if (isForgotPasswordPath(pathname)) {
    return (
      <Suspense fallback={<PageLoadingFallback />}>
        <ForgotPasswordPage
          onBackToSignIn={() => {
            if (typeof window !== 'undefined') {
              window.location.href = '/';
            }
          }}
        />
      </Suspense>
    );
  }

  // Handle invitation link: /accept-invite?token=...
  if (isAcceptInvitePath(pathname)) {
    return (
      <AuthPage
        initialTab="signin"
        inviteToken={initialAuthToken}
        showInviteModal={true}
        onNavigate={(route) => setActiveView(route)}
      />
    );
  }

  if (!isAuthenticated || !user) {
    return <AuthPage onNavigate={(route) => setActiveView(route)} />;
  }

  // A view requested before sign-in must never override the authenticated
  // user's actual role capabilities.
  const dashboardView = resolveDashboardView(user.role, activeView);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-[#2F4F4F] focus:font-semibold focus:rounded-md focus:shadow-lg"
      >
        Skip to main content
      </a>

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

        <div
          role="group"
          aria-label="Account actions"
          className="flex flex-wrap items-center gap-2 sm:space-x-3"
        >
          <span className="text-xs text-gray-200 hidden lg:inline">
            Logged in as <strong className="text-white">{user.email}</strong>
          </span>

          {(user.role === 'CARRIER_ADMIN' || user.role === 'WAREHOUSE_ADMIN') && (
            <button
              type="button"
              onClick={() => setIsTeamModalOpen(true)}
              aria-haspopup="dialog"
              className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-emerald-600/80 hover:bg-emerald-600 text-white rounded-md transition-colors shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              title="Manage organization team members and deactivations"
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Team & Access</span>
              <span className="sm:hidden">Team</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsSecurityModalOpen(true)}
            aria-label="Security settings"
            aria-haspopup="dialog"
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            title="Account security settings, including two-factor authentication"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Security</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const confirmed = window.confirm(
                'Are you sure you want to log out of all devices? This will invalidate all active sessions across every browser and device.',
              );
              if (confirmed) {
                await logoutAll();
              }
            }}
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-amber-600/30 hover:bg-amber-600/50 text-amber-100 border border-amber-400/30 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            title="Invalidate all active sessions across all devices"
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">Log Out All Devices</span>
            <span className="sm:hidden">Logout All</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard View */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto outline-none"
      >
        <Suspense
          fallback={<LoadingState message="Loading dashboard..." className="min-h-[40vh]" />}
        >
          {dashboardView === 'carrier' ? (
            <CarrierDashboard />
          ) : dashboardView === 'dock-manager' ? (
            <DockManagerDashboard />
          ) : (
            <WarehouseDashboard />
          )}
        </Suspense>
      </main>

      {/* Admin Team & Session Control Modal */}
      {isTeamModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <TeamManagementModal
            isOpen={isTeamModalOpen}
            onClose={() => setIsTeamModalOpen(false)}
            currentUserId={user.id}
            currentUserRole={user.role}
            organizationName={user.organization?.name}
          />
        </Suspense>
      )}

      {/* Account Security Settings (Two-Factor Authentication) */}
      {isSecurityModalOpen && (
        <Suspense fallback={<ModalLoadingFallback />}>
          <SecuritySettingsModal
            isOpen={isSecurityModalOpen}
            onClose={() => setIsSecurityModalOpen(false)}
            user={user}
            onStatusChange={() => {
              refreshUser();
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#2F4F4F',
            color: '#ffffff',
            fontSize: '0.875rem',
          },
          success: { iconTheme: { primary: '#059669', secondary: '#ffffff' } },
          error: { iconTheme: { primary: '#dc2626', secondary: '#ffffff' }, duration: 6000 },
        }}
      />
    </AuthProvider>
  );
};

export default App;
