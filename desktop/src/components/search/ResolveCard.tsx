import { AlertCircle, Link2, Loader2 } from 'lucide-react';
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getCurrentTime, getDownloadProgress, getYtStage, subscribe } from '../../lib/audio';
import { usePerfMode } from '../../lib/perf';
import { type ResolvedStreamingTrack, resolveTrackFromStreaming } from '../../lib/streaming';
import { buildYouTubeTrack, resolveYouTubeVideo } from '../../lib/youtube';
import { usePlayerStore } from '../../stores/player';
import { isYouTubeUrl } from './utils';

interface ResolveCardProps {
  url: string;
  onDone: () => void;
}

/// Резолв → внутренний роут. Плейлисты приходят без `urn` (только `id`),
/// поэтому URN при необходимости собираем из kind+id. Альбомные сеты SC —
/// тоже kind=playlist, их ведёт PlaylistPage.
const KIND_ROUTES: Record<string, { route: string; ns: string }> = {
  track: { route: 'track', ns: 'tracks' },
  user: { route: 'user', ns: 'users' },
  playlist: { route: 'playlist', ns: 'playlists' },
};

function resolvedRoute(resolved: ResolvedStreamingTrack | null | undefined): string | null {
  if (!resolved) return null;
  const target = KIND_ROUTES[resolved.kind ?? 'track'];
  if (!target) return null;
  const urn =
    resolved.urn ?? (resolved.id != null ? `soundcloud:${target.ns}:${resolved.id}` : null);
  return urn ? `/${target.route}/${encodeURIComponent(urn)}` : null;
}

const STAGE_KEYS: Record<string, string> = {
  setup: 'yt.state.setup',
  download: 'yt.state.download',
  convert: 'yt.state.convert',
};

/* SoundCloud URL short-circuit: resolve the link and redirect to the matching page.
 * YouTube URL: resolve video meta, then start the download→MP3 pipeline and keep the
 * card on screen ("конвертация") until playback actually starts. */
export const ResolveCard = memo(function ResolveCard({ url, onDone }: ResolveCardProps) {
  const { t } = useTranslation();
  const perf = usePerfMode();
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const yt = isYouTubeUrl(url);
  const startedRef = useRef(false);
  const playing = useSyncExternalStore(
    subscribe,
    () => usePlayerStore.getState().currentTrack?.urn ?? null,
  );
  const currentTime = useSyncExternalStore(subscribe, getCurrentTime);
  const stage = useSyncExternalStore(subscribe, getYtStage);
  const progress = useSyncExternalStore(subscribe, getDownloadProgress);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    startedRef.current = false;

    const playYouTube = async () => {
      try {
        const meta = await resolveYouTubeVideo(url);
        if (cancelled) return;
        const track = buildYouTubeTrack(meta);
        if (cancelled) return;
        startedRef.current = true;
        usePlayerStore.getState().play(track, [track]);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    if (yt) {
      void playYouTube();
      return () => {
        cancelled = true;
      };
    }

    resolveTrackFromStreaming(url)
      .then((resolved) => {
        if (cancelled) return;
        const route = resolvedRoute(resolved);
        if (route) {
          navigate(route);
          onDone();
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, yt, navigate, onDone]);

  // YouTube: как только плейер реально заиграл этот трек — сворачиваем карточку.
  const ytReady = startedRef.current && playing?.startsWith('youtube:tracks:') && currentTime > 0;
  useEffect(() => {
    if (yt && ytReady) onDone();
  }, [yt, ytReady, onDone]);

  const stageKey = stage ? STAGE_KEYS[stage] : null;
  const converting = yt && startedRef.current && !error && !ytReady;
  const busy = !yt || converting;

  const b = perf.blur(40);
  return (
    <div className="flex justify-center px-4 pt-16">
      <div
        className="w-full max-w-[440px] flex flex-col items-center gap-4 p-8 rounded-[2rem] text-center"
        style={{
          background:
            b > 0
              ? 'linear-gradient(165deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
              : 'rgba(18,18,22,0.85)',
          border: '0.5px solid rgba(255,255,255,0.1)',
          backdropFilter: b > 0 ? `blur(${b}px) saturate(160%)` : undefined,
          WebkitBackdropFilter: b > 0 ? `blur(${b}px) saturate(160%)` : undefined,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
          isolation: 'isolate',
        }}
      >
        <div
          className="w-14 h-14 flex items-center justify-center rounded-2xl"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '0.5px solid rgba(255,255,255,0.08)',
          }}
        >
          {error ? (
            <AlertCircle size={24} className="text-white/50" />
          ) : (
            <Loader2 size={24} className="text-accent animate-spin" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-white/90">
            {error
              ? yt
                ? t('yt.resolve.errorTitle')
                : t('search.resolve.errorTitle')
              : yt
                ? t('yt.resolve.loading')
                : t('search.resolve.loading')}
          </p>
          {converting && (
            <p className="text-[12px] text-white/50">
              {stageKey ? t(stageKey) : t('yt.state.download')}
              {stage === 'download' && progress != null && progress > 0
                ? ` · ${Math.round(progress * 100)}%`
                : ''}
            </p>
          )}
          <p className="flex items-center justify-center gap-1.5 text-[12px] text-white/40 font-mono">
            <Link2 size={12} />
            <span className="max-w-[300px] truncate">{url}</span>
          </p>
        </div>
        {(error || busy) && (
          <button
            type="button"
            onClick={onDone}
            className="h-9 px-5 rounded-full text-[13px] text-white/80 cursor-pointer transition-colors hover:bg-white/[0.06]"
            style={{ border: '0.5px solid rgba(255,255,255,0.12)' }}
          >
            {t('search.back')}
          </button>
        )}
      </div>
    </div>
  );
});
