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
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs } from '../components/ui/tabs';
import { authApi } from '../api/auth.api';
import { storage } from '../utils/storage';
import { useAuth } from '../hooks/useAuth';
import type {
  OrganizationType,
  User,
  LoginRequest,
  RegisterRequest,
} from '../types/user.types';

export type AuthTab = 'signin' | 'register';

export interface AuthPageProps {
  initialTab?: AuthTab;
  onSuccess?: (user: User, token: string) => void;
  onNavigate?: (route: 'carrier' | 'warehouse') => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({
  initialTab = 'signin',
  onSuccess,
  onNavigate,
}) => {
  const { login: setAuthContextUser } = useAuth();

  // Tab State: 'signin' | 'register'
  const [activeTab, setActiveTab] = useState<AuthTab>(initialTab);

  // Common UI State
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // Sign In Form State
  const [signInEmail, setSignInEmail] = useState<string>('');
  const [signInPassword, setSignInPassword] = useState<string>('');

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
    const isCarrier =
      user.role === 'CARRIER_ADMIN' ||
      user.role === 'DISPATCHER' ||
      user.organization?.type === 'CARRIER';

    const targetRoute = isCarrier ? 'carrier' : 'warehouse';

    if (onNavigate) {
      onNavigate(targetRoute);
    } else if (typeof window !== 'undefined') {
      window.location.href = isCarrier ? '/carrier' : '/warehouse';
    }
  };

  /**
   * Form Submission: Sign In
   */
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!signInEmail.trim() || !signInPassword) {
      setErrorMessage('Please provide both email address and password.');
      return;
    }

    try {
      setIsLoading(true);
      const payload: LoginRequest = {
        email: signInEmail.trim().toLowerCase(),
        password: signInPassword,
      };

      const response = await authApi.login(payload);

      const token = response.token || response.data?.token;
      const user = response.user || response.data?.user;

      if (!token || !user) {
        throw new Error('Authentication succeeded but received an incomplete server response.');
      }

      // Store JWT in HTTP cookies and localStorage
      storage.setToken(token);

      // Update global context
      setAuthContextUser(token, user);

      setSuccessMessage('Login successful! Redirecting to dashboard...');

      if (onSuccess) {
        onSuccess(user, token);
      }

      // Smooth redirection
      setTimeout(() => {
        handleDashboardRedirect(user);
      }, 500);
    } catch (err: any) {
      const serverMessage =
        err.response?.data?.message || err.message || 'Login failed. Please check your credentials.';
      setErrorMessage(serverMessage);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Form Submission: Register Org
   */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    if (!registerOrgName.trim()) {
      setErrorMessage('Organization Name is required.');
      return;
    }
    if (!registerEmail.trim()) {
      setErrorMessage('Email Address is required.');
      return;
    }
    if (!registerPassword || registerPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    try {
      setIsLoading(true);
      const payload: RegisterRequest = {
        organizationName: registerOrgName.trim(),
        orgName: registerOrgName.trim(),
        organizationType: registerOrgType,
        orgType: registerOrgType,
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
      };

      const response = await authApi.register(payload);

      const token = response.token || response.data?.token;
      const user = response.user || response.data?.user;

      if (!token || !user) {
        throw new Error('Registration completed but received an incomplete server response.');
      }

      // Store JWT in HTTP cookies and localStorage
      storage.setToken(token);

      // Update global context
      setAuthContextUser(token, user);

      setSuccessMessage('Organization registered successfully! Setting up your workspace...');

      if (onSuccess) {
        onSuccess(user, token);
      }

      // Smooth redirection
      setTimeout(() => {
        handleDashboardRedirect(user);
      }, 600);
    } catch (err: any) {
      const serverMessage =
        err.response?.data?.message ||
        err.message ||
        'Registration failed. Please check your details.';
      setErrorMessage(serverMessage);
    } finally {
      setIsLoading(false);
    }
  };

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
            {activeTab === 'signin'
              ? 'Sign In to Your Workspace'
              : 'Register New Organization'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {activeTab === 'signin'
              ? 'Access real-time dock availability and manage yard schedules'
              : 'Create a top-level admin account for your carrier fleet or warehouse facility'}
          </p>

          {/* Interactive Tab Switcher */}
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

          {/* Sign In View */}
          {activeTab === 'signin' && (
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
                  <a
                    href="#forgot"
                    onClick={(e) => {
                      e.preventDefault();
                      setErrorMessage('Password reset instructions can be requested via API.');
                    }}
                    className="text-xs text-[#2F4F4F] hover:underline font-medium"
                  >
                    Forgot password?
                  </a>
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
    </div>
  );
};

export default AuthPage;
