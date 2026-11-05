import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldOff,
  Smartphone,
  KeyRound,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Loader2,
  QrCode,
  Lock,
} from 'lucide-react';
import { twoFactorSettingsService } from '../services/twoFactorSettings.service';
import { getApiErrorMessage } from '../services/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { TwoFactorStatus } from '../types/user.types';

export interface TwoFactorSettingsProps {
  /** Called after 2FA is enabled or disabled so parent views can refresh user state. */
  onStatusChange?: (isTwoFactorEnabled: boolean) => void;
  className?: string;
}

type SetupStep = 'idle' | 'scan' | 'verify';

/**
 * Account-settings panel for optional TOTP two-factor authentication.
 *
 * Flow when enabling: request a secret + QR code, scan it with any authenticator
 * app (Google Authenticator, Authy, 1Password...), then confirm one generated
 * 6-digit code to prove the secret was stored correctly.
 */
export const TwoFactorSettings: React.FC<TwoFactorSettingsProps> = ({
  onStatusChange,
  className = '',
}) => {
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [setupStep, setSetupStep] = useState<SetupStep>('idle');

  // Generated secret + QR payload, only held while the user is enabling 2FA
  const [secret, setSecret] = useState<string>('');
  const [qrCode, setQrCode] = useState<string>('');
  const [otpauthUrl, setOtpauthUrl] = useState<string>('');
  const [hasCopiedSecret, setHasCopiedSecret] = useState<boolean>(false);

  // Code entry
  const [verifyCode, setVerifyCode] = useState<string>('');

  // Disable flow (proof of possession: password or a live 6-digit code)
  const [showDisableForm, setShowDisableForm] = useState<boolean>(false);
  const [disablePassword, setDisablePassword] = useState<string>('');
  const [disableCode, setDisableCode] = useState<string>('');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const nextStatus = await twoFactorSettingsService.fetchStatus();
      setStatus(nextStatus);
    } catch (err: unknown) {
      setErrorMessage(getApiErrorMessage(err, 'Failed to load 2FA status.'));
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const resetFlow = () => {
    setSetupStep('idle');
    setSecret('');
    setQrCode('');
    setOtpauthUrl('');
    setVerifyCode('');
    setHasCopiedSecret(false);
    setShowDisableForm(false);
    setDisablePassword('');
    setDisableCode('');
  };

  const clearMessages = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleStartSetup = async () => {
    clearMessages();
    setIsSubmitting(true);
    try {
      const payload = await twoFactorSettingsService.startSetup();

      setSecret(payload.secret);
      setQrCode(payload.qrCode);
      setOtpauthUrl(payload.otpauthUrl);
      setVerifyCode('');
      setSetupStep('scan');
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(err, 'Failed to start 2FA setup.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyAndEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const validationError =
      twoFactorSettingsService.validateVerificationCode(verifyCode);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await twoFactorSettingsService.verifyAndEnable(verifyCode);
      setSuccessMessage(result.message);
      onStatusChange?.(true);
      resetFlow();
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(err, 'That code was not accepted. Please try again.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();

    const validationError = twoFactorSettingsService.validateDisableInput(
      disablePassword,
      disableCode
    );
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await twoFactorSettingsService.disable({
        password: disablePassword,
        token: disableCode,
      });
      setSuccessMessage(result.message);
      onStatusChange?.(false);
      resetFlow();
      await fetchStatus();
    } catch (err: unknown) {
      setErrorMessage(
        getApiErrorMessage(err, 'Failed to disable 2FA. Please try again.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setHasCopiedSecret(true);
      setTimeout(() => setHasCopiedSecret(false), 2000);
    } catch {
      setErrorMessage('Could not copy automatically — please select and copy the code manually.');
    }
  };

  const isEnabled = status?.isTwoFactorEnabled === true;
  const isLocked = isSubmitting || isLoadingStatus;

  return (
    <div
      className={`bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-start space-x-3 min-w-0">
          <div
            className={`p-2 rounded-md shrink-0 ${
              isEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {isEnabled ? <ShieldCheck className="w-5 h-5" /> : <ShieldOff className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-[#2F4F4F]">
              Two-Factor Authentication (2FA)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">
              Add a one-time code from an authenticator app on top of your password.
            </p>
          </div>
        </div>

        {!isLoadingStatus && (
          <span
            className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              isEnabled
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-100 text-gray-600 border-gray-200'
            }`}
          >
            {isEnabled ? 'Enabled' : 'Disabled'}
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {/* Status loading */}
        {isLoadingStatus && (
          <div className="flex items-center space-x-2 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking your security settings...</span>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start space-x-2.5 p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-xs"
          >
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <span className="flex-1 font-medium leading-tight">{errorMessage}</span>
          </div>
        )}

        {/* Success Banner */}
        {successMessage && (
          <div
            role="status"
            className="flex items-start space-x-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-800 text-xs"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <span className="flex-1 font-medium leading-tight">{successMessage}</span>
          </div>
        )}

        {/* -------------------- Enabled state -------------------- */}
        {!isLoadingStatus && isEnabled && setupStep === 'idle' && (
          <div className="space-y-3">
            {!showDisableForm ? (
              <>
                <div className="flex items-start space-x-2.5 p-3 bg-emerald-50/60 border border-emerald-100 rounded-md">
                  <Lock className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-900 leading-snug">
                    Your account is protected. Signing in requires your password plus a rotating
                    6-digit code from your authenticator app.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    clearMessages();
                    setShowDisableForm(true);
                  }}
                  disabled={isLocked}
                >
                  <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                  Disable 2FA
                </Button>
              </>
            ) : (
              <form onSubmit={handleDisable} className="space-y-3" noValidate>
                <p className="text-xs text-gray-600 leading-snug">
                  For security, confirm it&apos;s you by entering your current password or a live
                  6-digit code from your authenticator app.
                </p>

                <div>
                  <Label htmlFor="disable-2fa-password">Current Password</Label>
                  <Input
                    id="disable-2fa-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your account password"
                    icon={<Lock className="w-4 h-4" />}
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex items-center space-x-3">
                  <div className="flex-1 border-t border-gray-200" />
                  <span className="text-[11px] font-medium text-gray-400 uppercase">or</span>
                  <div className="flex-1 border-t border-gray-200" />
                </div>

                <div>
                  <Label htmlFor="disable-2fa-code">6-Digit Authenticator Code</Label>
                  <Input
                    id="disable-2fa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    icon={<KeyRound className="w-4 h-4" />}
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={isSubmitting}
                    className="tracking-[0.3em] font-mono"
                  />
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                    Confirm & Disable
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetFlow}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* -------------------- Disabled, idle -------------------- */}
        {!isLoadingStatus && !isEnabled && setupStep === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 leading-snug">
              2FA is currently off. Enable it to require a time-based one-time password whenever
              you sign in.
            </p>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleStartSetup}
              isLoading={isSubmitting}
            >
              <Smartphone className="w-3.5 h-3.5 mr-1.5" />
              Enable 2FA
            </Button>
          </div>
        )}

        {/* -------------------- Step 1: scan QR -------------------- */}
        {setupStep === 'scan' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <QrCode className="w-4 h-4 text-[#2F4F4F]" />
              <h4 className="text-xs font-bold text-[#2F4F4F] uppercase tracking-wide">
                Step 1 of 2 — Scan this QR code
              </h4>
            </div>

            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
              <div className="p-3 bg-white border border-gray-200 rounded-md shrink-0">
                <img
                  src={qrCode}
                  alt="Two-factor authentication QR code"
                  width={168}
                  height={168}
                  className="w-[168px] h-[168px] block"
                />
              </div>

              <div className="flex-1 w-full space-y-2.5">
                <p className="text-xs text-gray-600 leading-snug">
                  Open <strong>Google Authenticator</strong> (or any TOTP app), tap{' '}
                  <em>Add account → Scan QR code</em>, and point it at this image. Scanning is only
                  required once unless you add a new device.
                </p>

                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase mb-1">
                    Or enter this key manually
                  </p>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 text-[11px] font-mono bg-gray-50 border border-gray-200 rounded px-2.5 py-2 break-all text-gray-800">
                      {secret}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      aria-label="Copy secret key"
                      className="p-2 rounded-md border border-gray-200 text-gray-500 hover:text-[#2F4F4F] hover:bg-gray-50 transition-colors shrink-0"
                    >
                      {hasCopiedSecret ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {otpauthUrl && (
                  <details className="text-[11px] text-gray-500">
                    <summary className="cursor-pointer font-medium hover:text-[#2F4F4F]">
                      Show otpauth:// provisioning URI
                    </summary>
                    <code className="block mt-1.5 font-mono break-all bg-gray-50 border border-gray-200 rounded px-2.5 py-2 text-gray-700">
                      {otpauthUrl}
                    </code>
                  </details>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  clearMessages();
                  setSetupStep('verify');
                }}
              >
                I&apos;ve scanned it — Continue
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetFlow();
                  clearMessages();
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* -------------------- Step 2: confirm code -------------------- */}
        {setupStep === 'verify' && (
          <form onSubmit={handleVerifyAndEnable} className="space-y-4" noValidate>
            <div className="flex items-center space-x-2">
              <KeyRound className="w-4 h-4 text-[#2F4F4F]" />
              <h4 className="text-xs font-bold text-[#2F4F4F] uppercase tracking-wide">
                Step 2 of 2 — Confirm your code
              </h4>
            </div>

            <p className="text-xs text-gray-600 leading-snug">
              Enter the 6-digit code currently shown for <strong>DockSlot</strong> in your
              authenticator app. This proves the secret was set up correctly.
            </p>

            <div className="max-w-[220px]">
              <Label htmlFor="verify-2fa-code" required>
                6-Digit Code
              </Label>
              <Input
                id="verify-2fa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                placeholder="123456"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isSubmitting}
                className="tracking-[0.4em] font-mono text-base"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                Verify & Enable
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearMessages();
                  setSetupStep('scan');
                }}
                disabled={isSubmitting}
              >
                Back to QR code
              </Button>
            </div>
          </form>
        )}

        {/* Setup hint for orphaned secrets */}
        {!isLoadingStatus && !isEnabled && status?.isSetupPending && setupStep === 'idle' && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-2 leading-snug">
            A previous setup was started but never confirmed. Enabling 2FA again generates a fresh
            secret and invalidates the old QR code.
          </p>
        )}
      </div>
    </div>
  );
};

export default TwoFactorSettings;
