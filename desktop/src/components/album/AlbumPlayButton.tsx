import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Aura } from '../../lib/aura';
import { pauseCurrent16, playCurrent16, Shuffle } from '../../lib/icons';
import { useIsPlayingFrom } from '../../lib/useTrackPlay';
import { shuffleArray, type Track, usePlayerStore } from '../../stores/player';

interface AlbumPlayButtonProps {
  tracks: Track[];
  aura?: Aura;
}

/** Apple Music Tahoe action row: circular Shuffle + pill Play, both Liquid Glass. */
function AlbumPlayButtonImpl({ tracks }: AlbumPlayButtonProps) {
  const { t } = useTranslation();

  const { playable, playableUrns } = useMemo(() => {
    const list: Track[] = [];
    const urns = new Set<string>();
    for (const tr of tracks) {
      if (tr.enrichment?.availability !== 'wanted') {
        list.push(tr);
        urns.add(tr.urn);
      }
    }
    return { playable: list, playableUrns: urns };
  }, [tracks]);

  const isPlayingFromAlbum = useIsPlayingFrom(playableUrns);
  const empty = playable.length === 0;

  const onClick = useCallback(() => {
    if (empty) return;
    const { play, pause, resume, currentTrack } = usePlayerStore.getState();
    if (isPlayingFromAlbum) {
      pause();
      return;
    }
    if (currentTrack?.urn && playableUrns.has(currentTrack.urn)) {
      resume();
      return;
    }
    play(playable[0], playable);
  }, [empty, isPlayingFromAlbum, playable, playableUrns]);

  const onShuffle = useCallback(() => {
    if (empty) return;
    const list = [...playable];
    shuffleArray(list);
    usePlayerStore.getState().play(list[0], list);
  }, [empty, playable]);

  return (
    <div className="flex items-center gap-3.5">
      <button
        type="button"
        onClick={onShuffle}
        disabled={empty}
        title={t('playlist.shuffle')}
        className="liquid-action-btn w-10 h-10 rounded-full disabled:opacity-50"
      >
        <Shuffle size={16} strokeWidth={2.2} />
      </button>
      <button
        type="button"
        onClick={onClick}
        disabled={empty}
        className="liquid-action-btn h-10 px-9 rounded-full text-[14px] font-semibold disabled:opacity-50"
      >
        {isPlayingFromAlbum ? pauseCurrent16 : playCurrent16}
        <span>{isPlayingFromAlbum ? t('track.pause') : t('track.play')}</span>
      </button>
    </div>
  );
}

export const AlbumPlayButton = memo(AlbumPlayButtonImpl);
