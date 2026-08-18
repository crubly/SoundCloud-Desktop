import React, { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router-dom';
import { LibraryFrame } from '../components/library/LibraryFrame';
import { LibrarySubHeader } from '../components/library/LibrarySubHeader';
import { LikesTab } from '../components/library/LikesTab';
import { useSoundprint } from '../components/library/useSoundprint';
import { useLocalFavorites } from '../stores/favorites';

/** Deep collection page (/library/:section) — local-only, so there's a single
 *  real section ("likes" = your on-device favorites). Everything else redirects. */
export const LibraryCollection = React.memo(() => {
  const { t } = useTranslation();
  const { section } = useParams<{ section: string }>();
  const likedTracks = useLocalFavorites();
  const sound = useSoundprint(likedTracks);
  const [filter, setFilter] = useState('');
  const deferredFilter = useDeferredValue(filter);

  if (section !== 'likes') {
    return <Navigate to="/library/likes" replace />;
  }

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
