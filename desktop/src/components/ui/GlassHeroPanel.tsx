import type React from 'react';
import { memo } from 'react';
import { type Aura, auraRgba } from '../../lib/aura';
import { usePerfMode } from '../../lib/perf';
import { HERO_STAR_SEEDS, StarField } from '../user/StarField';

interface GlassHeroPanelProps {
  hasStar: boolean;
  aura: Aura;
  className?: string;
  children: React.ReactNode;
}

function GlassHeroPanelImpl({ hasStar, aura, className, children }: GlassHeroPanelProps) {
  const perf = usePerfMode();
  const b = perf.blur(40);
  const filter = b > 0 ? `blur(${b}px) saturate(160%)` : undefined;
  return (
    <div
      className={`relative rounded-[24px] ${className ?? ''}`}
      style={{
        background:
          b > 0
            ? 'linear-gradient(180deg, rgba(255,255,255,0.065) 0%, rgba(255,255,255,0.02) 48%, rgba(255,255,255,0.035) 100%), rgba(12,12,15,0.68)'
            : 'rgba(14,14,18,0.92)',
        backdropFilter: filter,
        WebkitBackdropFilter: filter,
        boxShadow: hasStar
          ? `0 24px 64px rgba(0,0,0,0.75), inset 0 1px 0.5px rgba(255,255,255,0.22), inset 0 0 0 1px ${auraRgba(aura, 0.25)}`
          : '0 24px 64px rgba(0,0,0,0.72), inset 0 1px 0.5px rgba(255,255,255,0.18), inset 0 0 0 1px rgba(255,255,255,0.09)',
        animation: 'hub-rise 600ms cubic-bezier(0.2,0.8,0.2,1) both',
        isolation: 'isolate',
      }}
    >
      {hasStar && (
        <div className="absolute inset-0 rounded-[2.5rem] overflow-hidden pointer-events-none">
          <StarField aura={aura} seeds={HERO_STAR_SEEDS} intensity={1} />
        </div>
      )}

      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
        }}
      />

      {children}
    </div>
  );
}

export const GlassHeroPanel = memo(GlassHeroPanelImpl);
