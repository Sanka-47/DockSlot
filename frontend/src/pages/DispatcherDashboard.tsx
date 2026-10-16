import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar,
  Clock,
  Truck,
  User,
  Phone,
  FileText,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  XCircle,
  X,
  Building,
  ArrowRight,
  CalendarCheck,
  CalendarX,
  Check,
  RotateCcw,
  Globe,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { warehouseApi } from "../api/warehouse.api";
import { bookingApi } from "../api/booking.api";
import type {
  Warehouse,
  Dock,
  AvailableDockSlots,
  AvailableSlot,
} from "../types/warehouse.types";
import type {
  Booking,
  BookingStatus,
  CreateBookingRequest,
} from "../types/booking.types";
import { formatDateTime } from "../utils/formatters";

interface SelectedSlotInfo {
  warehouseId: number;
  warehouseName: string;
  dockId: number;
  dockName: string;
  slotStartTime: string;
  slotEndTime: string;
  localStartTime?: string;
  localEndTime?: string;
}

export const DispatcherDashboard: React.FC = () => {
  // ---------------------------------------------------------------------------
  // Global Data States
  // ---------------------------------------------------------------------------
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Loading States
  const [isLoadingInitial, setIsLoadingInitial] = useState<boolean>(true);
  const [isLoadingBookings, setIsLoadingBookings] = useState<boolean>(false);
  const [isSearchingSlots, setIsSearchingSlots] = useState<boolean>(false);
  const [isSubmittingBooking, setIsSubmittingBooking] =
    useState<boolean>(false);

  // Global Feedback Banners
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Slot Search & Filter Form State
  // ---------------------------------------------------------------------------
  const getTodayDateString = (): string => {
    const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  const getMaxAdvanceDateString = (days: number = 14): string => {
    const future = new Date(
      Date.now() +
        days * 24 * 60 * 60 * 1000 -
        new Date().getTimezoneOffset() * 60000,
    );
    return future.toISOString().slice(0, 10);
  };

  const isInsideLockWindow = (booking: Booking | null): boolean => {
    if (!booking || !booking.slotStartTime) return false;
    const slotTime = new Date(booking.slotStartTime).getTime();
    const hoursUntil = (slotTime - Date.now()) / (1000 * 60 * 60);
    const lockHours =
      booking.dock?.warehouse?.policy?.bookingLockWindowHours ?? 24;
    return hoursUntil >= 0 && hoursUntil < lockHours;
  };

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>(getTodayDateString());
  const [selectedDockId, setSelectedDockId] = useState<string>("ALL");

  // Available Slots State
  const [searchedSlots, setSearchedSlots] = useState<
    AvailableDockSlots[] | null
  >(null);
  const [hasSearchedSlots, setHasSearchedSlots] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Booking Creation Modal State
  // ---------------------------------------------------------------------------
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [selectedSlotForBooking, setSelectedSlotForBooking] =
    useState<SelectedSlotInfo | null>(null);
  const [bookingFormData, setBookingFormData] = useState<{
    truckPlate: string;
    driverName: string;
    driverPhone: string;
    cargoNote: string;
  }>({
    truckPlate: "",
    driverName: "",
    driverPhone: "",
    cargoNote: "",
  });
  const [bookingModalError, setBookingModalError] = useState<string | null>(
    null,
  );

  // ---------------------------------------------------------------------------
  // Reschedule Modal State
  // ---------------------------------------------------------------------------
  const [isRescheduleModalOpen, setIsRescheduleModalOpen] =
    useState<boolean>(false);
  const [bookingToReschedule, setBookingToReschedule] =
    useState<Booking | null>(null);
  const [rescheduleDate, setRescheduleDate] =
    useState<string>(getTodayDateString());
  const [rescheduleSlots, setRescheduleSlots] = useState<
    AvailableDockSlots[] | null
  >(null);
  const [isLoadingRescheduleSlots, setIsLoadingRescheduleSlots] =
    useState<boolean>(false);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<{
    dockId: number;
    dockName: string;
    slotStartTime: string;
    slotEndTime: string;
  } | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState<string>("");
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [isSubmittingReschedule, setIsSubmittingReschedule] =
    useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Cancel Modal State
  // ---------------------------------------------------------------------------
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isSubmittingCancel, setIsSubmittingCancel] = useState<boolean>(false);

  // ---------------------------------------------------------------------------
  // Bookings Table Filters & Search
  // ---------------------------------------------------------------------------
  const [bookingSearchQuery, setBookingSearchQuery] = useState<string>("");
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>("ALL");

  // ---------------------------------------------------------------------------
  // Fetch Initial Data (Warehouses and Carrier Bookings)
  // ---------------------------------------------------------------------------
  const fetchBookings = useCallback(async () => {
    setIsLoadingBookings(true);
    try {
      const res = await bookingApi.getAll();
      setBookings(res?.data || []);
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to fetch carrier bookings.";
      setErrorMessage(msg);
    } finally {
      setIsLoadingBookings(false);
    }
  }, []);

  const fetchInitialData = useCallback(async () => {
    setIsLoadingInitial(true);
    setErrorMessage(null);
    try {
      const [warehousesResult, bookingsResult] = await Promise.allSettled([
        warehouseApi.getAll(),
        bookingApi.getAll(),
      ]);

      let fetchedBookings: Booking[] = [];
      if (bookingsResult.status === "fulfilled") {
        fetchedBookings = bookingsResult.value?.data || [];
        setBookings(fetchedBookings);
      } else {
        const msg =
          bookingsResult.reason?.response?.data?.message ||
          bookingsResult.reason?.message ||
          "Failed to load bookings.";
        setErrorMessage(msg);
      }

      if (warehousesResult.status === "fulfilled") {
        const fetchedWarehouses = warehousesResult.value?.data || [];
        setWarehouses(fetchedWarehouses);
        if (fetchedWarehouses.length > 0) {
          setSelectedWarehouseId(String(fetchedWarehouses[0].id));
        }
      } else {
        // Fallback: extract warehouses from existing bookings if any
        const fallbackWarehousesMap: Record<number, Warehouse> = {};
        fetchedBookings.forEach((b) => {
          if (b.dock?.warehouse) {
            const wh = b.dock.warehouse;
            if (!fallbackWarehousesMap[wh.id]) {
              fallbackWarehousesMap[wh.id] = {
                id: wh.id,
                organizationId: 0,
                name: wh.name,
                address: wh.address || "",
                timezone: wh.timezone || "UTC",
                slotLengthMinutes: 30,
                docks: [
                  {
                    id: b.dock.id,
                    warehouseId: wh.id,
                    name: b.dock.name,
                    status: b.dock.status,
                  },
                ],
              };
            }
          }
        });
        const fallbackWarehouses = Object.values(fallbackWarehousesMap);
        if (fallbackWarehouses.length > 0) {
          setWarehouses(fallbackWarehouses);
          setSelectedWarehouseId(String(fallbackWarehouses[0].id));
        } else {
          const msg =
            warehousesResult.reason?.response?.data?.message ||
            warehousesResult.reason?.message ||
            "Failed to load warehouses.";
          setErrorMessage(msg);
        }
      }
    } finally {
      setIsLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const selectedWarehouse = useMemo<Warehouse | undefined>(() => {
    if (!selectedWarehouseId) return undefined;
    return warehouses.find((w) => w.id === Number(selectedWarehouseId));
  }, [warehouses, selectedWarehouseId]);

  // Available docks for currently selected warehouse
  const currentWarehouseDocks = useMemo<Dock[]>(() => {
    return selectedWarehouse?.docks || [];
  }, [selectedWarehouse]);

  // Browser Local Timezone
  const browserTimezone = useMemo<string>(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
      const offsetMinutes = -new Date().getTimezoneOffset();
      const sign = offsetMinutes >= 0 ? "+" : "-";
      const absMinutes = Math.abs(offsetMinutes);
      const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
      const mins = String(absMinutes % 60).padStart(2, "0");
      return `${tz} (UTC${sign}${hours}:${mins})`;
    } catch {
      return "UTC";
    }
  }, []);

  // Format IANA timezone string with UTC offset
  const formatTimezoneLabel = useCallback((tz?: string): string => {
    if (!tz) return "UTC";
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "shortOffset",
      }).formatToParts(new Date());
      const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value;
      if (offsetPart && offsetPart !== tz) {
        return `${tz} (${offsetPart.replace("GMT", "UTC")})`;
      }
      return tz;
    } catch {
      return tz;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Slot Search Handler
  // ---------------------------------------------------------------------------
  const handleSearchSlots = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedWarehouseId) {
      setErrorMessage("Please select a target warehouse.");
      return;
    }
    if (!targetDate) {
      setErrorMessage("Please select a target date.");
      return;
    }

    setIsSearchingSlots(true);
    setErrorMessage(null);
    setHasSearchedSlots(true);

    try {
      const warehouseIdNum = Number(selectedWarehouseId);
      const dockIdFilter =
        selectedDockId !== "ALL" ? Number(selectedDockId) : undefined;

      const res = await warehouseApi.getAvailableSlots(
        warehouseIdNum,
        targetDate,
        dockIdFilter,
      );
      const rawData = res.data;

      // Normalize response data: backend returns AvailableDockSlots[]:
      // [{ dockId, dockName, slots: [...] }]
      // or openapi flat list: [{ dockId, dockName, slotStartTime, slotEndTime }]
      let normalized: AvailableDockSlots[] = [];

      if (Array.isArray(rawData)) {
        if (rawData.length > 0 && "slots" in rawData[0]) {
          normalized = (rawData as AvailableDockSlots[]).map((group) => ({
            ...group,
            slots: dockIdFilter
              ? group.dockId === dockIdFilter
                ? group.slots
                : []
              : group.slots,
          }));
        } else if (rawData.length > 0 && "slotStartTime" in rawData[0]) {
          // Flat list format
          const flatList = rawData as unknown as AvailableSlot[];
          const grouped: Record<number, AvailableDockSlots> = {};
          flatList.forEach((slot) => {
            const dId = slot.dockId || 0;
            const dName = slot.dockName || `Dock #${dId}`;
            if (!grouped[dId]) {
              grouped[dId] = { dockId: dId, dockName: dName, slots: [] };
            }
            if (!dockIdFilter || dId === dockIdFilter) {
              grouped[dId].slots.push(slot);
            }
          });
          normalized = Object.values(grouped);
        } else {
          normalized = [];
        }
      }

      setSearchedSlots(normalized);
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to search available slots.";
      setErrorMessage(msg);
      setSearchedSlots([]);
    } finally {
      setIsSearchingSlots(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Booking Creation Handlers
  // ---------------------------------------------------------------------------
  const handleOpenBookingModal = (
    dock: { id: number; name: string },
    slot: AvailableSlot,
  ) => {
    const wh = warehouses.find((w) => w.id === Number(selectedWarehouseId));
    setSelectedSlotForBooking({
      warehouseId: wh?.id || Number(selectedWarehouseId),
      warehouseName: wh?.name || "Selected Warehouse",
      dockId: dock.id,
      dockName: dock.name,
      slotStartTime: slot.slotStartTime,
      slotEndTime: slot.slotEndTime,
      localStartTime: slot.localStartTime,
      localEndTime: slot.localEndTime,
    });
    setBookingFormData({
      truckPlate: "",
      driverName: "",
      driverPhone: "",
      cargoNote: "",
    });
    setBookingModalError(null);
    setIsBookingModalOpen(true);
  };

  const handleCreateBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlotForBooking) return;

    setBookingModalError(null);

    const { truckPlate, driverName, driverPhone, cargoNote } = bookingFormData;

    if (!truckPlate.trim()) {
      setBookingModalError("Truck license plate is required.");
      return;
    }
    if (!driverName.trim()) {
      setBookingModalError("Driver name is required.");
      return;
    }
    if (!driverPhone.trim()) {
      setBookingModalError("Driver phone number is required.");
      return;
    }

    setIsSubmittingBooking(true);

    try {
      const payload: CreateBookingRequest = {
        dockId: selectedSlotForBooking.dockId,
        slotStartTime: selectedSlotForBooking.slotStartTime,
        slotEndTime: selectedSlotForBooking.slotEndTime,
        truckPlate: truckPlate.trim(),
        driverName: driverName.trim(),
        driverPhone: driverPhone.trim(),
        cargoNote: cargoNote.trim() || undefined,
      };

      const res = await bookingApi.create(payload);
      const createdBooking = res.data;

      // Update bookings list
      setBookings((prev) => [createdBooking, ...prev]);

      // Remove the booked slot locally from searchedSlots for instant visual feedback
      setSearchedSlots((prev) => {
        if (!prev) return prev;
        return prev.map((dockGroup) => {
          if (dockGroup.dockId === selectedSlotForBooking.dockId) {
            return {
              ...dockGroup,
              slots: dockGroup.slots.filter(
                (s) => s.slotStartTime !== selectedSlotForBooking.slotStartTime,
              ),
            };
          }
          return dockGroup;
        });
      });

      setIsBookingModalOpen(false);
      setSuccessBanner(
        `Booking #${createdBooking.id} created successfully for ${selectedSlotForBooking.dockName} (${truckPlate.trim()})!`,
      );
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to create booking.";
      setBookingModalError(msg);
    } finally {
      setIsSubmittingBooking(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Reschedule Handlers
  // ---------------------------------------------------------------------------
  const handleOpenRescheduleModal = async (booking: Booking) => {
    setBookingToReschedule(booking);
    setRescheduleReason("");
    setRescheduleError(null);
    setSelectedRescheduleSlot(null);

    // Default reschedule date: same date as current booking or today
    const bDate = booking.slotStartTime
      ? booking.slotStartTime.slice(0, 10)
      : getTodayDateString();
    setRescheduleDate(bDate);
    setIsRescheduleModalOpen(true);

    // Pre-fetch slots for this warehouse and date
    const warehouseId = booking.dock?.warehouseId;
    if (warehouseId) {
      await fetchRescheduleSlots(warehouseId, bDate);
    }
  };

  const fetchRescheduleSlots = async (warehouseId: number, dateStr: string) => {
    setIsLoadingRescheduleSlots(true);
    setRescheduleError(null);
    try {
      const res = await warehouseApi.getAvailableSlots(warehouseId, dateStr);
      const rawData = res.data;
      let normalized: AvailableDockSlots[] = [];

      if (Array.isArray(rawData)) {
        if (rawData.length > 0 && "slots" in rawData[0]) {
          normalized = rawData as AvailableDockSlots[];
        } else if (rawData.length > 0 && "slotStartTime" in rawData[0]) {
          const flatList = rawData as unknown as AvailableSlot[];
          const grouped: Record<number, AvailableDockSlots> = {};
          flatList.forEach((slot) => {
            const dId = slot.dockId || 0;
            const dName = slot.dockName || `Dock #${dId}`;
            if (!grouped[dId]) {
              grouped[dId] = { dockId: dId, dockName: dName, slots: [] };
            }
            grouped[dId].slots.push(slot);
          });
          normalized = Object.values(grouped);
        }
      }

      setRescheduleSlots(normalized);
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to fetch slots for rescheduling.";
      setRescheduleError(msg);
      setRescheduleSlots([]);
    } finally {
      setIsLoadingRescheduleSlots(false);
    }
  };

  const handleRescheduleDateChange = async (newDate: string) => {
    setRescheduleDate(newDate);
    setSelectedRescheduleSlot(null);
    if (bookingToReschedule?.dock?.warehouseId) {
      await fetchRescheduleSlots(bookingToReschedule.dock.warehouseId, newDate);
    }
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingToReschedule) return;

    if (!selectedRescheduleSlot) {
      setRescheduleError("Please select a new available time slot.");
      return;
    }

    setIsSubmittingReschedule(true);
    setRescheduleError(null);

    try {
      const res = await bookingApi.reschedule(bookingToReschedule.id, {
        slotStartTime: selectedRescheduleSlot.slotStartTime,
        slotEndTime: selectedRescheduleSlot.slotEndTime,
        dockId: selectedRescheduleSlot.dockId,
        newDockId: selectedRescheduleSlot.dockId,
        reason: rescheduleReason.trim() || undefined,
      });

      const updatedBooking = res.data;

      // Update bookings list
      setBookings((prev) =>
        prev.map((b) => (b.id === updatedBooking.id ? updatedBooking : b)),
      );

      setIsRescheduleModalOpen(false);
      setSuccessBanner(
        `Booking #${bookingToReschedule.id} rescheduled successfully to ${formatDateTime(
          selectedRescheduleSlot.slotStartTime,
          "PPp",
        )}.`,
      );

      // Refresh searched slots if matching date
      if (hasSearchedSlots && targetDate === rescheduleDate) {
        handleSearchSlots();
      }
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to reschedule booking.";
      setRescheduleError(msg);
    } finally {
      setIsSubmittingReschedule(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Cancel Handlers
  // ---------------------------------------------------------------------------
  const handleOpenCancelModal = (booking: Booking) => {
    setBookingToCancel(booking);
    setCancelReason("");
    setCancelError(null);
    setIsCancelModalOpen(true);
  };

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookingToCancel) return;

    setIsSubmittingCancel(true);
    setCancelError(null);

    try {
      const res = await bookingApi.cancel(
        bookingToCancel.id,
        cancelReason.trim() || undefined,
      );
      const updatedBooking = res.data;

      // Update state locally
      setBookings((prev) =>
        prev.map((b) =>
          b.id === updatedBooking.id ? { ...b, status: "CANCELLED" } : b,
        ),
      );

      setIsCancelModalOpen(false);
      setSuccessBanner(
        `Booking #${bookingToCancel.id} has been cancelled and slot released.`,
      );

      // Refresh searched slots if matching
      if (hasSearchedSlots) {
        handleSearchSlots();
      }
    } catch (err: any) {
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Failed to cancel booking.";
      setCancelError(msg);
    } finally {
      setIsSubmittingCancel(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered Bookings for Table
  // ---------------------------------------------------------------------------
  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      // Status filter
      if (bookingStatusFilter !== "ALL" && b.status !== bookingStatusFilter) {
        return false;
      }

      // Text search
      if (bookingSearchQuery.trim()) {
        const query = bookingSearchQuery.toLowerCase().trim();
        const bId = String(b.id);
        const plate = (b.truckPlate || "").toLowerCase();
        const driver = (b.driverName || "").toLowerCase();
        const phone = (b.driverPhone || "").toLowerCase();
        const dockName = (b.dock?.name || "").toLowerCase();
        const whName = (b.dock?.warehouse?.name || "").toLowerCase();
        const note = (b.cargoNote || "").toLowerCase();

        return (
          bId.includes(query) ||
          plate.includes(query) ||
          driver.includes(query) ||
          phone.includes(query) ||
          dockName.includes(query) ||
          whName.includes(query) ||
          note.includes(query)
        );
      }

      return true;
    });
  }, [bookings, bookingStatusFilter, bookingSearchQuery]);

  // Helper for status badge rendering
  const renderStatusBadge = (status: BookingStatus) => {
    switch (status) {
      case "BOOKED":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Clock className="w-3 h-3 mr-1" />
            BOOKED
          </span>
        );
      case "ARRIVED":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Truck className="w-3 h-3 mr-1" />
            ARRIVED
          </span>
        );
      case "COMPLETED":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            COMPLETED
          </span>
        );
      case "NO_SHOW":
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            NO-SHOW
          </span>
        );
      case "CANCELLED":
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

  // Helper: Count total available slots in current search
  const totalSlotsCount = useMemo(() => {
    if (!searchedSlots) return 0;
    return searchedSlots.reduce(
      (acc, curr) => acc + (curr.slots?.length || 0),
      0,
    );
  }, [searchedSlots]);

  return (
    <div className="space-y-4 sm:space-y-6 pb-12">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 border-b border-gray-200 pb-4 sm:pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <div className="p-2 bg-[#2F4F4F] text-white rounded-lg shadow-sm shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
              Dispatcher Dashboard
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Search available warehouse time slots, book dock appointments, and
            manage carrier shipments.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
          {/* Browser Local Timezone Badge */}
          <div
            className="inline-flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 shadow-xs max-w-full"
            title="Your browser's local timezone"
          >
            <Globe className="w-3.5 h-3.5 text-[#2F4F4F] shrink-0" />
            <span className="text-slate-500 font-medium">Local Timezone:</span>
            <strong className="font-bold text-slate-900 truncate">
              {browserTimezone}
            </strong>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchBookings();
              if (hasSearchedSlots) handleSearchSlots();
            }}
            isLoading={isLoadingBookings || isSearchingSlots}
            className="flex items-center space-x-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </Button>
        </div>
      </header>

      {/* Global Alert Banners */}
      {errorMessage && (
        <div
          role="alert"
          className="p-3.5 sm:p-4 bg-red-50 border border-red-200 rounded-lg text-xs sm:text-sm text-red-800 flex items-start space-x-2.5 sm:space-x-3 animate-in fade-in duration-200"
        >
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium break-words">{errorMessage}</div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-600 p-1 -m-1"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div
          role="status"
          className="p-3.5 sm:p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-xs sm:text-sm text-emerald-800 flex items-start space-x-2.5 sm:space-x-3 animate-in fade-in duration-200"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 font-medium break-words">{successBanner}</div>
          <button
            onClick={() => setSuccessBanner(null)}
            className="text-emerald-400 hover:text-emerald-600 p-1 -m-1"
            aria-label="Dismiss success message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 1: Slot Search & Filter Section                                   */}
      {/* ========================================================================= */}
      <Card className="bg-white shadow-sm border border-gray-200">
        <CardHeader className="border-b border-gray-100 px-3.5 sm:px-6 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3">
          <div>
            <CardTitle className="text-sm sm:text-base font-bold text-gray-900 flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-[#2F4F4F] shrink-0" />
              <span>Search & Filter Available Dock Slots</span>
            </CardTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              Select a target warehouse, appointment date, and optional dock bay
              to query open time windows.
            </p>
          </div>

          {selectedWarehouse && (
            <div className="inline-flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 self-start sm:self-auto max-w-full">
              <Clock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">
                {selectedWarehouse.name} Timezone:{" "}
                <strong className="font-bold">
                  {formatTimezoneLabel(selectedWarehouse.timezone)}
                </strong>
              </span>
            </div>
          )}
        </CardHeader>

        <CardContent className="px-3.5 sm:px-6 pt-4 sm:pt-5 pb-4 sm:pb-6 space-y-5 sm:space-y-6">
          <form
            onSubmit={handleSearchSlots}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4 items-end"
          >
            {/* Target Warehouse */}
            <div>
              <Label
                htmlFor="search-warehouse"
                className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center justify-between gap-1"
              >
                <span className="flex items-center space-x-1">
                  <Building className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <span>
                    Target Warehouse <span className="text-red-500">*</span>
                  </span>
                </span>
                {selectedWarehouse?.timezone && (
                  <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded truncate">
                    {selectedWarehouse.timezone}
                  </span>
                )}
              </Label>
              <select
                id="search-warehouse"
                value={selectedWarehouseId}
                onChange={(e) => {
                  setSelectedWarehouseId(e.target.value);
                  setSelectedDockId("ALL");
                }}
                disabled={isLoadingInitial || warehouses.length === 0}
                className="w-full min-h-[42px] sm:min-h-[38px] text-base sm:text-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-[#2F4F4F] focus:outline-none focus:ring-1 focus:ring-[#2F4F4F]"
              >
                {warehouses.length === 0 ? (
                  <option value="">No warehouses available</option>
                ) : (
                  warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id}>
                      {wh.name} ({wh.address}) — [{wh.timezone || "UTC"}]
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Target Date */}
            <div>
              <Label
                htmlFor="search-date"
                className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center space-x-1"
              >
                <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>
                  Appointment Date <span className="text-red-500">*</span>
                </span>
              </Label>
              <Input
                id="search-date"
                type="date"
                min={getTodayDateString()}
                max={getMaxAdvanceDateString(
                  selectedWarehouse?.policy?.maxAdvanceDays || 14,
                )}
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                required
                className="min-h-[42px] sm:min-h-[38px] text-base sm:text-sm"
              />
            </div>

            {/* Optional Dock Filter */}
            <div>
              <Label
                htmlFor="search-dock"
                className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center space-x-1"
              >
                <WarehouseIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <span>Dock Bay (Optional)</span>
              </Label>
              <select
                id="search-dock"
                value={selectedDockId}
                onChange={(e) => setSelectedDockId(e.target.value)}
                className="w-full min-h-[42px] sm:min-h-[38px] text-base sm:text-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-[#2F4F4F] focus:outline-none focus:ring-1 focus:ring-[#2F4F4F]"
              >
                <option value="ALL">All Active Docks</option>
                {currentWarehouseDocks.map((dock) => (
                  <option key={dock.id} value={dock.id}>
                    {dock.name}{" "}
                    {dock.status === "MAINTENANCE" ? "(Under Maintenance)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Submit Action */}
            <div>
              <Button
                type="submit"
                variant="primary"
                isLoading={isSearchingSlots}
                disabled={!selectedWarehouseId || !targetDate}
                className="w-full min-h-[42px] sm:min-h-[38px] flex items-center justify-center space-x-1.5 text-sm font-semibold"
              >
                <Search className="w-4 h-4" />
                <span>Find Free Slots</span>
              </Button>
            </div>
          </form>

          {/* Available Slots Display */}
          {isSearchingSlots ? (
            <div className="py-10 sm:py-12 flex flex-col items-center justify-center space-y-2 text-gray-500 text-center px-3">
              <div className="w-6 h-6 border-2 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">
                Querying warehouse schedule and calculating available slots...
              </p>
            </div>
          ) : hasSearchedSlots && searchedSlots !== null ? (
            <div className="space-y-3.5 sm:space-y-4 pt-3 border-t border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#2F4F4F] shrink-0" />
                  <span>
                    Available Time Slots for {targetDate} ({totalSlotsCount}{" "}
                    open)
                  </span>
                </div>
                {totalSlotsCount > 0 && (
                  <span className="text-xs text-gray-500">
                    Tap any open time window to book
                  </span>
                )}
              </div>

              {totalSlotsCount === 0 ? (
                <div className="py-8 sm:py-10 text-center bg-gray-50 border border-dashed border-gray-200 rounded-lg p-4 sm:p-6">
                  <CalendarX className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-gray-700">
                    No Available Slots Found
                  </p>
                  <p className="text-xs text-gray-500 mt-1 max-w-md mx-auto">
                    The warehouse may be closed on this day, or all docking
                    intervals are fully booked or under scheduled maintenance.
                    Try choosing another date or dock.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                  {searchedSlots.map((dockGroup) => (
                    <div
                      key={dockGroup.dockId}
                      className="border border-gray-200 rounded-lg p-3.5 sm:p-4 bg-gray-50/50 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-gray-200 gap-2">
                        <div className="flex items-center space-x-2 min-w-0">
                          <WarehouseIcon className="w-4 h-4 text-[#2F4F4F] shrink-0" />
                          <h4 className="font-semibold text-sm text-gray-900 truncate">
                            {dockGroup.dockName}
                          </h4>
                        </div>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                          {dockGroup.slots.length} available
                        </span>
                      </div>

                      {dockGroup.slots.length === 0 ? (
                        <p className="text-xs text-gray-400 italic py-2">
                          No open intervals
                        </p>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {dockGroup.slots.map((slot, index) => {
                            const timeLabel = `${formatDateTime(
                              slot.slotStartTime,
                              "h:mm a",
                            )} - ${formatDateTime(slot.slotEndTime, "h:mm a")}`;

                            return (
                              <button
                                key={`${dockGroup.dockId}-${slot.slotStartTime}-${index}`}
                                type="button"
                                onClick={() =>
                                  handleOpenBookingModal(
                                    {
                                      id: dockGroup.dockId,
                                      name: dockGroup.dockName,
                                    },
                                    slot,
                                  )
                                }
                                className="group min-h-[48px] flex flex-col items-center justify-center px-2 py-2.5 rounded-md border border-gray-200 bg-white hover:border-[#2F4F4F] hover:bg-[#2F4F4F] hover:text-white active:scale-[0.98] transition-all shadow-xs text-center touch-manipulation"
                              >
                                <span className="text-[11px] sm:text-xs font-bold text-gray-900 group-hover:text-white leading-tight">
                                  {timeLabel}
                                </span>
                                <span className="text-[10px] text-gray-500 group-hover:text-gray-200 mt-1 flex items-center space-x-0.5">
                                  <span>Book</span>
                                  <ArrowRight className="w-2.5 h-2.5 ml-0.5" />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-7 sm:py-8 px-4 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg">
              Select your warehouse and date above, then tap{" "}
              <strong>"Find Free Slots"</strong> to view available booking
              intervals.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========================================================================= */}
      {/* SECTION 2: Carrier Bookings Management Table                              */}
      {/* ========================================================================= */}
      <Card className="bg-white shadow-sm border border-gray-200">
        <CardHeader className="border-b border-gray-100 px-3.5 sm:px-6 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-4">
          <div>
            <CardTitle className="text-sm sm:text-base font-bold text-gray-900 flex items-center space-x-2">
              <CalendarCheck className="w-4 h-4 text-[#2F4F4F] shrink-0" />
              <span>Carrier Bookings Management</span>
            </CardTitle>
            <p className="text-xs text-gray-500 mt-0.5">
              Review, reschedule, or cancel active appointments for your fleet.
            </p>
          </div>

          <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 rounded-md text-gray-700 self-start sm:self-auto">
            {filteredBookings.length} of {bookings.length} Bookings
          </span>
        </CardHeader>

        <CardContent className="px-3.5 sm:px-6 pt-4 pb-4 sm:pb-6 space-y-4">
          {/* Table Filters & Search Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1 w-full sm:max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <Input
                placeholder="Search truck, driver, ID, warehouse..."
                value={bookingSearchQuery}
                onChange={(e) => setBookingSearchQuery(e.target.value)}
                className="pl-9 text-sm sm:text-xs min-h-[40px] sm:min-h-[36px]"
              />
              {bookingSearchQuery && (
                <button
                  onClick={() => setBookingSearchQuery("")}
                  className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600 p-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Tabs */}
            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1">
              {[
                "ALL",
                "BOOKED",
                "ARRIVED",
                "COMPLETED",
                "CANCELLED",
                "NO_SHOW",
              ].map((status) => (
                <button
                  key={status}
                  onClick={() => setBookingStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap touch-manipulation ${
                    bookingStatusFilter === status
                      ? "bg-[#2F4F4F] text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Bookings List / Table */}
          {isLoadingBookings ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-2 text-gray-500">
              <div className="w-6 h-6 border-2 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-medium">Loading carrier bookings...</p>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="py-10 sm:py-12 px-4 text-center text-gray-500 border border-dashed border-gray-200 rounded-lg">
              <CalendarX className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-gray-700">
                No Bookings Found
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {bookings.length === 0
                  ? "Your organization has not created any bookings yet. Search for open slots above to book."
                  : "No bookings match your selected search or status filters."}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Card View (Phone / Small Screens) */}
              <div className="md:hidden space-y-3">
                {filteredBookings.map((b) => {
                  const isActionable = b.status === "BOOKED";
                  const insideLock = isActionable ? isInsideLockWindow(b) : false;

                  return (
                    <div
                      key={b.id}
                      className="rounded-lg border border-gray-200 bg-white p-3.5 shadow-xs space-y-3"
                    >
                      {/* Top row: Booking ID, Warehouse & Status */}
                      <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-gray-100">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#2F4F4F] bg-slate-100 px-2 py-0.5 rounded">
                              #{b.id}
                            </span>
                            <span className="font-semibold text-sm text-gray-900 truncate">
                              {b.dock?.warehouse?.name || "Warehouse"}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 flex items-center space-x-1 mt-1">
                            <WarehouseIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>{b.dock?.name || `Dock #${b.dockId}`}</span>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {renderStatusBadge(b.status)}
                        </div>
                      </div>

                      {/* Middle Details Grid */}
                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="col-span-2 bg-gray-50 rounded-md px-2.5 py-2 border border-gray-100 flex items-center justify-between">
                          <span className="text-gray-500 font-medium flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-[#2F4F4F]" />
                            <span>Time:</span>
                          </span>
                          <span className="font-semibold text-gray-900 text-right">
                            {formatDateTime(b.slotStartTime, "MMM dd, yyyy")} •{" "}
                            {formatDateTime(b.slotStartTime, "h:mm a")} –{" "}
                            {formatDateTime(b.slotEndTime, "h:mm a")}
                          </span>
                        </div>

                        <div>
                          <span className="text-[11px] text-gray-500 block mb-0.5">
                            Vehicle (Truck)
                          </span>
                          <div className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-800 font-mono font-bold text-xs border border-gray-300">
                            <Truck className="w-3 h-3 mr-1 text-gray-500 shrink-0" />
                            <span className="truncate">{b.truckPlate || "N/A"}</span>
                          </div>
                        </div>

                        <div>
                          <span className="text-[11px] text-gray-500 block mb-0.5">
                            Driver
                          </span>
                          <div className="font-medium text-gray-900 truncate">
                            {b.driverName || "N/A"}
                          </div>
                          {b.driverPhone && (
                            <div className="text-[11px] text-gray-500 truncate">
                              {b.driverPhone}
                            </div>
                          )}
                        </div>

                        {b.cargoNote && (
                          <div className="col-span-2 pt-1 text-gray-600 flex items-start space-x-1.5">
                            <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" />
                            <span className="break-words">{b.cargoNote}</span>
                          </div>
                        )}
                      </div>

                      {/* Bottom Action Buttons */}
                      {isActionable ? (
                        <div className="pt-2 border-t border-gray-100 grid grid-cols-2 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenRescheduleModal(b)}
                            className={`w-full min-h-[38px] text-xs px-2.5 flex items-center justify-center space-x-1 ${
                              insideLock
                                ? "border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 font-semibold"
                                : "border-gray-300 text-gray-700 hover:bg-gray-100"
                            }`}
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 shrink-0 ${insideLock ? "text-amber-600" : "text-[#2F4F4F]"}`}
                            />
                            <span className="truncate">
                              {insideLock ? "Emergency Reschedule" : "Reschedule"}
                            </span>
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenCancelModal(b)}
                            disabled={insideLock}
                            className={`w-full min-h-[38px] text-xs px-2.5 flex items-center justify-center space-x-1 ${
                              insideLock
                                ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed opacity-60"
                                : "border-rose-200 text-rose-700 hover:bg-rose-50"
                            }`}
                          >
                            <X
                              className={`w-3.5 h-3.5 shrink-0 ${insideLock ? "text-gray-400" : "text-rose-600"}`}
                            />
                            <span>Cancel</span>
                          </Button>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-gray-100 flex justify-end">
                          <span className="text-[11px] text-gray-400 italic">
                            Appointment Locked
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-left text-xs divide-y divide-gray-200">
                  <thead className="bg-gray-50 text-gray-600 font-semibold uppercase tracking-wider">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Booking ID
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Warehouse & Dock
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Scheduled Time
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Vehicle (Truck)
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Driver Info
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Cargo Note
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredBookings.map((b) => {
                      const isActionable = b.status === "BOOKED";

                      return (
                        <tr
                          key={b.id}
                          className="hover:bg-gray-50/80 transition-colors"
                        >
                          {/* ID */}
                          <td className="px-4 py-3 font-bold text-gray-900">
                            #{b.id}
                          </td>

                          {/* Warehouse & Dock */}
                          <td className="px-4 py-3">
                            <div className="font-semibold text-gray-900">
                              {b.dock?.warehouse?.name || "Warehouse"}
                            </div>
                            <div className="text-[11px] text-gray-500 flex items-center space-x-1 mt-0.5">
                              <WarehouseIcon className="w-3 h-3 text-gray-400" />
                              <span>{b.dock?.name || `Dock #${b.dockId}`}</span>
                            </div>
                          </td>

                          {/* Scheduled Time Window */}
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">
                              {formatDateTime(b.slotStartTime, "MMM dd, yyyy")}
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              {formatDateTime(b.slotStartTime, "h:mm a")} –{" "}
                              {formatDateTime(b.slotEndTime, "h:mm a")}
                            </div>
                          </td>

                          {/* Truck Plate */}
                          <td className="px-4 py-3">
                            <div className="inline-flex items-center px-2 py-0.5 rounded bg-gray-100 text-gray-800 font-mono font-bold text-xs border border-gray-300">
                              <Truck className="w-3 h-3 mr-1 text-gray-500" />
                              {b.truckPlate || "N/A"}
                            </div>
                          </td>

                          {/* Driver */}
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900 flex items-center space-x-1">
                              <User className="w-3 h-3 text-gray-400" />
                              <span>{b.driverName || "N/A"}</span>
                            </div>
                            {b.driverPhone && (
                              <div className="text-[11px] text-gray-500 flex items-center space-x-1 mt-0.5">
                                <Phone className="w-2.5 h-2.5 text-gray-400" />
                                <span>{b.driverPhone}</span>
                              </div>
                            )}
                          </td>

                          {/* Cargo Note */}
                          <td
                            className="px-4 py-3 max-w-[180px] truncate"
                            title={b.cargoNote || ""}
                          >
                            {b.cargoNote ? (
                              <span className="text-gray-700 flex items-center space-x-1">
                                <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                <span className="truncate">{b.cargoNote}</span>
                              </span>
                            ) : (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            {renderStatusBadge(b.status)}
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end space-x-1.5">
                              {isActionable ? (
                                <>
                                  {(() => {
                                    const insideLock = isInsideLockWindow(b);
                                    return (
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() =>
                                            handleOpenRescheduleModal(b)
                                          }
                                          className={`h-7 text-xs px-2.5 flex items-center space-x-1 ${
                                            insideLock
                                              ? "border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 font-semibold"
                                              : "border-gray-300 text-gray-700 hover:bg-gray-100"
                                          }`}
                                          title={
                                            insideLock
                                              ? "Emergency same-day rescheduling (within 24-hour lock window)"
                                              : "Reschedule booking"
                                          }
                                        >
                                          <RotateCcw
                                            className={`w-3 h-3 ${insideLock ? "text-amber-600" : "text-[#2F4F4F]"}`}
                                          />
                                          <span>
                                            {insideLock
                                              ? "Emergency Reschedule"
                                              : "Reschedule"}
                                          </span>
                                        </Button>

                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleOpenCancelModal(b)}
                                          disabled={insideLock}
                                          className={`h-7 text-xs px-2.5 flex items-center space-x-1 ${
                                            insideLock
                                              ? "border-gray-200 text-gray-400 bg-gray-50 cursor-not-allowed opacity-60"
                                              : "border-rose-200 text-rose-700 hover:bg-rose-50"
                                          }`}
                                          title={
                                            insideLock
                                              ? "Cancellations locked within 24 hours of arrival under warehouse policy"
                                              : "Cancel booking"
                                          }
                                        >
                                          <X
                                            className={`w-3 h-3 ${insideLock ? "text-gray-400" : "text-rose-600"}`}
                                          />
                                          <span>Cancel</span>
                                        </Button>
                                      </>
                                    );
                                  })()}
                                </>
                              ) : (
                                <span className="text-[11px] text-gray-400 italic">
                                  Locked
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ========================================================================= */}
      {/* MODAL 1: Create Booking Modal                                             */}
      {/* ========================================================================= */}
      {isBookingModalOpen && selectedSlotForBooking && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl border border-gray-300 max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-[#2F4F4F] text-white px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <CalendarCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                <h3 className="font-bold text-sm sm:text-base">
                  Book Warehouse Dock Slot
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsBookingModalOpen(false)}
                className="text-white/80 hover:text-white transition-colors p-1 -m-1"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form
              onSubmit={handleCreateBookingSubmit}
              className="p-4 sm:p-5 space-y-4 overflow-y-auto"
            >
              {/* Selected Slot Summary Box */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md text-xs space-y-1.5 text-gray-700">
                <div className="flex flex-col sm:flex-row sm:justify-between font-medium gap-0.5">
                  <span className="text-gray-500">Warehouse:</span>
                  <span className="font-semibold text-gray-900">
                    {selectedSlotForBooking.warehouseName}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between font-medium gap-0.5">
                  <span className="text-gray-500">Dock Bay:</span>
                  <span className="font-semibold text-gray-900">
                    {selectedSlotForBooking.dockName}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between font-medium gap-0.5">
                  <span className="text-gray-500">Time Window:</span>
                  <span className="font-bold text-[#2F4F4F]">
                    {formatDateTime(
                      selectedSlotForBooking.slotStartTime,
                      "MMM dd, yyyy, h:mm a",
                    )}{" "}
                    –{" "}
                    {formatDateTime(
                      selectedSlotForBooking.slotEndTime,
                      "h:mm a",
                    )}
                  </span>
                </div>
              </div>

              {bookingModalError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span>{bookingModalError}</span>
                </div>
              )}

              {/* Truck Plate */}
              <div>
                <Label
                  htmlFor="create-truckPlate"
                  className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                >
                  <Truck className="w-3.5 h-3.5 text-gray-500" />
                  <span>
                    Truck License Plate <span className="text-red-500">*</span>
                  </span>
                </Label>
                <Input
                  id="create-truckPlate"
                  placeholder="e.g. WP-CA-4029"
                  value={bookingFormData.truckPlate}
                  onChange={(e) =>
                    setBookingFormData({
                      ...bookingFormData,
                      truckPlate: e.target.value,
                    })
                  }
                  required
                  className="text-base sm:text-sm font-mono uppercase min-h-[42px] sm:min-h-[38px]"
                />
              </div>

              {/* Driver Name & Phone Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label
                    htmlFor="create-driverName"
                    className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                  >
                    <User className="w-3.5 h-3.5 text-gray-500" />
                    <span>
                      Driver Name <span className="text-red-500">*</span>
                    </span>
                  </Label>
                  <Input
                    id="create-driverName"
                    placeholder="e.g. Nuwan Perera"
                    value={bookingFormData.driverName}
                    onChange={(e) =>
                      setBookingFormData({
                        ...bookingFormData,
                        driverName: e.target.value,
                      })
                    }
                    required
                    className="text-base sm:text-sm min-h-[42px] sm:min-h-[38px]"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="create-driverPhone"
                    className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                  >
                    <Phone className="w-3.5 h-3.5 text-gray-500" />
                    <span>
                      Driver Phone <span className="text-red-500">*</span>
                    </span>
                  </Label>
                  <Input
                    id="create-driverPhone"
                    placeholder="e.g. +94771234567"
                    value={bookingFormData.driverPhone}
                    onChange={(e) =>
                      setBookingFormData({
                        ...bookingFormData,
                        driverPhone: e.target.value,
                      })
                    }
                    required
                    className="text-base sm:text-sm min-h-[42px] sm:min-h-[38px]"
                  />
                </div>
              </div>

              {/* Cargo Note */}
              <div>
                <Label
                  htmlFor="create-cargoNote"
                  className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  <span>Cargo Note / Instructions (Optional)</span>
                </Label>
                <textarea
                  id="create-cargoNote"
                  rows={2}
                  placeholder="e.g. 20 pallets of temperature-sensitive produce, requires forklift..."
                  value={bookingFormData.cargoNote}
                  onChange={(e) =>
                    setBookingFormData({
                      ...bookingFormData,
                      cargoNote: e.target.value,
                    })
                  }
                  className="w-full text-base sm:text-xs rounded-md border border-gray-300 p-2.5 sm:p-2 text-gray-900 shadow-sm focus:border-[#2F4F4F] focus:outline-none focus:ring-1 focus:ring-[#2F4F4F]"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBookingModalOpen(false)}
                  disabled={isSubmittingBooking}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] justify-center"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmittingBooking}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] flex items-center justify-center space-x-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Confirm Booking</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: Reschedule Booking Modal                                         */}
      {/* ========================================================================= */}
      {isRescheduleModalOpen && bookingToReschedule && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl border border-gray-300 max-w-xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-[#2F4F4F] text-white px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <RotateCcw className="w-5 h-5 text-amber-400 shrink-0" />
                <h3 className="font-bold text-sm sm:text-base">
                  Reschedule Booking #{bookingToReschedule.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRescheduleModalOpen(false)}
                className="text-white/80 hover:text-white transition-colors p-1 -m-1"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form
              onSubmit={handleRescheduleSubmit}
              className="p-4 sm:p-5 space-y-4 overflow-y-auto"
            >
              {/* Current Booking Info */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-md text-xs space-y-1.5 text-gray-700">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                  <span className="text-gray-500">Warehouse:</span>
                  <span className="font-semibold text-gray-900">
                    {bookingToReschedule.dock?.warehouse?.name || "Warehouse"}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                  <span className="text-gray-500">Current Slot:</span>
                  <span className="font-semibold text-gray-900">
                    {bookingToReschedule.dock?.name} (
                    {formatDateTime(bookingToReschedule.slotStartTime, "PPp")} –{" "}
                    {formatDateTime(bookingToReschedule.slotEndTime, "p")})
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                  <span className="text-gray-500">Truck / Driver:</span>
                  <span className="font-semibold text-gray-900">
                    {bookingToReschedule.truckPlate} (
                    {bookingToReschedule.driverName})
                  </span>
                </div>
              </div>

              {rescheduleError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span>{rescheduleError}</span>
                </div>
              )}

              {isInsideLockWindow(bookingToReschedule) && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-md text-xs text-amber-900 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Emergency Same-Day Rescheduling Active
                    </p>
                    <p className="mt-0.5 text-amber-800">
                      This booking is within the 24-hour lock window. Under
                      warehouse policy, standard cancellations are blocked and
                      rescheduling is strictly restricted to available time
                      slots on the same calendar day ({rescheduleDate}).
                    </p>
                  </div>
                </div>
              )}

              {/* Date Selection for New Slot */}
              <div>
                <Label
                  htmlFor="reschedule-date"
                  className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                >
                  <Calendar className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <span>
                    Select New Date <span className="text-red-500">*</span>
                    {isInsideLockWindow(bookingToReschedule) && (
                      <span className="ml-1 text-[11px] font-normal text-amber-700">
                        (Locked to same day for emergency reschedule)
                      </span>
                    )}
                  </span>
                </Label>
                <Input
                  id="reschedule-date"
                  type="date"
                  min={
                    isInsideLockWindow(bookingToReschedule)
                      ? rescheduleDate
                      : getTodayDateString()
                  }
                  max={
                    isInsideLockWindow(bookingToReschedule)
                      ? rescheduleDate
                      : undefined
                  }
                  disabled={isInsideLockWindow(bookingToReschedule)}
                  value={rescheduleDate}
                  onChange={(e) => handleRescheduleDateChange(e.target.value)}
                  required
                  className="text-base sm:text-sm min-h-[42px] sm:min-h-[38px] disabled:bg-gray-100 disabled:text-gray-600 disabled:cursor-not-allowed"
                />
              </div>

              {/* Available Slots for this Date */}
              <div>
                <Label className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5 text-gray-500" />
                  <span>
                    Choose an Available Time Slot{" "}
                    <span className="text-red-500">*</span>
                  </span>
                </Label>

                {isLoadingRescheduleSlots ? (
                  <div className="py-6 flex flex-col items-center justify-center space-y-2 text-gray-500">
                    <div className="w-5 h-5 border-2 border-[#2F4F4F] border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs">
                      Fetching open slots for {rescheduleDate}...
                    </p>
                  </div>
                ) : !rescheduleSlots ||
                  rescheduleSlots.length === 0 ||
                  rescheduleSlots.every((d) => d.slots.length === 0) ? (
                  <div className="p-4 text-center text-xs text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded-md">
                    No free slots found on this date. Please pick another date.
                  </div>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-3 border border-gray-200 p-2.5 rounded-md bg-gray-50">
                    {rescheduleSlots.map((dockGroup) => (
                      <div key={dockGroup.dockId} className="space-y-1.5">
                        <div className="text-xs font-bold text-gray-800 flex items-center space-x-1">
                          <WarehouseIcon className="w-3 h-3 text-[#2F4F4F]" />
                          <span>{dockGroup.dockName}</span>
                        </div>

                        {dockGroup.slots.length === 0 ? (
                          <p className="text-[11px] text-gray-400 italic">
                            No available slots
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                            {dockGroup.slots.map((slot, sIdx) => {
                              const isSelected =
                                selectedRescheduleSlot?.dockId ===
                                  dockGroup.dockId &&
                                selectedRescheduleSlot?.slotStartTime ===
                                  slot.slotStartTime;

                              return (
                                <button
                                  key={`${dockGroup.dockId}-${sIdx}`}
                                  type="button"
                                  onClick={() =>
                                    setSelectedRescheduleSlot({
                                      dockId: dockGroup.dockId,
                                      dockName: dockGroup.dockName,
                                      slotStartTime: slot.slotStartTime,
                                      slotEndTime: slot.slotEndTime,
                                    })
                                  }
                                  className={`min-h-[40px] px-2 py-2 rounded text-[11px] sm:text-xs font-semibold border transition-all text-center touch-manipulation ${
                                    isSelected
                                      ? "bg-[#2F4F4F] text-white border-[#2F4F4F] ring-2 ring-[#2F4F4F]/30"
                                      : "bg-white text-gray-800 border-gray-200 hover:border-gray-400"
                                  }`}
                                >
                                  {formatDateTime(slot.slotStartTime, "h:mm a")}{" "}
                                  – {formatDateTime(slot.slotEndTime, "h:mm a")}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reschedule Reason */}
              <div>
                <Label
                  htmlFor="reschedule-reason"
                  className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  <span>Reschedule Reason (Optional)</span>
                </Label>
                <Input
                  id="reschedule-reason"
                  placeholder="e.g. Driver caught in interstate traffic"
                  value={rescheduleReason}
                  onChange={(e) => setRescheduleReason(e.target.value)}
                  className="text-base sm:text-xs min-h-[42px] sm:min-h-[38px]"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRescheduleModalOpen(false)}
                  disabled={isSubmittingReschedule}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] justify-center"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isSubmittingReschedule}
                  disabled={!selectedRescheduleSlot}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] flex items-center justify-center space-x-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Confirm Reschedule</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: Cancel Booking Modal                                             */}
      {/* ========================================================================= */}
      {isCancelModalOpen && bookingToCancel && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-t-xl sm:rounded-lg shadow-xl border border-gray-300 max-w-md w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="bg-rose-700 text-white px-4 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                <XCircle className="w-5 h-5 text-white shrink-0" />
                <h3 className="font-bold text-sm sm:text-base">
                  Cancel Booking #{bookingToCancel.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(false)}
                className="text-white/80 hover:text-white transition-colors p-1 -m-1"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form
              onSubmit={handleCancelSubmit}
              className="p-4 sm:p-5 space-y-4 overflow-y-auto"
            >
              <p className="text-xs text-gray-600 leading-relaxed">
                Are you sure you want to cancel this booking? This will
                immediately release the time slot on{" "}
                <strong className="text-gray-900">
                  {bookingToCancel.dock?.name}
                </strong>{" "}
                at{" "}
                <strong className="text-gray-900">
                  {bookingToCancel.dock?.warehouse?.name}
                </strong>{" "}
                for other carriers.
              </p>

              {/* Booking Snapshot */}
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs space-y-1.5 text-rose-900">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                  <span className="text-rose-700">Scheduled Time:</span>
                  <span className="font-bold">
                    {formatDateTime(
                      bookingToCancel.slotStartTime,
                      "MMM dd, yyyy, h:mm a",
                    )}
                  </span>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5">
                  <span className="text-rose-700">Truck / Driver:</span>
                  <span className="font-bold">
                    {bookingToCancel.truckPlate} ({bookingToCancel.driverName})
                  </span>
                </div>
              </div>

              {cancelError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span>{cancelError}</span>
                </div>
              )}

              {isInsideLockWindow(bookingToCancel) && (
                <div className="p-3 bg-red-50 border border-red-300 rounded-md text-xs text-red-900 flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">
                      Cancellation Locked (24-Hour Policy Window)
                    </p>
                    <p className="mt-0.5 text-red-800">
                      Under warehouse policy, bookings within 24 hours of
                      scheduled arrival cannot be cancelled. Please use{" "}
                      <strong>Emergency Same-Day Rescheduling</strong> if you
                      need to adjust this appointment.
                    </p>
                  </div>
                </div>
              )}

              {/* Cancellation Reason */}
              <div>
                <Label
                  htmlFor="cancel-reason"
                  className="text-xs font-semibold text-gray-700 mb-1 flex items-center space-x-1"
                >
                  <FileText className="w-3.5 h-3.5 text-gray-500" />
                  <span>Reason for Cancellation (Optional)</span>
                </Label>
                <Input
                  id="cancel-reason"
                  placeholder="e.g. Shipment order cancelled by shipper"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  disabled={isInsideLockWindow(bookingToCancel)}
                  className="text-base sm:text-xs min-h-[42px] sm:min-h-[38px] disabled:bg-gray-100 disabled:text-gray-500"
                />
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-gray-100 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCancelModalOpen(false)}
                  disabled={isSubmittingCancel}
                  className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] justify-center"
                >
                  Keep Booking
                </Button>
                {isInsideLockWindow(bookingToCancel) ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const b = bookingToCancel;
                      setIsCancelModalOpen(false);
                      handleOpenRescheduleModal(b);
                    }}
                    className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center justify-center space-x-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Emergency Reschedule</span>
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="sm"
                    isLoading={isSubmittingCancel}
                    className="w-full sm:w-auto min-h-[42px] sm:min-h-[34px] bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center justify-center space-x-1"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Confirm Cancellation</span>
                  </Button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatcherDashboard;
