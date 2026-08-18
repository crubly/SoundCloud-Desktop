import { useAppStatusStore } from '../../stores/app-status';
import { API_BASE, API_STAR_BASE } from '../constants';
import { type NetVerdict, useHostStatusStore } from './store';

// SoundCloud-only build: scnative-хостов нет, аппа живёт на локальном Rust-сервере
// и SoundCloud напрямую. Вердикты зашиты в 'up'/'online' (см. store.ts), probe-движок
// отключён: никаких запросов «/health» и диагностики инцидентов больше не нужно.
// Остаётся только per-request cooldown-карта для локального сервера: фейл одного
// запроса не переобсчитывает вердикты.

// ─── Health-карта (per-request data-plane роутинг) ──────────

const UNHEALTHY_DURATION_MS = 30_000;
const unhealthyUntil = new Map<string, number>();

export function isHealthy(host: string): boolean {
  const until = unhealthyUntil.get(host);
  if (until === undefined) return true;
  if (Date.now() > until) {
    unhealthyUntil.delete(host);
    return true;
  }
  return false;
}

export function markHealthy(host: string): void {
  unhealthyUntil.delete(host);
  if (host === API_BASE) noteMainAlive();
  else if (host === API_STAR_BASE && useHostStatusStore.getState().star !== 'up') {
    useHostStatusStore.setState({ star: 'up' });
  }
}

/** Пассивный фейл вердикт НЕ меняет — ставит cooldown. Проба отключена. */
export function markUnhealthy(host: string): void {
  unhealthyUntil.set(host, Date.now() + UNHEALTHY_DURATION_MS);
}

/** Любой успех main (реальный запрос). Hot path: no-op, если уже up. */
export function noteMainAlive(): void {
  const prev = useHostStatusStore.getState().main;
  if (prev === 'up') return;
  useHostStatusStore.setState({ main: 'up', net: 'online' });
  useAppStatusStore.getState().setBackendReachable(true);
}

/** Таймаут / отмена по таймауту: наш AbortController или timeout/connect-ошибка reqwest. */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = msg.toLowerCase();
  return (
    m.includes('abort') ||
    m.includes('cancel') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('time out')
  );
}

/** SoundCloud-only build: request timeout — не «инцидент», просто запрос. no-op. */
export function noteRequestTimeout(): void {
  return;
}

/** SoundCloud-only build: проба хостов отключена. no-op. */
export function requestProbe(_opts?: { force?: boolean }): void {
  return;
}

let initialized = false;

/** Boot-проба + триггеры пробуждения (сеть вернулась / ноут проснулся). Idempotent. */
export function initHostStatus(): void {
  if (initialized) return;
  initialized = true;
  // Вердикты уже 'up'; online-состояние ведёт App.tsx (navigator.onLine).
  const sync = () => {
    const online = navigator.onLine ? ('online' as NetVerdict) : ('no-internet' as NetVerdict);
    useHostStatusStore.setState({ net: online });
  };
  sync();
  window.addEventListener('online', sync);
  window.addEventListener('focus', sync);
}
