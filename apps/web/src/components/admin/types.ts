export type PageResult<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type DashboardSummary = {
  open_tables: number;
  total_tables: number;
  active_orders: number;
  waiting_preparation: number;
  ready_orders: number;
  sales_today: string;
  paid_orders_today: number;
  average_order_value: string;
  low_stock_items: number;
  cancelled_items_today: number;
  discounts_today: string;
  current_shift_status: "OPEN" | "CLOSED";
  printer_warnings: number;
  station_warnings: number;
  hourly_sales: Array<{
    hour: string;
    revenue: string;
    orders: number;
  }>;
  top_products: Array<{
    product_id: string;
    name: string;
    quantity: string;
    revenue: string;
  }>;
  low_stock_products: Array<{
    item_id: string;
    name: string;
    unit: string;
    current_stock: string;
    minimum_stock: string;
  }>;
};

export type TableState =
  | "AVAILABLE"
  | "OCCUPIED"
  | "ORDER_PENDING"
  | "PREPARING"
  | "READY"
  | "BILL_REQUESTED"
  | "PAYMENT_PENDING"
  | "CLEANING"
  | "DISABLED";

export type DiningTable = {
  id: string;
  tenant_id: string;
  branch_id: string;
  area_id: string;
  name: string;
  capacity: number;
  sort_order: number;
  is_active: boolean;
  qr_token: string;
  state: TableState;
  version: number;
};

export type OrderStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "AWAITING_APPROVAL"
  | "ACCEPTED"
  | "PREPARING"
  | "PARTIALLY_READY"
  | "READY"
  | "SERVED"
  | "BILL_REQUESTED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "CANCELLED"
  | "VOIDED";

export type OrderSource =
  | "WAITER"
  | "CASHIER"
  | "QR"
  | "TAKEAWAY"
  | "DELIVERY"
  | "KIOSK"
  | "API";

export type OrderItemModifier = {
  id: string;
  modifier_id: string | null;
  name_snapshot: string;
  price_delta_snapshot: string;
  quantity: number;
};

export type OrderItem = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price: string;
  quantity: string;
  tax_rate_snapshot: string;
  discount_snapshot: string;
  line_total: string;
  status: string;
  note: string | null;
  modifiers: OrderItemModifier[];
};

export type Payment = {
  id: string;
  method: string;
  amount: string;
  status: string;
  reference: string | null;
};

export type Order = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_session_id: string | null;
  source: OrderSource;
  status: OrderStatus;
  customer_name: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  version: number;
  created_at: string;
  items: OrderItem[];
  payments: Payment[];
};

export type QrRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export type QrRequest = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  order_id: string | null;
  status: QrRequestStatus;
  items_payload: Array<Record<string, unknown>>;
  customer_note: string | null;
  expires_at: string;
  created_at: string;
};

export type Station = {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  code: string;
  is_active: boolean;
  sort_order: number;
};

export type PrintJobStatus =
  | "PENDING"
  | "CLAIMED"
  | "SENT"
  | "PRINTED"
  | "FAILED"
  | "CANCELLED";

export type PrintJob = {
  id: string;
  tenant_id: string;
  branch_id: string;
  preparation_station_id: string | null;
  printer_device_id: string | null;
  claimed_by_bridge_id: string | null;
  order_id: string | null;
  kitchen_ticket_id: string | null;
  payload: Record<string, unknown>;
  status: PrintJobStatus;
  kind: "ORIGINAL" | "COPY" | "REPRINT";
  attempt_count: number;
  last_error: string | null;
  created_at: string;
};

export type KitchenTicketStatus =
  | "NEW"
  | "ACCEPTED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED";

export type KitchenTicketItem = {
  id: string;
  order_item_id: string;
  name: string;
  quantity: string;
  note: string | null;
  modifiers: string[];
  status: string;
};

export type KitchenTicket = {
  id: string;
  tenant_id: string;
  branch_id: string;
  order_id: string;
  preparation_station_id: string;
  station_name: string;
  table_name: string | null;
  waiter_name: string | null;
  order_source: OrderSource;
  batch_number: number;
  status: KitchenTicketStatus;
  created_at: string;
  items: KitchenTicketItem[];
};

export type Branch = {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  working_hours: WorkingHours;
  is_active: boolean;
  archived_at: string | null;
};

export type DayHours = {
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
};

export type WorkingHours = Partial<
  Record<
    | "monday"
    | "tuesday"
    | "wednesday"
    | "thursday"
    | "friday"
    | "saturday"
    | "sunday",
    DayHours
  >
>;

export type BranchPricing = {
  currency: string;
  base_monthly_price: string;
  included_branches: number;
  additional_branch_price: string;
  active_branches: number;
  billable_extra_branches: number;
  monthly_total: string;
  next_branch_monthly_total: string;
};

export type BranchUsage = {
  plan_name: string | null;
  max_branches: number | null;
  active_branches: number;
  total_branches: number;
  can_create: boolean;
};

export type Employee = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  preparation_station_id: string | null;
  role_id: string;
  role: string;
  username: string;
  email: string | null;
  phone: string | null;
  display_name: string;
  is_active: boolean;
  has_pin: boolean;
  permissions: string[];
};

export type Role = {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
};

export type EmployeeCreateInput = {
  username: string;
  email: string | null;
  display_name: string;
  phone: string | null;
  role_id: string;
  branch_id: string | null;
  preparation_station_id: string | null;
  temporary_password: string;
  pin?: string | null;
  is_active: boolean;
};

export type EmployeeUpdateInput = {
  display_name?: string;
  email?: string | null;
  phone?: string | null;
  role_id?: string;
  branch_id?: string | null;
  preparation_station_id?: string | null;
  is_active?: boolean;
};

export type PrinterDevice = {
  id: string;
  tenant_id: string;
  branch_id: string;
  preparation_station_id: string | null;
  code: string;
  name: string;
  transport: string;
  is_active: boolean;
  last_seen_at: string | null;
  settings: Record<string, unknown>;
};

export type RoleCreateInput = {
  code: string;
  name: string;
  permission_codes: string[];
};

export type RoleUpdateInput = {
  name?: string;
  permission_codes?: string[];
  is_active?: boolean;
};

export type SalesSummary = {
  gross_sales: string;
  paid_orders: number;
  average_order_value: string;
  by_payment_method: Record<string, string>;
};

export type AuditLog = {
  id: string;
  branch_id: string | null;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  previous_value: unknown;
  new_value: unknown;
  reason: string | null;
  timestamp: string;
};

export type ApprovalType =
  | "DISCOUNT"
  | "ITEM_CANCELLATION"
  | "ORDER_VOID"
  | "STOCK_OVERRIDE"
  | "TABLE_TRANSFER";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type ApprovalRequest = {
  id: string;
  order_id: string | null;
  order_item_id: string | null;
  approval_type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  requested_by_user_id: string;
  requested_by_name: string | null;
  resolved_by_user_id: string | null;
  resolved_by_name: string | null;
  table_name: string | null;
  order_item_name: string | null;
  order_total: string | null;
};

export type CashierShift = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  user_display_name: string | null;
  cashier_name: string | null;
  predecessor_shift_id: string | null;
  status: string;
  opening_cash: string;
  opening_note: string | null;
  closing_cash: string | null;
  cash_sales: string;
  card_sales: string;
  total_sales: string;
  cash_variance: string | null;
  opened_at: string;
  closed_at: string | null;
  closing_note: string | null;
};

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  business_type: string;
  state: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "ARCHIVED";
  is_active: boolean;
  default_currency: string;
  prevent_negative_stock: boolean;
  theme_mode: "LIGHT" | "DARK" | "SYSTEM";
  created_at: string;
};
