import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocalFavorites } from '../stores/favorites';
import type { Track } from '../stores/player';
import { api } from './api';
import { useDislikedUrns } from './dislikes';
import { dedupeByUrn } from './hooks';

/**
 * Собственная «вкладка хоум»: подборки собираются локально из лайков — по любимым
 * жанрам и артистам через живой SC-поиск (/tracks?q=…). Бэкенд-рекомендации
 * (/recommendations/*) заглушены, поэтому «Открытия недели» строим сами.
 */

export interface DiscoverySeed {
  key: string;
  kind: 'artist' | 'genre';
  name: string;
  query: string;
}

export interface DiscoveryShelf {
  seed: DiscoverySeed;
  tracks: Track[];
  isLoading: boolean;
}

const SEARCH_LIMIT = 20;
const SHELF_LIMIT = 16;
const WEEK_LIMIT = 28;
const MAX_SEEDS = 6;
const DISCOVERY_CACHE_MS = 1000 * 60 * 5;

function rankedCounts(
  liked: Track[],
  pick: (t: Track) => string | undefined,
  max: number,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const track of liked) {
    const value = (pick(track) ?? '').trim().toLowerCase();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name, count]) => ({ name, count }));
}

/** Семена подборок: топ-3 жанра + топ-3 артиста из лайков. */
export function planHomeDiscovery(liked: Track[]): DiscoverySeed[] {
  const genres = rankedCounts(liked, (t) => t.genre, 3);
  const artists = rankedCounts(liked, (t) => t.user?.username, 3);
  const seeds: DiscoverySeed[] = [
    ...genres.map((g) => ({
      key: `genre:${g.name}`,
      kind: 'genre' as const,
      name: g.name,
      query: g.name,
    })),
    ...artists.map((a) => ({
      key: `artist:${a.name}`,
      kind: 'artist' as const,
      name: a.name,
      query: a.name,
    })),
  ];
  return seeds.slice(0, MAX_SEEDS);
}

interface TracksPage {
  collection: Track[];
}

/** Полки рекомендаций из локальных лайков + живой поиск; залайканное и дизлайкнутое выкидывается. */
export function useHomeDiscovery() {
  const liked = useLocalFavorites();
  const likedUrns = useMemo(() => new Set(liked.map((t) => t.urn)), [liked]);
  const disliked = useDislikedUrns();
  const dislikedUrns = useMemo(() => new Set(Object.keys(disliked)), [disliked]);

  const seeds = useMemo(() => planHomeDiscovery(liked), [liked]);

  const queries = useQueries({
    queries: seeds.map((seed) => ({
      queryKey: ['home', 'discovery', seed.query],
      queryFn: () =>
        api<TracksPage>(`/tracks?limit=${SEARCH_LIMIT}&page=0&q=${encodeURIComponent(seed.query)}`),
      staleTime: DISCOVERY_CACHE_MS,
      gcTime: DISCOVERY_CACHE_MS * 2,
      enabled: likedUrns.size > 0,
    })),
  });

  const shelves = useMemo<DiscoveryShelf[]>(() => {
    return seeds.map((seed, i) => {
      const unique = dedupeByUrn(queries[i]?.data?.collection ?? []);
      const tracks = unique
        .filter((t) => !likedUrns.has(t.urn) && !dislikedUrns.has(t.urn))
        .slice(0, SHELF_LIMIT);
      return { seed, tracks, isLoading: queries[i]?.isPending ?? false };
    });
  }, [seeds, queries, likedUrns, dislikedUrns]);

  const week = useMemo(
    () => dedupeByUrn(shelves.flatMap((s) => s.tracks)).slice(0, WEEK_LIMIT),
    [shelves],
  );

  return {
    likedCount: liked.length,
    likedLoading: false,
    shelves,
    week,
  };
}
