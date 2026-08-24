import { useEffect, useState } from 'react';
import { trackedInvoke as invoke } from './diagnostics';

let supportedPromise: Promise<boolean> | null = null;

/** Whether this Mac has a physical Touch Bar (cached — one native call). */
export function isTouchBarSupported(): Promise<boolean> {
  if (!supportedPromise) {
    supportedPromise = invoke<boolean>('touchbar_supported')
      .then((v) => !!v)
      .catch(() => false);
  }
  return supportedPromise;
}

/** React hook mirroring `isTouchBarSupported` — false until the native check resolves. */
export function useTouchBarSupported(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    void isTouchBarSupported().then((v) => {
      if (alive) setSupported(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return supported;
}
