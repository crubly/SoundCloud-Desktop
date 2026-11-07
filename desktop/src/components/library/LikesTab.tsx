import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { armLikesContinuation } from '../../lib/queue-continuation';
import { useLocalFavorites } from '../../stores/favorites';
import { VirtualList } from '../ui/VirtualList';
import { LibraryTrackRow } from './LibraryTrackRow';

/** Locally-liked tracks (persisted favorites) rendered in an Apple Music Tahoe table. */
export const LikesTab = React.memo(function LikesTab({ filter }: { filter: string }) {
  const { t } = useTranslation();
  const likedTracks = useLocalFavorites();

  const filtered = useMemo(() => {
    if (!filter) return likedTracks;
    const q = filter.toLowerCase();
    return likedTracks.filter(
      (tr) => tr.title.toLowerCase().includes(q) || tr.user.username.toLowerCase().includes(q),
    );
  }, [likedTracks, filter]);

  const filterRef = React.useRef(filter);
  filterRef.current = filter;
  const onLikePlay = React.useCallback(() => {
    if (!filterRef.current) armLikesContinuation();
  }, []);

  if (likedTracks.length === 0) {
    return (
      <div className="min-h-[320px]">
        <div className="py-20 text-center text-white/30">{t('library.noLikedTracks')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-[360px]">
      {/* Apple Music Tahoe Column Header (Reference Image 3) */}
      <div className="liquid-table-header grid-cols-[24px_minmax(180px,2fr)_minmax(120px,1.3fr)_minmax(120px,1.2fr)_88px] gap-3 !px-2 mb-1">
        <div />
        <div className="pl-0">{t('table.song')}</div>
        <div className="liquid-table-header-col">{t('table.artist')}</div>
        <div className="liquid-table-header-col">{t('table.album')}</div>
        <div className="liquid-table-header-col">{t('table.time')}</div>
      </div>

      <div className="flex flex-col">
        {filtered.length > 0 ? (
          <VirtualList
            items={filtered}
            rowHeight={58}
            overscan={8}
            className="flex flex-col"
            disabled={filtered.length < 40}
            getItemKey={(track) => track.urn}
            renderItem={(track, i) => (
              <LibraryTrackRow track={track} index={i} queue={filtered} onPlay={onLikePlay} />
            )}
          />
        ) : (
          <div className="py-16 text-center text-white/30">{t('library.noMatches')}</div>
        )}
      </div>
    </div>
  );
});
