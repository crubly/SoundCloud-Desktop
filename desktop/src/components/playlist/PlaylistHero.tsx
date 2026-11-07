import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { art, durLong } from '../../lib/formatters';
import type { Playlist } from '../../lib/hooks';
import { Music, Star } from '../../lib/icons';
import { rawPlaylistCover } from '../../lib/playlist-cover';
import type { Track } from '../../stores/player';
import { PlaylistActions } from './PlaylistActions';
import type { PlaylistAura } from './usePlaylistAura';

export const PlaylistHero = React.memo(function PlaylistHero({
  playlist,
  tracks,
  isOwner,
  isPlaying,
  isPinned,
  trackCount,
  onPlayAll,
  onShuffle,
  onTogglePin,
  onDelete,
}: {
  playlist: Playlist;
  tracks: Track[];
  aura: PlaylistAura;
  isOwner: boolean;
  isPlaying: boolean;
  isPinned: boolean;
  trackCount: number;
  onPlayAll: () => void;
  onShuffle: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const coverUrl = art(rawPlaylistCover(playlist.artwork_url, tracks), 't500x500');

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-stretch gap-8 pb-2">
      {/* Left: 228×228 Apple Music Tahoe Rounded Cover Card (Reference Image 3) */}
      <div
        onClick={onPlayAll}
        className="w-[216px] h-[216px] sm:w-[228px] sm:h-[228px] shrink-0 rounded-[18px] overflow-hidden bg-[#141418] cursor-pointer select-none shadow-[0_24px_60px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.14] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015] flex items-center justify-center"
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={playlist.title}
            className="w-full h-full object-cover"
            decoding="async"
          />
        ) : (
          <Music size={56} className="text-white/20" />
        )}
      </div>

      {/* Right: Vertically aligned Title + Curator + Action Row */}
      <div className="flex-1 flex flex-col justify-between min-w-0 py-2">
        <div className="my-auto space-y-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-white leading-tight truncate">
              {playlist.title}
            </h1>
            {isPinned && (
              <Star
                size={18}
                fill="var(--color-accent)"
                strokeWidth={0}
                className="text-accent shrink-0"
              />
            )}
          </div>

          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white/55">
            {playlist.user?.username && (
              <button
                type="button"
                onClick={() =>
                  playlist.user?.urn && navigate(`/user/${encodeURIComponent(playlist.user.urn)}`)
                }
                className="text-accent hover:underline cursor-pointer"
              >
                {playlist.user.username}
              </button>
            )}
            <span>·</span>
            <span>
              {trackCount} {t('library.tracks').toLowerCase()}
            </span>
            {playlist.duration > 0 && (
              <>
                <span>·</span>
                <span>{durLong(playlist.duration)}</span>
              </>
            )}
          </div>

          {playlist.description && (
            <p className="text-[12.5px] text-white/45 line-clamp-2 max-w-xl pt-1">
              {playlist.description}
            </p>
          )}
        </div>

        <div className="pt-5">
          <PlaylistActions
            playlist={playlist}
            isOwner={isOwner}
            isPlaying={isPlaying}
            isPinned={isPinned}
            onPlayAll={onPlayAll}
            onShuffle={onShuffle}
            onTogglePin={onTogglePin}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
});
