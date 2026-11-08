import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GenreChip } from './utils';

const TILES = [
  ['#f2467c', '#ff7aa2'],
  ['#4a7de8', '#7fa4ff'],
  ['#e8532b', '#ff8a5c'],
  ['#12b35b', '#46d985'],
  ['#c0188e', '#e65bc0'],
  ['#e5b200', '#ffd23f'],
  ['#8a3ffc', '#b78bff'],
  ['#1aa7b8', '#4fd6e6'],
];

/** Apple Music "Browse Categories": a 4-up grid of saturated rounded tiles. */
export const BrowseCategories = memo(function BrowseCategories({
  genres,
  onSelect,
}: {
  genres: GenreChip[];
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-8 pt-2 pb-6">
      <h2 className="text-[15px] font-semibold text-white mb-3">{t('search.browseCategories')}</h2>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {genres.map((g, i) => {
          const [a, b] = TILES[i % TILES.length];
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => onSelect(g.key)}
              className="relative h-[88px] rounded-[10px] overflow-hidden text-left p-3 flex items-end cursor-pointer transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]"
              style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
            >
              <span className="text-[14px] font-bold text-white drop-shadow">{g.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
