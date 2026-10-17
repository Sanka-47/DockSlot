import apiClient from './client';
import type {
  Warehouse,
  Dock,
  DockClosure,
  CreateDockClosureRequest,
  DockStatus,
  AvailableDockSlots,
  WarehousePolicy,
  UpdateWarehousePolicyRequest,
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  CreateDockRequest,
  UpdateDockRequest,
  WarehouseHours,
  UpdateOperatingHoursRequest,
} from '../types/warehouse.types';

export const warehouseApi = {
  getAll: async (): Promise<{ success: boolean; data: Warehouse[] }> => {
    const response = await apiClient.get<{ success: boolean; data: Warehouse[] }>('/warehouses');
    return response.data;
  },

  getById: async (id: number | string): Promise<{ success: boolean; data: Warehouse }> => {
    const response = await apiClient.get<{ success: boolean; data: Warehouse }>(`/warehouses/${id}`);
    return response.data;
  },

  create: async (
    data: CreateWarehouseRequest
  ): Promise<{ success: boolean; message: string; data: Warehouse }> => {
    const response = await apiClient.post<{ success: boolean; message: string; data: Warehouse }>(
      '/warehouses',
      data
    );
    return response.data;
  },

  update: async (
    warehouseId: number,
    data: UpdateWarehouseRequest
  ): Promise<{ success: boolean; message: string; data: Warehouse }> => {
    const response = await apiClient.put<{ success: boolean; message: string; data: Warehouse }>(
      `/warehouses/${warehouseId}`,
      data
    );
    return response.data;
  },

  getHours: async (warehouseId: number): Promise<{ success: boolean; data: WarehouseHours }> => {
    const response = await apiClient.get<{ success: boolean; data: WarehouseHours }>(
      `/warehouses/${warehouseId}/hours`
    );
    return response.data;
  },

  updateHours: async (
    warehouseId: number,
    data: UpdateOperatingHoursRequest
  ): Promise<{ success: boolean; message: string; data: WarehouseHours }> => {
    const response = await apiClient.put<{
      success: boolean;
      message: string;
      data: WarehouseHours;
    }>(`/warehouses/${warehouseId}/hours`, data);
    return response.data;
  },

  getDocks: async (warehouseId: number): Promise<{ success: boolean; data: Dock[] }> => {    const response = await apiClient.get<{ success: boolean; data: Dock[] }>(
      `/warehouses/${warehouseId}/docks`
    );
    return response.data;
  },

  createDock: async (
    warehouseId: number,
    data: CreateDockRequest
  ): Promise<{ success: boolean; message: string; data: Dock }> => {
    const response = await apiClient.post<{ success: boolean; message: string; data: Dock }>(
      `/warehouses/${warehouseId}/docks`,
      data
    );
    return response.data;
  },

  updateDock: async (
    dockId: number,
    data: UpdateDockRequest,
    warehouseId?: number
  ): Promise<{ success: boolean; message: string; data: Dock }> => {
    const path = warehouseId
      ? `/warehouses/${warehouseId}/docks/${dockId}`
      : `/warehouses/docks/${dockId}`;
    const response = await apiClient.patch<{ success: boolean; message: string; data: Dock }>(
      path,
      data
    );
    return response.data;
  },

  updateDockStatus: async (
    dockId: number,
    status: DockStatus
  ): Promise<{ success: boolean; message: string; data: Dock }> => {
    const response = await apiClient.patch<{ success: boolean; message: string; data: Dock }>(
      `/warehouses/docks/${dockId}/status`,
      { status }
    );
    return response.data;
  },

  createDockClosure: async (
    dockId: number,
    data: CreateDockClosureRequest
  ): Promise<{ success: boolean; message: string; data: DockClosure }> => {
    const response = await apiClient.post<{ success: boolean; message: string; data: DockClosure }>(
      `/warehouses/docks/${dockId}/closures`,
      data
    );
    return response.data;
  },

  getDockClosures: async (
    dockId: number
  ): Promise<{ success: boolean; data: DockClosure[] }> => {
    const response = await apiClient.get<{ success: boolean; data: DockClosure[] }>(
      `/warehouses/docks/${dockId}/closures`
    );
    return response.data;
  },

  getAvailableSlots: async (
    warehouseId: number,
    targetDate: string,
    dockId?: number
  ): Promise<{ success: boolean; data: AvailableDockSlots[] }> => {
    const params: Record<string, string | number> = {
      targetDate,
      date: targetDate,
    };
    if (dockId !== undefined) {
      params.dockId = dockId;
    }
    const response = await apiClient.get<{ success: boolean; data: AvailableDockSlots[] }>(
      `/warehouses/${warehouseId}/slots`,
      { params }
    );
    return response.data;
  },

  getPolicy: async (
    warehouseId: number
  ): Promise<{ success: boolean; data: WarehousePolicy }> => {
    const response = await apiClient.get<{ success: boolean; data: WarehousePolicy }>(
      `/warehouses/${warehouseId}/policy`
    );
    return response.data;
  },

  updatePolicy: async (
    warehouseId: number,
    data: UpdateWarehousePolicyRequest
  ): Promise<{ success: boolean; message: string; data: WarehousePolicy }> => {
    const response = await apiClient.put<{ success: boolean; message: string; data: WarehousePolicy }>(
      `/warehouses/${warehouseId}/policy`,
      data
    );
    return response.data;
  },
};

export default warehouseApi;
