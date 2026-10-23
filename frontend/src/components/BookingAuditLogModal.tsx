import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  History,
  Clock,
  User,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  FileText,
  RefreshCw,
  ArrowRight,
  Building2,
} from 'lucide-react';
import { Button } from './ui/button';
import { bookingAuditLogModalService } from '../services/bookingAuditLogModal.service';
import { getApiErrorMessage } from '../services/errors';
import type { Booking, BookingAuditLog } from '../types/booking.types';
import { formatDateTime } from '../utils/formatters';

interface BookingAuditLogModalProps {
  booking: Booking | null;
  isOpen: boolean;
  onClose: () => void;
}

export const BookingAuditLogModal: React.FC<BookingAuditLogModalProps> = ({
  booking,
  isOpen,
  onClose,
}) => {
  const [logs, setLogs] = useState<BookingAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    if (!booking) return;
    setIsLoading(true);
    setError(null);
    try {
      setLogs(await bookingAuditLogModalService.fetchAuditLogs(booking.id));
    } catch (err: unknown) {
      setError(
        getApiErrorMessage(
          err,
          'Failed to load audit history for this booking.'
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [booking]);

  useEffect(() => {
    if (isOpen && booking) {
      fetchAuditLogs();
    } else {
      setLogs([]);
      setError(null);
    }
  }, [isOpen, booking, fetchAuditLogs]);

  // Handle escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !booking) return null;

  // Determine action display label and badge styling
  const getActionDisplay = (log: BookingAuditLog) => {
    const upperAction = log.action?.toUpperCase();
    const actionType = log.actionType?.toUpperCase();

    if (upperAction === 'CREATED' || actionType === 'CREATED') {
      return {
        label: 'Created',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        border: 'border-emerald-200',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      };
    }

    if (upperAction === 'CANCELLED' || actionType === 'CANCELLED') {
      return {
        label: 'Cancelled',
        bg: 'bg-rose-50',
        text: 'text-rose-700',
        border: 'border-rose-200',
        icon: <XCircle className="w-4 h-4 text-rose-600" />,
      };
    }

    // Default to Modified (e.g. RESCHEDULED, UPDATED, STATUS_CHANGED)
    let specificLabel = 'Modified';
    if (upperAction === 'RESCHEDULED') specificLabel = 'Modified (Rescheduled)';
    else if (upperAction === 'STATUS_CHANGED') specificLabel = 'Modified (Status Change)';

    return {
      label: specificLabel,
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      icon: <RotateCcw className="w-4 h-4 text-blue-600" />,
    };
  };

  // Format actor role badge
  const getRoleBadge = (role?: string) => {
    switch (role) {
      case 'DISPATCHER':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            Carrier Dispatcher
          </span>
        );
      case 'CARRIER_ADMIN':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
            Carrier Admin
          </span>
        );
      case 'DOCK_MANAGER':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            Dock Manager
          </span>
        );
      case 'WAREHOUSE_ADMIN':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            Warehouse Admin
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            {role || 'User'}
          </span>
        );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-log-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
    >
      <div className="relative bg-white rounded-xl shadow-2xl max-w-2xl w-full border border-gray-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:px-6 sm:py-4 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-[#2F4F4F] text-white rounded-lg shadow-xs">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3
                  id="audit-log-title"
                  className="font-bold text-lg text-gray-900 leading-tight"
                >
                  Booking Audit Log
                </h3>
                <span className="font-mono text-xs font-bold px-2 py-0.5 bg-gray-200 text-gray-800 rounded">
                  #{booking.id}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Complete lifecycle history connecting warehouse operator and carrier.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Booking Overview Strip */}
        <div className="bg-gray-50 px-4 sm:px-6 py-2.5 border-b border-gray-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-gray-400 block text-[11px]">Facility & Dock</span>
            <span className="font-semibold text-gray-800 truncate block">
              {booking.dock?.name || `Dock #${booking.dockId}`}
              {booking.dock?.warehouse?.name ? ` (${booking.dock.warehouse.name})` : ''}
            </span>
          </div>

          <div>
            <span className="text-gray-400 block text-[11px]">Carrier</span>
            <span className="font-semibold text-gray-800 truncate block">
              {booking.carrierOrg?.name || 'Carrier Organization'}
            </span>
          </div>

          <div>
            <span className="text-gray-400 block text-[11px]">Truck / Driver</span>
            <span className="font-mono font-medium text-gray-800 truncate block">
              {booking.truckPlate || '—'}{' '}
              {booking.driverName ? `• ${booking.driverName}` : ''}
            </span>
          </div>

          <div>
            <span className="text-gray-400 block text-[11px]">Current Status</span>
            <span className="font-bold text-gray-900 block">
              {booking.status}
            </span>
          </div>
        </div>

        {/* Scrollable Timeline Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3 text-gray-500">
              <div className="w-8 h-8 border-3 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium">Loading lifecycle audit trail...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Unable to fetch audit log</p>
                <p className="text-xs text-red-700 mt-1">{error}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={fetchAuditLogs}
                  className="mt-3 text-xs border-red-300 text-red-800 hover:bg-red-100"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  Try Again
                </Button>
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-gray-500">
              <Clock className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-700">No audit log entries recorded</p>
              <p className="text-xs text-gray-400 mt-1">
                Lifecycle actions will appear here as the booking progresses.
              </p>
            </div>
          ) : (
            <div className="relative pl-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gray-200 space-y-6">
              {logs.map((log, index) => {
                const actionMeta = getActionDisplay(log);
                const actor = log.actor || (log.user as any);
                const actorName =
                  actor?.name ||
                  (actor?.email ? actor.email.split('@')[0] : `User #${log.userId}`);
                const actorRole = actor?.role || 'USER';
                const details = log.details || {};

                return (
                  <div key={log.id || index} className="relative group">
                    {/* Timeline bullet dot */}
                    <div className="absolute -left-[27px] top-1.5 w-6 h-6 rounded-full bg-white border-2 border-gray-300 flex items-center justify-center group-hover:border-[#2F4F4F] transition-colors shadow-xs">
                      <div className="w-2 h-2 rounded-full bg-[#2F4F4F]" />
                    </div>

                    {/* Log Card */}
                    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-xs transition-shadow space-y-3">
                      {/* Top Bar: Action Badge + Timestamp */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${actionMeta.bg} ${actionMeta.text} ${actionMeta.border}`}
                          >
                            {actionMeta.icon}
                            <span>{actionMeta.label}</span>
                          </span>

                          <span className="text-[11px] text-gray-400 font-mono">
                            Event #{log.id}
                          </span>
                        </div>

                        <div className="flex items-center text-xs text-gray-500 font-medium">
                          <Clock className="w-3.5 h-3.5 mr-1 text-gray-400" />
                          <span>{formatDateTime(log.createdAt, 'MMM dd, yyyy • h:mm a')}</span>
                        </div>
                      </div>

                      {/* Actor Information */}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700 bg-gray-50/70 rounded-md p-2 border border-gray-100">
                        <div className="flex items-center space-x-1.5 font-semibold text-gray-900">
                          <User className="w-3.5 h-3.5 text-gray-400" />
                          <span>{actorName}</span>
                        </div>

                        {getRoleBadge(actorRole)}

                        {actor?.email && (
                          <span className="text-[11px] text-gray-500 font-mono truncate">
                            ({actor.email})
                          </span>
                        )}

                        {actor?.organizationName && (
                          <span className="text-[11px] text-gray-500 flex items-center space-x-1 ml-auto">
                            <Building2 className="w-3 h-3 text-gray-400" />
                            <span>{actor.organizationName}</span>
                          </span>
                        )}
                      </div>

                      {/* Change Summary */}
                      {log.summary && (
                        <div className="text-xs text-gray-800 font-medium flex items-start space-x-1.5">
                          <FileText className="w-3.5 h-3.5 text-[#2F4F4F] mt-0.5 shrink-0" />
                          <span>{log.summary}</span>
                        </div>
                      )}

                      {/* Specific Action Breakdown Details */}
                      {details && (
                        <div className="text-[11px] text-gray-600 pt-1 space-y-1.5">
                          {/* Reschedule Details */}
                          {details.newSlotStartTime && (
                            <div className="p-2 rounded bg-amber-50/60 border border-amber-200/70 space-y-1">
                              {details.oldDockId && details.newDockId && details.oldDockId !== details.newDockId && (
                                <div className="flex items-center space-x-2">
                                  <span className="font-semibold text-gray-700">Dock Shift:</span>
                                  <span>Dock #{details.oldDockId}</span>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <span className="font-bold text-[#2F4F4F]">Dock #{details.newDockId}</span>
                                </div>
                              )}
                              {details.oldSlotStartTime && (
                                <div className="flex items-center space-x-2">
                                  <span className="font-semibold text-gray-700">Time Shift:</span>
                                  <span>{formatDateTime(details.oldSlotStartTime, 'MMM dd, h:mm a')}</span>
                                  <ArrowRight className="w-3 h-3 text-gray-400" />
                                  <span className="font-bold text-[#2F4F4F]">
                                    {formatDateTime(details.newSlotStartTime, 'MMM dd, h:mm a')}
                                  </span>
                                </div>
                              )}
                              {details.reason && (
                                <div className="text-amber-900 font-medium">
                                  <strong>Reason:</strong> {details.reason}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Cancellation Details */}
                          {log.action === 'CANCELLED' && details.reason && (
                            <div className="p-2 rounded bg-rose-50/60 border border-rose-200 text-rose-900">
                              <strong>Cancellation Reason:</strong> {details.reason}
                            </div>
                          )}

                          {/* Status Change Details */}
                          {details.newStatus && (
                            <div className="flex items-center space-x-2 font-mono">
                              <span className="font-semibold text-gray-600">Status:</span>
                              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                {details.oldStatus || 'INITIAL'}
                              </span>
                              <ArrowRight className="w-3 h-3 text-gray-400" />
                              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 font-bold">
                                {details.newStatus}
                              </span>
                            </div>
                          )}

                          {/* Initial Creation Details */}
                          {log.action === 'CREATED' && (
                            <div className="grid grid-cols-2 gap-2 text-gray-600 bg-gray-50/50 p-2 rounded border border-gray-100">
                              {details.truckPlate && (
                                <div>
                                  <span className="text-gray-400">Truck: </span>
                                  <span className="font-mono font-semibold">{details.truckPlate}</span>
                                </div>
                              )}
                              {details.driverName && (
                                <div>
                                  <span className="text-gray-400">Driver: </span>
                                  <span className="font-semibold">{details.driverName}</span>
                                </div>
                              )}
                              {details.slotStartTime && (
                                <div className="col-span-2">
                                  <span className="text-gray-400">Initial Slot: </span>
                                  <span className="font-medium">
                                    {formatDateTime(details.slotStartTime, 'MMM dd, yyyy h:mm a')} –{' '}
                                    {details.slotEndTime
                                      ? formatDateTime(details.slotEndTime, 'h:mm a')
                                      : ''}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <span className="text-xs text-gray-500 font-medium">
            {logs.length} audit {logs.length === 1 ? 'event' : 'events'} recorded
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="px-4">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BookingAuditLogModal;
