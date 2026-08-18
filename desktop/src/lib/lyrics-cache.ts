import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useFavoritesStore } from '../stores/favorites';
import type { LyricsResult } from './lyrics';
import { tauriStorage } from './tauri-storage';

/**
 * Custom lyrics cache — stores lyrics the user accepted via manual search.
 * Persisted on-disk through the same `tauri-storage` layer as the other stores.
 * Favorites are kept forever; everything else expires after 30 days.
 */
export const CUSTOM_LYRICS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedLyricsEntry {
  result: LyricsResult;
  savedAt: number;
}

interface LyricsCacheState {
  entries: Record<string, CachedLyricsEntry>;
  save: (scTrackId: string, result: LyricsResult) => void;
  clear: () => void;
}

export const useLyricsCacheStore = create<LyricsCacheState>()(
  persist(
    (set) => ({
      entries: {},
      save: (scTrackId, result) =>
        set((s) => ({
          entries: { ...s.entries, [scTrackId]: { result, savedAt: Date.now() } },
        })),
      clear: () => set({ entries: {} }),
    }),
    {
      name: 'sc-lyrics-cache',
      storage: createJSONStorage(() => tauriStorage),
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);

/** Read a cached result, honouring the favorite-forever / 30-day TTL rule.
 *  The returned result is tagged `source: 'cache'` so the UI can show where it came from. */
export function getCachedLyrics(scTrackId: string): LyricsResult | null {
  const entry = useLyricsCacheStore.getState().entries[scTrackId];
  if (!entry) return null;
  const isFavorite = scTrackId in useFavoritesStore.getState().tracks;
  if (!isFavorite && Date.now() - entry.savedAt > CUSTOM_LYRICS_TTL_MS) {
    return null;
  }
  return { ...entry.result, source: 'cache' };
}

export function saveLyricsToCache(scTrackId: string, result: LyricsResult): void {
  useLyricsCacheStore.getState().save(scTrackId, result);
}
