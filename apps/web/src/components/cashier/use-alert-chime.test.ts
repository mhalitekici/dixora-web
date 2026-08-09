import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAlertChime } from "./use-alert-chime";

/** Counts how many times the hook actually starts audio. */
let startedTones = 0;

class FakeOscillator {
  frequency = { value: 0 };
  type = "sine";
  connect = vi.fn();
  stop = vi.fn();
  start = vi.fn(() => {
    startedTones += 1;
  });
}

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator = () => new FakeOscillator();
  createGain = () => ({
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  });
  close = vi.fn();
}

beforeEach(() => {
  startedTones = 0;
  vi.useFakeTimers();
  window.localStorage.clear();
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAlertChime", () => {
  it("stays silent for events that already existed when the till opened", () => {
    const { result } = renderHook(() => useAlertChime(3, true));
    expect(result.current.alerting).toBe(false);
    expect(startedTones).toBe(0);
  });

  it("alerts and repeats until the operator acknowledges", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useAlertChime(pending, true),
      { initialProps: { pending: 0 } },
    );
    expect(result.current.alerting).toBe(false);

    // A new request arrives.
    rerender({ pending: 1 });
    expect(result.current.alerting).toBe(true);
    const afterFirst = startedTones;
    expect(afterFirst).toBeGreaterThan(0);

    // It keeps re-alerting while unacknowledged.
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    expect(startedTones).toBeGreaterThan(afterFirst);

    // Acknowledging stops both the banner and any further sound.
    act(() => {
      result.current.acknowledge();
    });
    expect(result.current.alerting).toBe(false);

    const afterAck = startedTones;
    act(() => {
      vi.advanceTimersByTime(40_000);
    });
    expect(startedTones).toBe(afterAck);
  });

  it("does not stack overlapping alerts when several events arrive", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useAlertChime(pending, true),
      { initialProps: { pending: 0 } },
    );

    rerender({ pending: 1 });
    const afterFirst = startedTones;
    // Two more arrive in quick succession while still alerting.
    rerender({ pending: 2 });
    rerender({ pending: 3 });

    // Still a single armed alert, not three concurrent loops.
    expect(result.current.alerting).toBe(true);
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    // One repeat interval => one additional chime, not three.
    const tonesPerChime = afterFirst;
    expect(startedTones).toBeLessThanOrEqual(afterFirst + tonesPerChime * 2);
  });

  it("clears the alert when the queue empties on its own", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useAlertChime(pending, true),
      { initialProps: { pending: 0 } },
    );
    rerender({ pending: 2 });
    expect(result.current.alerting).toBe(true);

    rerender({ pending: 0 });
    expect(result.current.alerting).toBe(false);
  });

  it("honours a muted sound preference but still raises the visual alert", () => {
    window.localStorage.setItem("dixora:cashier-alert-sound", "off");
    const { result, rerender } = renderHook(
      ({ pending }) => useAlertChime(pending, true),
      { initialProps: { pending: 0 } },
    );

    rerender({ pending: 1 });
    expect(result.current.alerting).toBe(true);
    expect(result.current.soundEnabled).toBe(false);
    expect(startedTones).toBe(0);
  });

  it("persists the sound preference", () => {
    const { result } = renderHook(() => useAlertChime(0, true));
    act(() => {
      result.current.setSoundPreference(false);
    });
    expect(window.localStorage.getItem("dixora:cashier-alert-sound")).toBe("off");
    expect(result.current.soundEnabled).toBe(false);
  });
});
