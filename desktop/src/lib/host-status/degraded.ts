// «main доступен, но не обслуживает» — состояние, которого у SoundCloud-only
// сборки нет: scnative-инфраструктуры больше не существует, локальный сервер
// либо работает, либо нет (это обрабатывают API/стриминг-пути напрямую).
// Все функции остаются экспортируемыми, но инертны — для совместимости
// с import'ами (premium-cache, api-client, UI-баннеры).

export const SLOW_RESPONSE_MS = 12_000;

/** main отвечает, но обслуживать не может. Всегда false в SoundCloud-only. */
export function isMainDegraded(): boolean {
  return false;
}

/** no-op: деградаций хостов больше нет. */
export function markMainDegraded(): void {
  return;
}

/** no-op: деградаций хостов больше нет. */
export function noteMainBadResponse(): void {
  return;
}

// ─── Подписка для UI ────────────────────────────────────────
// Всё ещё экспортируется, но событий не шлёт.

export function subscribeMainDegraded(_listener: () => void): () => void {
  return () => {};
}