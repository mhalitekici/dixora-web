import type {
  AccessibleBranches,
  AuthContext,
  AuthUser,
  BranchSummary,
  LoginResult,
  TenantSummary,
} from "@/lib/api/types"

export function normalizeAccessibleBranches(
  value: unknown,
): AccessibleBranches | null {
  const record = asRecord(value)
  if (!record || !Array.isArray(record.branches)) {
    return null
  }

  const branches = record.branches.flatMap((item) => {
    const branch = normalizeBranch(item)
    return branch ? [branch] : []
  })
  if (branches.length !== record.branches.length) {
    return null
  }

  return {
    branches,
    currentBranchId: readNullableString(
      record,
      "current_branch_id",
      "currentBranchId",
    ),
    canSwitch: readBoolean(record, false, "can_switch", "canSwitch"),
  }
}

export function normalizeLoginResult(value: unknown): LoginResult | null {
  const record = asRecord(value)
  const user = normalizeUser(record?.user)
  const expiresIn = readNumber(record, "expires_in", "expiresIn")

  if (!user || expiresIn === undefined) {
    return null
  }

  return { user, expiresIn }
}

export function normalizeAuthContext(value: unknown): AuthContext | null {
  const record = asRecord(value)
  const user = normalizeUser(record?.user ?? record)

  if (!record || !user) {
    return null
  }

  const rawPermissions = record.permissions
  const permissions = Array.isArray(rawPermissions)
    ? rawPermissions.filter((item): item is string => typeof item === "string")
    : []

  return {
    user,
    tenant: normalizeTenant(record.tenant),
    branch: normalizeBranch(record.branch),
    permissions: [...new Set(permissions)],
  }
}

export function normalizeUser(value: unknown): AuthUser | null {
  const record = asRecord(value)
  const id = readString(record, "id")
  const username = readString(record, "username")
  const displayName = readString(record, "display_name", "displayName")

  if (!record || !id || !username || !displayName) {
    return null
  }

  const tenantId = readNullableString(record, "tenant_id", "tenantId")
  const branchId = readNullableString(record, "branch_id", "branchId")
  const email = readNullableString(record, "email")
  const role = asRecord(record.role)
  const roleCode =
    readString(record, "role_code", "roleCode") ??
    readString(record, "role") ??
    readString(role, "code") ??
    "UNKNOWN"

  return {
    id,
    tenantId,
    branchId,
    username,
    email,
    displayName,
    roleCode,
    isActive: readBoolean(record, true, "is_active", "isActive"),
    isSuperAdmin: readBoolean(
      record,
      roleCode === "SUPER_ADMIN",
      "is_super_admin",
      "isSuperAdmin",
    ),
  }
}

function normalizeTenant(value: unknown): TenantSummary | null {
  const record = asRecord(value)
  const id = readString(record, "id")
  const name = readString(record, "name")
  const slug = readString(record, "slug")

  if (!record || !id || !name || !slug) {
    return null
  }

  return {
    id,
    name,
    slug,
    state: readString(record, "state"),
    isActive: readBoolean(record, true, "is_active", "isActive"),
    defaultCurrency: readString(
      record,
      "default_currency",
      "defaultCurrency",
    ),
    themeMode: readThemeMode(record),
  }
}

function readThemeMode(
  record: Record<string, unknown>,
): TenantSummary["themeMode"] {
  const value = readString(record, "theme_mode", "themeMode")
  return value === "LIGHT" || value === "DARK" || value === "SYSTEM"
    ? value
    : undefined
}

function normalizeBranch(value: unknown): BranchSummary | null {
  const record = asRecord(value)
  const id = readString(record, "id")
  const name = readString(record, "name")
  const slug = readString(record, "slug")

  if (!record || !id || !name || !slug) {
    return null
  }

  return {
    id,
    tenantId:
      readNullableString(record, "tenant_id", "tenantId") ?? undefined,
    name,
    slug,
    timezone: readString(record, "timezone"),
    isActive: readBoolean(record, true, "is_active", "isActive"),
  }
}

export function asRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }

  return value as Record<string, unknown>
}

export function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return undefined
}

export function readNumber(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      return value
    }
  }

  return undefined
}

function readNullableString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = record?.[key]
    if (value === null) {
      return null
    }
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return null
}

function readBoolean(
  record: Record<string, unknown> | undefined,
  fallback: boolean,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === "boolean") {
      return value
    }
  }

  return fallback
}
