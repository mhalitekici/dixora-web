import { describe, expect, it } from "vitest";

import {
  queryKeysForRealtimeEvent,
  shouldEnableOperationalRealtime,
  shouldRequestRealtimeTicketAfterClose,
} from "./realtime-sync";

describe("shouldEnableOperationalRealtime", () => {
  it.each(["/admin", "/admin/orders", "/waiter", "/cashier/shift"])(
    "enables tenant-scoped operational routes: %s",
    (pathname) => {
      expect(shouldEnableOperationalRealtime(pathname)).toBe(true);
    },
  );

  it.each([
    "/",
    "/login",
    "/m/dixora-lab/merkez",
    "/super-admin",
    "/super-admin/businesses",
    "/super-admin/login",
    "/kitchen",
  ])("does not request tenant realtime tickets outside operations: %s", (pathname) => {
    expect(shouldEnableOperationalRealtime(pathname)).toBe(false);
  });
});

describe("shouldRequestRealtimeTicketAfterClose", () => {
  it("requests a fresh one-use ticket after server closes, including code 1000", () => {
    expect(shouldRequestRealtimeTicketAfterClose(true, "server shutdown")).toBe(
      true,
    );
    expect(shouldRequestRealtimeTicketAfterClose(true, "")).toBe(true);
  });

  it("ignores local cleanup closes and disabled routes", () => {
    expect(
      shouldRequestRealtimeTicketAfterClose(true, "component unmounted"),
    ).toBe(false);
    expect(shouldRequestRealtimeTicketAfterClose(true, "stale connection")).toBe(
      false,
    );
    expect(shouldRequestRealtimeTicketAfterClose(false, "server shutdown")).toBe(
      false,
    );
  });
});

describe("queryKeysForRealtimeEvent", () => {
  it("invalidates both operational and admin order caches", () => {
    expect(queryKeysForRealtimeEvent("order.updated")).toEqual(
      expect.arrayContaining([
        ["orders"],
        ["admin-operations", "orders"],
        ["admin-operations", "order"],
        ["admin-operations", "dashboard"],
      ]),
    );
  });

  it("invalidates the real QR and printer query roots", () => {
    expect(queryKeysForRealtimeEvent("qr.requested")).toEqual(
      expect.arrayContaining([
        ["qr-menu"],
        ["admin-operations", "qr-requests"],
      ]),
    );
    expect(queryKeysForRealtimeEvent("printing.completed")).toEqual(
      expect.arrayContaining([
        ["printing"],
        ["admin-operations", "print-jobs"],
      ]),
    );
  });

  it("refetches every authoritative root after a reconnect", () => {
    expect(queryKeysForRealtimeEvent("connection.ready")).toEqual(
      expect.arrayContaining([
        ["admin-operations"],
        ["catalog"],
        ["qr-menu"],
        ["loyalty"],
      ]),
    );
  });
});
