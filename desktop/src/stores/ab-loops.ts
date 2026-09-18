import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isUrnLiked } from '../lib/likes';
import { createThrottledJsonStorage } from '../lib/tauri-storage';
import type { AbLoop, Track } from './player';

const EPHEMERAL_LOOP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SavedAbLoop {
  a: number;
  b: number;
  /** `null` means the track was liked when the loop was saved. */
  expiresAt: number | null;
}

interface AbLoopLibraryState {
  loops: Record<string, SavedAbLoop>;
  save: (track: Track, loop: AbLoop) => void;
  remove: (urn: string) => void;
  get: (urn: string) => AbLoop | null;
}

function isValidLoop(loop: SavedAbLoop, now: number): boolean {
  return (
    Number.isFinite(loop.a) &&
    Number.isFinite(loop.b) &&
    loop.a >= 0 &&
    loop.b > loop.a &&
    (loop.expiresAt === null || loop.expiresAt > now)
  );
}

/**
 * Per-track A-B loops, persisted in the application's local data store.
 * Liked tracks retain their loop forever; every other track is kept for 30 days.
 */
export const useAbLoopLibraryStore = create<AbLoopLibraryState>()(
  persist(
    (set, get) => ({
      loops: {},
      save: (track, loop) => {
        if (loop.b == null || !Number.isFinite(loop.a) || !Number.isFinite(loop.b)) return;
        const permanent = track.user_favorite === true || isUrnLiked(track.urn);
        set((state) => ({
          loops: {
            ...state.loops,
            [track.urn]: {
              a: loop.a,
              b: loop.b!,
              expiresAt: permanent ? null : Date.now() + EPHEMERAL_LOOP_TTL_MS,
            },
          },
        }));
      },
      remove: (urn) =>
        set((state) => {
          if (!(urn in state.loops)) return state;
          const { [urn]: _, ...loops } = state.loops;
          return { loops };
        }),
      get: (urn) => {
        const saved = get().loops[urn];
        if (!saved) return null;
        if (isValidLoop(saved, Date.now())) return { a: saved.a, b: saved.b };
        get().remove(urn);
        return null;
      },
    }),
    {
      name: 'sc-ab-loops',
      storage: createThrottledJsonStorage(),
      partialize: (state) => ({ loops: state.loops }),
    },
  ),
);

/** Resolves only after persisted loops have been read from disk. */
export function waitForAbLoopLibrary(): Promise<void> {
  if (useAbLoopLibraryStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = useAbLoopLibraryStore.persist.onFinishHydration(() => {
      stop();
      resolve();
    });
  });
}
