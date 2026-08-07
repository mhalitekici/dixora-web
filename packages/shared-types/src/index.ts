export type UUID = string;
export type IsoDateTime = string;
export type DecimalString = string;

export interface TenantContext {
  tenantId: UUID;
  branchId: UUID | null;
  userId: UUID;
  sessionId: UUID;
  permissions: readonly string[];
}

export interface AuthLoginInput {
  businessSlug: string | null;
  identifier: string;
  password: string;
  branchId?: UUID | null;
  rememberMe: boolean;
}

export interface AuthSessionPolicy {
  expiresIn: number;
  refreshExpiresIn: number;
  rememberMe: boolean;
}

export interface TenantOwned {
  tenantId: UUID;
}

export interface BranchOwned extends TenantOwned {
  branchId: UUID;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  field?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface ApiErrorResponse {
  error: ApiErrorDetail;
  requestId: string;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: readonly T[];
  page: PageInfo;
}

export const TABLE_STATES = [
  "AVAILABLE",
  "OCCUPIED",
  "ORDER_PENDING",
  "PREPARING",
  "READY",
  "BILL_REQUESTED",
  "PAYMENT_PENDING",
  "CLEANING",
  "DISABLED",
] as const;
export type TableState = (typeof TABLE_STATES)[number];

export const ORDER_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "AWAITING_APPROVAL",
  "ACCEPTED",
  "PREPARING",
  "PARTIALLY_READY",
  "READY",
  "SERVED",
  "BILL_REQUESTED",
  "PAYMENT_PENDING",
  "PAID",
  "CANCELLED",
  "VOIDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PRINT_JOB_STATUSES = [
  "PENDING",
  "CLAIMED",
  "SENT",
  "PRINTED",
  "FAILED",
  "CANCELLED",
] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export interface ReceiptLine {
  name: string;
  quantity: DecimalString;
  unitPrice?: DecimalString;
  modifiers?: readonly string[];
  note?: string;
}

export interface ReceiptDocument {
  title: string;
  branchName: string;
  stationName: string;
  orderNumber: string;
  tableName?: string;
  waiterName?: string;
  submittedAt: IsoDateTime;
  currency?: string;
  lines: readonly ReceiptLine[];
  footer?: readonly string[];
}

export interface PrintJobClaim extends BranchOwned {
  id: UUID;
  printerDeviceId: UUID | string;
  preparationStationId: UUID | null;
  orderId: UUID;
  kitchenTicketId: UUID | null;
  contentType: "application/vnd.dixora.receipt+json";
  document: ReceiptDocument;
  copies: number;
  isReprint: boolean;
  attemptCount: number;
  claimedAt: IsoDateTime;
}

export interface PrintResult {
  externalReference: string;
  printedAt: IsoDateTime;
  transport: "mock";
}

export interface RealtimeEnvelope<TPayload = unknown> {
  id: UUID;
  tenantId: UUID;
  branchId: UUID | null;
  type: string;
  occurredAt: IsoDateTime;
  version: number;
  payload: TPayload;
}
