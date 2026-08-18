import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { armLikesContinuation } from '../../lib/queue-continuation';
import { useLocalFavorites } from '../../stores/favorites';
import { VirtualList } from '../ui/VirtualList';
import { LibraryTrackRow } from './LibraryTrackRow';

/** Locally-liked tracks (persisted favorites) — no server, no pagination. */
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
      <div className="min-h-[400px]">
        <div className="py-20 text-center text-white/20">{t('library.noLikedTracks')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-[400px]">
      <div className="flex flex-col gap-1">
        {filtered.length > 0 ? (
          <VirtualList
            items={filtered}
            rowHeight={68}
            overscan={8}
            className="flex flex-col gap-1"
            disabled={filtered.length < 40}
            getItemKey={(track) => track.urn}
            renderItem={(track, i) => (
              <LibraryTrackRow track={track} index={i} queue={filtered} onPlay={onLikePlay} />
            )}
          />
        ) : (
          <div className="py-20 text-center text-white/20">{t('library.noMatches')}</div>
        )}
      </div>
    </div>
  );
});
