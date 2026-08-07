"use client";

import type { QueryKey } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { useWebSocket } from "@/hooks/use-websocket";
import { BRANCH_SWITCHED_EVENT } from "@/lib/auth-events";

type RealtimeMessage = {
  type?: string;
  refetch_required?: boolean;
};

const operationalRoots = ["/admin", "/waiter", "/cashier", "/kitchen"];
const allOperationalKeys: readonly QueryKey[] = [
  ["admin-operations"],
  ["dashboard"],
  ["orders"],
  ["tables"],
  ["waiter"],
  ["cashier"],
  ["kitchen"],
  ["inventory"],
  ["catalog"],
  ["qr"],
  ["qr-menu"],
  ["loyalty"],
  ["reports"],
  ["printing"],
  ["shifts"],
];

export function RealtimeSync() {
  const pathname = usePathname();
  const enabled = shouldEnableOperationalRealtime(pathname);
  const [socketUrl, setSocketUrl] = useState<string | null>(null);
  const [ticketRequestKey, setTicketRequestKey] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);

  const requestTicket = useCallback(async () => {
    const currentGeneration = ++generation.current;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    try {
      const response = await fetch("/api/backend/auth/realtime-ticket", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("realtime ticket unavailable");
      const payload = (await response.json()) as { ticket?: string };
      if (!payload.ticket) throw new Error("invalid realtime ticket");
      if (generation.current !== currentGeneration) return;
      const url = realtimeEndpoint();
      url.searchParams.set("ticket", payload.ticket);
      setSocketUrl(url.toString());
    } catch {
      if (generation.current !== currentGeneration) return;
      setSocketUrl(null);
      retryTimer.current = setTimeout(
        () => setTicketRequestKey((value) => value + 1),
        15_000,
      );
    }
  }, []);

  useEffect(() => {
    const reconnectForBranch = () => {
      generation.current += 1;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
      setSocketUrl(null);
      setTicketRequestKey((value) => value + 1);
    };
    window.addEventListener(BRANCH_SWITCHED_EVENT, reconnectForBranch);
    return () => {
      window.removeEventListener(BRANCH_SWITCHED_EVENT, reconnectForBranch);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      generation.current += 1;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      return;
    }
    retryTimer.current = setTimeout(() => void requestTicket(), 0);
    return () => {
      generation.current += 1;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [enabled, requestTicket, ticketRequestKey]);

  useWebSocket<RealtimeMessage>({
    url: socketUrl,
    enabled: enabled && Boolean(socketUrl),
    maxRetries: 0,
    refetchQueryKeys: allOperationalKeys,
    invalidateQueryKeys: (message) => queryKeysForRealtimeEvent(message.type),
    onClose: (event) => {
      if (shouldRequestRealtimeTicketAfterClose(enabled, event.reason)) {
        retryTimer.current = setTimeout(
          () => setTicketRequestKey((value) => value + 1),
          1_000,
        );
      }
    },
  });

  return null;
}

export function shouldEnableOperationalRealtime(pathname: string): boolean {
  return operationalRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

export function shouldRequestRealtimeTicketAfterClose(
  enabled: boolean,
  reason: string,
): boolean {
  return (
    enabled &&
    reason !== "component unmounted" &&
    reason !== "stale connection"
  );
}

function realtimeEndpoint() {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return new URL(configured, window.location.origin);

  const api = new URL(
    process.env.NEXT_PUBLIC_API_URL ?? "/api/v1",
    window.location.origin,
  );
  api.protocol = api.protocol === "https:" ? "wss:" : "ws:";
  api.pathname = `${api.pathname.replace(/\/+$/, "")}/ws`;
  return api;
}

export function queryKeysForRealtimeEvent(type = ""): readonly QueryKey[] {
  if (type === "connection.ready") return allOperationalKeys;
  if (type.startsWith("order.")) {
    return [
      ["orders"],
      ["tables"],
      ["waiter"],
      ["cashier"],
      ["kitchen"],
      ["dashboard"],
      ["admin-operations", "orders"],
      ["admin-operations", "order"],
      ["admin-operations", "tables"],
      ["admin-operations", "dashboard"],
    ];
  }
  if (type.startsWith("kitchen.")) {
    return [
      ["kitchen"],
      ["orders"],
      ["tables"],
      ["waiter"],
      ["dashboard"],
      ["admin-operations", "kitchen-tickets"],
      ["admin-operations", "orders"],
      ["admin-operations", "dashboard"],
    ];
  }
  if (type.startsWith("qr.")) {
    return [
      ["qr"],
      ["qr-menu"],
      ["orders"],
      ["tables"],
      ["waiter"],
      ["dashboard"],
      ["admin-operations", "qr-requests"],
      ["admin-operations", "orders"],
      ["admin-operations", "tables"],
      ["admin-operations", "dashboard"],
    ];
  }
  if (type.startsWith("inventory.")) {
    return [
      ["inventory"],
      ["catalog"],
      ["dashboard"],
      ["admin-operations", "dashboard"],
    ];
  }
  if (type.startsWith("printing.")) {
    return [
      ["printing"],
      ["admin-operations", "print-jobs"],
      ["admin-operations", "printer-devices"],
    ];
  }
  return allOperationalKeys;
}
