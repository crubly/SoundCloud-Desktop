import { useEffect } from 'react';
import { applyAccentVars, applyBgVars, applyPerfMode } from '../lib/apply-theme';
import { setupPerfGovernor, setupVisibilityGate, usePerfMode } from '../lib/perf';
import { getPlatform, isMac } from '../lib/platform';
import { useSettingsStore } from '../stores/settings';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const accentColor = useSettingsStore((s) => s.accentColor);
  const bgPrimary = useSettingsStore((s) => s.bgPrimary);
  const effective = usePerfMode();

  // Set platform attribute once so CSS can apply native macOS vs Windows/Linux/iOS Liquid Glass rules.
  useEffect(() => {
    document.documentElement.dataset.platform = getPlatform();
  }, []);

  // One global gate that pauses every CSS animation while the window is hidden
  // (the WebView does not throttle timers/rAF). Install once.
  useEffect(() => {
    setupVisibilityGate();
  }, []);

  // Auto governor: on sustained frame jank (screen recording overloads the
  // compositor) temporarily render as `light`; the setting itself never changes.
  useEffect(() => {
    setupPerfGovernor();
  }, []);

  // Drives index.css `[data-perf="…"]` rules (glass blur radii, idle-animation gates).
  useEffect(() => {
    applyPerfMode(effective.mode);
  }, [effective.mode]);

  useEffect(() => {
    applyAccentVars(accentColor);
  }, [accentColor]);

  useEffect(() => {
    applyBgVars(bgPrimary);
    document.documentElement.style.backgroundColor = isMac() ? 'transparent' : bgPrimary;
  }, [bgPrimary]);

  return <>{children}</>;
}
