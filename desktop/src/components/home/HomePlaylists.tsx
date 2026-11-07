import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { art } from '../../lib/formatters';
import { useHomeDiscovery } from '../../lib/home-discovery';
import { Cloud, Music, Play } from '../../lib/icons';
import { armLikesContinuation } from '../../lib/queue-continuation';
import { useAuthStore } from '../../stores/auth';
import { shuffleArray, type Track, usePlayerStore } from '../../stores/player';
import { TrackCard } from '../music/TrackCard';
import { HorizontalScroll } from '../ui/HorizontalScroll';

/** Top-right Apple Music / SoundCloud Liquid Glass watermark badge (`☁music`) */
const BrandMark = () => (
  <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-0.5 text-white/95 drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] pointer-events-none select-none">
    <Cloud size={13} fill="currentColor" strokeWidth={0} />
    <span className="text-[12px] font-bold tracking-tight leading-none">music</span>
  </div>
);

/** Layered geometric play-chevron prism SVG (Reference Image 2 Station Cards) */
const StationPrismSvg = ({ variant }: { variant: 'crimson' | 'cobalt' }) => {
  const isCrimson = variant === 'crimson';
  return (
    <svg
      viewBox="0 0 250 336"
      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`bg-${variant}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isCrimson ? '#ff4b6e' : '#4f46e5'} />
          <stop offset="55%" stopColor={isCrimson ? '#fa233b' : '#2563eb'} />
          <stop offset="100%" stopColor={isCrimson ? '#e0112b' : '#1d4ed8'} />
        </linearGradient>
        <linearGradient id={`c1-${variant}`} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor={isCrimson ? '#ff5e3a' : '#6366f1'} />
          <stop offset="100%" stopColor={isCrimson ? '#ff2a68' : '#3b82f6'} />
        </linearGradient>
        <linearGradient id={`c2-${variant}`} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor={isCrimson ? '#ff7b00' : '#818cf8'} />
          <stop offset="100%" stopColor={isCrimson ? '#ff3b30' : '#60a5fa'} />
        </linearGradient>
        <linearGradient id={`c3-${variant}`} x1="0%" y1="0%" x2="100%" y2="50%">
          <stop offset="0%" stopColor={isCrimson ? '#ff9500' : '#a5b4fc'} />
          <stop offset="100%" stopColor={isCrimson ? '#ff5500' : '#38bdf8'} />
        </linearGradient>
      </defs>
      <rect width="250" height="336" fill={`url(#bg-${variant})`} />
      {/* Outer wide chevron */}
      <polygon points="0,0 248,154 0,308" fill={`url(#c1-${variant})`} opacity="0.92" />
      {/* Middle chevron */}
      <polygon points="0,24 166,154 0,284" fill={`url(#c2-${variant})`} opacity="0.95" />
      {/* Inner bright chevron */}
      <polygon points="0,58 96,154 0,250" fill={`url(#c3-${variant})`} />
    </svg>
  );
};

export const HomePlaylists = memo(function HomePlaylists({
  likedTracks,
}: {
  likedTracks: Track[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const play = usePlayerStore((s) => s.play);
  const { likedLoading, shelves, week } = useHomeDiscovery();

  const pool = useMemo(() => {
    const map = new Map<string, Track>();
    for (const tr of likedTracks) map.set(tr.urn, tr);
    for (const tr of week) if (!map.has(tr.urn)) map.set(tr.urn, tr);
    return Array.from(map.values());
  }, [likedTracks, week]);

  const featuredTrack = pool[0] ?? null;
  const collageTracks = useMemo(() => pool.slice(1, 5), [pool]);
  const extraPickTracks = useMemo(() => pool.slice(4, 12), [pool]);
  const recentlyPlayedTracks = useMemo(() => pool.slice(0, 14), [pool]);

  const collageArtistName =
    collageTracks[0]?.user?.username || featuredTrack?.user?.username || 'SoundCloud';

  const playStation = (source: Track[], shuffle: boolean) => {
    const list = source.length > 0 ? source : pool;
    if (list.length === 0) return;
    if (shuffle) {
      const q = [...list];
      shuffleArray(q);
      play(q[0], q);
    } else {
      play(list[0], list);
    }
  };

  if (likedLoading && pool.length === 0) {
    return (
      <section aria-hidden className="space-y-8 animate-pulse">
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-[250px] h-[332px] shrink-0 rounded-[18px] bg-white/[0.05]" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-9">
      {/* ── Top Picks for You (Reference Image 2 Tall Vertical Poster Cards) ── */}
      <div>
        <h2 className="text-[18px] font-bold tracking-tight text-white/95 mb-3.5">
          {t('home.topPicks')}
        </h2>

        <HorizontalScroll className="!gap-4">
          {/* Card 1: Personal Station ("Made for You — [User]'s Station") */}
          <div
            onClick={() => {
              armLikesContinuation();
              playStation(likedTracks.length > 0 ? likedTracks : pool, true);
            }}
            className="group/pick relative w-[250px] h-[332px] shrink-0 rounded-[18px] overflow-hidden cursor-pointer select-none shadow-[0_14px_34px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.12] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
          >
            <StationPrismSvg variant="crimson" />
            <BrandMark />

            {/* Hover Play Button */}
            <div className="absolute right-3.5 bottom-3.5 z-20 w-10 h-10 rounded-full bg-black/45 backdrop-blur-md border border-white/25 flex items-center justify-center text-white opacity-0 translate-y-1 group-hover/pick:opacity-100 group-hover/pick:translate-y-0 transition-all duration-200">
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </div>

            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/35 via-transparent to-transparent">
              <p className="text-[11.5px] font-medium text-white/85 leading-tight">
                {t('home.madeForYou')}
              </p>
              <h3 className="mt-0.5 text-[15px] font-bold text-white tracking-tight leading-snug truncate">
                {t('home.userStation', { user: user?.username || 'SoundCloud' })}
              </h3>
            </div>
          </div>

          {/* Card 2: Featured / Recently Added Track Poster Card */}
          {featuredTrack && (
            <div
              onClick={() => play(featuredTrack, pool)}
              className="group/pick relative w-[250px] h-[332px] shrink-0 rounded-[18px] overflow-hidden cursor-pointer select-none bg-[#141418] shadow-[0_14px_34px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.1] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
            >
              {art(featuredTrack.artwork_url, 't500x500') ? (
                <img
                  src={art(featuredTrack.artwork_url, 't500x500')!}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover/pick:scale-105"
                  decoding="async"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                  <Music size={42} className="text-white/20" />
                </div>
              )}

              {/* Bottom Dark Liquid Glass Frosted Overlay */}
              <div
                className="absolute inset-x-0 bottom-0 pt-10 pb-4 px-4"
                style={{
                  background:
                    'linear-gradient(180deg, transparent 0%, rgba(12,12,15,0.78) 45%, rgba(10,10,12,0.94) 100%)',
                  backdropFilter: 'blur(16px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                }}
              >
                <p className="text-[11.5px] font-medium text-white/60 leading-tight">
                  {t('sidebar.recentlyAdded')}
                </p>
                <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                  <h3 className="text-[14.5px] font-bold text-white tracking-tight truncate">
                    {featuredTrack.title} - Single
                  </h3>
                  <span className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded-[3px] bg-white/25 text-[9px] font-bold text-black">
                    E
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] font-medium text-white/65 truncate">
                  {featuredTrack.user?.username}
                </p>
              </div>
            </div>
          )}

          {/* Card 3: 3-Circle Artist Collage Card ("Featuring [Artist] — [Artist] & Similar Artists") */}
          {collageTracks.length > 0 && (
            <div
              onClick={() => playStation(collageTracks, false)}
              className="group/pick relative w-[250px] h-[332px] shrink-0 rounded-[18px] overflow-hidden cursor-pointer select-none shadow-[0_14px_34px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.12] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
              style={{
                background: 'linear-gradient(180deg, #3c3c40 0%, #525258 60%, #64646c 100%)',
              }}
            >
              <BrandMark />

              {/* 3-Circle Collage matching Reference Image 2 */}
              <div className="relative w-full h-[245px]">
                {/* Top-Left Large Circle with Inset Square Cover */}
                <div className="absolute top-4 left-4 w-[134px] h-[134px] rounded-full bg-white/25 flex items-center justify-center shadow-lg">
                  {art(collageTracks[0]?.artwork_url, 't300x300') ? (
                    <img
                      src={art(collageTracks[0]?.artwork_url, 't300x300')!}
                      alt=""
                      className="w-[78px] h-[78px] object-cover shadow-md"
                      decoding="async"
                    />
                  ) : (
                    <Music size={28} className="text-white/50" />
                  )}
                </div>

                {/* Middle-Right Dark Circle with Inset Square Cover */}
                <div className="absolute top-[102px] right-4 w-[78px] h-[78px] rounded-full bg-[#22122c] flex items-center justify-center shadow-lg">
                  {art(
                    (collageTracks[1] ?? collageTracks[0])?.artwork_url,
                    't300x300',
                  ) ? (
                    <img
                      src={
                        art((collageTracks[1] ?? collageTracks[0])?.artwork_url, 't300x300')!
                      }
                      alt=""
                      className="w-[46px] h-[46px] object-cover"
                      decoding="async"
                    />
                  ) : (
                    <Music size={18} className="text-white/50" />
                  )}
                </div>

                {/* Bottom-Center Circular Artist/Track Avatar */}
                <div className="absolute bottom-2 left-[76px] w-[72px] h-[72px] rounded-full overflow-hidden bg-sky-100 ring-2 ring-white/15 shadow-lg">
                  {art(
                    (collageTracks[2] ?? collageTracks[0])?.user?.avatar_url ||
                      (collageTracks[2] ?? collageTracks[0])?.artwork_url,
                    't300x300',
                  ) ? (
                    <img
                      src={
                        art(
                          (collageTracks[2] ?? collageTracks[0])?.user?.avatar_url ||
                            (collageTracks[2] ?? collageTracks[0])?.artwork_url,
                          't300x300',
                        )!
                      }
                      alt=""
                      className="w-full h-full object-cover"
                      decoding="async"
                    />
                  ) : null}
                </div>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4">
                <p className="text-[11.5px] font-medium text-white/80 leading-tight truncate">
                  {t('home.featuringArtist', { artist: collageArtistName })}
                </p>
                <h3 className="mt-0.5 text-[14.5px] font-bold text-white tracking-tight leading-snug truncate">
                  {t('home.similarArtists', { artist: collageArtistName })}
                </h3>
              </div>
            </div>
          )}

          {/* Card 4: Discovery Station ("Made for You — Discovery Station") */}
          <div
            onClick={() => playStation(week.length > 0 ? week : pool, true)}
            className="group/pick relative w-[250px] h-[332px] shrink-0 rounded-[18px] overflow-hidden cursor-pointer select-none shadow-[0_14px_34px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.12] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
          >
            <StationPrismSvg variant="cobalt" />
            <BrandMark />

            <div className="absolute right-3.5 bottom-3.5 z-20 w-10 h-10 rounded-full bg-black/45 backdrop-blur-md border border-white/25 flex items-center justify-center text-white opacity-0 translate-y-1 group-hover/pick:opacity-100 group-hover/pick:translate-y-0 transition-all duration-200">
              <Play size={16} fill="currentColor" className="ml-0.5" />
            </div>

            <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/35 via-transparent to-transparent">
              <p className="text-[11.5px] font-medium text-white/85 leading-tight">
                {t('home.madeForYou')}
              </p>
              <h3 className="mt-0.5 text-[15px] font-bold text-white tracking-tight leading-snug truncate">
                {t('home.discoveryStation')}
              </h3>
            </div>
          </div>

          {/* Additional Top Pick Poster Cards */}
          {extraPickTracks.map((tr) => {
            const cover = art(tr.artwork_url, 't500x500');
            return (
              <div
                key={tr.urn}
                onClick={() => play(tr, pool)}
                className="group/pick relative w-[250px] h-[332px] shrink-0 rounded-[18px] overflow-hidden cursor-pointer select-none bg-[#141418] shadow-[0_14px_34px_rgba(0,0,0,0.65)] ring-1 ring-white/[0.1] transition-transform duration-300 ease-[var(--ease-apple)] hover:scale-[1.015]"
              >
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover/pick:scale-105"
                    decoding="async"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/[0.04]">
                    <Music size={42} className="text-white/20" />
                  </div>
                )}
                <div
                  className="absolute inset-x-0 bottom-0 pt-10 pb-4 px-4"
                  style={{
                    background:
                      'linear-gradient(180deg, transparent 0%, rgba(12,12,15,0.78) 45%, rgba(10,10,12,0.94) 100%)',
                    backdropFilter: 'blur(16px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                  }}
                >
                  <p className="text-[11.5px] font-medium text-white/60 leading-tight">
                    {tr.genre || t('sidebar.recentlyAdded')}
                  </p>
                  <h3 className="mt-0.5 text-[14.5px] font-bold text-white tracking-tight truncate">
                    {tr.title}
                  </h3>
                  <p
                    onClick={(e) => {
                      if (tr.user?.urn) {
                        e.stopPropagation();
                        navigate(`/user/${encodeURIComponent(tr.user.urn)}`);
                      }
                    }}
                    className="mt-0.5 text-[12px] font-medium text-white/65 hover:text-white truncate"
                  >
                    {tr.user?.username}
                  </p>
                </div>
              </div>
            );
          })}
        </HorizontalScroll>
      </div>

      {/* ── Recently Played (Reference Image 2 Bottom Row of Square Cards) ── */}
      {recentlyPlayedTracks.length > 0 && (
        <div>
          <h2 className="text-[18px] font-bold tracking-tight text-white/95 mb-3.5">
            {t('home.recentlyPlayed')}
          </h2>
          <HorizontalScroll className="!gap-4">
            {recentlyPlayedTracks.map((track) => (
              <div key={track.urn} className="w-[186px] shrink-0">
                <TrackCard track={track} queue={recentlyPlayedTracks} />
              </div>
            ))}
          </HorizontalScroll>
        </div>
      )}

      {/* ── Genre & Artist Shelves ── */}
      {shelves.map((shelf) => {
        if (shelf.tracks.length === 0) return null;
        const isArtist = shelf.seed.kind === 'artist';
        const name = shelf.seed.name.charAt(0).toUpperCase() + shelf.seed.name.slice(1);
        return (
          <div key={shelf.seed.key}>
            <h2 className="text-[18px] font-bold tracking-tight text-white/95 mb-3.5">
              {t(isArtist ? 'home.discovery.shelfArtist' : 'home.discovery.shelfGenre', {
                name,
              })}
            </h2>
            <HorizontalScroll className="!gap-4">
              {shelf.tracks.map((track) => (
                <div key={track.urn} className="w-[186px] shrink-0">
                  <TrackCard track={track} queue={shelf.tracks} />
                </div>
              ))}
            </HorizontalScroll>
          </div>
        );
      })}
    </section>
  );
});
