import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); window.history.replaceState({}, "", "/"); });

it("reports a fixed schema without URL, customer input or arbitrary digest contents", async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetcher);
  window.history.replaceState({}, "", "/cashier/orders?customer=private&token=secret");
  const { reportIncident } = await import("./report-incident");
  reportIncident("react_boundary", "private@example.test");
  reportIncident("unhandled_error", "valid-digest");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ kind: "react_boundary", screen: "cashier" });
  vi.advanceTimersByTime(6_000);
  reportIncident("react_boundary", "valid-digest");
  expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ kind: "react_boundary", screen: "cashier", digest: "valid-digest" });
});
