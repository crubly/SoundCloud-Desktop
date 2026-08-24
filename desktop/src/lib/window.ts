import { getCurrentWindow } from '@tauri-apps/api/window';

// Cached shell reference (one lookup per rule — querySelectorAll in hot paths is
// forbidden, and this element never reappears after the app mounts).
let cachedShellEl: HTMLElement | null | undefined;

/**
 * Gentle opacity settle right after the native window fullscreen transition.
 * Never animates scale/layout (blur-recursion per WebView rules) — just a soft
 * fade-through so windowed→immersive cutting isn't jarring.
 */
function settleShell() {
  if (cachedShellEl === undefined && typeof document !== 'undefined') {
    cachedShellEl = document.getElementById('app-shell-root') ?? null;
  }
  cachedShellEl?.animate([{ opacity: 0.86 }, { opacity: 1 }], {
    duration: 260,
    easing: 'cubic-bezier(0.28, 0.8, 0.42, 1)',
  });
}

export async function toggleWindowFullscreen() {
  const currentWindow = getCurrentWindow();
  const isFullscreen = await currentWindow.isFullscreen();
  await currentWindow.setFullscreen(!isFullscreen);
  settleShell();
}
