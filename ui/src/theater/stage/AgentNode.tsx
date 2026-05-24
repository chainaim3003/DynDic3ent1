/**
 * AgentNode — HTML overlay containing one agent's avatar + label + sub-label
 * ---------------------------------------------------------------------------
 * Positioned absolutely over the SVG stage by the parent (TheaterStage),
 * using viewBox-relative percentages so SVG and HTML stay aligned across
 * any container size.
 *
 * The SVG StateAura and PhaseRing for this same agent render INSIDE the
 * sibling <svg> element using viewBox coordinates. Together they appear
 * as a single composed visual: rings below (SVG), disc above (HTML), label
 * floating below disc (HTML).
 *
 * Phase 2: static labels, click handler stub. Phase 5 will plug in
 * useSelection to drive the Inspector right rail.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { AvatarDisc } from './AvatarDisc';
import { shortLei, type AgentIdentity } from '@/theater/shared/identities';

interface AgentNodeProps {
  identity: AgentIdentity;
  /** Percent-left in container (computed from viewBox x ÷ viewBox width). */
  leftPct: number;
  /** Percent-top in container. */
  topPct: number;
  /** Status badge text (e.g. 'idle', 'active'). */
  statusLabel: string;
  /** Disc size in px. */
  discSize?: number;
  dimmed?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function AgentNode({
  identity,
  leftPct,
  topPct,
  statusLabel,
  discSize = 64,
  dimmed = false,
  selected = false,
  onClick,
}: AgentNodeProps) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      {/* AvatarDisc owns its own pointer-events (it's a button). */}
      <div className="pointer-events-auto">
        <AvatarDisc
          identity={identity}
          size={discSize}
          dimmed={dimmed}
          selected={selected}
          onClick={onClick}
        />
      </div>

      {/* Label cluster — sits below the disc */}
      <div
        className={cn(
          'mt-2 flex flex-col items-center pointer-events-none transition-opacity duration-200',
          dimmed && 'opacity-40',
        )}
      >
        <div className="text-xs font-semibold text-foreground leading-tight">
          {identity.shortName}
        </div>
        <div className="text-[10px] font-mono text-muted-foreground leading-tight">
          {shortLei(identity.lei)}
        </div>
        <div className="mt-0.5">
          <span
            className={cn(
              'inline-block text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium',
              statusLabel === 'active'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                : statusLabel === 'paused'
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
