import { api } from './api';
import { getCachedLyrics, saveLyricsToCache } from './lyrics-cache';
import type { Track } from '../stores/player';
import { isYouTubeUrn } from './youtube';

export type LyricsSource =
  | 'lrclib'
  | 'musixmatch'
  | 'genius'
  | 'netease'
  | 'self_gen'
  | 'none'
  | 'cache';

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  plain: string | null;
  synced: LyricLine[] | null;
  source: LyricsSource;
  language: string | null;
}

interface BackendLyricsResponse {
  scTrackId: string;
  syncedLrc: string | null;
  plainText: string | null;
  source: LyricsSource;
  language: string | null;
  languageConfidence: number | null;
}

/** Parse LRC format: [mm:ss.xx] text */
export function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
    if (!m) continue;
    const time = +m[1] * 60 + +m[2] + +m[3].padEnd(3, '0') / 1000;
    const text = m[4].trim();
    if (text) lines.push({ time, text });
  }
  return lines;
}

function toResult(data: BackendLyricsResponse | null): LyricsResult | null {
  if (!data) return null;
  const synced = data.syncedLrc ? parseLRC(data.syncedLrc) : null;
  return {
    plain: data.plainText,
    synced: synced && synced.length > 0 ? synced : null,
    source: data.source,
    language: data.language,
  };
}

/** Load lyrics by track URN/id. Backend resolves artist/title itself and writes to cache. */
export async function getLyricsByTrack(scTrackId: string): Promise<LyricsResult | null> {
  const cached = getCachedLyrics(scTrackId);
  if (cached) return cached;
  const data = await api<BackendLyricsResponse>(
    `/lyrics/${encodeURIComponent(scTrackId)}`,
    undefined,
    180_000,
  ).catch(() => null);
  const result = toResult(data);
  if (result) saveLyricsToCache(scTrackId, result);
  return result;
}

/* ── YouTube ────────────────────────────────────────────────── */

/** «Artist — Title (Official Video)» → чистые artist/title для LRCLIB. */
function youtubeArtistTitle(track: Track): { artist: string; title: string } {
  const clean = (s: string) =>
    s
      .replace(
        /\s*[([][^\])]*(official|video|audio|lyrics?|hd|hq|4k|m\/?v|visuali[sz]er|premiere)[^\])]*[\])]/gi,
        ' ',
      )
      .replace(/\s{2,}/g, ' ')
      .trim();
  const channel = track.user.username.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const parts = track.title.split(' - ');
  if (parts.length >= 2 && parts[0].trim().length > 0 && parts[0].length <= 60) {
    return { artist: clean(parts[0]) || channel, title: clean(parts.slice(1).join(' - ')) };
  }
  return { artist: channel, title: clean(track.title) };
}

/** Единая точка входа для панели лирики. Для youtube: URN серверный резолвер
 *  по URN бессилен — идём в ручной поиск по artist/title, кэш тот же. */
export async function getLyricsForTrack(track: Track): Promise<LyricsResult | null> {
  if (!isYouTubeUrn(track.urn)) return getLyricsByTrack(track.urn);
  const cached = getCachedLyrics(track.urn);
  if (cached) return cached;
  const { artist, title } = youtubeArtistTitle(track);
  if (!title) return null;
  return searchLyricsManual(artist, title, track.duration, track.urn);
}

/** Manual search — preview only. Backend does NOT read or write cache.
 *  When the result is displayed for a track (`scTrackId`), it is written to the
 *  local custom-lyrics cache so the track keeps it on the next visit. */
export async function searchLyricsManual(
  artist: string,
  title: string,
  durationMs?: number,
  scTrackId?: string,
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({ artist, title });
  if (durationMs && Number.isFinite(durationMs) && durationMs > 0) {
    params.set('duration', String(Math.round(durationMs)));
  }
  const data = await api<BackendLyricsResponse>(
    `/lyrics/search?${params}`,
    undefined,
    180_000,
  ).catch(() => null);
  const result = toResult(data);
  if (result && scTrackId) saveLyricsToCache(scTrackId, result);
  return result;
}
