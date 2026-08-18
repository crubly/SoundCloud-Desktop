import React, { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LibraryFrame } from '../components/library/LibraryFrame';
import { LibrarySubHeader } from '../components/library/LibrarySubHeader';
import { LikesTab } from '../components/library/LikesTab';
import { useSoundprint } from '../components/library/useSoundprint';
import { useLocalFavorites } from '../stores/favorites';

/** Library — your locally-liked tracks. No account, no server — hearts you hit
 *  anywhere in the app land here and stay on-device. */
export const Library = React.memo(() => {
  const { t } = useTranslation();
  const likedTracks = useLocalFavorites();
  const sound = useSoundprint(likedTracks);
  const [filter, setFilter] = useState('');
  const deferredFilter = useDeferredValue(filter);

  return (
    <LibraryFrame sound={sound}>
      <LibrarySubHeader
        title={t('library.likedTracks')}
        aura={sound.aura}
        count={likedTracks.length}
        filter={filter}
        onFilter={setFilter}
      />
      <LikesTab filter={deferredFilter} />
    </LibraryFrame>
  );
});
