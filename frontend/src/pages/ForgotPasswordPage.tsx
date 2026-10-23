import React, { useState } from 'react';
import {
  Mail,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Warehouse,
  Send,
  RotateCcw,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { forgotPasswordPageService } from '../services/forgotPasswordPage.service';
import { getApiErrorMessage } from '../services/errors';

export interface ForgotPasswordPageProps {
  onBackToSignIn?: () => void;
  onSuccess?: (email: string) => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  onBackToSignIn,
  onSuccess,
}) => {
  const [email, setEmail] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [submittedEmail, setSubmittedEmail] = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = forgotPasswordPageService.normalizeEmail(email);
    const validationError = forgotPasswordPageService.validateEmail(trimmedEmail);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    try {
      setIsLoading(true);
      await forgotPasswordPageService.requestPasswordReset(trimmedEmail);
      setSubmittedEmail(trimmedEmail);
      setIsSubmitted(true);
      if (onSuccess) {
        onSuccess(trimmedEmail);
      }
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(
          err,
          'An error occurred while sending password reset link.'
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetForm = () => {
    setIsSubmitted(false);
    setEmail('');
    setErrorMessage(null);
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
          <h1 className="text-xl font-bold text-[#2F4F4F]">
            {isSubmitted ? 'Check Your Inbox' : 'Reset Your Password'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {isSubmitted
              ? 'Password reset instructions have been dispatched'
              : "Enter your registered email address and we'll send you a link to reset your password"}
          </p>
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

          {isSubmitted ? (
            /* Success Confirmation View */
            <div className="space-y-5 text-center py-2 animate-in fade-in duration-200">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">
                  Instructions Sent!
                </p>
                <p className="text-xs text-gray-600 leading-relaxed px-4">
                  If an account exists for{' '}
                  <strong className="text-gray-900">{submittedEmail}</strong>,
                  you will receive an email shortly with a secure password reset link.
                </p>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-800 text-xs text-left">
                <strong>Important:</strong> The password reset link expires in 1 hour. Be sure to check your spam or junk folder if you don't see it within a few minutes.
              </div>

              <div className="space-y-2 pt-2">
                {onBackToSignIn ? (
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={onBackToSignIn}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    <span>Return to Sign In</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      if (typeof window !== 'undefined') {
                        window.location.href = '/login';
                      }
                    }}
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    <span>Return to Sign In</span>
                  </Button>
                )}

                <button
                  type="button"
                  onClick={handleResetForm}
                  className="inline-flex items-center text-xs text-gray-600 hover:text-gray-900 font-medium py-1.5 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                  <span>Send to a different email address</span>
                </button>
              </div>
            </div>
          ) : (
            /* Form View */
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="forgot-email" required>
                  Email Address
                </Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="name@company.com"
                  icon={<Mail className="w-4 h-4" />}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  hasError={!!errorMessage}
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isLoading}
              >
                <span>Send Reset Link</span>
                {!isLoading && <Send className="w-4 h-4 ml-2" />}
              </Button>

              <div className="pt-2 text-center">
                {onBackToSignIn ? (
                  <button
                    type="button"
                    onClick={onBackToSignIn}
                    disabled={isLoading}
                    className="inline-flex items-center text-xs font-semibold text-[#2F4F4F] hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    <span>Back to Sign In</span>
                  </button>
                ) : (
                  <a
                    href="/login"
                    className="inline-flex items-center text-xs font-semibold text-[#2F4F4F] hover:underline"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                    <span>Back to Sign In</span>
                  </a>
                )}
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

export default ForgotPasswordPage;
