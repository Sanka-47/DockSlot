import React, { useState, useEffect } from 'react';
import {
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  X,
  ArrowRight,
  UserCheck,
  Building,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authApi } from '../api/auth.api';

export interface UserRegisterModalProps {
  isOpen: boolean;
  token?: string;
  onClose: () => void;
  onSuccess: (registeredEmail?: string, message?: string) => void;
}

export const UserRegisterModal: React.FC<UserRegisterModalProps> = ({
  isOpen,
  token: propToken,
  onClose,
  onSuccess,
}) => {
  // Extract token from props or URL (?token=...)
  const [token, setToken] = useState<string>(propToken || '');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  // Invitation info
  const [invitationInfo, setInvitationInfo] = useState<{
    email: string;
    role: string;
    organizationName?: string;
  } | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isVerifyingToken, setIsVerifyingToken] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync token from URL or props
  useEffect(() => {
    let activeToken = propToken || '';
    if (!activeToken && typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      activeToken = searchParams.get('token') || '';
    }
    setToken(activeToken);

    if (isOpen && activeToken) {
      // Fetch invitation details to present context to user
      setIsVerifyingToken(true);
      setErrorMessage(null);
      authApi
        .getInvitationDetails(activeToken)
        .then((res) => {
          if (res?.data) {
            setInvitationInfo(res.data);
          }
        })
        .catch((err) => {
          const msg =
            err.response?.data?.message ||
            err.message ||
            'The invitation token is invalid or has expired.';
          setErrorMessage(msg);
        })
        .finally(() => {
          setIsVerifyingToken(false);
        });
    } else {
      setInvitationInfo(null);
    }

    if (isOpen) {
      setPassword('');
      setConfirmPassword('');
      setSuccessMessage(null);
    }
  }, [isOpen, propToken]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const activeToken =
      token.trim() ||
      (typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('token') || ''
        : '');

    if (!activeToken) {
      setErrorMessage(
        'Missing invitation token. Please ensure you clicked the full link from your invitation email.'
      );
      return;
    }

    if (!password) {
      setErrorMessage('Please enter a password.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify both fields.');
      return;
    }

    try {
      setIsLoading(true);
      const res = await authApi.acceptInvite(activeToken, password);

      const msg =
        res.message || 'Account registered successfully! Redirecting to sign in...';
      setSuccessMessage(msg);

      // Brief delay to display the success confirmation, then redirect
      setTimeout(() => {
        onSuccess(
          invitationInfo?.email || res.user?.email,
          'Account created successfully! Please sign in with your password.'
        );
      }, 700);
    } catch (err: any) {
      const serverMessage =
        err.response?.data?.message ||
        err.message ||
        'Failed to complete registration. The invitation link may be invalid or expired.';
      setErrorMessage(serverMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 bg-white/10 rounded-md">
              <UserCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight">Complete User Registration</h2>
              <p className="text-xs text-gray-300">Set your password to activate your account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Close and return to Sign In"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Organization & Role Badge (if fetched) */}
          {invitationInfo && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
              <div className="flex items-center space-x-1.5 text-gray-700 font-semibold">
                <Building className="w-3.5 h-3.5 text-[#2F4F4F]" />
                <span>{invitationInfo.organizationName || 'DockSlot Workspace'}</span>
              </div>
              <p className="text-gray-600">
                Registering account for <strong className="text-gray-900">{invitationInfo.email}</strong> as{' '}
                <span className="inline-block px-1.5 py-0.5 bg-[#2F4F4F]/10 text-[#2F4F4F] rounded font-medium">
                  {invitationInfo.role}
                </span>
              </p>
            </div>
          )}

          {/* Missing Token Alert */}
          {!token && (
            <div
              role="alert"
              className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs flex items-start space-x-2"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong>No invitation token found.</strong> Please make sure you accessed this page from the link in your invitation email.
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-start space-x-2 animate-in fade-in duration-150"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="flex-1 font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div
              role="status"
              className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-xs flex items-center space-x-2 animate-in fade-in duration-150"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="flex-1 font-medium">{successMessage}</span>
            </div>
          )}

          {/* Registration Form with Two Fields: Enter Password and Re-enter Password */}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {/* Field 1: Enter Password */}
            <div>
              <Label htmlFor="register-password-field" required>
                Enter Password
              </Label>
              <Input
                id="register-password-field"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                placeholder="Enter password"
                icon={<Lock className="w-4 h-4" />}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading || isVerifyingToken}
                rightElement={
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />
              <span className="text-[11px] text-gray-500 mt-0.5 block">
                Must be at least 6 characters long
              </span>
            </div>

            {/* Field 2: Re-enter Password */}
            <div>
              <Label htmlFor="register-confirm-password-field" required>
                Re-enter Password
              </Label>
              <Input
                id="register-confirm-password-field"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                placeholder="Re-enter password"
                icon={<Lock className="w-4 h-4" />}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading || isVerifyingToken}
                rightElement={
                  <button
                    type="button"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                }
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-gray-100">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading || isVerifyingToken}
              >
                <span>Register Account</span>
                {!isLoading && !isVerifyingToken && (
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default UserRegisterModal;
