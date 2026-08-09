"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const SOUND_PREFERENCE_KEY = "dixora:cashier-alert-sound";
const SOUND_CHANGE_EVENT = "dixora:cashier-alert-sound-change";
/** Gap between repeats while an event is still unacknowledged. */
const REPEAT_INTERVAL_MS = 8_000;
/** Safety stop so an unattended terminal never loops audio forever. */
const MAX_REPEATS = 12;

type WebkitWindow = typeof window & { webkitAudioContext?: typeof AudioContext };

/** Two rising two-tone sweeps — audible over café noise without being shrill. */
function playChime(): void {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const now = context.currentTime;
    const pattern = [880, 1320, 880, 1320, 1046, 1568];
    pattern.forEach((frequency, index) => {
      const start = now + index * 0.4;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.38);
    });
    window.setTimeout(() => void context.close(), 3000);
  } catch {
    // Browsers block audio until the operator has interacted with the page.
    // The visible banner is the mandatory channel; sound is an enhancement.
  }
}

function subscribeToSoundPreference(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(SOUND_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(SOUND_CHANGE_EVENT, callback);
  };
}

function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Sound is on by default; the server render must not guess otherwise. */
function readServerSoundPreference(): boolean {
  return true;
}

/**
 * Repeating operator alert that stops only on explicit acknowledgement.
 *
 * `alerting` is derived from the gap between the live pending count and the
 * count the operator last acknowledged, so there is no alert state to fall out
 * of sync. A burst of new events therefore re-arms one alert rather than
 * stacking several overlapping audio loops.
 *
 * `ready` gates the baseline: until the caller's query has resolved we do not
 * know the real queue size, and treating the initial 0 as "acknowledged" would
 * make every pre-existing order scream the moment the till loads.
 */
export function useAlertChime(pendingCount: number, ready = true) {
  const [acknowledgedCount, setAcknowledgedCount] = useState<number | null>(null);
  const soundEnabled = useSyncExternalStore(
    subscribeToSoundPreference,
    readSoundPreference,
    readServerSoundPreference,
  );

  // Establish the baseline during render (React's documented "adjust state
  // while rendering" pattern) instead of in an effect, so the first paint
  // already reflects the correct silent state.
  if (ready && acknowledgedCount === null) {
    setAcknowledgedCount(pendingCount);
  }

  const alerting = acknowledgedCount !== null && pendingCount > acknowledgedCount;

  const acknowledge = useCallback(() => {
    setAcknowledgedCount(pendingCount);
  }, [pendingCount]);

  const setSoundPreference = useCallback((enabled: boolean) => {
    try {
      window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "on" : "off");
    } catch {
      // Preference just won't persist across reloads.
    }
    window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
  }, []);

  // Repeat until acknowledged (or the safety ceiling is reached).
  useEffect(() => {
    if (!alerting) return;
    if (readSoundPreference()) playChime();
    let repeats = 1;

    const timer = window.setInterval(() => {
      if (repeats >= MAX_REPEATS) {
        window.clearInterval(timer);
        return;
      }
      repeats += 1;
      if (readSoundPreference()) playChime();
    }, REPEAT_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [alerting]);

  return { alerting, acknowledge, soundEnabled, setSoundPreference };
}
