'use client';

import { useEffect, useState } from 'react';

import { formatRemaining, msUntil } from '@/lib/expire';

/**
 * Live "expires in …" countdown for a share. Ticks once per second; renders
 * a static label on the server (no hydration mismatch — the first client
 * render recomputes with the same input).
 */
export function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const target = new Date(expiresAt).getTime();
  const [label, setLabel] = useState(() =>
    formatRemaining(msUntil(new Date(target))),
  );

  useEffect(() => {
    const id = setInterval(() => {
      setLabel(formatRemaining(msUntil(new Date(target))));
    }, 1000);
    return () => clearInterval(id);
  }, [target]);

  return (
    <span className="tabular-nums">
      {label === 'expired' ? 'Expired' : `Expires in ${label}`}
    </span>
  );
}
