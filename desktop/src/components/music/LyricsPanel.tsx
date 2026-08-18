import React, { useEffect, useRef } from 'react';
import { applyAccentVars } from '../../lib/apply-theme';
import { art } from '../../lib/formatters';
import { useLyricsStore } from '../../stores/lyrics';
import { usePlayerStore } from '../../stores/player';
import { useSettingsStore } from '../../stores/settings';
import { darkenRgb, LyricsBackdrop, useArtworkColor } from './lyrics/LyricsBackdrop';
import { LyricsHeader } from './lyrics/LyricsHeader';
import { LyricsPane } from './lyrics/LyricsPane';
import { LyricsVisualizer } from './lyrics/LyricsVisualizer';
import { SplitDivider } from './lyrics/SplitDivider';
import { TimedCommentsRail } from './lyrics/TimedComments';
import { TrackColumn } from './lyrics/TrackColumn';

/* ── Lyrics Panel (fullscreen) ────────────────────────────────
 * Thin shell: immersive backdrop (wallpaper-aware) + floating header (close is
 * pinned top-right, never shifts) + the split track/lyrics/comments composition.
 * All the heavy pieces live in ./lyrics/*. */

export const LyricsPanel = React.memo(() => {
  const open = useLyricsStore((s) => s.open);
  const close = useLyricsStore((s) => s.close);
  const tab = useLyricsStore((s) => s.tab);
  const setTab = useLyricsStore((s) => s.setTab);
  const rightPanelOpen = useLyricsStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useLyricsStore((s) => s.setRightPanelOpen);
  const toggleRightPanel = useLyricsStore((s) => s.toggleRightPanel);
  const splitRatio = useLyricsStore((s) => s.splitRatio);
  const setSplitRatio = useLyricsStore((s) => s.setSplitRatio);
  const track = usePlayerStore((s) => s.currentTrack);
  const { color } = useArtworkColor(track?.artwork_url ?? null);
  const splitLayoutRef = useRef<HTMLDivElement>(null);
  const visualizerEnabled = useSettingsStore((s) => s.lyricsVisualizer);
  const hideTuning = useSettingsStore((s) => s.fullscreenHideTuning);

  useEffect(() => {
    if (!open) return;
    const userAccent = useSettingsStore.getState().accentColor;
    applyAccentVars(darkenRgb(color, 0.72), document.documentElement);
    return () => applyAccentVars(userAccent, document.documentElement);
  }, [open, color]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  if (!open || !track) return null;

  const artwork500 = art(track.artwork_url, 't500x500');
  const splitPercent = splitRatio * 100;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col overflow-hidden animate-fade-in-up bg-[#08080a]">
      <LyricsBackdrop artworkSrc={artwork500} color={color} />
      {visualizerEnabled && <LyricsVisualizer />}

      <LyricsHeader
        tab={tab}
        rightPanelOpen={rightPanelOpen}
        onSelectTab={(next) => {
          setTab(next);
          setRightPanelOpen(true);
        }}
        onTogglePanel={toggleRightPanel}
        onClose={close}
      />

      {rightPanelOpen ? (
        <div
          ref={splitLayoutRef}
          className="relative z-10 grid flex-1 min-h-0 pt-16"
          style={{
            isolation: 'isolate',
            gridTemplateColumns: `${splitPercent}% ${100 - splitPercent}%`,
          }}
        >
          <div className="min-w-0 min-h-0">
            <TrackColumn track={track} hideTuning={hideTuning} />
          </div>

          <SplitDivider
            splitRatio={splitRatio}
            onChange={setSplitRatio}
            layoutRef={splitLayoutRef}
          />

          <div className="min-w-0 min-h-0 flex flex-col relative">
            {tab === 'comments' ? (
              <TimedCommentsRail trackUrn={track.urn} />
            ) : (
              <LyricsPane track={track} />
            )}
          </div>
        </div>
      ) : (
        <div
          className="relative z-10 flex-1 flex items-center justify-center min-h-0 pt-16"
          style={{ isolation: 'isolate' }}
        >
          <TrackColumn track={track} layout="side" hideTuning={hideTuning} />
        </div>
      )}
    </div>
  );
});
