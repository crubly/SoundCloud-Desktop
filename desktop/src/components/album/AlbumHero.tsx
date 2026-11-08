import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Aura } from '../../lib/aura';
import { dur } from '../../lib/formatters';
import { AlbumPlayButton } from './AlbumPlayButton';
import type { AlbumDetail } from './types';

interface AlbumHeroProps {
  album: AlbumDetail;
  hasStar: boolean;
  aura: Aura;
}

/** Apple Music Tahoe album header: 253px cover, big title, accent artist,
 *  grey metadata line, Liquid Glass Shuffle / Play. */
function AlbumHeroImpl({ album }: AlbumHeroProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const kind = (album.type ?? 'album').toLowerCase();
  const kindLabel = t(`artist.kind.${kind}`, { defaultValue: kind });

  const totalDuration = useMemo(
    () => album.tracks.reduce((sum, tr) => sum + (tr.duration ?? 0), 0),
    [album.tracks],
  );
  const artists = [
    ...(album.primary_artist ? [album.primary_artist] : []),
    ...album.artists.filter((a) => a.role !== 'primary'),
  ];
  const meta = [kindLabel, album.release_year, totalDuration > 0 ? dur(totalDuration) : null]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="flex flex-col sm:flex-row gap-8 items-center sm:items-end px-8 pt-14">
      <div className="w-[253px] h-[253px] shrink-0 rounded-[10px] overflow-hidden bg-white/[0.06] shadow-[0_18px_44px_rgba(0,0,0,0.6)]">
        {album.cover_url && (
          <img src={album.cover_url} alt="" className="w-full h-full object-cover" decoding="async" />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1 sm:self-stretch sm:justify-between text-center sm:text-left">
        <div className="sm:pt-16">
          <h1 className="text-[24px] font-bold tracking-tight leading-tight text-white wrap-break-word">
            {album.title}
          </h1>
          <div className="text-[24px] font-semibold leading-tight text-accent">
            {artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  onClick={() => navigate(`/artist/${encodeURIComponent(a.id)}`)}
                  className="cursor-pointer hover:underline"
                >
                  {a.name}
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] font-semibold text-white/45">{meta}</p>
        </div>
        <div className="pt-4 flex justify-center sm:justify-start">
          <AlbumPlayButton tracks={album.tracks} />
        </div>
      </div>
    </div>
  );
}

export const AlbumHero = memo(AlbumHeroImpl);
