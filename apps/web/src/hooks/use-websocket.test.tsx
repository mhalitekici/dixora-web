import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "./use-websocket";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor() { FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(new Event("open")); }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close", { code, reason }));
  }
  send() {}
}

afterEach(() => { vi.unstubAllGlobals(); FakeSocket.instances = []; });

describe("operational websocket recovery", () => {
  it("refetches authoritative data after a fresh ticket and ignores events from the old branch socket", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const query = new QueryClient();
    const refetch = vi.spyOn(query, "refetchQueries").mockResolvedValue(undefined);
    const invalidate = vi.spyOn(query, "invalidateQueries").mockResolvedValue(undefined);
    const closed = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={query}>{children}</QueryClientProvider>;
    const hook = renderHook(({ url }) => useWebSocket({
      url, maxRetries: 0, onClose: closed,
      refetchQueryKeys: [["orders"], ["kitchen"]],
      invalidateQueryKeys: () => [["orders"]],
    }), { initialProps: { url: "ws://localhost/ws?ticket=first" }, wrapper });
    const old = FakeSocket.instances[0]!;
    act(() => old.open());
    expect(hook.result.current.status).toBe("open");
    hook.rerender({ url: "ws://localhost/ws?ticket=new-branch" });
    expect(closed).not.toHaveBeenCalled();
    act(() => old.onmessage?.(new MessageEvent("message", { data: '{"type":"order.updated"}' })));
    expect(invalidate).not.toHaveBeenCalled();
    act(() => FakeSocket.instances[1]!.open());
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["orders"], type: "active" });
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["kitchen"], type: "active" });
    hook.unmount();
    expect(closed).not.toHaveBeenCalled();
  });

  it("shows browser offline state without replaying any business mutation", () => {
    vi.stubGlobal("WebSocket", FakeSocket);
    const query = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={query}>{children}</QueryClientProvider>;
    const hook = renderHook(() => useWebSocket({ url: "ws://localhost/ws", maxRetries: 0 }), { wrapper });
    act(() => FakeSocket.instances[0]!.open());
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(hook.result.current.status).toBe("offline");
    expect(hook.result.current.send("order mutation")).toBe(false);
    hook.unmount();
    vi.restoreAllMocks();
  });
});
