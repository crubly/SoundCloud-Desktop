import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Track } from '../stores/player';
import { usePlayerStore } from '../stores/player';
import { api } from './api';
import { recordEvent } from './events';
import { tauriStorage } from './tauri-storage';

/* ── Local dislikes — single source of truth ────────────────
 *  Дизлайки живут только на устройстве (персист sc-dislikes). Аккаунт/бэк
 *  отдаёт заглушку, так что никакой сетевой синхронизации нет — пишем локально.
 *  Дизлайкнутое исключается из рекомендаций (вкус) и убирается из очереди. */

interface DislikesState {
  urns: Record<string, boolean>;
  set: (urn: string, disliked: boolean) => void;
  clear: () => void;
}

export const useDislikesStore = create<DislikesState>()(
  persist(
    (set) => ({
      urns: {},
      set: (urn, disliked) =>
        set((s) => {
          const urns = { ...s.urns };
          if (disliked) urns[urn] = true;
          else delete urns[urn];
          return { urns };
        }),
      clear: () => set({ urns: {} }),
    }),
    {
      name: 'sc-dislikes',
      storage: createJSONStorage(() => tauriStorage),
      partialize: (s) => ({ urns: s.urns }),
    },
  ),
);

export function setDislikedUrn(urn: string, disliked: boolean): void {
  useDislikesStore.getState().set(urn, disliked);
}

export function isUrnDisliked(urn: string): boolean {
  return useDislikesStore.getState().urns[urn] === true;
}

/** React hook — дизлайкнут ли URN. */
export function useDisliked(urn: string): boolean {
  return useDislikesStore((s) => s.urns[urn] === true);
}

/** Hook: состояние дизлайка без побочных фетчей (бэк заглушен). */
export function useDislikeStatus(urn: string | undefined): boolean {
  return useDislikesStore((s) => (urn ? s.urns[urn] === true : false));
}

/** Все дизлайкнутые URN (для фильтра вкуса/лент) — реактивно. */
export function useDislikedUrns(): Record<string, boolean> {
  return useDislikesStore((s) => s.urns);
}

/** Синхронный набор дизлайкнутых URN (вне React). */
export function getDislikedUrns(): Set<string> {
  return new Set(Object.keys(useDislikesStore.getState().urns));
}

// Совместимые no-op — сетевой синхронизации с этим бэком не существует.
export async function fetchDislikeStatus(urn: string): Promise<boolean> {
  return isUrnDisliked(urn);
}

export async function loadAllDislikedIds(): Promise<void> {
  /* дизлайки локальные (sc-dislikes) — подгрузки с бэка нет */
}

/** Выбрасывает дизлайкнутый трек из очереди; если он играл — продолжает следующим. */
export function purgeDislikedFromQueue(urn: string): void {
  const state = usePlayerStore.getState();
  const idx = state.queue.findIndex((t) => t.urn === urn);
  if (idx < 0) return;
  const isCurrent = idx === state.queueIndex;
  const queue = state.queue.filter((t) => t.urn !== urn);
  const originalQueue = state.originalQueue
    ? state.originalQueue.filter((t) => t.urn !== urn)
    : null;

  if (queue.length === 0) {
    usePlayerStore.setState({
      queue: [],
      originalQueue,
      queueIndex: -1,
      currentTrack: null,
      isPlaying: false,
    });
    return;
  }

  if (isCurrent) {
    const nextIdx = Math.min(idx, queue.length - 1);
    usePlayerStore.setState({
      queue,
      originalQueue,
      queueIndex: nextIdx,
      currentTrack: queue[nextIdx],
      isPlaying: state.isPlaying,
    });
  } else {
    const qi = idx < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
    usePlayerStore.setState({ queue, originalQueue, queueIndex: qi });
  }
}

export async function toggleDislike(
  qc: QueryClient,
  track: Track,
  nowDisliked: boolean,
): Promise<void> {
  setDislikedUrn(track.urn, nowDisliked);
  if (nowDisliked) recordEvent('dislike', track.urn);

  try {
    if (nowDisliked) {
      await api(`/dislikes/${encodeURIComponent(track.urn)}`, {
        method: 'POST',
        body: JSON.stringify(track),
      });
    } else {
      await api(`/dislikes/${encodeURIComponent(track.urn)}`, { method: 'DELETE' });
    }
    qc.invalidateQueries({ queryKey: ['dislikes'] });
  } catch {
    setDislikedUrn(track.urn, !nowDisliked);
  }
}
