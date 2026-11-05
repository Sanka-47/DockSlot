import React, { useState, useEffect } from 'react';
import {
  Lock,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Warehouse,
  Eye,
  EyeOff,
  KeyRound,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { resetPasswordPageService } from '../services/resetPasswordPage.service';
import { getApiErrorMessage } from '../services/errors';

export interface ResetPasswordPageProps {
  token?: string;
  onSuccess?: () => void;
  onBackToSignIn?: () => void;
}

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({
  token: propToken,
  onSuccess,
  onBackToSignIn,
}) => {
  // Extract token from props or URL query parameter (?token=...)
  const [token, setToken] = useState<string>(propToken || '');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (!token) {
      const queryToken = resetPasswordPageService.getTokenFromUrl();
      if (queryToken) {
        setToken(queryToken);
      }
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const validationError = resetPasswordPageService.validateResetInput(
      token,
      newPassword,
      confirmPassword
    );
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsLoading(true);
      await resetPasswordPageService.resetPassword(token, newPassword);
      setIsSuccess(true);
      if (onSuccess) {
        onSuccess();
      }
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(
          err,
          'Failed to reset password. The reset link may be invalid or expired.'
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigateToSignIn = () => {
    if (onBackToSignIn) {
      onBackToSignIn();
    } else if (typeof window !== 'undefined') {
      window.location.href = '/login';
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
          Smart Warehouse Dock Scheduling & Carrier Logistics
        </p>
      </div>

      {/* Main Centered White Card */}
      <Card className="w-full max-w-md bg-white shadow-xl rounded-lg border border-gray-300 overflow-hidden">
        <CardHeader className="text-center pb-2">
          <div className="w-12 h-12 bg-slate-100 text-[#2F4F4F] rounded-full flex items-center justify-center mx-auto mb-2">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-[#2F4F4F]">
            {isSuccess ? 'Password Reset Complete' : 'Set New Password'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {isSuccess
              ? 'Your account credentials have been successfully updated'
              : 'Choose a strong, secure password for your DockSlot account'}
          </p>
        </CardHeader>

        <CardContent className="pt-4">
          {/* Missing Token Alert */}
          {!token && !isSuccess && (
            <div
              role="alert"
              className="mb-4 flex items-start space-x-3 p-3.5 bg-amber-50 border border-amber-200 rounded-md text-amber-900 text-xs"
            >
              <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <strong>No reset token detected.</strong> Please ensure you clicked the complete link from your email, or request a new password reset link below.
              </div>
            </div>
          )}

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

          {isSuccess ? (
            /* Success Confirmation Screen */
            <div className="space-y-5 text-center py-2 animate-in fade-in duration-200">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">
                  Password Updated Successfully!
                </p>
                <p className="text-xs text-gray-600 px-2 leading-relaxed">
                  Your new password is now active. You can proceed to sign in to your workspace with your updated credentials.
                </p>
              </div>

              <Button
                type="button"
                variant="primary"
                className="w-full mt-3"
                onClick={handleNavigateToSignIn}
              >
                <span>Sign In to Dashboard</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          ) : (
            /* Form View */
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Optional Token input field if token was not in URL */}
              {!propToken && !new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get('token') && (
                <div>
                  <Label htmlFor="reset-token" required>
                    Reset Token
                  </Label>
                  <Input
                    id="reset-token"
                    type="text"
                    required
                    placeholder="Paste reset token from email"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              )}

              <div>
                <Label htmlFor="new-password" required>
                  New Password (min. 6 characters)
                </Label>
                <Input
                  id="new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="Enter new password"
                  icon={<Lock className="w-4 h-4" />}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isLoading}
                  hasError={!!errorMessage}
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

              <div>
                <Label htmlFor="confirm-password" required>
                  Confirm New Password
                </Label>
                <Input
                  id="confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  placeholder="Re-enter new password"
                  icon={<Lock className="w-4 h-4" />}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isLoading}
                  hasError={!!errorMessage}
                  rightElement={
                    <button
                      type="button"
                      aria-label={
                        showConfirmPassword ? 'Hide password' : 'Show password'
                      }
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

              <Button
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                <span>Reset Password</span>
                {!isLoading && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleNavigateToSignIn}
                  disabled={isLoading}
                  className="inline-flex items-center text-xs font-semibold text-[#2F4F4F] hover:underline"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  <span>Back to Sign In</span>
                </button>
              </div>
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

export default ResetPasswordPage;
