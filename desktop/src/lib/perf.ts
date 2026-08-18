import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '../stores/settings';
import { logInfo } from './diagnostics';

/**
 * Performance modes scale the cost of the liquid-glass design down gracefully.
 * `beauty` is byte-for-byte the original experience; `light` is flat and static
 * but keeps the dark frosted aesthetic via solid tints; `medium` sits between.
 *
 * Two gating surfaces consume this:
 *  - index.css `[data-perf="…"]` rules gate CSS-class effects (named glass panels,
 *    keyframe animations) — see ThemeProvider which writes `documentElement.dataset.perf`.
 *  - components read `usePerfMode()` to gate inline-style blurs, particle counts and
 *    whole decorative subtrees (inline `animation`/`filter` can't be overridden by a class).
 */
export type PerfMode = 'light' | 'medium' | 'beauty';

export const PERF_MODES: PerfMode[] = ['light', 'medium', 'beauty'];

export interface PerfProfile {
  mode: PerfMode;
  /** Scale a backdrop/decorative blur radius (px). `light` → 0 (caller swaps to a solid tint). */
  blur: (beautyPx: number) => number;
  /** Scale a decorative particle/element count. Disabled everywhere (`0`) —
   *  particle fields are the heaviest idle cost and are removed app-wide to keep
   *  the chip cool; callers slice `SEEDS.slice(0, particles(N))` → empty. */
  particles: (beautyCount: number) => number;
  /** Run idle decorative animations (drifts, twinkles, spins, marquees, breathing). */
  idleAnim: boolean;
  /** Mount the full page atmosphere (aurora orbs, star fields, ambient layers). */
  atmosphere: boolean;
  /** Per-element drop-shadow/box-shadow glows on particles (the expensive part of twinkle). */
  glow: boolean;
  /** Mount heavy decorative background blooms (AmbientGlow, BackgroundGlow, per-card halos). */
  bloom: boolean;
}

const PROFILES: Record<PerfMode, Omit<PerfProfile, 'mode'>> = {
  beauty: {
    blur: (px) => px,
    particles: () => 0,
    idleAnim: true,
    atmosphere: true,
    glow: true,
    bloom: true,
  },
  medium: {
    blur: (px) => Math.round(px * 0.5),
    particles: () => 0,
    idleAnim: true,
    atmosphere: true,
    glow: false,
    bloom: true,
  },
  light: {
    blur: () => 0,
    particles: () => 0,
    idleAnim: false,
    atmosphere: false,
    glow: false,
    bloom: false,
  },
};

// Stable per-mode profile objects so consumers can use them as memo/effect deps and
// zustand selectors return a referentially-stable value.
const PROFILE_CACHE: Record<PerfMode, PerfProfile> = {
  light: { mode: 'light', ...PROFILES.light },
  medium: { mode: 'medium', ...PROFILES.medium },
  beauty: { mode: 'beauty', ...PROFILES.beauty },
};

export function getPerfProfile(mode: PerfMode): PerfProfile {
  return PROFILE_CACHE[mode] ?? PROFILE_CACHE.beauty;
}

/** React hook: the active performance profile, re-rendering only when the mode changes. */
export function usePerfMode(): PerfProfile {
  const settingsMode = useSettingsStore((s) => s.perfMode);
  const mode = useSyncExternalStore(
    subscribePerfOverride,
    () => perfOverride ?? settingsMode,
    () => perfOverride ?? settingsMode,
  );
  return getPerfProfile(mode);
}

/* ── Auto performance governor ─────────────────────────────────
 * WebKit does not throttle the view while another process recomposites the
 * window (screen recording, streaming) — so the heavy glass/animation design
 * eats WindowServer cycles and the app visibly freezes. This governor watches
 * frame pacing and, on sustained jank, temporarily switches the *effective*
 * mode to `light` (blur → 0, idle animations off). The user's perfMode setting
 * is untouched and the design comes back on its own once frames smooth out.
 * Hysteresis (cooldown + recovery) keeps it from flapping.
 */

/** Runtime visual override that softens (only tightens, never raises) the mode. */
type PerfOverride = PerfMode | null;
let perfOverride: PerfOverride = null;
const overrideListeners = new Set<() => void>();

function setPerfOverride(value: PerfOverride): void {
  if (perfOverride === value) return;
  perfOverride = value;
  for (const l of overrideListeners) l();
}

function subscribePerfOverride(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
}

/** What the design should actually render right now (governor may tighten it). */
export function getEffectivePerfMode(): PerfMode {
  return perfOverride ?? useSettingsStore.getState().perfMode;
}

const TICK_MS = 200;
const JANK_MS = 500;
const JANK_HITS = 3;
const JANK_COOLDOWN_MS = 5000;
const RECOVER_TICKS = 60;
const CLEAN_MS = 300;

let governorInstalled = false;

/**
 * Interval-based frame-gap monitor. The old rAF approach only accumulates jank
 * samples while rAF is scheduled (one heavy gap per freeze, ~10-30s to trip).
 * A 200ms timer measures *event-loop* blocking directly — a gap > 500ms means
 * the main thread just stalled (screen recording / heavy compositing starves
 * the renderer). Trips to `light` within ~1-2s of sustained jank, and lifts
 * after ~12s of smooth pacing. Idempotent; logs transitions to desktop.log.
 */
export function setupPerfGovernor(): void {
  if (governorInstalled || typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }
  governorInstalled = true;

  let last = performance.now();
  let hits = 0;
  let clean = 0;
  let lastJankAt = 0;

  const tick = () => {
    const now = performance.now();
    const gap = now - last;
    last = now;

    if (perfOverride !== null) {
      // Recovering: lift `light` only after a sustained stretch of clean pacing.
      clean = gap <= CLEAN_MS ? clean + 1 : 0;
      if (clean >= RECOVER_TICKS) {
        clean = 0;
        setPerfOverride(null);
        logInfo('[Perf] governor: frames smooth, restored design');
      }
      return;
    }

    if (gap > JANK_MS) {
      if (now - lastJankAt > JANK_COOLDOWN_MS) hits = 0;
      hits += 1;
      if (hits >= JANK_HITS) {
        hits = 0;
        lastJankAt = now;
        setPerfOverride('light');
        logInfo(`[Perf] governor: event-loop stall (${Math.round(gap)}ms gap) → light mode`);
      }
    } else {
      hits = 0;
    }
  };

  window.setInterval(tick, TICK_MS);
}

/**
 * Global idle-animation gate: a single visibilitychange listener flips
 * `documentElement[data-app-hidden]`, which index.css uses to pause every CSS
 * animation while the window is hidden (the WebView does NOT throttle timers/rAF).
 * Idempotent; call once at startup.
 */
let visibilityGateInstalled = false;

export function setupVisibilityGate(): void {
  if (visibilityGateInstalled || typeof document === 'undefined') return;
  visibilityGateInstalled = true;
  const apply = () => {
    if (document.visibilityState === 'hidden') {
      document.documentElement.setAttribute('data-app-hidden', '1');
    } else {
      document.documentElement.removeAttribute('data-app-hidden');
    }
  };
  apply();
  document.addEventListener('visibilitychange', apply);
}
