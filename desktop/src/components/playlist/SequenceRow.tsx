import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { preloadTrack } from '../../lib/audio';
import { art, dur } from '../../lib/formatters';
import {
  GripVertical,
  ListPlus,
  MoreHorizontal,
  Music,
  pauseWhite14,
  playWhite14,
  Trash2,
} from '../../lib/icons';
import { useArtistLinkItems, useDisplayTitle } from '../../lib/track-display';
import { useTrackPlay } from '../../lib/useTrackPlay';
import type { Track } from '../../stores/player';
import { usePlayerStore } from '../../stores/player';
import { AddToPlaylistDialog } from '../music/AddToPlaylistDialog';
import { ArtistNameLinks } from '../music/ArtistNameLinks';
import { LikeButton } from '../music/LikeButton';
import { sameScdMeta, TrackStatusBadges } from '../music/TrackStatusBadges';

function RowBody({
  track,
  isThis,
  isThisPlaying,
  togglePlay,
  dragHandle,
  onRemove,
}: {
  track: Track;
  index: number;
  isThis: boolean;
  isThisPlaying: boolean;
  togglePlay: () => void;
  dragHandle?: React.ReactNode;
  onRemove?: (urn: string) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToQueueNext = usePlayerStore((s) => s.addToQueueNext);
  const displayTitle = useDisplayTitle(track);
  const artistLinks = useArtistLinkItems(track);
  const cover = art(track.artwork_url, 't200x200');
  const albumLabel = track.genre ? `${displayTitle} - ${track.genre}` : `${displayTitle} - Single`;

  return (
    <>
      {/* 1. Left Star ★ gutter (or drag handle on hover for owner) */}
      <div className="flex items-center justify-center gap-0.5">
        {dragHandle}
        <LikeButton track={track} />
      </div>

      {/* 2. Song column: 42×42 rounded-[8px] cover art + Title + badges */}
      <div className="flex items-center gap-3.5 min-w-0 pr-2">
        <div
          onClick={togglePlay}
          onMouseEnter={() => preloadTrack(track.urn)}
          className="relative w-[42px] h-[42px] rounded-[8px] overflow-hidden shrink-0 bg-white/[0.05] ring-1 ring-white/[0.1] shadow-sm cursor-pointer"
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              className="w-full h-full object-cover"
              decoding="async"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music size={15} className="text-white/25" />
            </div>
          )}

          <div
            className={`absolute inset-0 flex items-center justify-center bg-black/45 transition-opacity duration-150 ${
              isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            {isThisPlaying ? pauseWhite14 : playWhite14}
          </div>
        </div>

        <div className="min-w-0 flex items-center gap-2">
          <span
            onClick={() => navigate(`/track/${encodeURIComponent(track.urn)}`)}
            className={`text-[13.5px] font-medium truncate cursor-pointer transition-colors ${
              isThis ? 'text-accent font-semibold' : 'text-white/92 hover:text-white'
            }`}
          >
            {displayTitle}
          </span>
          <TrackStatusBadges meta={track._scd_meta} />
        </div>
      </div>

      {/* 3. Artist column */}
      <div className="min-w-0 pl-3 text-[13px] text-white/60 truncate">
        <ArtistNameLinks
          items={artistLinks}
          linkClassName="hover:text-white hover:underline transition-colors"
        />
      </div>

      {/* 4. Album / Single column */}
      <div className="min-w-0 pl-3 text-[13px] text-white/55 truncate">{albumLabel}</div>

      {/* 5. Time + ••• Actions column */}
      <div className="flex items-center justify-end gap-1.5 pl-3">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            addToQueueNext([track]);
          }}
          className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer shrink-0"
          title={t('player.addToQueue')}
        >
          <ListPlus size={14} />
        </button>

        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(track.urn)}
            className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center text-white/35 hover:text-red-400 hover:bg-red-400/10 transition-all cursor-pointer shrink-0"
            title={t('playlist.removeTrack')}
          >
            <Trash2 size={13} />
          </button>
        )}

        <span className="text-[13px] text-white/50 tabular-nums font-normal shrink-0">
          {dur(track.duration)}
        </span>

        <AddToPlaylistDialog trackUrns={[track.urn]}>
          <button
            type="button"
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer shrink-0"
            title={t('playlist.addToPlaylist')}
          >
            <MoreHorizontal size={15} />
          </button>
        </AddToPlaylistDialog>
      </div>

      {/* Inset hairline bottom border starting after artwork (Reference Image 3) */}
      <div className="pointer-events-none absolute bottom-0 left-[86px] right-2 h-px bg-white/[0.06]" />
    </>
  );
}

const ROW_GRID =
  'group liquid-table-row grid grid-cols-[24px_minmax(180px,2fr)_minmax(120px,1.3fr)_minmax(120px,1.2fr)_96px] items-center gap-3 px-2 py-2 select-none';

/** Owner row — drag-to-reorder + remove on hover. */
export const SortableSequenceRow = React.memo(
  function SortableSequenceRow({
    track,
    index,
    queue,
    onRemove,
    onPlay,
  }: {
    track: Track;
    index: number;
    queue: Track[];
    onRemove: (urn: string) => void;
    onPlay?: () => void;
  }) {
    const { isThis, isThisPlaying, togglePlay } = useTrackPlay(track, queue, onPlay);
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
      id: track.urn,
    });
    const base = CSS.Transform.toString(transform);

    const dragHandle = (
      <div
        className="hidden group-hover:flex w-4 items-center justify-center shrink-0 cursor-grab active:cursor-grabbing text-white/30 hover:text-white/70 transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={13} />
      </div>
    );

    return (
      <div
        ref={setNodeRef}
        data-active={isThis ? 'true' : undefined}
        onDoubleClick={togglePlay}
        style={{
          transform: base,
          transition,
          opacity: isDragging ? 0 : 1,
        }}
        className={ROW_GRID}
      >
        <RowBody
          track={track}
          index={index}
          isThis={isThis}
          isThisPlaying={isThisPlaying}
          togglePlay={togglePlay}
          dragHandle={dragHandle}
          onRemove={onRemove}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.track.urn === next.track.urn &&
    prev.index === next.index &&
    prev.track.user_favorite === next.track.user_favorite &&
    prev.track.title === next.track.title &&
    prev.track.enrichment === next.track.enrichment &&
    sameScdMeta(prev.track._scd_meta, next.track._scd_meta),
);

export function SequenceRowOverlay({
  track,
  index,
  queue,
}: {
  track: Track;
  index: number;
  queue: Track[];
}) {
  const { isThis, isThisPlaying, togglePlay } = useTrackPlay(track, queue);
  return (
    <div
      data-active={isThis ? 'true' : undefined}
      className={`${ROW_GRID} bg-white/[0.08] cursor-grabbing`}
      style={{
        transform: 'rotate(1deg)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.16)',
      }}
    >
      <RowBody
        track={track}
        index={index}
        isThis={isThis}
        isThisPlaying={isThisPlaying}
        togglePlay={togglePlay}
      />
    </div>
  );
}

/** Read-only row (non-owner). */
export const SequenceRow = React.memo(
  function SequenceRow({
    track,
    index,
    queue,
    onPlay,
  }: {
    track: Track;
    index: number;
    queue: Track[];
    onPlay?: () => void;
  }) {
    const { isThis, isThisPlaying, togglePlay } = useTrackPlay(track, queue, onPlay);
    return (
      <div
        data-active={isThis ? 'true' : undefined}
        onDoubleClick={togglePlay}
        className={ROW_GRID}
      >
        <RowBody
          track={track}
          index={index}
          isThis={isThis}
          isThisPlaying={isThisPlaying}
          togglePlay={togglePlay}
        />
      </div>
    );
  },
  (prev, next) =>
    prev.track.urn === next.track.urn &&
    prev.index === next.index &&
    prev.track.user_favorite === next.track.user_favorite &&
    prev.track.title === next.track.title &&
    prev.track.enrichment === next.track.enrichment &&
    sameScdMeta(prev.track._scd_meta, next.track._scd_meta),
);
