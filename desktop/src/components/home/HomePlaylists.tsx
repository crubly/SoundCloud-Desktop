import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { art } from '../../lib/formatters';
import { useHomeDiscovery } from '../../lib/home-discovery';
import { MicVocal, Music, Play, Shuffle, Sparkles } from '../../lib/icons';
import { shuffleArray, usePlayerStore } from '../../stores/player';
import { TrackCard } from '../music/TrackCard';
import { GlassButton } from '../ui/GlassButton';
import { HorizontalScroll } from '../ui/HorizontalScroll';

/** Собственные «подборки недели» на главной: собраны локально из лайков —
 *  любимые жанры и артисты через живой SC-поиск. Блок идёт поверх «Течения». */
export const HomePlaylists = memo(function HomePlaylists() {
  const { t } = useTranslation();
  const play = usePlayerStore((s) => s.play);
  const { likedCount, likedLoading, shelves, week } = useHomeDiscovery();

  const heroArts = useMemo(() => {
    const arts: (string | null)[] = [];
    for (const track of week) {
      if (arts.length >= 4) break;
      arts.push(art(track.artwork_url, 't400x400'));
    }
    while (arts.length < 4) arts.push(null);
    return arts;
  }, [week]);

  const playWeek = (shuffle: boolean) => {
    if (week.length === 0) return;
    if (shuffle) {
      const queue = [...week];
      shuffleArray(queue);
      play(queue[0], queue);
    } else {
      play(week[0], week);
    }
  };

  if (likedLoading) {
    return (
      <section aria-hidden className="space-y-4 animate-pulse">
        <div className="h-44 rounded-3xl bg-white/[0.04]" />
        <div className="flex gap-3">
          <div className="h-28 w-28 rounded-2xl bg-white/[0.04]" />
          <div className="h-28 w-28 rounded-2xl bg-white/[0.04]" />
          <div className="h-28 w-28 rounded-2xl bg-white/[0.04]" />
          <div className="h-28 w-28 rounded-2xl bg-white/[0.04]" />
        </div>
      </section>
    );
  }

  if (likedCount === 0) {
    return (
      <section className="relative overflow-hidden rounded-3xl ring-1 ring-white/[0.06] bg-white/[0.02] px-5 py-6">
        <div
          aria-hidden
          className="absolute -right-20 -top-24 h-64 w-64 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, var(--color-accent-glow), transparent 70%)',
          }}
        />
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.04] text-white/60 ring-1 ring-white/[0.06]">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold tracking-tight text-white/90">
              {t('home.startLikingTitle')}
            </h3>
            <p className="mt-0.5 text-[12px] leading-snug text-white/45">
              {t('home.startLikingDesc')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      {/* Открытия недели */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-white/[0.08]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, var(--color-accent) 0%, rgba(28,26,34,0.92) 58%, rgba(20,20,24,0.96) 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -right-20 -top-28 h-80 w-80 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, var(--color-accent-glow), transparent 70%)',
          }}
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.08), transparent 70%)',
          }}
        />

        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-6 md:p-7">
          <div className="grid h-28 w-28 shrink-0 grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-2xl ring-1 ring-white/10 md:h-36 md:w-36">
            {heroArts.map((src, i) =>
              src ? (
                <img
                  key={i}
                  src={src}
                  alt=""
                  draggable={false}
                  decoding="async"
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div
                  key={i}
                  className="flex h-full w-full items-center justify-center bg-white/[0.05] text-white/40"
                >
                  <Music size={16} />
                </div>
              ),
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/65">
              <Sparkles size={13} />
              {t('home.discovery.badge')}
            </div>
            <h2 className="mt-1.5 text-[22px] font-extrabold leading-none tracking-tight text-white md:text-[28px]">
              {t('home.discovery.title')}
            </h2>
            <p className="mt-2 max-w-md text-[13px] leading-snug text-white/65">
              {t('home.discovery.subtitle')}
            </p>
            <p className="mt-1 text-[12px] font-medium text-white/45">
              {t('home.discovery.tracksCount', { count: week.length })}
            </p>
            <div className="mt-4 flex items-center gap-2.5">
              <GlassButton
                variant="primary"
                disabled={week.length === 0}
                onClick={() => playWeek(false)}
              >
                <Play size={15} fill="currentColor" className="ml-0.5" />
                {t('home.discovery.play')}
              </GlassButton>
              <GlassButton disabled={week.length === 0} onClick={() => playWeek(true)}>
                <Shuffle size={14} />
                {t('home.discovery.shuffle')}
              </GlassButton>
            </div>
          </div>
        </div>
      </div>

      {/* Полки по жанрам и артистам */}
      {shelves.map((shelf) => {
        if (shelf.tracks.length === 0) return null;
        const isArtist = shelf.seed.kind === 'artist';
        const name = shelf.seed.name.charAt(0).toUpperCase() + shelf.seed.name.slice(1);
        return (
          <div key={shelf.seed.key}>
            <div className="mb-3 flex items-center gap-2.5 px-1">
              <span className="text-white/55">
                {isArtist ? <MicVocal size={16} /> : <Sparkles size={16} />}
              </span>
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold leading-none tracking-tight text-white/90">
                  {t(isArtist ? 'home.discovery.shelfArtist' : 'home.discovery.shelfGenre', {
                    name,
                  })}
                </h3>
                <p className="mt-1 text-[11px] text-white/40">{t('home.discovery.shelfDesc')}</p>
              </div>
            </div>
            <HorizontalScroll>
              {shelf.tracks.map((track) => (
                <div key={track.urn} className="w-[150px] shrink-0">
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
