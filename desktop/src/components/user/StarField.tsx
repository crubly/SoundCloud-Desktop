import React from 'react';
import type { Aura } from '../../lib/aura';

export type StarSeed = {
  i: number;
  size: number;
  left: number;
  top: number;
  rot: number;
  hueShift: number;
  delay: number;
  duration: number;
  min: number;
  max: number;
};

export const HERO_STAR_SEEDS: StarSeed[] = [];
export const PAGE_STAR_SEEDS: StarSeed[] = [];

interface StarFieldProps {
  aura: Aura;
  seeds: StarSeed[];
  intensity?: number;
  /** Per-star glow (drop-shadow/box-shadow). Off for cheaper pages. Default on. */
  glow?: boolean;
}

function StarFieldImpl(_props: StarFieldProps) {
  return null;
}

export const StarField = React.memo(StarFieldImpl);
