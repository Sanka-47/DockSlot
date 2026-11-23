import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { paymentApi } from '../api/payment.api';
import { getApiErrorMessage } from '../services/errors';
import { formatMoney } from '../utils/money';
import type { PaymentStatusResponse } from '../types/booking.types';
import { Button } from '../components/ui/button';

type Phase = 'loading' | 'paid' | 'pending' | 'cancelled' | 'error';

const MAX_POLLS = 10;
const POLL_INTERVAL_MS = 2000;

/**
 * Stripe-hosted Checkout returns the browser here with ?checkout=success and
 * the Checkout Session id. This page polls the tenant-scoped API so it works
 * even when the webhook is delayed; it never trusts the redirect alone.
 */
export const CheckoutReturnPage: React.FC = () => {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const checkout = params.get('checkout');
  const sessionId = params.get('session_id');
  const bookingId = params.get('booking_id');

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState<string>('');
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null);
  const timerRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (checkout === 'cancelled') {
      setPhase('cancelled');
      setMessage(
        bookingId
          ? `Payment for booking #${bookingId} was cancelled. The slot is held until the payment window expires.`
          : 'Payment was cancelled. The slot is held until the payment window expires.',
      );
      return;
    }

    if (!sessionId) {
      setPhase('error');
      setMessage(
        'Missing Stripe Checkout Session ID. Return to your dashboard to view the booking.',
      );
      return;
    }

    let disposed = false;
    const controller = new AbortController();

    const poll = async () => {
      attemptsRef.current += 1;
      try {
        const response = await paymentApi.getSessionStatus(sessionId, controller.signal);
        if (disposed) return;
        setStatus(response.data);

        if (response.data.bookingStatus === 'BOOKED') {
          setPhase('paid');
          return;
        }
        if (response.data.bookingStatus === 'CANCELLED') {
          setPhase('error');
          setMessage('This booking was cancelled because payment was not completed in time.');
          return;
        }
        if (attemptsRef.current >= MAX_POLLS) {
          setPhase('pending');
          setMessage(
            'Payment is still being confirmed. Stripe may take a moment; refresh this page shortly.',
          );
          return;
        }
        timerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (error: unknown) {
        if (disposed) return;
        if (attemptsRef.current >= 5) {
          setPhase('error');
          setMessage(getApiErrorMessage(error, 'Could not verify the payment status.'));
          return;
        }
        timerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    void poll();

    return () => {
      disposed = true;
      controller.abort();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [bookingId, checkout, sessionId]);

  const goToDashboard = () => window.location.assign('/');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6 sm:p-8 text-center space-y-5">
        {phase === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-[#2F4F4F] mx-auto animate-spin" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Confirming your payment</h1>
              <p className="text-sm text-gray-500 mt-1">
                Please wait while we verify the Stripe Checkout Session.
              </p>
            </div>
          </>
        )}

        {phase === 'paid' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Payment successful</h1>
              <p className="text-sm text-gray-500 mt-1">
                Booking #{status?.bookingId ?? bookingId} is confirmed.
              </p>
              {status?.payment && (
                <p className="text-sm font-semibold text-emerald-700 mt-2">
                  {formatMoney(status.payment.amountCents, status.payment.currency)} paid
                </p>
              )}
            </div>
          </>
        )}

        {phase === 'pending' && (
          <>
            <Clock className="w-12 h-12 text-amber-500 mx-auto" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Payment received</h1>
              <p className="text-sm text-gray-500 mt-1">{message}</p>
            </div>
          </>
        )}

        {phase === 'cancelled' && (
          <>
            <XCircle className="w-12 h-12 text-amber-500 mx-auto" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Checkout cancelled</h1>
              <p className="text-sm text-gray-500 mt-1">{message}</p>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" aria-hidden="true" />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Payment not confirmed</h1>
              <p className="text-sm text-gray-500 mt-1">{message}</p>
            </div>
          </>
        )}

        <div className="pt-2 flex flex-col gap-2">
          {phase === 'pending' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                attemptsRef.current = 0;
                setPhase('loading');
                setMessage('');
                if (sessionId) {
                  window.location.reload();
                }
              }}
              className="w-full min-h-[42px]"
            >
              Refresh status
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={goToDashboard}
            className="w-full min-h-[42px] flex items-center justify-center space-x-1"
          >
            <span>Back to dashboard</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CheckoutReturnPage;
