import type { ReactNode } from 'react';
import { Star } from '../../lib/icons';

/** Shared settings primitives — one consistent visual language across every card. */

export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative w-[42px] h-[26px] rounded-full transition-all duration-200 shrink-0 ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-accent' : 'bg-white/[0.16]'}`}
    >
      <span
        className={`absolute top-0.5 w-[22px] h-[22px] rounded-full shadow-md transition-all duration-200 ${
          checked ? 'left-[18px] bg-white' : 'left-0.5 bg-white'
        }`}
      />
    </button>
  );
}

export function Row({
  title,
  desc,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[13.5px] text-white/90 font-medium flex items-center gap-2">
          {title}
        </div>
        {desc && <p className="text-[12px] text-white/45 mt-0.5 leading-snug">{desc}</p>}
      </div>
      {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Divider() {
  return <div className="border-t border-white/[0.07]" />;
}

export function Card({
  title,
  desc,
  icon,
  action,
  children,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="liquid-group relative p-5">
      <div className="relative flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="w-7 h-7 flex items-center justify-center shrink-0 text-[var(--color-accent)]">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-white tracking-tight">{title}</h3>
            {desc && <p className="text-[12px] text-white/45 mt-0.5 leading-snug">{desc}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div
      className="grid gap-1 p-[3px] rounded-full bg-white/[0.07]"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-all duration-200 cursor-pointer ${
              active ? 'text-white bg-white/[0.18] shadow-sm' : 'text-white/55 hover:text-white/80'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function RangeSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-[var(--color-accent)] h-1 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg"
    />
  );
}

/** "Star" (premium) lock badge — shown next to gated controls. */
export function PremiumBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-purple-300/80"
      style={{
        background: 'linear-gradient(135deg, rgba(139,92,246,0.2), rgba(168,85,247,0.12))',
        border: '0.5px solid rgba(168,85,247,0.25)',
      }}
    >
      <Star size={10} fill="currentColor" className="text-amber-400" />
      Star
    </span>
  );
}

/** Disabled toggle silhouette — used when a control is premium-locked. */
export function LockedToggle() {
  return (
    <div className="w-11 h-6 rounded-full bg-white/10 relative opacity-40 cursor-not-allowed">
      <div className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-md bg-white" />
    </div>
  );
}
