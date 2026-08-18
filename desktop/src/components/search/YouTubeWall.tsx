import { Loader2, Pause, Play } from 'lucide-react';
import { memo, useCallback, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getDownloadProgress, getYtStage, subscribe } from '../../lib/audio';
import { art } from '../../lib/formatters';
import { Youtube } from '../../lib/icons';
import { useTrackPlay } from '../../lib/useTrackPlay';
import { useYouTubeSearch } from '../../lib/youtube';
import type { Track } from '../../stores/player';
import { InfiniteSentinel } from '../discover/InfiniteSentinel';
import { EmptyState } from './EmptyState';

/* YouTube-стена: прямоугольные 16:9 превью (видео-эстетика), поведение плитки
 * как у CoverTile — hover-lift, accent-ring у текущего трека, play по клику.
 * Прослушивание идёт через скачивание+конвертацию на Rust — пока идёт пайплайн,
 * на тайле оверлей со стадией. */

const STAGE_KEYS: Record<string, string> = {
  setup: 'yt.state.setup',
  download: 'yt.state.download',
  convert: 'yt.state.convert',
};

function formatDuration(ms: number): string | null {
  if (!ms || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const YouTubeTile = memo(function YouTubeTile({
  track,
  getQueue,
}: {
  track: Track;
  getQueue: () => Track[];
}) {
  const { t } = useTranslation();
  const { isThis, isThisPlaying, togglePlay } = useTrackPlay(track, getQueue);
  const progress = useSyncExternalStore(subscribe, getDownloadProgress);
  const stage = useSyncExternalStore(subscribe, getYtStage);

  const cover = art(track.artwork_url);
  const duration = formatDuration(track.duration);
  const preparing = isThis && (stage != null || progress != null);
  const stageKey = stage ? STAGE_KEYS[stage] : null;

  return (
    <div className="tg-tile group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={togglePlay}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            togglePlay();
          }
        }}
        className="tg-lift relative block w-full rounded-2xl overflow-hidden cursor-pointer bg-white/[0.03]"
        style={{ aspectRatio: '16 / 9' }}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(140deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))',
            }}
          />
        )}

        {duration && !preparing && (
          <span
            className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded-md text-[11px] font-medium text-white/90"
            style={{ background: 'rgba(0,0,0,0.72)' }}
          >
            {duration}
          </span>
        )}

        {/* Пайплайн подготовки: скачивание → конвертация в MP3 */}
        {preparing && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3"
            style={{ background: 'rgba(0,0,0,0.62)' }}
          >
            <Loader2 size={18} className="text-accent animate-spin" />
            <p className="text-[11px] font-medium text-white/85 text-center leading-tight">
              {stageKey ? t(stageKey) : t('yt.state.download')}
              {stage === 'download' && progress != null && progress > 0
                ? ` · ${Math.round(progress * 100)}%`
                : ''}
            </p>
          </div>
        )}

        {/* Play affordance */}
        {!preparing && (
          <div
            className={`absolute top-2 right-2 flex items-center justify-center rounded-full transition-all duration-300 ${
              isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{
              width: 30,
              height: 30,
              background: 'rgba(0,0,0,0.62)',
              border: '0.5px solid rgba(255,255,255,0.18)',
            }}
          >
            {isThisPlaying ? (
              <Pause size={14} className="text-white" fill="currentColor" />
            ) : (
              <Play size={14} className="text-white translate-x-[1px]" fill="currentColor" />
            )}
          </div>
        )}
      </div>

      {isThis && (
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 0 2px var(--color-accent), 0 0 24px var(--color-accent-glow)',
          }}
        />
      )}

      <div className="pt-2 px-0.5">
        <p className="line-clamp-2 text-[13px] font-medium text-white/90 leading-snug">
          {track.title}
        </p>
        <p className="truncate text-[11px] text-white/45 pt-0.5">{track.user.username}</p>
      </div>
    </div>
  );
});

export const YouTubeWall = memo(function YouTubeWall({ query }: { query: string }) {
  const { t } = useTranslation();
  const hasQuery = query.trim().length >= 2;
  const { items, isLoading, isError, isFetchingMore, hasMore, loadMore } = useYouTubeSearch(
    query,
    hasQuery,
  );

  // Очередь читается лениво на момент play (см. useTrackPlay/CoverTile) —
  // свежий массив на каждый рендер сломал бы memo тайлов.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const getQueue = useCallback(() => itemsRef.current, []);

  if (!hasQuery) {
    return (
      <EmptyState
        icon={<Youtube size={26} />}
        title={t('yt.firstTimeTitle')}
        body={t('yt.firstTimeBody')}
      />
    );
  }

  if (isError && items.length === 0) {
    return (
      <EmptyState
        icon={<Youtube size={26} />}
        title={t('yt.errorTitle')}
        body={t('yt.errorBody')}
      />
    );
  }

  const showSkeleton = isLoading && items.length === 0;

  return (
    <>
      <div
        className="grid px-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: 16 }}
      >
        {showSkeleton
          ? Array.from({ length: 12 }, (_, i) => (
              <div key={`yt-sk-${i}`}>
                <div
                  className="rounded-2xl skeleton-shimmer"
                  style={{ aspectRatio: '16 / 9', background: 'rgba(255,255,255,0.04)' }}
                />
                <div
                  className="mt-2 h-3 w-4/5 rounded skeleton-shimmer"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                />
                <div
                  className="mt-1.5 h-2.5 w-2/5 rounded skeleton-shimmer"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                />
              </div>
            ))
          : items.map((track) => <YouTubeTile key={track.urn} track={track} getQueue={getQueue} />)}
      </div>

      {!showSkeleton && items.length === 0 && (
        <EmptyState
          icon={<Youtube size={26} />}
          title={t('yt.emptyTitle')}
          body={t('yt.emptyBody', { query: query.trim() })}
        />
      )}

      {!showSkeleton && hasMore && (
        <InfiniteSentinel hasMore={hasMore} isFetching={isFetchingMore} onLoadMore={loadMore} />
      )}
    </>
  );
});
