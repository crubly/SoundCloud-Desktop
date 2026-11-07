import { memo } from 'react';
import { preloadTrack } from '../../lib/audio';
import type { Aura } from '../../lib/aura';
import { art, dur } from '../../lib/formatters';
import { ListPlus, Music, pauseWhite14, playWhite14 } from '../../lib/icons';
import { useTrackPlay } from '../../lib/useTrackPlay';
import type { Track } from '../../stores/player';
import { AddToPlaylistDialog } from '../music/AddToPlaylistDialog';
import { LikeButton } from '../music/LikeButton';
import { sameScdMeta, TrackStatusBadges } from '../music/TrackStatusBadges';
import { TrackTitleArtist } from '../music/TrackTitleArtist';

interface AlbumTrackRowProps {
  track: Track;
  position: number;
  queue: Track[];
  aura: Aura;
}

function AlbumTrackRowImpl({ track, position, queue }: AlbumTrackRowProps) {
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
            <span className="text-[12.5px] text-white/35 tabular-nums font-medium group-hover:opacity-0 transition-opacity">
              {position}
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
            <Music size={14} className="text-white/20" />
          </div>
        )}
      </div>

      <TrackTitleArtist track={track} highlight={isThis} size="md" className="flex-1 min-w-0" />

      <div className="shrink-0">
        <TrackStatusBadges meta={track._scd_meta} />
      </div>

      <div className="flex items-center gap-1 shrink-0">
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

const areEqual = (prev: AlbumTrackRowProps, next: AlbumTrackRowProps) =>
  prev.track.urn === next.track.urn &&
  prev.position === next.position &&
  prev.aura.id === next.aura.id &&
  prev.aura.accent[0] === next.aura.accent[0] &&
  prev.aura.accent[1] === next.aura.accent[1] &&
  prev.aura.accent[2] === next.aura.accent[2] &&
  prev.track.user_favorite === next.track.user_favorite &&
  sameScdMeta(prev.track._scd_meta, next.track._scd_meta);

export const AlbumTrackRow = memo(AlbumTrackRowImpl, areEqual);
