import React, { useState, useEffect, useCallback } from 'react';
import {
  Warehouse as WarehouseIcon,
  Layers,
  Clock,
  Calendar,
  ShieldCheck,
  Users,
  UserPlus,
  UserX,
  UserCheck,
  Plus,
  Edit2,
  Save,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sliders,
  X,
  Building2,
  Info,
  Check,
  SlidersHorizontal,
} from 'lucide-react';
import { warehouseApi } from '../api/warehouse.api';
import { userApi } from '../api/user.api';
import type {
  Warehouse,
  Dock,
  DockStatus,
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  CreateDockRequest,
} from '../types/warehouse.types';
import type { User } from '../types/user.types';
import { useAuth } from '../hooks/useAuth';

export const WarehouseAdminDashboard: React.FC = () => {
  const { user } = useAuth();

  // Active Tab: 'warehouses' | 'schedule' | 'policies' | 'users'
  const [activeTab, setActiveTab] = useState<'warehouses' | 'schedule' | 'policies' | 'users'>('warehouses');

  // Warehouses & Docks state
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [docks, setDocks] = useState<Dock[]>([]);
  const [isLoadingWarehouses, setIsLoadingWarehouses] = useState<boolean>(true);
  const [isLoadingDocks, setIsLoadingDocks] = useState<boolean>(false);

  // Modals & Forms
  const [isCreateWarehouseModalOpen, setIsCreateWarehouseModalOpen] = useState<boolean>(false);
  const [newWarehouseForm, setNewWarehouseForm] = useState<CreateWarehouseRequest>({
    name: '',
    address: '',
    timezone: 'Asia/Colombo',
    slotLengthMinutes: 60,
  });
  const [isSubmittingWarehouse, setIsSubmittingWarehouse] = useState<boolean>(false);

  // Editing Warehouse details
  const [editingWarehouseForm, setEditingWarehouseForm] = useState<UpdateWarehouseRequest>({
    name: '',
    address: '',
    timezone: 'Asia/Colombo',
    slotLengthMinutes: 60,
  });
  const [isSavingWarehouse, setIsSavingWarehouse] = useState<boolean>(false);

  // Dock Creation & Editing
  const [isCreateDockModalOpen, setIsCreateDockModalOpen] = useState<boolean>(false);
  const [newDockForm, setNewDockForm] = useState<CreateDockRequest>({
    name: '',
    status: 'ACTIVE',
  });
  const [isSubmittingDock, setIsSubmittingDock] = useState<boolean>(false);

  const [editingDock, setEditingDock] = useState<Dock | null>(null);
  const [editingDockName, setEditingDockName] = useState<string>('');
  const [isSavingDock, setIsSavingDock] = useState<boolean>(false);

  // Tab 2: Operating Hours & Slots
  const [scheduleSlotLength, setScheduleSlotLength] = useState<number>(60);
  const [isSavingSlotLength, setIsSavingSlotLength] = useState<boolean>(false);
  const [weeklySchedule, setWeeklySchedule] = useState([
    { day: 'Monday', isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
    { day: 'Tuesday', isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
    { day: 'Wednesday', isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
    { day: 'Thursday', isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
    { day: 'Friday', isOpen: true, openTime: '08:00', closeTime: '18:00', is24h: false },
    { day: 'Saturday', isOpen: true, openTime: '08:00', closeTime: '14:00', is24h: false },
    { day: 'Sunday', isOpen: false, openTime: '08:00', closeTime: '18:00', is24h: false },
  ]);
  const [scheduleSavedToast, setScheduleSavedToast] = useState<boolean>(false);

  // Tab 3: Policies
  const [policyForm, setPolicyForm] = useState<{
    maxConcurrentBookings: number;
    maxAdvanceDays: number;
    bookingLockWindowHours: number;
  }>({
    maxConcurrentBookings: 3,
    maxAdvanceDays: 14,
    bookingLockWindowHours: 24,
  });
  const [isLoadingPolicy, setIsLoadingPolicy] = useState<boolean>(false);
  const [isSavingPolicy, setIsSavingPolicy] = useState<boolean>(false);

  // Tab 4: Users
  const [organizationUsers, setOrganizationUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState<boolean>(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [isSendingInvite, setIsSendingInvite] = useState<boolean>(false);
  const [deactivatingUserId, setDeactivatingUserId] = useState<number | null>(null);
  const [reactivatingUserId, setReactivatingUserId] = useState<number | null>(null);

  // Feedback Notifications
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);

  // Helper to show temporary success banner
  const triggerSuccess = (msg: string) => {
    setSuccessBanner(msg);
    setErrorBanner(null);
    setTimeout(() => setSuccessBanner(null), 5000);
  };

  // 1. Fetch Warehouses
  const fetchWarehouses = useCallback(async () => {
    setIsLoadingWarehouses(true);
    try {
      const res = await warehouseApi.getAll();
      const list = res.data || [];
      setWarehouses(list);
      if (list.length > 0) {
        setSelectedWarehouseId((prev) => (prev && list.some((w) => w.id === prev) ? prev : list[0].id));
      } else {
        setSelectedWarehouseId(null);
      }
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to load warehouses.');
    } finally {
      setIsLoadingWarehouses(false);
    }
  }, []);

  // 2. Fetch Docks when selectedWarehouseId changes
  const fetchDocks = useCallback(async (warehouseId: number) => {
    setIsLoadingDocks(true);
    try {
      const res = await warehouseApi.getDocks(warehouseId);
      setDocks(res.data || []);
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to load docks for the selected warehouse.');
    } finally {
      setIsLoadingDocks(false);
    }
  }, []);

  // 3. Fetch Policy for selected warehouse
  const fetchPolicy = useCallback(async (warehouseId: number) => {
    setIsLoadingPolicy(true);
    try {
      const res = await warehouseApi.getPolicy(warehouseId);
      if (res?.data) {
        setPolicyForm({
          maxConcurrentBookings: res.data.maxConcurrentBookings ?? 3,
          maxAdvanceDays: res.data.maxAdvanceDays ?? 14,
          bookingLockWindowHours: res.data.bookingLockWindowHours ?? 24,
        });
      }
    } catch {
      // Use defaults if policy is unconfigured
      setPolicyForm({
        maxConcurrentBookings: 3,
        maxAdvanceDays: 14,
        bookingLockWindowHours: 24,
      });
    } finally {
      setIsLoadingPolicy(false);
    }
  }, []);

  // 4. Fetch Organization Users
  const fetchUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    try {
      const res = await userApi.getUsers();
      setOrganizationUsers(res.data || []);
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to load organization members.');
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    fetchWarehouses();
    fetchUsers();
  }, [fetchWarehouses, fetchUsers]);

  useEffect(() => {
    if (selectedWarehouseId) {
      fetchDocks(selectedWarehouseId);
      fetchPolicy(selectedWarehouseId);

      const currentWh = warehouses.find((w) => w.id === selectedWarehouseId);
      if (currentWh) {
        setEditingWarehouseForm({
          name: currentWh.name,
          address: currentWh.address,
          timezone: currentWh.timezone,
          slotLengthMinutes: currentWh.slotLengthMinutes,
        });
        setScheduleSlotLength(currentWh.slotLengthMinutes || 60);
      }
    } else {
      setDocks([]);
    }
  }, [selectedWarehouseId, warehouses, fetchDocks, fetchPolicy]);

  // Tab 1 Handlers: Create & Update Warehouse
  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWarehouseForm.name.trim() || !newWarehouseForm.address.trim()) return;

    setIsSubmittingWarehouse(true);
    setErrorBanner(null);
    try {
      const res = await warehouseApi.create(newWarehouseForm);
      triggerSuccess(`Warehouse facility '${res.data.name}' created successfully.`);
      setIsCreateWarehouseModalOpen(false);
      setNewWarehouseForm({
        name: '',
        address: '',
        timezone: 'Asia/Colombo',
        slotLengthMinutes: 60,
      });
      await fetchWarehouses();
      if (res.data.id) {
        setSelectedWarehouseId(res.data.id);
      }
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to create warehouse.');
    } finally {
      setIsSubmittingWarehouse(false);
    }
  };

  const handleUpdateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouseId) return;

    setIsSavingWarehouse(true);
    setErrorBanner(null);
    try {
      const res = await warehouseApi.update(selectedWarehouseId, editingWarehouseForm);
      triggerSuccess(`Warehouse '${res.data.name}' details updated successfully.`);
      await fetchWarehouses();
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to update warehouse details.');
    } finally {
      setIsSavingWarehouse(false);
    }
  };

  // Dock Handlers: Create, Edit Name, Toggle Status
  const handleCreateDock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouseId || !newDockForm.name.trim()) return;

    setIsSubmittingDock(true);
    setErrorBanner(null);
    try {
      const res = await warehouseApi.createDock(selectedWarehouseId, newDockForm);
      triggerSuccess(`Loading dock '${res.data.name}' added to warehouse.`);
      setIsCreateDockModalOpen(false);
      setNewDockForm({ name: '', status: 'ACTIVE' });
      await fetchDocks(selectedWarehouseId);
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to create loading dock.');
    } finally {
      setIsSubmittingDock(false);
    }
  };

  const handleStartEditDock = (dock: Dock) => {
    setEditingDock(dock);
    setEditingDockName(dock.name);
  };

  const handleSaveDockName = async () => {
    if (!editingDock || !editingDockName.trim()) return;

    setIsSavingDock(true);
    setErrorBanner(null);
    try {
      const res = await warehouseApi.updateDock(
        editingDock.id,
        { name: editingDockName.trim() },
        selectedWarehouseId || undefined
      );
      triggerSuccess(`Dock renamed to '${res.data.name}'.`);
      setEditingDock(null);
      if (selectedWarehouseId) {
        await fetchDocks(selectedWarehouseId);
      }
    } catch (err: any) {
      setErrorBanner(
        err.response?.data?.message ||
          'Failed to rename dock. Note: Dock name cannot be changed if active bookings with status BOOKED exist.'
      );
    } finally {
      setIsSavingDock(false);
    }
  };

  const handleToggleDockStatus = async (dock: Dock) => {
    const nextStatus: DockStatus = dock.status === 'ACTIVE' ? 'MAINTENANCE' : 'ACTIVE';
    setErrorBanner(null);
    try {
      await warehouseApi.updateDockStatus(dock.id, nextStatus);
      triggerSuccess(`Dock '${dock.name}' status set to ${nextStatus}.`);
      if (selectedWarehouseId) {
        await fetchDocks(selectedWarehouseId);
      }
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to update dock status.');
    }
  };

  // Tab 2 Handlers: Slot Length & Schedule
  const handleSaveSlotLength = async (newLength: number) => {
    if (!selectedWarehouseId) return;

    setIsSavingSlotLength(true);
    setErrorBanner(null);
    try {
      await warehouseApi.update(selectedWarehouseId, { slotLengthMinutes: newLength });
      setScheduleSlotLength(newLength);
      triggerSuccess(`Slot interval updated to ${newLength} minutes. Existing bookings retain their times.`);
      await fetchWarehouses();
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to update slot interval.');
    } finally {
      setIsSavingSlotLength(false);
    }
  };

  const handleSaveScheduleDesign = () => {
    setScheduleSavedToast(true);
    setTimeout(() => setScheduleSavedToast(false), 4000);
  };

  // Tab 3 Handlers: Booking Policies
  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouseId) return;

    setIsSavingPolicy(true);
    setErrorBanner(null);
    try {
      const res = await warehouseApi.updatePolicy(selectedWarehouseId, policyForm);
      triggerSuccess(`Booking policy updated for '${selectedWarehouse?.name || 'warehouse'}'.`);
      setPolicyForm({
        maxConcurrentBookings: res.data.maxConcurrentBookings,
        maxAdvanceDays: res.data.maxAdvanceDays,
        bookingLockWindowHours: res.data.bookingLockWindowHours,
      });
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to update warehouse policy.');
    } finally {
      setIsSavingPolicy(false);
    }
  };

  // Tab 4 Handlers: Users
  const handleInviteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsSendingInvite(true);
    setErrorBanner(null);
    try {
      const res = await userApi.inviteUser({ email: inviteEmail.trim() });
      triggerSuccess(res.message || `Invitation successfully sent to ${inviteEmail}.`);
      setInviteEmail('');
      setIsInviteModalOpen(false);
      await fetchUsers();
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to send invitation.');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleDeactivateUser = async (targetUser: User) => {
    const confirmed = window.confirm(
      `Are you sure you want to deactivate ${targetUser.email}? Their active sessions will be terminated immediately.`
    );
    if (!confirmed) return;

    setDeactivatingUserId(targetUser.id);
    setErrorBanner(null);
    try {
      const res = await userApi.deactivateUser(targetUser.id);
      triggerSuccess(res.message || `User ${targetUser.email} has been deactivated.`);
      await fetchUsers();
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to deactivate user.');
    } finally {
      setDeactivatingUserId(null);
    }
  };

  const handleReactivateUser = async (targetUser: User) => {
    const confirmed = window.confirm(
      `Are you sure you want to reactivate ${targetUser.email}? They will be permitted to log in and access system functions.`
    );
    if (!confirmed) return;

    setReactivatingUserId(targetUser.id);
    setErrorBanner(null);
    try {
      const res = await userApi.reactivateUser(targetUser.id);
      triggerSuccess(res.message || `User ${targetUser.email} has been reactivated.`);
      await fetchUsers();
    } catch (err: any) {
      setErrorBanner(err.response?.data?.message || 'Failed to reactivate user.');
    } finally {
      setReactivatingUserId(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Page Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-[#2F4F4F]/10 rounded-lg">
              <Building2 className="w-6 h-6 text-[#2F4F4F]" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Warehouse Admin Management</h1>
              <p className="text-xs text-gray-500">
                Configure facilities, docks, schedules, booking policies, and manage organization team members.
              </p>
            </div>
          </div>
        </div>

        {/* Global Facility Selector & Action */}
        <div className="flex items-center space-x-3">
          {isLoadingWarehouses ? (
            <div className="flex items-center space-x-2 text-xs text-gray-500 py-1.5 px-3">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#2F4F4F]" />
              <span>Loading facilities...</span>
            </div>
          ) : warehouses.length > 0 && (
            <div className="flex items-center space-x-2">
              <label htmlFor="facility-select" className="text-xs font-semibold text-gray-600 whitespace-nowrap">
                Active Facility:
              </label>
              <select
                id="facility-select"
                value={selectedWarehouseId || ''}
                onChange={(e) => setSelectedWarehouseId(Number(e.target.value))}
                className="text-xs font-semibold bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#2F4F4F]"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.docks?.length || 0} Docks)
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => setIsCreateWarehouseModalOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] rounded-lg shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Warehouse</span>
          </button>
        </div>
      </div>

      {/* Global Banners */}
      {errorBanner && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button onClick={() => setErrorBanner(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successBanner}</span>
          </div>
          <button onClick={() => setSuccessBanner(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 bg-white rounded-t-xl px-4 pt-2 shadow-sm space-x-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('warehouses')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'warehouses'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <WarehouseIcon className="w-4 h-4" />
          <span>Warehouses & Docks</span>
        </button>

        <button
          onClick={() => setActiveTab('schedule')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'schedule'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Operating Hours & Slots</span>
        </button>

        <button
          onClick={() => setActiveTab('policies')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'policies'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Booking Policies</span>
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center space-x-2 px-4 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'users'
              ? 'border-[#2F4F4F] text-[#2F4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User Management ({organizationUsers.length})</span>
        </button>
      </div>

      {/* Tab 1: Warehouses & Docks */}
      {activeTab === 'warehouses' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Facility Details Form (4 cols) */}
          <div className="lg:col-span-5 bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col space-y-5">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Facility Configuration</h3>
                <p className="text-xs text-gray-500">Edit general warehouse details.</p>
              </div>
              <span className="text-[10px] bg-[#2F4F4F]/10 text-[#2F4F4F] font-bold px-2 py-0.5 rounded">
                ID #{selectedWarehouseId || 'None'}
              </span>
            </div>

            {selectedWarehouse ? (
              <form onSubmit={handleUpdateWarehouse} className="space-y-4">
                <div>
                  <label htmlFor="wh-name" className="block text-xs font-semibold text-gray-700 mb-1">
                    Warehouse Name
                  </label>
                  <input
                    id="wh-name"
                    type="text"
                    value={editingWarehouseForm.name || ''}
                    onChange={(e) =>
                      setEditingWarehouseForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    required
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="wh-address" className="block text-xs font-semibold text-gray-700 mb-1">
                    Physical Address
                  </label>
                  <input
                    id="wh-address"
                    type="text"
                    value={editingWarehouseForm.address || ''}
                    onChange={(e) =>
                      setEditingWarehouseForm((prev) => ({ ...prev, address: e.target.value }))
                    }
                    required
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="wh-timezone" className="block text-xs font-semibold text-gray-700 mb-1">
                      IANA Timezone
                    </label>
                    <input
                      id="wh-timezone"
                      type="text"
                      value={editingWarehouseForm.timezone || ''}
                      onChange={(e) =>
                        setEditingWarehouseForm((prev) => ({ ...prev, timezone: e.target.value }))
                      }
                      required
                      placeholder="e.g. Asia/Colombo"
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="wh-slot-length" className="block text-xs font-semibold text-gray-700 mb-1">
                      Slot Interval
                    </label>
                    <select
                      id="wh-slot-length"
                      value={editingWarehouseForm.slotLengthMinutes || 60}
                      onChange={(e) =>
                        setEditingWarehouseForm((prev) => ({
                          ...prev,
                          slotLengthMinutes: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none bg-white"
                    >
                      <option value={30}>30 Minutes</option>
                      <option value={45}>45 Minutes</option>
                      <option value={60}>60 Minutes</option>
                    </select>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2 text-[11px] text-amber-800">
                  <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>
                    <strong>Driver Confusion Rule:</strong> Name, address, and timezone can only be updated when there
                    are no active bookings with status <code>BOOKED</code>. Existing confirmed bookings preserve their
                    original slot times.
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={isSavingWarehouse}
                  className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center space-x-2 shadow-sm"
                >
                  {isSavingWarehouse ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Facility Changes</span>
                </button>
              </form>
            ) : (
              <div className="py-12 text-center text-xs text-gray-500">
                No warehouse selected. Click "+ New Warehouse" above to add one.
              </div>
            )}
          </div>

          {/* Docks Management Section (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-[#2F4F4F]" />
                  <span>Loading Docks for {selectedWarehouse?.name || 'Selected Warehouse'}</span>
                </h3>
                <p className="text-xs text-gray-500">Manage dock names and active/maintenance operational statuses.</p>
              </div>

              {selectedWarehouseId && (
                <button
                  onClick={() => setIsCreateDockModalOpen(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Dock</span>
                </button>
              )}
            </div>

            {isLoadingDocks ? (
              <div className="py-16 text-center text-xs text-gray-500">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
                Loading loading docks...
              </div>
            ) : docks.length === 0 ? (
              <div className="py-12 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                No docks created for this warehouse yet. Click &quot;Add Dock&quot; to configure bays.
              </div>
            ) : (
              <div className="space-y-3">
                {docks.map((dock) => {
                  const isEditingThis = editingDock?.id === dock.id;

                  return (
                    <div
                      key={dock.id}
                      className="p-4 bg-gray-50 hover:bg-gray-100/80 border border-gray-200 rounded-xl flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center space-x-3 flex-1 mr-4">
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs ${
                            dock.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          #{dock.id}
                        </div>

                        {isEditingThis ? (
                          <div className="flex items-center space-x-2 flex-1 max-w-sm">
                            <input
                              type="text"
                              value={editingDockName}
                              onChange={(e) => setEditingDockName(e.target.value)}
                              placeholder="Dock name"
                              className="px-2.5 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none w-full bg-white"
                              autoFocus
                            />
                            <button
                              onClick={handleSaveDockName}
                              disabled={isSavingDock || !editingDockName.trim()}
                              className="px-2.5 py-1 text-xs font-semibold bg-[#2F4F4F] text-white rounded hover:bg-[#1E3333] disabled:opacity-50"
                            >
                              {isSavingDock ? <RefreshCw className="w-3 h-3 animate-spin" /> : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingDock(null)}
                              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-bold text-gray-900">{dock.name}</span>
                              <button
                                onClick={() => handleStartEditDock(dock)}
                                className="text-gray-400 hover:text-gray-600 p-0.5"
                                title="Rename Dock"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                            </div>
                            <span className="text-[11px] text-gray-500">
                              Bay ID: {dock.id} • Facility #{dock.warehouseId}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        {dock.effectiveStatus === 'MAINTENANCE' && dock.status === 'ACTIVE' ? (
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                              <span>Maintenance</span>
                            </span>
                            <span className="text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/60" title="Active scheduled maintenance closure window">
                              Active Closure
                            </span>
                          </div>
                        ) : (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              (dock.effectiveStatus || dock.status) === 'ACTIVE'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-amber-100 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {(dock.effectiveStatus || dock.status) === 'ACTIVE' ? 'Active' : 'Maintenance'}
                          </span>
                        )}

                        <button
                          onClick={() => handleToggleDockStatus(dock)}
                          className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${
                            dock.status === 'ACTIVE'
                              ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'
                              : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {dock.status === 'ACTIVE' ? 'Set Maintenance' : 'Set Active'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Operating Hours & Slots */}
      {activeTab === 'schedule' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                <Clock className="w-4 h-4 text-[#2F4F4F]" />
                <span>Operating Hours & Slot Intervals</span>
              </h3>
              <p className="text-xs text-gray-500">
                Configure standard warehouse shift operating hours template and default appointment duration.
              </p>
            </div>
          </div>

          {/* Slot Duration Configuration */}
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center space-x-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#2F4F4F]" />
              <span>Default Slot Duration (Interval)</span>
            </h4>
            <p className="text-xs text-gray-600">
              Select slot granularity for time-slot generation. Existing confirmed bookings retain their original times.
            </p>

            <div className="flex flex-wrap gap-3 pt-1">
              {[30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  onClick={() => handleSaveSlotLength(mins)}
                  disabled={isSavingSlotLength}
                  className={`px-4 py-2.5 rounded-lg text-xs font-bold border transition-all flex items-center space-x-2 ${
                    scheduleSlotLength === mins
                      ? 'bg-[#2F4F4F] text-white border-[#2F4F4F] shadow-sm'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {scheduleSlotLength === mins && <Check className="w-3.5 h-3.5" />}
                  <span>{mins} Minutes</span>
                </button>
              ))}
            </div>
          </div>

          {/* Daily Schedule Design Template */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center space-x-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#2F4F4F]" />
                <span>Weekly Operational Schedule Template</span>
              </h4>
              <button
                onClick={handleSaveScheduleDesign}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] rounded-lg transition-colors flex items-center space-x-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Schedule Template</span>
              </button>
            </div>

            {scheduleSavedToast && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-lg flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Operational weekly schedule template updated successfully.</span>
              </div>
            )}

            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {weeklySchedule.map((item, index) => (
                <div key={item.day} className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-gray-50/50">
                  <div className="flex items-center space-x-3 w-36">
                    <input
                      type="checkbox"
                      checked={item.isOpen}
                      onChange={(e) => {
                        const copy = [...weeklySchedule];
                        copy[index].isOpen = e.target.checked;
                        setWeeklySchedule(copy);
                      }}
                      className="rounded border-gray-300 text-[#2F4F4F] focus:ring-[#2F4F4F]"
                    />
                    <span className={`text-xs font-bold ${item.isOpen ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                      {item.day}
                    </span>
                  </div>

                  {item.isOpen ? (
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-1.5 text-xs">
                        <span className="text-gray-500">Opens:</span>
                        <input
                          type="time"
                          value={item.openTime}
                          onChange={(e) => {
                            const copy = [...weeklySchedule];
                            copy[index].openTime = e.target.value;
                            setWeeklySchedule(copy);
                          }}
                          className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#2F4F4F]"
                        />
                      </div>

                      <span className="text-gray-400">—</span>

                      <div className="flex items-center space-x-1.5 text-xs">
                        <span className="text-gray-500">Closes:</span>
                        <input
                          type="time"
                          value={item.closeTime}
                          onChange={(e) => {
                            const copy = [...weeklySchedule];
                            copy[index].closeTime = e.target.value;
                            setWeeklySchedule(copy);
                          }}
                          className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-[#2F4F4F]"
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400 italic">Facility Closed</span>
                  )}

                  <div className="text-[11px] text-gray-500 font-medium">
                    {item.isOpen ? `${Math.floor((10 * 60) / scheduleSlotLength)} slots/dock est.` : '0 slots'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Booking Policies */}
      {activeTab === 'policies' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 max-w-3xl space-y-6">
          <div className="border-b pb-4">
            <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-[#2F4F4F]" />
              <span>Anti-Hogging & Booking Reservation Policies</span>
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Configure reservation horizons, carrier concurrency limits, and modification lock windows for{' '}
              <strong>{selectedWarehouse?.name || 'this warehouse'}</strong>.
            </p>
          </div>

          {isLoadingPolicy ? (
            <div className="py-12 text-center text-xs text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
              Loading policy settings...
            </div>
          ) : (
            <form onSubmit={handleSavePolicy} className="space-y-5">
              <div>
                <label htmlFor="max-concurrent-bookings" className="block text-xs font-bold text-gray-800 mb-1">
                  Max Concurrent Active Bookings per Carrier
                </label>
                <input
                  id="max-concurrent-bookings"
                  type="number"
                  min={1}
                  max={20}
                  value={policyForm.maxConcurrentBookings}
                  onChange={(e) =>
                    setPolicyForm((prev) => ({
                      ...prev,
                      maxConcurrentBookings: Number(e.target.value),
                    }))
                  }
                  required
                  className="w-full max-w-xs px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Default: 3. Maximum number of simultaneous uncompleted bookings (<code>BOOKED</code>, <code>ARRIVED</code>)
                  a single carrier organization can hold at this warehouse. Prevents bay hoarding.
                </p>
              </div>

              <div>
                <label htmlFor="max-advance-days" className="block text-xs font-bold text-gray-800 mb-1">
                  Maximum Advance Reservation Window (Days)
                </label>
                <input
                  id="max-advance-days"
                  type="number"
                  min={1}
                  max={60}
                  value={policyForm.maxAdvanceDays}
                  onChange={(e) =>
                    setPolicyForm((prev) => ({
                      ...prev,
                      maxAdvanceDays: Number(e.target.value),
                    }))
                  }
                  required
                  className="w-full max-w-xs px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Default: 14 days. Carriers cannot book slots further into the future than this horizon.
                </p>
              </div>

              <div>
                <label htmlFor="booking-lock-hours" className="block text-xs font-bold text-gray-800 mb-1">
                  Hard-Lock Window before Slot Start (Hours)
                </label>
                <input
                  id="booking-lock-hours"
                  type="number"
                  min={1}
                  max={72}
                  value={policyForm.bookingLockWindowHours}
                  onChange={(e) =>
                    setPolicyForm((prev) => ({
                      ...prev,
                      bookingLockWindowHours: Number(e.target.value),
                    }))
                  }
                  required
                  className="w-full max-w-xs px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Default: 24 hours. Prevents standard carrier cancellations inside this window. Allows emergency same-day
                  slot transfers.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingPolicy}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center space-x-2 shadow-sm"
                >
                  {isSavingPolicy ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Policy Settings</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Tab 4: User Management */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#2F4F4F]" />
                <span>Organization Team Members & Access</span>
              </h3>
              <p className="text-xs text-gray-500">
                Invite new dock managers, view active staff, and deactivate credentials instantly with Redis session revocation.
              </p>
            </div>

            <button
              onClick={() => setIsInviteModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Invite Staff</span>
            </button>
          </div>

          {isLoadingUsers ? (
            <div className="py-16 text-center text-xs text-gray-500">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
              Loading organization team members...
            </div>
          ) : organizationUsers.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              No users found.
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {organizationUsers.map((u) => {
                const isDeactivated = u.isActive === false;
                const isSelf = u.id === user?.id;

                return (
                  <div
                    key={u.id}
                    className="p-4 flex items-center justify-between hover:bg-gray-50/70 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${
                          isDeactivated
                            ? 'bg-red-100 text-red-700'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {u.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-gray-900">{u.email}</span>
                          {isSelf && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded">
                              You
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 mt-0.5">
                          <span className="text-[11px] font-semibold text-gray-500">{u.role}</span>
                          <span className="text-gray-300">•</span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center space-x-1 ${
                              isDeactivated
                                ? 'bg-red-50 text-red-600 border border-red-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {isDeactivated ? (
                              <>
                                <UserX className="w-2.5 h-2.5" />
                                <span>Deactivated</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-2.5 h-2.5" />
                                <span>Active</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {isSelf ? (
                        <span className="text-xs text-gray-400 font-medium">Current Session</span>
                      ) : isDeactivated ? (
                        <button
                          onClick={() => handleReactivateUser(u)}
                          disabled={reactivatingUserId === u.id}
                          className="px-3 py-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded-lg transition-colors flex items-center space-x-1 disabled:opacity-50"
                        >
                          {reactivatingUserId === u.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserCheck className="w-3 h-3" />
                          )}
                          <span>Reactivate</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeactivateUser(u)}
                          disabled={deactivatingUserId === u.id}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 border border-red-200 hover:bg-red-50 rounded-lg transition-colors flex items-center space-x-1 disabled:opacity-50"
                        >
                          {deactivatingUserId === u.id ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <UserX className="w-3 h-3" />
                          )}
                          <span>Deactivate</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Create Warehouse */}
      {isCreateWarehouseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <WarehouseIcon className="w-4 h-4 text-emerald-400" />
                <span>Create New Warehouse Facility</span>
              </h3>
              <button
                onClick={() => setIsCreateWarehouseModalOpen(false)}
                className="text-gray-300 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateWarehouse} className="p-6 space-y-4">
              <div>
                <label htmlFor="create-wh-name" className="block text-xs font-semibold text-gray-700 mb-1">
                  Facility Name
                </label>
                <input
                  id="create-wh-name"
                  type="text"
                  placeholder="e.g. Colombo Western Terminal"
                  value={newWarehouseForm.name}
                  onChange={(e) => setNewWarehouseForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="create-wh-address" className="block text-xs font-semibold text-gray-700 mb-1">
                  Address
                </label>
                <input
                  id="create-wh-address"
                  type="text"
                  placeholder="e.g. 500 Port Access Rd, Colombo"
                  value={newWarehouseForm.address}
                  onChange={(e) => setNewWarehouseForm((prev) => ({ ...prev, address: e.target.value }))}
                  required
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="create-wh-timezone" className="block text-xs font-semibold text-gray-700 mb-1">
                    Timezone
                  </label>
                  <input
                    id="create-wh-timezone"
                    type="text"
                    value={newWarehouseForm.timezone}
                    onChange={(e) => setNewWarehouseForm((prev) => ({ ...prev, timezone: e.target.value }))}
                    required
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="create-wh-slot-length" className="block text-xs font-semibold text-gray-700 mb-1">
                    Slot Interval
                  </label>
                  <select
                    id="create-wh-slot-length"
                    value={newWarehouseForm.slotLengthMinutes}
                    onChange={(e) =>
                      setNewWarehouseForm((prev) => ({
                        ...prev,
                        slotLengthMinutes: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none bg-white"
                  >
                    <option value={30}>30 Minutes</option>
                    <option value={45}>45 Minutes</option>
                    <option value={60}>60 Minutes</option>
                  </select>
                </div>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateWarehouseModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWarehouse}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center space-x-1.5"
                >
                  {isSubmittingWarehouse && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Facility</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Create Dock */}
      {isCreateDockModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <span>Add Dock to {selectedWarehouse?.name}</span>
              </h3>
              <button onClick={() => setIsCreateDockModalOpen(false)} className="text-gray-300 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateDock} className="p-6 space-y-4">
              <div>
                <label htmlFor="dock-name" className="block text-xs font-semibold text-gray-700 mb-1">
                  Dock Bay Name
                </label>
                <input
                  id="dock-name"
                  type="text"
                  placeholder="e.g. Bay 03 - Cold Storage Express"
                  value={newDockForm.name}
                  onChange={(e) => setNewDockForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="dock-status" className="block text-xs font-semibold text-gray-700 mb-1">
                  Initial Status
                </label>
                <select
                  id="dock-status"
                  value={newDockForm.status}
                  onChange={(e) =>
                    setNewDockForm((prev) => ({ ...prev, status: e.target.value as DockStatus }))
                  }
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none bg-white"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                </select>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCreateDockModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingDock}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center space-x-1.5"
                >
                  {isSubmittingDock && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Add Dock</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Invite Team Member */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center space-x-2">
                <UserPlus className="w-4 h-4 text-emerald-400" />
                <span>Invite Team Member</span>
              </h3>
              <button onClick={() => setIsInviteModalOpen(false)} className="text-gray-300 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleInviteUser} className="p-6 space-y-4">
              <div>
                <label htmlFor="invite-email" className="block text-xs font-semibold text-gray-700 mb-1">
                  Team Member Email Address
                </label>
                <input
                  id="invite-email"
                  type="email"
                  placeholder="manager@colombo-yard.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#2F4F4F] focus:outline-none"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Invited users to a Warehouse Operator organization will automatically be designated the{' '}
                  <strong>DOCK_MANAGER</strong> role.
                </p>
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingInvite}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#2F4F4F] hover:bg-[#1E3333] disabled:opacity-50 rounded-lg transition-colors flex items-center space-x-1.5"
                >
                  {isSendingInvite && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Send Invitation</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseAdminDashboard;
