import apiClient from './client';
import type {
  Warehouse,
  Dock,
  DockClosure,
  CreateDockClosureRequest,
  DockStatus,
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

  getDocks: async (warehouseId: number): Promise<{ success: boolean; data: Dock[] }> => {
    const response = await apiClient.get<{ success: boolean; data: Dock[] }>(
      `/warehouses/${warehouseId}/docks`
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
};

export default warehouseApi;
