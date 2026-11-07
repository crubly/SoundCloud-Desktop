import React, { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { LibraryFrame } from '../components/library/LibraryFrame';
import { LibrarySubHeader } from '../components/library/LibrarySubHeader';
import { LikesTab } from '../components/library/LikesTab';
import { PlaylistsTab } from '../components/library/PlaylistsTab';
import { useSoundprint } from '../components/library/useSoundprint';
import { Search as SearchIcon, X } from '../lib/icons';
import { useLocalFavorites } from '../stores/favorites';

/** Library — supports both Songs / Favourite Songs (/library) and All Playlists (/library?tab=playlists). */
export const Library = React.memo(() => {
  const { t } = useTranslation();
  const location = useLocation();
  const likedTracks = useLocalFavorites();
  const sound = useSoundprint(likedTracks);
  const [filter, setFilter] = useState('');
  const deferredFilter = useDeferredValue(filter);
  const isPlaylistsTab = location.search.includes('tab=playlists');

  if (isPlaylistsTab) {
    return (
      <LibraryFrame sound={sound}>
        <div className="flex items-center justify-between gap-4 pt-1 mb-6">
          <h1 className="text-[34px] font-bold tracking-tight text-white leading-none">
            {t('sidebar.allPlaylists')}
          </h1>
          <div className="liquid-pill relative flex items-center gap-2 h-8 w-[220px] focus-within:w-[270px] pl-3 pr-2 rounded-full transition-[width] duration-200">
            <SearchIcon size={13} className="text-white/45 shrink-0" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('library.filter')}
              className="flex-1 min-w-0 bg-transparent text-white/90 placeholder:text-white/40 text-[12.5px] outline-none select-text"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter('')}
                className="w-4 h-4 flex items-center justify-center rounded-full text-white/40 hover:text-white cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        <PlaylistsTab filter={deferredFilter} />
      </LibraryFrame>
    );
  }

  return (
    <LibraryFrame sound={sound}>
      <LibrarySubHeader
        title={t('sidebar.favouriteSongs')}
        aura={sound.aura}
        count={likedTracks.length}
        filter={filter}
        onFilter={setFilter}
      />
      <LikesTab filter={deferredFilter} />
    </LibraryFrame>
  );
});
