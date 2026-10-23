import { warehouseApi } from '../api/warehouse.api';
import { userApi } from '../api/user.api';
import type {
  CreateDockRequest,
  CreateWarehouseRequest,
  Dock,
  DockStatus,
  OperatingHour,
  UpdateDockRequest,
  UpdateOperatingHoursRequest,
  UpdateWarehousePolicyRequest,
  UpdateWarehouseRequest,
  Warehouse,
} from '../types/warehouse.types';
import type { User } from '../types/user.types';

export interface ScheduleDay {
  day: string;
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  is24h: boolean;
}

export interface ScheduleWindow {
  openMin: number;
  closeMin: number;
}

export interface PolicyForm {
  maxConcurrentBookings: number;
  maxAdvanceDays: number;
  bookingLockWindowHours: number;
}

export const DEFAULT_WEEKLY_SCHEDULE: ScheduleDay[] = [
  { day: 'Monday', dayOfWeek: 1, isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
  { day: 'Tuesday', dayOfWeek: 2, isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
  { day: 'Wednesday', dayOfWeek: 3, isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
  { day: 'Thursday', dayOfWeek: 4, isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
  { day: 'Friday', dayOfWeek: 5, isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
  { day: 'Saturday', dayOfWeek: 6, isOpen: true, openTime: '08:00', closeTime: '14:00', is24h: false },
  { day: 'Sunday', dayOfWeek: 7, isOpen: false, openTime: '08:00', closeTime: '18:00', is24h: false },
];

const DEFAULT_POLICY: PolicyForm = {
  maxConcurrentBookings: 3,
  maxAdvanceDays: 14,
  bookingLockWindowHours: 24,
};

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

export function minutesToTime(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** A close time at or before the open time means the window ends the next day. */
export function resolveScheduleWindow(
  openTime: string,
  closeTime: string
): ScheduleWindow {
  const openMin = timeToMinutes(openTime);
  let closeMin = timeToMinutes(closeTime);

  if (closeMin <= openMin) {
    closeMin += 1440;
  }

  return { openMin, closeMin };
}

/** <input type="time"> cannot represent 24:00; 00:00 is the same end of day. */
function toScheduleInputTime(time: string): string {
  return time === '24:00' ? '00:00' : time;
}

export function cloneDefaultSchedule(): ScheduleDay[] {
  return DEFAULT_WEEKLY_SCHEDULE.map((day) => ({ ...day }));
}

export function mergeScheduleWithHours(hours: OperatingHour[]): ScheduleDay[] {
  return DEFAULT_WEEKLY_SCHEDULE.map((day) => {
    const stored = hours.find(
      (hour) =>
        hour.dayOfWeek === day.dayOfWeek ||
        (day.dayOfWeek === 7 && hour.dayOfWeek === 0)
    );

    if (!stored) {
      return { ...day, isOpen: false };
    }

    return {
      ...day,
      isOpen: true,
      openTime: toScheduleInputTime(stored.openTime),
      closeTime: toScheduleInputTime(stored.closeTime),
      is24h:
        stored.openTime === '00:00' &&
        (stored.closeTime === '24:00' || stored.closeTime === '00:00'),
    };
  });
}

export function adjustScheduleTime(
  item: ScheduleDay,
  field: 'openTime' | 'closeTime',
  direction: 1 | -1,
  stepMinutes: number
): ScheduleDay {
  const { openMin, closeMin } = resolveScheduleWindow(item.openTime, item.closeTime);

  if (field === 'openTime') {
    const maxOpenMin = Math.min(1439, Math.max(0, closeMin - stepMinutes));
    const nextOpenMin = Math.min(
      Math.max(0, openMin + direction * stepMinutes),
      maxOpenMin
    );
    return { ...item, openTime: minutesToTime(nextOpenMin) };
  }

  // Preserve overnight windows by allowing the extended minute space to grow
  // past 24:00 when the existing close already rolled over.
  const maxCloseMin = closeMin > 1440 ? 2880 : 1440;
  const nextCloseMin = Math.min(
    Math.max(openMin + stepMinutes, closeMin + direction * stepMinutes),
    maxCloseMin
  );

  return { ...item, closeTime: minutesToTime(nextCloseMin), is24h: false };
}

export function getScheduleSlotEstimate(
  item: ScheduleDay,
  slotLengthMinutes: number
): number {
  if (!item.isOpen) return 0;

  const { openMin, closeMin } = resolveScheduleWindow(item.openTime, item.closeTime);
  const stepMinutes = slotLengthMinutes > 0 ? slotLengthMinutes : 60;
  return Math.max(0, Math.floor((closeMin - openMin) / stepMinutes));
}

export function buildOperatingHoursPayload(
  schedule: ScheduleDay[],
  slotLengthMinutes: number
): UpdateOperatingHoursRequest {
  return {
    hours: schedule.map((item) => ({
      dayOfWeek: item.dayOfWeek,
      isOpen: item.isOpen,
      ...(item.isOpen
        ? { openTime: item.openTime, closeTime: item.closeTime }
        : {}),
      slotLengthMinutes,
    })),
  };
}

/** API orchestration and schedule rules for the warehouse admin dashboard. */
export const warehouseAdminDashboardService = {
  async fetchWarehouses(): Promise<Warehouse[]> {
    const response = await warehouseApi.getAll();
    return response.data || [];
  },

  async fetchDocks(warehouseId: number): Promise<Dock[]> {
    const response = await warehouseApi.getDocks(warehouseId);
    return response.data || [];
  },

  /** Policies are optional server-side; absent configuration falls back to defaults. */
  async fetchPolicy(warehouseId: number): Promise<PolicyForm> {
    try {
      const response = await warehouseApi.getPolicy(warehouseId);
      return {
        maxConcurrentBookings: response.data.maxConcurrentBookings ?? DEFAULT_POLICY.maxConcurrentBookings,
        maxAdvanceDays: response.data.maxAdvanceDays ?? DEFAULT_POLICY.maxAdvanceDays,
        bookingLockWindowHours:
          response.data.bookingLockWindowHours ?? DEFAULT_POLICY.bookingLockWindowHours,
      };
    } catch {
      return { ...DEFAULT_POLICY };
    }
  },

  async fetchScheduleHours(
    warehouseId: number
  ): Promise<{ schedule: ScheduleDay[]; slotLengthMinutes?: number }> {
    const response = await warehouseApi.getHours(warehouseId);

    return {
      schedule: mergeScheduleWithHours(response.data?.operatingHours || []),
      slotLengthMinutes: response.data?.slotLengthMinutes,
    };
  },

  async fetchUsers(): Promise<User[]> {
    const response = await userApi.getUsers();
    return response.data || [];
  },

  async createWarehouse(data: CreateWarehouseRequest): Promise<Warehouse> {
    const response = await warehouseApi.create(data);
    return response.data;
  },

  async updateWarehouse(
    warehouseId: number,
    data: UpdateWarehouseRequest
  ): Promise<Warehouse> {
    const response = await warehouseApi.update(warehouseId, data);
    return response.data;
  },

  async createDock(warehouseId: number, data: CreateDockRequest): Promise<Dock> {
    const response = await warehouseApi.createDock(warehouseId, data);
    return response.data;
  },

  async updateDock(
    dockId: number,
    data: UpdateDockRequest,
    warehouseId?: number
  ): Promise<Dock> {
    const response = await warehouseApi.updateDock(dockId, data, warehouseId);
    return response.data;
  },

  async updateDockStatus(dockId: number, status: DockStatus): Promise<Dock> {
    const response = await warehouseApi.updateDockStatus(dockId, status);
    return response.data;
  },

  async updateSlotLength(
    warehouseId: number,
    slotLengthMinutes: number
  ): Promise<Warehouse> {
    const response = await warehouseApi.update(warehouseId, { slotLengthMinutes });
    return response.data;
  },

  async saveSchedule(
    warehouseId: number,
    schedule: ScheduleDay[],
    slotLengthMinutes: number
  ): Promise<{ schedule: ScheduleDay[] }> {
    const response = await warehouseApi.updateHours(
      warehouseId,
      buildOperatingHoursPayload(schedule, slotLengthMinutes)
    );

    return {
      schedule: mergeScheduleWithHours(response.data?.operatingHours || []),
    };
  },

  async savePolicy(
    warehouseId: number,
    policy: PolicyForm
  ): Promise<PolicyForm> {
    const payload: UpdateWarehousePolicyRequest = policy;
    const response = await warehouseApi.updatePolicy(warehouseId, payload);

    return {
      maxConcurrentBookings: response.data.maxConcurrentBookings,
      maxAdvanceDays: response.data.maxAdvanceDays,
      bookingLockWindowHours: response.data.bookingLockWindowHours,
    };
  },

  async inviteUser(email: string): Promise<{ message: string }> {
    const response = await userApi.inviteUser({ email: email.trim() });
    return {
      message: response.message || `Invitation successfully sent to ${email.trim()}.`,
    };
  },

  async deactivateUser(userId: number): Promise<{ message: string }> {
    const response = await userApi.deactivateUser(userId);
    return { message: response.message || 'User has been deactivated.' };
  },

  async reactivateUser(userId: number): Promise<{ message: string }> {
    const response = await userApi.reactivateUser(userId);
    return { message: response.message || 'User has been reactivated.' };
  },
};
