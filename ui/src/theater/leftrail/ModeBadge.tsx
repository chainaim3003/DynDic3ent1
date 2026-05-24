/**
 * ModeBadge — read-only PLAIN/VLEI pill driven by the buyer agent's env
 * ---------------------------------------------------------------------------
 * Phase 6. Calls fetchIdentityMode('buyer') once on mount. The buyer agent's
 * /api/identity-mode endpoint returns its current CREDENTIAL_MODE ('plain'
 * or 'vlei'). This is purely informational — it tells the user which
 * verification path "verify agent" will take, but doesn't change anything.
 *
 * If the buyer agent isn't running on :9090, fetchIdentityMode returns null
 * silently and we render a neutral "—" badge. No errors, no spinner past
 * the initial null state — matching the way AgentCenter handles this.
 */

import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fetchIdentityMode, type IdentityMode } from '@/lib/a2aService';

export function ModeBadge() {
  const [mode, setMode] = useState<IdentityMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIdentityMode('buyer').then(m => {
      if (!cancelled) setMode(m);
    });
    return () => { cancelled = true; };
  }, []);

  if (!mode) {
    return (
      <div className="rounded border border-border/50 bg-background/30 px-2.5 py-1.5 text-[10px] font-mono">
        <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Identity mode</div>
        <div className="text-foreground/60">— (buyer agent unreachable)</div>
      </div>
    );
  }

  const isVlei = mode.mode === 'vlei';

  return (
    <div
      className={cn(
        'rounded border px-2.5 py-1.5 text-[10px] font-mono',
        isVlei
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
      )}
      title={mode.description}
    >
      <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Identity mode</div>
      <div className="flex items-center gap-2">
        <span className="font-bold">{mode.mode.toUpperCase()}</span>
        <span className="opacity-70 normal-case">CREDENTIAL_MODE={mode.rawValue}</span>
      </div>
    </div>
  );
}
