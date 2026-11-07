import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic, Loader2 } from '../../lib/icons';
import type { Track } from '../../stores/player';
import { VirtualList } from '../ui/VirtualList';
import { SequenceRow, SequenceRowOverlay, SortableSequenceRow } from './SequenceRow';

/** The Sequence — virtualized Apple Music Tahoe track table. */
export const SequenceList = React.memo(function SequenceList({
  tracks,
  isOwner,
  onDragEnd,
  onRemove,
  onPlay,
  sentinelRef,
  hasNextPage,
  isFetchingNextPage,
}: {
  tracks: Track[];
  isOwner: boolean;
  onDragEnd: (e: DragEndEvent) => void;
  onRemove: (urn: string) => void;
  onPlay?: () => void;
  sentinelRef: React.Ref<HTMLDivElement>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const ids = useMemo(() => tracks.map((tr) => tr.urn), [tracks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIndex = activeId ? tracks.findIndex((tr) => tr.urn === activeId) : -1;
  const activeTrack = activeIndex >= 0 ? tracks[activeIndex] : null;

  if (tracks.length === 0) {
    return (
      <div className="py-20 flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-white/[0.03] border border-white/[0.06]">
          <ListMusic size={24} className="text-white/15" />
        </div>
        <p className="text-white/30 text-sm">{t('playlist.emptyCrate')}</p>
      </div>
    );
  }

  const sentinel = hasNextPage ? (
    <div ref={sentinelRef} className="flex justify-center py-4">
      {isFetchingNextPage && <Loader2 size={20} className="animate-spin text-white/30" />}
    </div>
  ) : null;

  return (
    <div>
      {/* Apple Music Tahoe Table Header (Reference Image 3) */}
      <div className="liquid-table-header grid-cols-[24px_minmax(180px,2fr)_minmax(120px,1.3fr)_minmax(120px,1.2fr)_96px] gap-3 !px-2 mb-1">
        <div />
        <div>{t('table.song')}</div>
        <div className="liquid-table-header-col">{t('table.artist')}</div>
        <div className="liquid-table-header-col">{t('table.album')}</div>
        <div className="liquid-table-header-col">{t('table.time')}</div>
      </div>

      {isOwner ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={(e) => {
            setActiveId(null);
            onDragEnd(e);
          }}
          onDragCancel={() => setActiveId(null)}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <VirtualList
              items={tracks}
              rowHeight={58}
              overscan={12}
              className="flex flex-col"
              getItemKey={(tr) => tr.urn}
              renderItem={(track, i) => (
                <SortableSequenceRow
                  track={track}
                  index={i}
                  queue={tracks}
                  onRemove={onRemove}
                  onPlay={onPlay}
                />
              )}
            />
          </SortableContext>
          <DragOverlay>
            {activeTrack ? (
              <SequenceRowOverlay track={activeTrack} index={activeIndex} queue={tracks} />
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <VirtualList
          items={tracks}
          rowHeight={58}
          overscan={10}
          className="flex flex-col"
          getItemKey={(tr) => tr.urn}
          renderItem={(track, i) => (
            <SequenceRow track={track} index={i} queue={tracks} onPlay={onPlay} />
          )}
        />
      )}
      {sentinel}
    </div>
  );
});
