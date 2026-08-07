"use client"

import { useCurrentUser } from "@/hooks/use-auth"
import {
  hasPermission,
  type PermissionRequirement,
} from "@/lib/permissions"

export function usePermission(
  requirement: PermissionRequirement,
  mode: "all" | "any" = "all",
): boolean {
  const { data } = useCurrentUser()
  return hasPermission(data, requirement, mode)
}
