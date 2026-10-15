import React, { useState, useEffect, useMemo } from 'react';
import {
  Warehouse as WarehouseIcon,
  Truck,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  Calendar,
  CalendarX,
  Filter,
  Search,
  RefreshCw,
  PlusCircle,
  Wrench,
  ShieldAlert,
  Phone,
  User,
  FileText,
  X,
  ChevronDown,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { bookingApi } from '../api/booking.api';
import { warehouseApi } from '../api/warehouse.api';
import type { Booking, BookingStatus } from '../types/booking.types';
import type { Warehouse, Dock, DockClosure } from '../types/warehouse.types';
import { formatDateTime } from '../utils/formatters';

export const DockManagerDashboard: React.FC = () => {
  // State for Bookings & Warehouses
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [closures, setClosures] = useState<DockClosure[]>([]);

  // Loading & Error States
  const [isLoadingBookings, setIsLoadingBookings] = useState<boolean>(true);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState<boolean>(true);
  const [statusActionLoadingId, setStatusActionLoadingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL');

  // Modal State for Maintenance Closure
  const [isClosureModalOpen, setIsClosureModalOpen] = useState<boolean>(false);
  const [selectedDockForClosure, setSelectedDockForClosure] = useState<number | ''>('');
  const [selectedClosureDate, setSelectedClosureDate] = useState<string>('');
  const [closureStartTimeOnly, setClosureStartTimeOnly] = useState<string>('08:00');
  const [closureEndTimeOnly, setClosureEndTimeOnly] = useState<string>('18:00');
  const [closureStartTime, setClosureStartTime] = useState<string>('');
  const [closureEndTime, setClosureEndTime] = useState<string>('');
  const [closureReason, setClosureReason] = useState<string>('');
  const [closureError, setClosureError] = useState<string | null>(null);
  const [isSubmittingClosure, setIsSubmittingClosure] = useState<boolean>(false);

  // Fetch initial data
  const fetchData = async () => {
    setErrorMessage(null);
    try {
      setIsLoadingBookings(true);
      setIsLoadingWarehouses(true);

      const [bookingsRes, warehousesRes] = await Promise.all([
        bookingApi.getAll(),
        warehouseApi.getAll(),
      ]);

      const fetchedBookings = bookingsRes?.data || [];
      const fetchedWarehouses = warehousesRes?.data || [];

      setBookings(fetchedBookings);
      setWarehouses(fetchedWarehouses);

      // Fetch closures for all docks across warehouses
      const allDocks: Dock[] = [];
      fetchedWarehouses.forEach((wh) => {
        if (wh.docks) {
          wh.docks.forEach((d) => allDocks.push(d));
        }
      });

      if (allDocks.length > 0) {
        try {
          const closurePromises = allDocks.map((dock) =>
            warehouseApi.getDockClosures(dock.id).catch(() => ({ data: [] }))
          );
          const closureResults = await Promise.all(closurePromises);
          const aggregatedClosures: DockClosure[] = [];
          closureResults.forEach((res, index) => {
            if (res?.data) {
              const dockData = allDocks[index];
              res.data.forEach((c) => {
                aggregatedClosures.push({ ...c, dock: dockData });
              });
            }
          });
          setClosures(aggregatedClosures);
        } catch {
          // Non-critical if closures fail to load
        }
      }
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.message ||
          err.message ||
          'Failed to load dock manager dashboard data. Please try again.'
      );
    } finally {
      setIsLoadingBookings(false);
      setIsLoadingWarehouses(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Clear success banner after 5 seconds
  useEffect(() => {
    if (successBanner) {
      const timer = setTimeout(() => setSuccessBanner(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successBanner]);

  // Aggregate all docks from warehouses
  const allDocks = useMemo(() => {
    const list: (Dock & { warehouseName: string })[] = [];
    warehouses.forEach((wh) => {
      if (wh.docks) {
        wh.docks.forEach((d) => {
          list.push({ ...d, warehouseName: wh.name });
        });
      }
    });
    return list;
  }, [warehouses]);

  // Filtered Bookings
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      // Warehouse Filter
      if (selectedWarehouseId !== 'ALL') {
        const whId = b.dock?.warehouseId || b.dock?.warehouse?.id;
        if (whId !== undefined && whId !== Number(selectedWarehouseId)) {
          return false;
        }
      }

      // Status Filter
      if (selectedStatusFilter !== 'ALL' && b.status !== selectedStatusFilter) {
        return false;
      }

      // Search Query (ID, carrier, truck plate, driver name, driver phone, cargo note)
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchesId = b.id.toString().includes(query);
        const matchesCarrier = b.carrierOrg?.name?.toLowerCase().includes(query);
        const matchesTruck = b.truckPlate?.toLowerCase().includes(query);
        const matchesDriver = b.driverName?.toLowerCase().includes(query);
        const matchesPhone = b.driverPhone?.toLowerCase().includes(query);
        const matchesDock = b.dock?.name?.toLowerCase().includes(query);
        const matchesNote = b.cargoNote?.toLowerCase().includes(query);

        return (
          matchesId ||
          matchesCarrier ||
          matchesTruck ||
          matchesDriver ||
          matchesPhone ||
          matchesDock ||
          matchesNote
        );
      }

      return true;
    });
  }, [bookings, selectedWarehouseId, selectedStatusFilter, searchQuery]);

  // Handle Truck Status Update (Arrived / No-Show / Completed)
  const handleUpdateStatus = async (
    bookingId: number,
    newStatus: 'ARRIVED' | 'NO_SHOW' | 'COMPLETED'
  ) => {
    setErrorMessage(null);

    // Client-side validation: booking slotStartTime must have passed
    const targetBooking = bookings.find((b) => b.id === bookingId);
    if (targetBooking?.slotStartTime && new Date() < new Date(targetBooking.slotStartTime)) {
      setErrorMessage(
        `Cannot update status for booking #${bookingId} before its scheduled slot start time has passed.`
      );
      return;
    }

    setStatusActionLoadingId(bookingId);
    try {
      const res = await bookingApi.updateStatus(bookingId, newStatus);
      const updatedBooking = res.data;

      // Update local state smoothly
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status: updatedBooking.status } : b))
      );

      const statusLabels: Record<string, string> = {
        ARRIVED: 'Marked as Arrived',
        NO_SHOW: 'Marked as No-Show',
        COMPLETED: 'Marked as Completed',
      };

      setSuccessBanner(
        `Booking #${bookingId} successfully ${statusLabels[newStatus] || newStatus}.`
      );
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.message ||
          err.message ||
          `Failed to update status for booking #${bookingId}.`
      );
    } finally {
      setStatusActionLoadingId(null);
    }
  };

  // Map of date (YYYY-MM-DD) -> active bookings count on the selected dock bay
  const bookedDatesForSelectedDock = useMemo(() => {
    const datesMap = new Map<string, number>();
    const targetDockId = Number(selectedDockForClosure);
    if (!targetDockId) return datesMap;

    bookings.forEach((b) => {
      const bDockId = b.dockId ?? b.dock?.id;
      if (
        bDockId === targetDockId &&
        (b.status === 'BOOKED' || b.status === 'ARRIVED')
      ) {
        const d = new Date(b.slotStartTime);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
      }
    });

    return datesMap;
  }, [bookings, selectedDockForClosure]);

  // Generate next 14 calendar days starting from today for quick selection
  const upcomingDays = useMemo(() => {
    const days: {
      dateStr: string;
      dayOfWeekShort: string;
      dayOfMonth: number;
      monthShort: string;
    }[] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      days.push({
        dateStr,
        dayOfWeekShort: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayOfMonth: d.getDate(),
        monthShort: d.toLocaleDateString('en-US', { month: 'short' }),
      });
    }

    return days;
  }, []);

  const isSelectedDateBooked = useMemo(() => {
    if (!selectedClosureDate) return false;
    return bookedDatesForSelectedDock.has(selectedClosureDate);
  }, [selectedClosureDate, bookedDatesForSelectedDock]);

  const hasBookingConflict = useMemo(() => {
    if (isSelectedDateBooked) return true;
    if (!closureStartTime || !closureEndTime || !selectedDockForClosure) return false;

    const startDate = new Date(closureStartTime);
    const endDate = new Date(closureEndTime);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;

    const cur = new Date(startDate);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    while (cur <= end) {
      const yyyy = cur.getFullYear();
      const mm = String(cur.getMonth() + 1).padStart(2, '0');
      const dd = String(cur.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      if (bookedDatesForSelectedDock.has(dateStr)) {
        return true;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return false;
  }, [isSelectedDateBooked, closureStartTime, closureEndTime, selectedDockForClosure, bookedDatesForSelectedDock]);

  // Open Closure Modal (optionally preselecting a dock)
  const handleOpenClosureModal = (dockId?: number) => {
    setClosureError(null);
    const targetDockId = dockId !== undefined ? dockId : allDocks[0]?.id || '';
    setSelectedDockForClosure(targetDockId);

    // Compute booked dates for targetDockId
    const targetBookedDates = new Set<string>();
    bookings.forEach((b) => {
      const bDockId = b.dockId ?? b.dock?.id;
      if (
        bDockId === Number(targetDockId) &&
        (b.status === 'BOOKED' || b.status === 'ARRIVED')
      ) {
        const d = new Date(b.slotStartTime);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        targetBookedDates.add(`${yyyy}-${mm}-${dd}`);
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let chosenDate = '';
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      if (!targetBookedDates.has(dateStr)) {
        chosenDate = dateStr;
        break;
      }
    }
    if (!chosenDate) {
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      chosenDate = `${yyyy}-${mm}-${dd}`;
    }

    setSelectedClosureDate(chosenDate);
    setClosureStartTimeOnly('08:00');
    setClosureEndTimeOnly('18:00');
    setClosureStartTime(`${chosenDate}T08:00`);
    setClosureEndTime(`${chosenDate}T18:00`);
    setClosureReason('');
    setIsClosureModalOpen(true);
  };

  const handleSelectClosureDate = (dateStr: string) => {
    setSelectedClosureDate(dateStr);
    setClosureStartTime(`${dateStr}T${closureStartTimeOnly}`);
    setClosureEndTime(`${dateStr}T${closureEndTimeOnly}`);
    if (closureError) setClosureError(null);
  };

  const handleStartTimeChange = (timeStr: string) => {
    setClosureStartTimeOnly(timeStr);
    if (selectedClosureDate) {
      setClosureStartTime(`${selectedClosureDate}T${timeStr}`);
    }
  };

  const handleEndTimeChange = (timeStr: string) => {
    setClosureEndTimeOnly(timeStr);
    if (selectedClosureDate) {
      setClosureEndTime(`${selectedClosureDate}T${timeStr}`);
    }
  };

  // Submit Closure Modal
  const handleSubmitClosure = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosureError(null);

    if (!selectedDockForClosure) {
      setClosureError('Please select a dock to schedule maintenance.');
      return;
    }

    if (hasBookingConflict) {
      setClosureError(
        'Cannot schedule maintenance closure: an active booking exists on this dock for that day.'
      );
      return;
    }

    const trimmedReason = closureReason.trim();
    if (!trimmedReason) {
      setClosureError('Maintenance reason is required and cannot be blank.');
      return;
    }

    if (!closureStartTime || !closureEndTime) {
      setClosureError('Both start time and end time are required.');
      return;
    }

    const startDate = new Date(closureStartTime);
    const endDate = new Date(closureEndTime);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      setClosureError('Please enter valid start and end dates.');
      return;
    }

    // Client-side validation: start time cannot be in the past
    const now = new Date();
    if (startDate < now) {
      setClosureError(
        'Closure start time cannot be in the past. Please select a current or future time.'
      );
      return;
    }

    if (endDate <= startDate) {
      setClosureError('End time must be after the start time.');
      return;
    }

    try {
      setIsSubmittingClosure(true);

      const res = await warehouseApi.createDockClosure(Number(selectedDockForClosure), {
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        reason: trimmedReason,
      });

      const newClosure = res.data;
      const targetDock = allDocks.find((d) => d.id === Number(selectedDockForClosure));

      setClosures((prev) => [{ ...newClosure, dock: targetDock }, ...prev]);
      setSuccessBanner(
        `Maintenance closure scheduled successfully for Dock ${
          targetDock?.name || selectedDockForClosure
        }.`
      );
      setIsClosureModalOpen(false);

      // Refresh data in background
      fetchData();
    } catch (err: any) {
      const serverMessage =
        err.response?.data?.message ||
        err.message ||
        'Failed to schedule dock closure. Please check for scheduling conflicts.';
      setClosureError(serverMessage);
    } finally {
      setIsSubmittingClosure(false);
    }
  };

  // Helper for Status Badge styling
  const renderStatusBadge = (status: BookingStatus) => {
    switch (status) {
      case 'BOOKED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 mr-1" />
            BOOKED
          </span>
        );
      case 'ARRIVED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            ARRIVED
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            COMPLETED
          </span>
        );
      case 'NO_SHOW':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            NO-SHOW
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-300">
            <XCircle className="w-3 h-3 mr-1" />
            CANCELLED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-[#2F4F4F] text-white rounded-lg shadow-sm">
              <WarehouseIcon className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Dock Manager Dashboard
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Real-time yard check-ins, dock availability tracking, and maintenance closure management.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            isLoading={isLoadingBookings || isLoadingWarehouses}
            className="flex items-center space-x-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => handleOpenClosureModal()}
            className="flex items-center space-x-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Close Dock / Maintenance</span>
          </Button>
        </div>
      </div>

      {/* Global Alert Banners */}
      {errorMessage && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-start space-x-3 animate-in fade-in duration-200"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{errorMessage}</div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div
          role="status"
          className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-start space-x-3 animate-in fade-in duration-200"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{successBanner}</div>
          <button
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-400 hover:text-emerald-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Section 1: Dock Bay Operational Status Overview */}
      <Card className="bg-white shadow-sm border border-gray-200">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-bold text-gray-900 flex items-center space-x-2">
              <Wrench className="w-4 h-4 text-[#2F4F4F]" />
              <span>Dock Bays & Operational Status</span>
            </CardTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              Active loading bays and ongoing scheduled maintenance closures.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 rounded-md text-gray-700">
            {allDocks.length} {allDocks.length === 1 ? 'Bay' : 'Bays'} Total
          </span>
        </CardHeader>

        <CardContent>
          {isLoadingWarehouses ? (
            <div className="py-8 flex items-center justify-center space-x-2 text-gray-500 text-sm">
              <div className="w-5 h-5 border-2 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
              <span>Loading docks...</span>
            </div>
          ) : allDocks.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">
              No docks registered in your warehouse facilities.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
              {allDocks.map((dock) => {
                const now = new Date();
                const activeClosureNow = closures.find(
                  (c) =>
                    c.dockId === dock.id &&
                    new Date(c.startTime) <= now &&
                    new Date(c.endTime) >= now
                );
                const hasActiveClosureNow = !!activeClosureNow;
                const isUnderMaintenance =
                  (dock.effectiveStatus || dock.status) === 'MAINTENANCE' || hasActiveClosureNow;
                // Check if dock has active/upcoming closures
                const dockClosures = closures.filter((c) => c.dockId === dock.id);
                const hasUpcomingClosures = dockClosures.length > 0;

                return (
                  <div
                    key={dock.id}
                    className={`p-3.5 rounded-lg border transition-all ${
                      isUnderMaintenance
                        ? 'border-amber-300 bg-amber-50/50'
                        : 'border-gray-200 bg-white hover:border-gray-300 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-sm text-gray-900 truncate">
                        {dock.name}
                      </div>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1 ${
                          isUnderMaintenance
                            ? 'bg-amber-100 text-amber-800 border border-amber-200'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {isUnderMaintenance ? (
                          <>
                            {hasActiveClosureNow && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse inline-block mr-1"></span>
                            )}
                            <span>Maintenance</span>
                          </>
                        ) : (
                          'Active'
                        )}
                      </span>
                    </div>

                    <div className="text-xs text-gray-500 flex items-center space-x-1 truncate mb-3">
                      <WarehouseIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{dock.warehouseName}</span>
                    </div>

                    {hasUpcomingClosures && (
                      <div className="text-[11px] text-amber-900 bg-amber-100/70 p-1.5 rounded mb-2 flex items-start space-x-1">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-700 flex-shrink-0 mt-0.5" />
                        <span className="truncate">
                          {dockClosures.length} scheduled closure(s)
                        </span>
                      </div>
                    )}

                    <div className="pt-1 border-t border-gray-100 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => handleOpenClosureModal(dock.id)}
                        className="text-[11px] font-semibold text-[#2F4F4F] hover:underline inline-flex items-center"
                      >
                        <PlusCircle className="w-3 h-3 mr-1" />
                        <span>Schedule Closure</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Warehouse Bookings Table */}
      <Card className="bg-white shadow-sm border border-gray-200 overflow-hidden">
        <CardHeader className="pb-3 border-b border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-bold text-gray-900 flex items-center space-x-2">
                <Truck className="w-5 h-5 text-[#2F4F4F]" />
                <span>Warehouse Bookings & Yard Activity</span>
              </CardTitle>
              <p className="text-xs text-gray-500 mt-0.5">
                Incoming truck appointments, carrier dispatch manifests, and quick check-in actions.
              </p>
            </div>

            {/* Total Count Pill */}
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-500 font-medium">
                Showing{' '}
                <strong className="text-gray-900">{filteredBookings.length}</strong> of{' '}
                <strong className="text-gray-900">{bookings.length}</strong> bookings
              </span>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-4">
            {/* Search Bar */}
            <div className="sm:col-span-2">
              <Input
                type="text"
                placeholder="Search by ID, truck plate, driver, carrier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-4 h-4 text-gray-400" />}
              />
            </div>

            {/* Warehouse Filter */}
            <div>
              <div className="relative">
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 pl-3 pr-8 text-xs bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F] focus:border-[#2F4F4F]"
                >
                  <option value="ALL">All Warehouses</option>
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-3 pointer-events-none" />
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <div className="relative">
                <select
                  value={selectedStatusFilter}
                  onChange={(e) => setSelectedStatusFilter(e.target.value)}
                  className="w-full h-9 rounded-md border border-gray-300 pl-3 pr-8 text-xs bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F] focus:border-[#2F4F4F]"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="BOOKED">BOOKED (Incoming)</option>
                  <option value="ARRIVED">ARRIVED (In Yard)</option>
                  <option value="COMPLETED">COMPLETED</option>
                  <option value="NO_SHOW">NO_SHOW</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
                <Filter className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-3 pointer-events-none" />
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoadingBookings ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3 text-gray-500">
              <div className="w-8 h-8 border-4 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm font-medium">Loading warehouse bookings...</p>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="py-16 text-center text-gray-500">
              <Truck className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-sm font-semibold text-gray-700">No bookings found</p>
              <p className="text-xs text-gray-400 mt-1">
                {bookings.length === 0
                  ? 'No dock reservations have been created for this warehouse yet.'
                  : 'Try adjusting your search query or filters to find what you are looking for.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider">
                    <th className="py-3 px-4">Booking ID</th>
                    <th className="py-3 px-4">Carrier Name</th>
                    <th className="py-3 px-4">Dock Bay</th>
                    <th className="py-3 px-4">Scheduled Window</th>
                    <th className="py-3 px-4">Truck Plate</th>
                    <th className="py-3 px-4">Driver Details</th>
                    <th className="py-3 px-4">Cargo Note</th>
                    <th className="py-3 px-4">Current Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBookings.map((booking) => {
                    const isActionLoading = statusActionLoadingId === booking.id;
                    const isBooked = booking.status === 'BOOKED';
                    const isArrived = booking.status === 'ARRIVED';
                    const isSlotStarted = Boolean(
                      booking.slotStartTime && new Date() >= new Date(booking.slotStartTime)
                    );

                    return (
                      <tr
                        key={booking.id}
                        className="hover:bg-gray-50/70 transition-colors"
                      >
                        {/* 1. Booking ID */}
                        <td className="py-3.5 px-4 font-mono font-bold text-gray-900 whitespace-nowrap">
                          #{booking.id}
                        </td>

                        {/* 2. Carrier Name */}
                        <td className="py-3.5 px-4 font-medium text-gray-800 whitespace-nowrap">
                          <div className="flex items-center space-x-1.5">
                            <Truck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                            <span>{booking.carrierOrg?.name || 'Carrier'}</span>
                          </div>
                        </td>

                        {/* 3. Dock Bay */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-semibold text-gray-900">
                            {booking.dock?.name || `Dock #${booking.dockId}`}
                          </div>
                          {booking.dock?.warehouse?.name && (
                            <div className="text-[11px] text-gray-400 truncate">
                              {booking.dock.warehouse.name}
                            </div>
                          )}
                        </td>

                        {/* 4. Scheduled Time Window */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="flex items-center space-x-1 text-gray-800 font-medium">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            <span>
                              {formatDateTime(booking.slotStartTime, 'MMM dd, yyyy')}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 font-mono">
                            {formatDateTime(booking.slotStartTime, 'HH:mm')} –{' '}
                            {formatDateTime(booking.slotEndTime, 'HH:mm')}
                          </div>
                        </td>

                        {/* 5. Truck Plate */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {booking.truckPlate ? (
                            <span className="font-mono bg-gray-100 text-gray-800 px-2 py-0.5 rounded font-semibold text-[11px] border border-gray-200">
                              {booking.truckPlate}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* 6. Driver Details */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900 flex items-center space-x-1">
                            <User className="w-3 h-3 text-gray-400" />
                            <span>{booking.driverName || '—'}</span>
                          </div>
                          {booking.driverPhone && (
                            <div className="text-[11px] text-gray-500 flex items-center space-x-1 font-mono">
                              <Phone className="w-3 h-3 text-gray-400" />
                              <span>{booking.driverPhone}</span>
                            </div>
                          )}
                        </td>

                        {/* 7. Cargo Note */}
                        <td className="py-3.5 px-4 max-w-xs">
                          {booking.cargoNote ? (
                            <div
                              className="text-gray-600 truncate flex items-center space-x-1"
                              title={booking.cargoNote}
                            >
                              <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="truncate">{booking.cargoNote}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>

                        {/* 8. Current Status */}
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          {renderStatusBadge(booking.status)}
                        </td>

                        {/* 9. Actions */}
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          {isActionLoading ? (
                            <div className="inline-flex items-center space-x-1 text-gray-400 text-xs py-1">
                              <div className="w-3.5 h-3.5 border-2 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
                              <span>Updating...</span>
                            </div>
                          ) : isBooked ? (
                            /* Incoming Truck Actions: Mark Arrived or Mark No-Show */
                            <div className="inline-flex items-center space-x-1.5">
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => handleUpdateStatus(booking.id, 'ARRIVED')}
                                disabled={!isSlotStarted}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] px-2.5 py-1 h-7"
                                title={
                                  isSlotStarted
                                    ? 'Mark incoming truck as arrived at the facility yard'
                                    : 'Cannot mark as Arrived before the scheduled slot start time has passed'
                                }
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                <span>Arrived</span>
                              </Button>

                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdateStatus(booking.id, 'NO_SHOW')}
                                disabled={!isSlotStarted}
                                className="border-rose-200 text-rose-700 hover:bg-rose-50 text-[11px] px-2.5 py-1 h-7"
                                title={
                                  isSlotStarted
                                    ? 'Mark carrier appointment as a No-Show'
                                    : 'Cannot mark as No-Show before the scheduled slot start time has passed'
                                }
                              >
                                <XCircle className="w-3 h-3 mr-1" />
                                <span>No-Show</span>
                              </Button>
                            </div>
                          ) : isArrived ? (
                            /* In-Yard Truck Action: Mark Completed */
                            <div className="inline-flex items-center space-x-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUpdateStatus(booking.id, 'COMPLETED')}
                                className="border-purple-200 text-purple-700 hover:bg-purple-50 text-[11px] px-2.5 py-1 h-7"
                                title="Complete unloading/loading and clear dock bay"
                              >
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                <span>Complete</span>
                              </Button>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-xs italic">
                              No actions available
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Close Dock / Schedule Maintenance Modal */}
      {isClosureModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4"
        >
          <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full border border-gray-300 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center space-x-2">
                <div className="p-1.5 bg-[#2F4F4F] text-white rounded">
                  <Wrench className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-gray-900 leading-tight">
                    Schedule Dock Maintenance Closure
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Maintenance cannot be scheduled on days with existing bookings.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsClosureModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitClosure} className="p-5 space-y-4">
              {closureError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start space-x-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 font-medium">{closureError}</div>
                </div>
              )}

              {/* 1. Dock Selection */}
              <div>
                <Label htmlFor="closure-dock" required>
                  Dock Bay
                </Label>
                <select
                  id="closure-dock"
                  value={selectedDockForClosure}
                  onChange={(e) => {
                    const newDockId = Number(e.target.value);
                    setSelectedDockForClosure(newDockId);
                    setClosureError(null);
                  }}
                  required
                  disabled={isSubmittingClosure}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F] focus:border-[#2F4F4F]"
                >
                  {allDocks.map((dock) => {
                    const isMaint = (dock.effectiveStatus || dock.status) === 'MAINTENANCE';
                    return (
                      <option key={dock.id} value={dock.id}>
                        {dock.name} ({dock.warehouseName}) - Status: {isMaint ? 'Maintenance' : 'Active'}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  Select the loading dock to reserve for scheduled maintenance.
                </p>
              </div>

              {/* 2. Select Maintenance Date (Days with bookings are DISABLED) */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label required>Maintenance Date</Label>
                  <span className="text-[11px] text-amber-700 font-medium flex items-center">
                    <CalendarX className="w-3 h-3 mr-1" />
                    Days with bookings are disabled
                  </span>
                </div>

                {/* Quick 14-day selector grid */}
                <div className="grid grid-cols-7 gap-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg max-h-48 overflow-y-auto">
                  {upcomingDays.map((d) => {
                    const isBooked = bookedDatesForSelectedDock.has(d.dateStr);
                    const bookingCount = bookedDatesForSelectedDock.get(d.dateStr) || 0;
                    const isSelected = selectedClosureDate === d.dateStr;

                    return (
                      <button
                        key={d.dateStr}
                        type="button"
                        disabled={isBooked || isSubmittingClosure}
                        onClick={() => handleSelectClosureDate(d.dateStr)}
                        className={`p-1.5 rounded-md text-center flex flex-col items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-[#2F4F4F] text-white font-bold ring-2 ring-[#2F4F4F] shadow-sm'
                            : isBooked
                            ? 'bg-rose-50 text-rose-400 border border-rose-200 cursor-not-allowed opacity-70'
                            : 'bg-white text-gray-800 border border-gray-200 hover:border-[#2F4F4F] hover:bg-emerald-50/50'
                        }`}
                        title={
                          isBooked
                            ? `Disabled: ${bookingCount} active booking(s) exist on ${d.dateStr}. Maintenance cannot be scheduled on this day.`
                            : `Select ${d.dateStr}`
                        }
                      >
                        <span className="text-[10px] uppercase font-semibold">{d.dayOfWeekShort}</span>
                        <span className="text-xs font-bold my-0.5">{d.dayOfMonth}</span>
                        {isBooked ? (
                          <span className="text-[9px] font-semibold text-rose-600 bg-rose-100/90 px-1 rounded truncate max-w-full">
                            Booked
                          </span>
                        ) : isSelected ? (
                          <span className="text-[9px] font-semibold text-emerald-200">Selected</span>
                        ) : (
                          <span className="text-[9px] text-emerald-600 font-medium">Free</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Date Input for dates beyond 14 days */}
                <div className="flex items-center space-x-2 mt-2">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Or pick date:</span>
                  <input
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={selectedClosureDate}
                    onChange={(e) => handleSelectClosureDate(e.target.value)}
                    disabled={isSubmittingClosure}
                    className={`flex-1 text-xs px-2.5 py-1.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#2F4F4F] ${
                      isSelectedDateBooked
                        ? 'border-rose-400 bg-rose-50 text-rose-800'
                        : 'border-gray-300 bg-white'
                    }`}
                  />
                </div>

                {isSelectedDateBooked && (
                  <div className="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Day Blocked:</strong> Dock bay has{' '}
                      <strong>{bookedDatesForSelectedDock.get(selectedClosureDate)} active booking(s)</strong> scheduled on{' '}
                      {selectedClosureDate}. Maintenance cannot be scheduled on this day.
                    </span>
                  </div>
                )}
              </div>

              {/* 3. Maintenance Time Window */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="closure-start-time" required>
                    Start Time
                  </Label>
                  <input
                    id="closure-start-time"
                    type="time"
                    required
                    value={closureStartTimeOnly}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    disabled={isSubmittingClosure}
                    className="w-full text-xs px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
                  />
                </div>

                <div>
                  <Label htmlFor="closure-end-time" required>
                    End Time
                  </Label>
                  <input
                    id="closure-end-time"
                    type="time"
                    required
                    value={closureEndTimeOnly}
                    onChange={(e) => handleEndTimeChange(e.target.value)}
                    disabled={isSubmittingClosure}
                    className="w-full text-xs px-3 py-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
                  />
                </div>
              </div>

              {/* 4. Reason */}
              <div>
                <Label htmlFor="closure-reason" required>
                  Maintenance Reason / Note
                </Label>
                <Input
                  id="closure-reason"
                  type="text"
                  required
                  placeholder="e.g. Hydraulic lift sensor calibration or routine inspection"
                  value={closureReason}
                  onChange={(e) => setClosureReason(e.target.value)}
                  disabled={isSubmittingClosure}
                  hasError={Boolean(closureError && !closureReason.trim())}
                />
                {closureError && !closureReason.trim() && (
                  <p className="text-[11px] text-red-600 mt-1">
                    Please provide a valid maintenance reason.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                <div className="text-[11px] text-gray-500">
                  {hasBookingConflict ? (
                    <span className="text-rose-600 font-medium">⚠️ Selected day has bookings</span>
                  ) : (
                    <span>Ready to schedule</span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsClosureModalOpen(false)}
                    disabled={isSubmittingClosure}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={hasBookingConflict || isSubmittingClosure}
                    isLoading={isSubmittingClosure}
                    title={
                      hasBookingConflict
                        ? 'Cannot schedule maintenance: active bookings exist for this dock on this day.'
                        : 'Schedule Closure'
                    }
                  >
                    Schedule Closure
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DockManagerDashboard;
