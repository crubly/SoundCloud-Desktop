import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Track } from '../stores/player';
import { trackedInvoke as invoke } from './diagnostics';

/** YouTube-треки живут под обычным Track с URN `youtube:tracks:<videoId>` —
 *  очередь, плеер, кэш и лирика работают с ними как с любыми другими. */
export const YT_URN_PREFIX = 'youtube:tracks:';

export interface YouTubeSearchItem {
  id: string;
  title: string;
  durationMs?: number;
  channel?: string;
  channelId?: string;
}

export interface YouTubeVideoMeta extends YouTubeSearchItem {
  thumbnail: string;
  url: string;
}

export interface YouTubeAudioReady {
  path: string;
  durationMs?: number;
}

/** Стадии пайплайна yt_ensure_audio (событие yt:progress). */
export type YouTubeStage = 'setup' | 'download' | 'convert' | 'done' | 'error';

const PAGE = 24;
const MAX_LIMIT = 50;

export function isYouTubeUrn(urn: string | null | undefined): boolean {
  return !!urn && urn.startsWith(YT_URN_PREFIX);
}

export function youtubeIdFromUrn(urn: string): string | null {
  return urn.startsWith(YT_URN_PREFIX) ? urn.slice(YT_URN_PREFIX.length) : null;
}

/** 16:9 превью напрямую с ytimg — без лишнего резолва через yt-dlp. */
export function youtubeArtwork(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Track.id — число; стабильный хэш videoId. */
function numericId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function buildYouTubeTrack(meta: YouTubeSearchItem): Track {
  const channel = meta.channel?.trim() || 'YouTube';
  const channelKey = meta.channelId?.trim() || channel;
  return {
    id: numericId(meta.id),
    urn: `${YT_URN_PREFIX}${meta.id}`,
    title: meta.title,
    duration: meta.durationMs ?? 0,
    artwork_url: youtubeArtwork(meta.id),
    permalink_url: `https://www.youtube.com/watch?v=${meta.id}`,
    user: {
      id: numericId(channelKey),
      urn: `youtube:users:${channelKey}`,
      username: channel,
      avatar_url: '',
      permalink_url: meta.channelId
        ? `https://www.youtube.com/channel/${meta.channelId}`
        : undefined,
    },
  };
}

export function searchYouTube(query: string, limit: number): Promise<YouTubeSearchItem[]> {
  return invoke<YouTubeSearchItem[]>('yt_search', { query, limit });
}

export function resolveYouTubeVideo(url: string): Promise<YouTubeVideoMeta> {
  return invoke<YouTubeVideoMeta>('yt_resolve', { url });
}

/** Дожидается MP3 в кэше (скачивание + конвертация на Rust-стороне). */
export function ensureYouTubeAudio(id: string): Promise<YouTubeAudioReady> {
  return invoke<YouTubeAudioReady>('yt_ensure_audio', { id });
}

/**
 * Поиск по YouTube для вкладки в /search. Пагинация — повторный ytsearch с
 * бо́льшим лимитом (continuation у yt-dlp нет), дедуп по id.
 */
export function useYouTubeSearch(query: string, enabled: boolean) {
  const [limit, setLimit] = useState(PAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: сбрасываем лимит на новый запрос
  useEffect(() => setLimit(PAGE), [query]);

  const q = useQuery({
    queryKey: ['yt-search', query, limit],
    queryFn: () => searchYouTube(query, limit),
    enabled: enabled && query.trim().length >= 2,
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: Track[] = [];
    for (const item of q.data ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(buildYouTubeTrack(item));
    }
    return out;
  }, [q.data]);

  return {
    items,
    isLoading: q.isLoading,
    isError: q.isError,
    isFetchingMore: q.isFetching && items.length > 0,
    hasMore: items.length >= limit && limit < MAX_LIMIT,
    loadMore: () => setLimit((l) => Math.min(l + PAGE, MAX_LIMIT)),
  };
}
