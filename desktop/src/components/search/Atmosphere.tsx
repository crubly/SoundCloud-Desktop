import { memo } from 'react';

interface AtmosphereProps {
  /** 1-3 hues pulled from the vibe of what's on the wall. Falls back to accent. */
  tint?: string[];
  /** 0 (calm/cold) .. 1 (hot/fast) — scales orb drift speed. */
  energy?: number;
}

/* Three blurred orbs, mix-blend-screen, GPU-isolated so the breathing wall in
 * front never recomputes their blur. The color says what's on the wall; the
 * drift speed says its energy. Not decoration — meaning. */
export const Atmosphere = memo(function Atmosphere(_props: AtmosphereProps) {
  return null;
});
