import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Aura } from '../../lib/aura';
import {
  ArrowDownToLine,
  Play,
  Search as SearchIcon,
  Shuffle,
  Star,
  X,
} from '../../lib/icons';
import { armLikesContinuation } from '../../lib/queue-continuation';
import { useLocalFavorites } from '../../stores/favorites';
import { shuffleArray, usePlayerStore } from '../../stores/player';

interface LibrarySubHeaderProps {
  title: string;
  aura: Aura;
  count?: number;
  filter?: string;
  onFilter?: (v: string) => void;
}

/** Apple Music macOS Tahoe "Favourite Songs" Hero Header (Reference Image 3):
 *  - Left: 224×224 rounded-[18px] crisp light card with large accent Star ★
 *  - Right: Title + ★, inline filter pill, and dark Liquid Glass Shuffle / Play / Download buttons. */
export const LibrarySubHeader = memo(function LibrarySubHeader({
  title,
  filter,
  onFilter,
}: LibrarySubHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const likedTracks = useLocalFavorites();
  const play = usePlayerStore((s) => s.play);

  const handlePlay = (shuffle: boolean) => {
    if (likedTracks.length === 0) return;
    armLikesContinuation();
    if (shuffle) {
      const q = [...likedTracks];
      shuffleArray(q);
      play(q[0], q);
    } else {
      play(likedTracks[0], likedTracks);
    }
  };

  return (
    <div className="mb-8 pt-2">
      {/* Top-right inline filter pill ("Find in Playlist") */}
      {onFilter && (
        <div className="flex justify-end mb-4">
          <div className="liquid-pill relative flex items-center gap-2 h-8 w-[220px] focus-within:w-[270px] pl-3 pr-2 rounded-full transition-[width] duration-200">
            <SearchIcon size={13} className="text-white/45 shrink-0" />
            <input
              type="text"
              value={filter ?? ''}
              onChange={(e) => onFilter(e.target.value)}
              placeholder={t('playlist.findInPlaylist')}
              className="flex-1 min-w-0 bg-transparent text-white/90 placeholder:text-white/40 text-[12.5px] outline-none select-text"
            />
            {filter && (
              <button
                type="button"
                onClick={() => onFilter('')}
                className="w-4 h-4 flex items-center justify-center rounded-full text-white/40 hover:text-white cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Hero Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-stretch gap-8">
        {/* Left: 220×220 Favourite Songs Star Artwork Card (Reference Image 3) */}
        <div
          onClick={() => handlePlay(false)}
          className="w-[216px] h-[216px] sm:w-[228px] sm:h-[228px] shrink-0 rounded-[18px] flex items-center justify-center cursor-pointer select-none shadow-[0_24px_60px_rgba(0,0,0,0.85)] ring-1 ring-white/20 transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
          style={{
            background: 'linear-gradient(180deg, #f5f5f7 0%, #e5e5ea 100%)',
          }}
        >
          <Star
            size={112}
            fill="var(--color-accent)"
            strokeWidth={0}
            className="text-accent drop-shadow-[0_6px_18px_var(--color-accent-glow)]"
          />
        </div>

        {/* Right: Vertically aligned Title + Bottom Action Buttons */}
        <div className="flex-1 flex flex-col justify-between min-w-0 py-2">
          <div className="my-auto">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[28px] sm:text-[32px] font-bold tracking-tight text-white leading-tight truncate">
                {title}
              </h1>
              <Star
                size={18}
                fill="var(--color-accent)"
                strokeWidth={0}
                className="text-accent shrink-0"
              />
            </div>
          </div>

          {/* Bottom Action Row: Circular Shuffle, Pill Play, Circular Download (Reference Image 3) */}
          <div className="flex items-center gap-3.5 pt-5">
            <button
              type="button"
              disabled={likedTracks.length === 0}
              onClick={() => handlePlay(true)}
              title={t('home.discovery.shuffle')}
              className="liquid-action-btn w-10 h-10 rounded-full disabled:opacity-35"
            >
              <Shuffle size={16} strokeWidth={2.2} />
            </button>

            <button
              type="button"
              disabled={likedTracks.length === 0}
              onClick={() => handlePlay(false)}
              className="liquid-action-btn h-10 px-9 rounded-full text-[14px] font-semibold disabled:opacity-35"
            >
              <Play size={15} fill="currentColor" strokeWidth={0} className="ml-0.5" />
              <span>{t('track.play')}</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/offline')}
              title={t('nav.offline')}
              className="liquid-action-btn w-10 h-10 rounded-full"
            >
              <ArrowDownToLine size={16} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
