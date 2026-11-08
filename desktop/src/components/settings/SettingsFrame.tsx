import { memo, type ReactNode } from 'react';
import type { Aura } from '../../lib/aura';

/** Flat pure-black frame for Settings (Apple Music style). */
export const SettingsFrame = memo(function SettingsFrame({
  children,
}: {
  aura?: Aura;
  children: ReactNode;
}) {
  return <div className="relative min-h-full w-full">{children}</div>;
});
