import { api } from "@/lib/api";

import type {
  AuditLog,
  Branch,
  BranchUsage,
  DashboardSummary,
  DiningTable,
  Employee,
  EmployeeCreateInput,
  EmployeeUpdateInput,
  KitchenTicket,
  KitchenTicketStatus,
  Order,
  OrderStatus,
  PageResult,
  PrintJob,
  PrinterDevice,
  QrRequest,
  QrRequestStatus,
  Role,
  RoleCreateInput,
  RoleUpdateInput,
  SalesSummary,
  Station,
  Tenant,
} from "./types";

export const adminKeys = {
  root: ["admin-operations"] as const,
  dashboard: () => [...adminKeys.root, "dashboard"] as const,
  tables: () => [...adminKeys.root, "tables"] as const,
  orders: (status: string, offset: number, limit: number) =>
    [...adminKeys.root, "orders", status, offset, limit] as const,
  order: (id: string) => [...adminKeys.root, "order", id] as const,
  qrRequests: (status: string) => [...adminKeys.root, "qr-requests", status] as const,
  stations: (branchId = "current") => [...adminKeys.root, "stations", branchId] as const,
  printJobs: (branchId = "current") => [...adminKeys.root, "print-jobs", branchId] as const,
  printerDevices: (branchId: string) =>
    [...adminKeys.root, "printer-devices", branchId] as const,
  kitchenTickets: (stationId: string, includeCompleted: boolean) =>
    [...adminKeys.root, "kitchen-tickets", stationId, includeCompleted] as const,
  employees: () => [...adminKeys.root, "employees"] as const,
  branches: () => [...adminKeys.root, "branches"] as const,
  branchUsage: () => [...adminKeys.root, "branch-usage"] as const,
  roles: () => [...adminKeys.root, "roles"] as const,
  permissions: () => [...adminKeys.root, "permissions"] as const,
  report: (from: string, to: string) => [...adminKeys.root, "report", from, to] as const,
  audit: (action: string, limit: number) => [...adminKeys.root, "audit", action, limit] as const,
  businesses: () => [...adminKeys.root, "businesses"] as const,
};

export const adminApi = {
  dashboard: (signal?: AbortSignal) => api.get<DashboardSummary>("dashboard", { signal }),
  tables: (signal?: AbortSignal) => api.get<DiningTable[]>("tables", { signal }),
  orders: (
    input: { status?: OrderStatus; offset?: number; limit?: number } = {},
    signal?: AbortSignal,
  ) =>
    api.get<PageResult<Order>>("orders", {
      search: {
        status: input.status,
        offset: input.offset ?? 0,
        limit: input.limit ?? 50,
      },
      signal,
    }),
  order: (id: string, signal?: AbortSignal) => api.get<Order>(`orders/${id}`, { signal }),
  acceptOrder: (id: string) => api.post<Order>(`orders/${id}/accept`),
  qrRequests: (status?: QrRequestStatus, signal?: AbortSignal) =>
    api.get<QrRequest[]>("qr/requests", { search: { status }, signal }),
  approveQrRequest: (id: string) => api.post<QrRequest>(`qr/requests/${id}/approve`),
  rejectQrRequest: (id: string) => api.post<QrRequest>(`qr/requests/${id}/reject`),
  stations: (signal?: AbortSignal, branchId?: string) =>
    api.get<Station[]>("catalog/stations", {
      search: { branch_id: branchId },
      signal,
    }),
  createStation: (input: { name: string; code: string; sort_order: number }) =>
    api.post<Station>("catalog/stations", input),
  printJobs: (signal?: AbortSignal, branchId?: string) =>
    api.get<PrintJob[]>("printing/jobs", {
      search: { branch_id: branchId },
      signal,
    }),
  printerDevices: (branchId: string, signal?: AbortSignal) =>
    api.get<PrinterDevice[]>("printing/devices", {
      search: { branch_id: branchId },
      signal,
    }),
  createPrinterDevice: (input: {
    branch_id: string;
    preparation_station_id: string | null;
    code: string;
    name: string;
    transport: string;
    settings: Record<string, unknown>;
  }) => api.post<PrinterDevice>("printing/devices", input),
  updatePrinterDevice: (
    id: string,
    input: {
      name?: string;
      preparation_station_id?: string | null;
      transport?: string;
      is_active?: boolean;
      settings?: Record<string, unknown>;
    },
  ) => api.patch<PrinterDevice>(`printing/devices/${id}`, input),
  testPrinterDevice: (id: string) =>
    api.post<PrintJob>(`printing/devices/${id}/test`),
  kitchenTickets: (
    input: { stationId?: string; includeCompleted?: boolean } = {},
    signal?: AbortSignal,
  ) =>
    api.get<KitchenTicket[]>("kitchen/tickets", {
      search: {
        station_id: input.stationId,
        include_completed: input.includeCompleted ?? false,
      },
      signal,
    }),
  updateKitchenTicket: (id: string, status: KitchenTicketStatus) =>
    api.patch<KitchenTicket>(`kitchen/tickets/${id}/status`, { status }),
  employees: (signal?: AbortSignal) => api.get<Employee[]>("users", { signal }),
  createEmployee: (input: EmployeeCreateInput) => api.post<Employee>("users", input),
  updateEmployee: (id: string, input: EmployeeUpdateInput) =>
    api.patch<Employee>(`users/${id}`, input),
  resetEmployeePassword: (id: string, password: string) =>
    api.post<void>(`users/${id}/password`, { password }),
  setEmployeePin: (id: string, pin: string | null) =>
    api.put<void>(`users/${id}/pin`, { pin }),
  roles: (signal?: AbortSignal) => api.get<Role[]>("roles", { signal }),
  createRole: (input: RoleCreateInput) => api.post<Role>("roles", input),
  updateRole: (id: string, input: RoleUpdateInput) => api.patch<Role>(`roles/${id}`, input),
  permissions: (signal?: AbortSignal) => api.get<string[]>("permissions", { signal }),
  salesSummary: (from: string, to: string, signal?: AbortSignal) =>
    api.get<SalesSummary>("reports/sales-summary", {
      search: { date_from: from, date_to: to },
      signal,
    }),
  auditLogs: (action: string, limit = 250, signal?: AbortSignal) =>
    api.get<AuditLog[]>("audit-logs", {
      search: { action: action || undefined, limit },
      signal,
    }),
  businesses: (signal?: AbortSignal) =>
    api.get<PageResult<Tenant>>("businesses", {
      search: { limit: 50, offset: 0 },
      signal,
    }),
  updateBusiness: (
    id: string,
    input: { name: string; default_currency: string; prevent_negative_stock: boolean },
  ) =>
    api.patch<Tenant>(`businesses/${id}`, input),
  branches: (signal?: AbortSignal) => api.get<Branch[]>("branches", { signal }),
  branchUsage: (signal?: AbortSignal) =>
    api.get<BranchUsage>("branches/usage", { signal }),
  createBranch: (input: {
    name: string;
    slug: string;
    timezone: string;
    address: string | null;
    phone: string | null;
    working_hours: Branch["working_hours"];
  }) => api.post<Branch>("branches", input),
  updateBranch: (
    id: string,
    input: {
      name?: string;
      timezone?: string;
      address?: string | null;
      phone?: string | null;
      working_hours?: Branch["working_hours"];
      is_active?: boolean;
    },
  ) => api.patch<Branch>(`branches/${id}`, input),
};
