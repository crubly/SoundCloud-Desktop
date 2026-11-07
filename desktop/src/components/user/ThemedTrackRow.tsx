import { Lock } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { preloadTrack } from '../../lib/audio';
import type { Aura } from '../../lib/aura';
import { art, dur, fc } from '../../lib/formatters';
import {
  headphones11,
  heart11,
  ListPlus,
  Music,
  pauseWhite14,
  playWhite14,
} from '../../lib/icons';
import { useTrackPlay } from '../../lib/useTrackPlay';
import type { Track } from '../../stores/player';
import { AddToPlaylistDialog } from '../music/AddToPlaylistDialog';
import { LikeButton } from '../music/LikeButton';
import { sameScdMeta, TrackStatusBadges } from '../music/TrackStatusBadges';
import { TrackTitleArtist } from '../music/TrackTitleArtist';

interface ThemedTrackRowProps {
  track: Track;
  index: number;
  queue: Track[];
  aura: Aura;
}

function ThemedTrackRowImpl({ track, index, queue }: ThemedTrackRowProps) {
  const { t } = useTranslation();
  const { isThis, isThisPlaying, togglePlay } = useTrackPlay(track, queue);
  const cover = art(track.artwork_url, 't200x200');

  return (
    <div
      data-active={isThis ? 'true' : undefined}
      onDoubleClick={togglePlay}
      onMouseEnter={() => preloadTrack(track.urn)}
      className="group liquid-table-row flex items-center gap-3.5 px-3 py-2 select-none"
    >
      <LikeButton track={track} />

      <div
        className="w-7 h-7 flex items-center justify-center shrink-0 cursor-pointer relative"
        onClick={togglePlay}
      >
        {isThisPlaying ? (
          <div className="w-7 h-7 rounded-full bg-accent text-accent-contrast flex items-center justify-center">
            {pauseWhite14}
          </div>
        ) : (
          <>
            <span className="text-[12px] text-white/30 tabular-nums font-medium group-hover:opacity-0 transition-opacity">
              {index + 1}
            </span>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center">
                {playWhite14}
              </div>
            </div>
          </>
        )}
      </div>

      <div
        onClick={togglePlay}
        className="relative w-[42px] h-[42px] rounded-[8px] overflow-hidden shrink-0 ring-1 ring-white/[0.1] cursor-pointer"
      >
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-white/[0.04]">
            <Music size={16} className="text-white/20" />
          </div>
        )}
        {track.sharing === 'private' && (
          <div
            title={t('sharing.private')}
            aria-label={t('sharing.private')}
            className="absolute top-0.5 left-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/65 backdrop-blur-md text-amber-300/90"
          >
            <Lock size={9} />
          </div>
        )}
      </div>

      <TrackTitleArtist track={track} highlight={isThis} size="md" className="flex-1 min-w-0" />

      <div className="hidden md:flex shrink-0">
        <TrackStatusBadges meta={track._scd_meta} />
      </div>

      <div className="hidden md:flex items-center gap-5 shrink-0 pr-2 text-[11px] text-white/35">
        {track.playback_count != null && (
          <span className="inline-flex items-center gap-1.5 tabular-nums w-16">
            {headphones11} {fc(track.playback_count)}
          </span>
        )}
        {(track.favoritings_count ?? track.likes_count) != null && (
          <span className="inline-flex items-center gap-1.5 tabular-nums w-14">
            {heart11} {fc(track.favoritings_count ?? track.likes_count)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        <AddToPlaylistDialog trackUrns={[track.urn]}>
          <button
            type="button"
            className="cursor-pointer w-7 h-7 rounded-lg flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-all"
          >
            <ListPlus size={14} />
          </button>
        </AddToPlaylistDialog>
      </div>

      <span className="text-[12.5px] text-white/45 tabular-nums font-normal shrink-0 w-12 text-right">
        {dur(track.duration)}
      </span>

      <div className="pointer-events-none absolute bottom-0 left-[112px] right-3 h-px bg-white/[0.06]" />
    </div>
  );
}

const areEqual = (prev: ThemedTrackRowProps, next: ThemedTrackRowProps) =>
  prev.track.urn === next.track.urn &&
  prev.index === next.index &&
  prev.aura.id === next.aura.id &&
  prev.aura.accent[0] === next.aura.accent[0] &&
  prev.aura.accent[1] === next.aura.accent[1] &&
  prev.aura.accent[2] === next.aura.accent[2] &&
  prev.track.user_favorite === next.track.user_favorite &&
  prev.track.sharing === next.track.sharing &&
  sameScdMeta(prev.track._scd_meta, next.track._scd_meta);

export const ThemedTrackRow = React.memo(ThemedTrackRowImpl, areEqual);
