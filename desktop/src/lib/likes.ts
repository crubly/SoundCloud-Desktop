import type { QueryClient } from '@tanstack/react-query';
import { useFavoritesStore } from '../stores/favorites';
import type { Track } from '../stores/player';

/* ── Local favorites — single source of truth ──────────────
 *  Likes live ONLY on-device (persisted via tauri-storage in the favorites
 *  store). There is no account/backend sync — the heart always works offline. */

/** React hook — is a track URN liked? */
export function useLiked(urn: string): boolean {
  return useFavoritesStore((s) => s.tracks[urn] !== undefined);
}

/** Check if a track URN is liked (outside React) */
export function isUrnLiked(urn: string): boolean {
  return useFavoritesStore.getState().tracks[urn] !== undefined;
}

/** Set like status for a track URN (no track payload — only removes, or marks urn-only) */
export function setLikedUrn(urn: string, liked: boolean) {
  useFavoritesStore.getState().set(urn, null, liked);
}

/** Set like status with a full track payload (used to seed / save into Library) */
export function setLikedTrack(track: Track, liked: boolean) {
  useFavoritesStore.getState().set(track.urn, track, liked);
}

/** Backwards-compat seed from server data — now a no-op (no server likes) */
export function initLikedUrns(_tracks: Track[]) {}

/* ── Liked-tracks counter (server/account-derived, legacy) ─ */

interface UserLikeCounters {
  likes_count?: number | null;
  public_favorites_count?: number | null;
}

export function likedTracksCount(user: UserLikeCounters | null | undefined): number | undefined {
  return user?.likes_count ?? user?.public_favorites_count ?? undefined;
}

/* ── Optimistic toggle (local + TanStack Query cache) ───── */

export function optimisticToggleLike(qc: QueryClient, track: Track, nowLiked: boolean) {
  // Persist locally — this is the real "write"
  setLikedTrack(track, nowLiked);

  // Update single track query (so `user_favorite` chips/buttons agree)
  qc.setQueryData<Track>(['track', track.urn], (old) => {
    if (!old) return old;
    return { ...old, user_favorite: nowLiked };
  });
}
