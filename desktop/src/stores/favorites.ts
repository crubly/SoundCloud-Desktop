import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import { tauriStorage } from '../lib/tauri-storage';
import type { Track } from './player';

/**
 * Local favorites — hearts saved on-device, no account/backend.
 * A `null` value = liked but we only have the URN (no track payload yet),
 * e.g. the icon-only like path. Library rows render only tracks with payload.
 */
interface FavoritesState {
  tracks: Record<string, Track | null>;
  set: (urn: string, track: Track | null, liked: boolean) => void;
  clear: () => void;
}

/** All locally-liked tracks that carry a full payload (for Library rendering). */
export function useLocalFavorites(): Track[] {
  return useFavoritesStore(
    useShallow((s) => Object.values(s.tracks).filter((t): t is Track => t != null)),
  );
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      tracks: {},
      set: (urn, track, liked) =>
        set((s) => {
          const tracks = { ...s.tracks };
          if (!liked) {
            delete tracks[urn];
          } else if (track) {
            tracks[urn] = track;
          } else if (!(urn in s.tracks)) {
            tracks[urn] = null;
          }
          return { tracks };
        }),
      clear: () => set({ tracks: {} }),
    }),
    {
      name: 'sc-favorites',
      storage: createJSONStorage(() => tauriStorage),
      partialize: (s) => ({ tracks: s.tracks }),
    },
  ),
);
