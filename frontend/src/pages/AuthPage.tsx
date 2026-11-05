import React, { useState } from 'react';
import {
  Mail,
  Lock,
  Building,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  Truck,
  Warehouse,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  ArrowLeft,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs } from '../components/ui/tabs';
import { authPageService } from '../services/authPage.service';
import { getApiErrorMessage } from '../services/errors';
import { useAuth } from '../hooks/useAuth';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { UserRegisterModal } from '../components/UserRegisterModal';
import type {
  OrganizationType,
  User,
} from '../types/user.types';

export type AuthTab = 'signin' | 'register' | 'forgot' | 'reset';

export interface AuthPageProps {
  initialTab?: AuthTab;
  resetToken?: string;
  inviteToken?: string;
  showInviteModal?: boolean;
  onSuccess?: (user: User, token: string) => void;
  onNavigate?: (route: 'carrier' | 'warehouse') => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialTab = 'signin',
  resetToken,
  inviteToken,
  showInviteModal = false,
  onSuccess,
  onNavigate,
}) => {
  const { login: setAuthContextUser } = useAuth();

  // Determine initial tab synchronously based on URL and props
  const getInitialTab = (): AuthTab => {
    if (initialTab && initialTab !== 'signin') {
      return initialTab;
    }
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      if (
        resetToken ||
        path.includes('reset-password') ||
        (searchParams.get('token') && !path.includes('accept-invite') && !path.includes('verify'))
      ) {
        return 'reset';
      }
      if (path.includes('forgot-password')) {
        return 'forgot';
      }
    }
    return initialTab;
  };

  // Tab State: 'signin' | 'register' | 'forgot' | 'reset'
  const [activeTab, setActiveTab] = useState<AuthTab>(getInitialTab);

  // Sync tab if URL or resetToken changes
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      if (
        resetToken ||
        path.includes('reset-password') ||
        (searchParams.get('token') && !path.includes('accept-invite') && !path.includes('verify'))
      ) {
        setActiveTab('reset');
      } else if (path.includes('forgot-password')) {
        setActiveTab('forgot');
      }
    }
  }, [resetToken]);

  // Common UI State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // User Register Modal (for invitation links)
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(() => {
    if (showInviteModal) return true;
    if (typeof window !== 'undefined') {
      return window.location.pathname.includes('accept-invite');
    }
    return false;
  });

  const effectiveInviteToken =
    inviteToken ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token') || undefined
      : undefined);

  // Sync invite modal if showInviteModal or URL changes
  React.useEffect(() => {
    if (showInviteModal) {
      setIsInviteModalOpen(true);
    } else if (typeof window !== 'undefined' && window.location.pathname.includes('accept-invite')) {
      setIsInviteModalOpen(true);
    }
  }, [showInviteModal]);

  // Handle invite modal success and redirect to AuthPage sign in
  const handleInviteSuccess = (registeredEmail?: string, message?: string) => {
    setIsInviteModalOpen(false);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
    }
    setActiveTab('signin');
    if (registeredEmail) {
      setSignInEmail(registeredEmail);
    }
    setSuccessMessage(
      message || 'Registration completed successfully! Please sign in with your new password.'
    );
  };

  const handleInviteClose = () => {
    setIsInviteModalOpen(false);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', '/');
    }
  };

  // Sign In Form State
  const [signInEmail, setSignInEmail] = useState<string>('');
  const [signInPassword, setSignInPassword] = useState<string>('');

  // Two-Factor Authentication challenge state (set when the backend replies requires2FA)
  const [pendingTempToken, setPendingTempToken] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const [totpCode, setTotpCode] = useState<string>('');

  const isTwoFactorStep = pendingTempToken !== null;

  /**
   * Stores the final JWT, syncs global auth context, and routes to the right dashboard.
   */
  const completeSignIn = (token: string, user: User, successText: string) => {
    // Store the access token; the refresh token lives in an HttpOnly cookie.
    authPageService.persistSession(token);

    // Update global context
    setAuthContextUser(token, user);

    setSuccessMessage(successText);

    if (onSuccess) {
      onSuccess(user, token);
    }

    // Smooth redirection
    setTimeout(() => {
      handleDashboardRedirect(user);
    }, 500);
  };

  // Register Org Form State
  const [registerOrgType, setRegisterOrgType] = useState<OrganizationType>('CARRIER');
  const [registerOrgName, setRegisterOrgName] = useState<string>('');
  const [registerEmail, setRegisterEmail] = useState<string>('');
  const [registerPassword, setRegisterPassword] = useState<string>('');

  // Clear messages on tab change
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as AuthTab);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  /**
   * Route user to their respective dashboard based on role and organization type.
   */
  const handleDashboardRedirect = (user: User) => {
    const targetRoute = authPageService.getDashboardRoute(user);

    if (onNavigate) {
      onNavigate(targetRoute);
    } else if (typeof window !== 'undefined') {
      window.location.href = targetRoute === 'carrier' ? '/carrier' : '/warehouse';
    }
  };

  /**
   * Form Submission: Sign In
   *
   * If the account has 2FA enabled the backend withholds the final JWT and
   * returns { requires2FA: true, tempToken }. We then switch the card into the
   * 6-digit code view and finish the handshake via handleVerify2FA.
   */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const validationError = authPageService.validateSignIn(
      signInEmail,
      signInPassword
    );
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsLoading(true);
      const result = await authPageService.signIn(signInEmail, signInPassword);

      // Backend responded with a 2FA challenge instead of a session token
      if (result.requiresTwoFactor) {
        setPendingTempToken(result.tempToken);
        setPendingEmail(result.email);
        setTotpCode('');
        setSuccessMessage(null);
        return;
      }

      completeSignIn(
        result.token,
        result.user,
        'Login successful! Redirecting to dashboard...'
      );
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(
          err,
          'Login failed. Please check your credentials.'
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Step 2 of the 2FA login flow: exchange the temp token + 6-digit TOTP code
   * for the final access JWT.
   */
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!pendingTempToken) {
      setErrorMessage('Your 2FA session has expired. Please sign in again.');
      return;
    }

    const validationError = authPageService.validateTwoFactorCode(totpCode);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsLoading(true);
      const session = await authPageService.verifyTwoFactor(
        pendingTempToken,
        totpCode
      );

      setPendingTempToken(null);
      setTotpCode('');
      completeSignIn(
        session.token,
        session.user,
        'Two-factor verification successful! Redirecting to dashboard...'
      );
    } catch (err: unknown) {
      // An expired temp token cannot be retried — send the user back to the password step.
      if (authPageService.isTwoFactorSessionExpired(err)) {
        setPendingTempToken(null);
        setTotpCode('');
        setErrorMessage('Your 2FA session expired. Please sign in again.');
      } else {
        setErrorMessage(
          getApiErrorMessage(
            err,
            'That verification code was not accepted. Please try again.'
          )
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel2FA = () => {
    setPendingTempToken(null);
    setPendingEmail('');
    setTotpCode('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  /**
   * Form Submission: Register Org
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    const validationError = authPageService.validateRegistration({
      organizationName: registerOrgName,
      email: registerEmail,
      password: registerPassword,
    });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsLoading(true);
      const session = await authPageService.registerOrganization({
        organizationName: registerOrgName,
        organizationType: registerOrgType,
        email: registerEmail,
        password: registerPassword,
      });

      authPageService.persistSession(session.token);

      // Update global context
      setAuthContextUser(session.token, session.user);

      setSuccessMessage('Organization registered successfully! Setting up your workspace...');

      if (onSuccess) {
        onSuccess(session.user, session.token);
      }

      // Smooth redirection
      setTimeout(() => {
        handleDashboardRedirect(session.user);
      }, 600);
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(
          err,
          'Registration failed. Please check your details.'
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (activeTab === 'forgot') {
    return (
      <ForgotPasswordPage
        onBackToSignIn={() => handleTabChange('signin')}
      />
    );
  }

  if (activeTab === 'reset') {
    return (
      <ResetPasswordPage
        token={resetToken}
        onBackToSignIn={() => handleTabChange('signin')}
        onSuccess={() => handleTabChange('signin')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#D9D9D9] flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8">
      {/* Brand Header */}
      <div className="mb-6 text-center">
        <div className="inline-flex items-center justify-center space-x-2 mb-2">
          <div className="p-2.5 bg-[#2F4F4F] rounded-lg text-white shadow-md">
            <Warehouse className="w-6 h-6" />
          </div>
          <span className="text-3xl font-extrabold tracking-tight text-[#2F4F4F]">
            DockSlot
          </span>
        </div>
        <p className="text-sm font-medium text-gray-600">
          Intelligent Warehouse Dock Scheduling & Carrier Logistics
        </p>
      </div>

      {/* Main Centered White Card Container */}
      <Card className="w-full max-w-md bg-white shadow-xl rounded-lg border border-gray-300 overflow-hidden">
        <CardHeader className="text-center pb-2">
          <h1 className="text-xl font-bold text-[#2F4F4F]">
            {isTwoFactorStep
              ? 'Two-Factor Verification'
              : activeTab === 'signin'
                ? 'Sign In to Your Workspace'
                : 'Register New Organization'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {isTwoFactorStep
              ? 'Enter the 6-digit code from your authenticator app to finish signing in'
              : activeTab === 'signin'
                ? 'Access real-time dock availability and manage yard schedules'
                : 'Create a top-level admin account for your carrier fleet or warehouse facility'}
          </p>

          {/* Interactive Tab Switcher (hidden while completing a 2FA challenge) */}
          {!isTwoFactorStep && (
            <div className="mt-5">
              <Tabs
                activeTab={activeTab}
                onChange={handleTabChange}
                tabs={[
                  { id: 'signin', label: 'Sign In' },
                  { id: 'register', label: 'Register Org' },
                ]}
              />
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-4">
          {/* Error Banner */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 flex items-start space-x-3 p-3.5 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm animate-in fade-in duration-200"
            >
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-tight">
                {errorMessage}
              </div>
            </div>
          )}

          {/* Success Banner */}
          {successMessage && (
            <div
              role="status"
              className="mb-4 flex items-start space-x-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-sm animate-in fade-in duration-200"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-tight">
                {successMessage}
              </div>
            </div>
          )}

          {/* Two-Factor Challenge View */}
          {isTwoFactorStep && (
            <form onSubmit={handleVerify2FA} className="space-y-4" noValidate>
              <div className="flex items-start space-x-3 p-3 bg-[#2F4F4F]/5 border border-[#2F4F4F]/15 rounded-md">
                <ShieldCheck className="w-5 h-5 text-[#2F4F4F] flex-shrink-0 mt-0.5" />
                <div className="text-xs text-gray-700 leading-snug">
                  <p className="font-semibold text-[#2F4F4F]">
                    Password verified — one more step
                  </p>
                  <p className="mt-0.5">
                    Open <strong>Google Authenticator</strong> and enter the current 6-digit code for
                    <span className="font-medium"> {pendingEmail || 'your account'}</span>.
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="signin-2fa-code" required>
                  Authentication Code
                </Label>
                <Input
                  id="signin-2fa-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={6}
                  placeholder="123456"
                  icon={<KeyRound className="w-4 h-4" />}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={isLoading}
                  className="tracking-[0.4em] font-mono text-base"
                />
                <p className="text-[11px] text-gray-500 mt-1.5 flex items-center space-x-1">
                  <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
                  <span>
                    Codes rotate every 30 seconds. This challenge expires 5 minutes after your
                    password was accepted.
                  </span>
                </p>
              </div>

              <Button type="submit" variant="primary" className="w-full mt-2" isLoading={isLoading}>
                <span>Verify & Sign In</span>
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>

              <button
                type="button"
                onClick={handleCancel2FA}
                disabled={isLoading}
                className="w-full flex items-center justify-center space-x-1.5 text-xs text-gray-500 hover:text-[#2F4F4F] font-medium focus:outline-none disabled:opacity-50"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back to sign in</span>
              </button>
            </form>
          )}

          {/* Sign In View */}
          {activeTab === 'signin' && !isTwoFactorStep && (
            <form onSubmit={handleSignIn} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="signin-email" required>
                  Email Address
                </Label>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@company.com"
                  icon={<Mail className="w-4 h-4" />}
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="signin-password" required>
                    Password
                  </Label>
                  <button
                    type="button"
                    onClick={() => handleTabChange('forgot')}
                    className="text-xs text-[#2F4F4F] hover:underline font-medium focus:outline-none"
                  >
                    Forgot password?
                  </button>
                </div>
                <Input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  icon={<Lock className="w-4 h-4" />}
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  disabled={isLoading}
                  rightElement={
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  }
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                <span>Sign In</span>
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </form>
          )}

          {/* Register Org View */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4" noValidate>
              {/* Organization Type Selector */}
              <div>
                <Label htmlFor="register-org-type" required>
                  Organization Type
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Building className="w-4 h-4" />
                  </div>
                  <select
                    id="register-org-type"
                    value={registerOrgType}
                    onChange={(e) =>
                      setRegisterOrgType(e.target.value as OrganizationType)
                    }
                    disabled={isLoading}
                    className="w-full rounded-md border border-gray-300 pl-10 pr-8 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F] focus:border-[#2F4F4F] transition-colors"
                  >
                    <option value="CARRIER">
                      Carrier / Fleet Operator (CARRIER)
                    </option>
                    <option value="WAREHOUSE_OPERATOR">
                      Warehouse Operator (WAREHOUSE_OPERATOR)
                    </option>
                  </select>
                </div>
                <p className="text-[11px] text-gray-500 mt-1 flex items-center space-x-1">
                  {registerOrgType === 'CARRIER' ? (
                    <>
                      <Truck className="w-3.5 h-3.5 text-[#2F4F4F] inline mr-1" />
                      <span>Grants CARRIER_ADMIN role to manage trucks, dispatchers & bookings.</span>
                    </>
                  ) : (
                    <>
                      <Warehouse className="w-3.5 h-3.5 text-[#2F4F4F] inline mr-1" />
                      <span>Grants WAREHOUSE_ADMIN role to configure docks, slots & maintenance.</span>
                    </>
                  )}
                </p>
              </div>

              {/* Organization Name */}
              <div>
                <Label htmlFor="register-org-name" required>
                  Organization Name
                </Label>
                <Input
                  id="register-org-name"
                  type="text"
                  required
                  placeholder={
                    registerOrgType === 'CARRIER'
                      ? 'e.g., Global Freight Line'
                      : 'e.g., Rotterdam Port Logistics Center'
                  }
                  icon={<Building className="w-4 h-4" />}
                  value={registerOrgName}
                  onChange={(e) => setRegisterOrgName(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              {/* Email Address */}
              <div>
                <Label htmlFor="register-email" required>
                  Admin Email Address
                </Label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="admin@yourcompany.com"
                  icon={<Mail className="w-4 h-4" />}
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              {/* Password */}
              <div>
                <Label htmlFor="register-password" required>
                  Password (min. 6 characters)
                </Label>
                <Input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="Create a strong password"
                  icon={<Lock className="w-4 h-4" />}
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  disabled={isLoading}
                  rightElement={
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  }
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                <span>Register Organization</span>
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Footer Info */}
      <div className="mt-8 text-center text-xs text-gray-500">
        &copy; {new Date().getFullYear()} DockSlot Inc. Multi-tenant Logistics Platform.
      </div>

      {/* User Registration Modal for Invitations */}
      <UserRegisterModal
        isOpen={isInviteModalOpen}
        token={effectiveInviteToken}
        onClose={handleInviteClose}
        onSuccess={handleInviteSuccess}
      />
    </div>
  );
};

export default AuthPage;
