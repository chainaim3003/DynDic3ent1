/**
 * BottomTimeline — three-row temporal view below the stage
 * ---------------------------------------------------------------------------
 * Phase 4a. Sits below TheaterStage. Three horizontal bands:
 *   1) Phase strip — colored segments split by 'phase'-kind events
 *   2) Round chips — horizontally scrollable, one chip per round
 *   3) Event ribbon — one tick per LogEvent + draggable scrubber that
 *      drives playhead.seek()
 *
 * Uses native pointer-capture so scrub drags keep firing even if the
 * cursor leaves the ribbon.
 */

import React, { useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { LogEvent, Phase, Round } from '@/theater/shared/types';
import type { NegotiationStatus } from './useNegotiationRounds';

// Click-vs-drag threshold for ribbon gesture detection. 6px matches Material
// Design's tap-vs-pan heuristic and feels right for mouse + touch.
const CLICK_THRESHOLD_PX = 6;

// Shared helper for both old handleRibbonPointer and the new click-aware
// handlers — convert a pointer event's client X into a clamped event index.
function indexFromPointer(
  e: React.PointerEvent<HTMLDivElement>,
  el: HTMLDivElement | null,
  count: number,
): number | null {
  if (!el || count === 0) return null;
  const rect = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const ratio = rect.width > 0 ? x / rect.width : 0;
  return Math.round(ratio * Math.max(0, count - 1));
}

const PHASE_COLOR: Record<Phase, string> = {
  idle:      '#475569',
  verify:    '#f59e0b',
  request:   '#3b82f6',
  handshake: '#06b6d4',
  negotiate: '#a855f7',
  consult:   '#f97316',
  ipex:      '#D4A017',
  close:     '#10b981',
  escalate:  '#ef4444',
};

const SSE_KIND_COLOR: Record<string, string> = {
  offer:    '#3b82f6',
  counter:  '#f59e0b',
  accept:   '#10b981',
  reject:   '#ef4444',
  po:       '#06b6d4',
  invoice:  '#a855f7',
  dd:       '#eab308',
  escalate: '#f97316',
  info:     '#94a3b8',
};

const LOGKIND_COLOR: Record<LogEvent['kind'], string> = {
  sse:          '#94a3b8',
  'user-cmd':   '#ffffff',
  verify:       '#f59e0b',
  ipex:         '#D4A017',
  'agent-card': '#06b6d4',
  audit:        '#a855f7',
  phase:        '#cbd5e1',
};

function tickColorFor(ev: LogEvent): string {
  if (ev.kind === 'sse') {
    return SSE_KIND_COLOR[ev.payload.kind] ?? LOGKIND_COLOR.sse;
  }
  return LOGKIND_COLOR[ev.kind];
}

interface PhaseSegment {
  phase: Phase;
  startIdx: number;
  endIdx: number;
}

function computePhaseSegments(events: LogEvent[]): PhaseSegment[] {
  if (events.length === 0) return [];
  const segs: PhaseSegment[] = [];
  let currentPhase: Phase = 'idle';
  let segStart = 0;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind !== 'phase') continue;
    if (i > segStart) {
      segs.push({ phase: currentPhase, startIdx: segStart, endIdx: i });
    }
    currentPhase = ev.payload.phase;
    segStart = i;
  }
  segs.push({ phase: currentPhase, startIdx: segStart, endIdx: events.length });
  return segs;
}

interface RoundChipProps {
  round: Round;
  maxGapSoFar?: number;
  onSelectRound?: (round: number) => void;
}

function RoundChip({ round, maxGapSoFar, onSelectRound }: RoundChipProps) {
  const hasBoth = round.buyerOffer !== undefined && round.sellerOffer !== undefined;
  const gap = hasBoth ? Math.abs((round.sellerOffer ?? 0) - (round.buyerOffer ?? 0)) : undefined;
  const gapPct = (gap !== undefined && maxGapSoFar && maxGapSoFar > 0)
    ? Math.max(0.06, gap / maxGapSoFar)
    : (gap === 0 ? 0 : undefined);

  const clickable = !!onSelectRound;

  return (
    <div
      className={cn(
        'shrink-0 rounded-md border border-border bg-background/40 px-2 py-1 flex flex-col gap-0.5 text-[10px] font-mono leading-tight min-w-[88px]',
        clickable && 'cursor-pointer hover:bg-muted/40 transition-colors',
      )}
      onClick={() => { if (onSelectRound) onSelectRound(round.round); }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : -1}
      title={`Round ${round.round}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-foreground">R{round.round}</span>
        {gap !== undefined && (
          <span className={cn(
            'tabular-nums',
            gap === 0 ? 'text-emerald-500' :
            gap < (maxGapSoFar ?? Infinity) / 4 ? 'text-emerald-400' :
            'text-muted-foreground',
          )}>
            Δ{gap}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 tabular-nums">
        <span className={cn(round.buyerOffer !== undefined ? 'text-blue-500' : 'text-muted-foreground/30')}>
          ↑{round.buyerOffer ?? '—'}
        </span>
        <span className={cn(round.sellerOffer !== undefined ? 'text-emerald-500' : 'text-muted-foreground/30')}>
          ↓{round.sellerOffer ?? '—'}
        </span>
      </div>
      {gapPct !== undefined && (
        <div className="h-0.5 w-full bg-muted/30 rounded-full overflow-hidden">
          <div
            className={cn('h-full transition-all', gap === 0 ? 'bg-emerald-500' : 'bg-amber-500')}
            style={{ width: `${Math.min(100, gapPct * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface BottomTimelineProps {
  events: LogEvent[];
  rounds: Round[];
  status: NegotiationStatus;
  finalPrice?: number;
  totalValue?: number;
  phase: Phase;
  playheadIndex: number;
  playheadIsLive: boolean;
  onSeek: (index: number) => void;
  onResumeLive: () => void;
  /** Called when a ribbon tick is CLICKED (not dragged). Drag-only motions
   *  scrub via onSeek but don't trigger selection. */
  onSelectMessage?: (eventId: string) => void;
  /** Called when a round chip is clicked. */
  onSelectRound?: (round: number) => void;
}

export function BottomTimeline({
  events,
  rounds,
  status,
  finalPrice,
  totalValue,
  phase,
  playheadIndex,
  playheadIsLive,
  onSeek,
  onResumeLive,
  onSelectMessage,
  onSelectRound,
}: BottomTimelineProps) {
  const ribbonRef = useRef<HTMLDivElement>(null);
  // Click-vs-drag detection: any pointer movement greater than CLICK_THRESHOLD_PX
  // (squared) from the pointerdown position promotes the gesture to a drag.
  // On pointerup, if we never crossed the threshold, fire onSelectMessage
  // for the event under the cursor in addition to the seek.
  const pointerStartXRef = useRef<number | null>(null);
  const pointerStartIdxRef = useRef<number | null>(null);
  const didDragRef = useRef<boolean>(false);

  const phaseSegments = useMemo(() => computePhaseSegments(events), [events]);
  const maxGapSoFar = useMemo(() => {
    let m = 0;
    for (const r of rounds) {
      if (r.buyerOffer !== undefined && r.sellerOffer !== undefined) {
        m = Math.max(m, Math.abs(r.sellerOffer - r.buyerOffer));
      }
    }
    return m;
  }, [rounds]);

  const totalEvents = events.length;
  const scrubberLeftPct = totalEvents <= 1
    ? 0
    : (playheadIndex / (totalEvents - 1)) * 100;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card/30 p-3 space-y-2">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Timeline</span>
          <span
            className="rounded-full px-2 py-0.5"
            style={{
              backgroundColor: PHASE_COLOR[phase] + '33',
              color: PHASE_COLOR[phase],
            }}
          >
            {phase}
          </span>
          {status !== 'idle' && (
            <span className={cn(
              'rounded px-1.5 py-0.5 text-[9px] tracking-wider',
              status === 'completed'   && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
              status === 'in_progress' && 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
              status === 'escalated'   && 'bg-red-500/15 text-red-600 dark:text-red-400',
              status === 'failed'      && 'bg-red-500/15 text-red-600 dark:text-red-400',
            )}>
              {status}
            </span>
          )}
          {finalPrice !== undefined && (
            <span className="normal-case text-foreground/80">
              final ₹{finalPrice.toLocaleString('en-IN')}/fabric unit
              {totalValue !== undefined && ` · total ₹${totalValue.toLocaleString('en-IN')}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="normal-case">
            {playheadIsLive ? 'live' : `paused @ ${playheadIndex + 1}/${totalEvents}`}
          </span>
          {!playheadIsLive && totalEvents > 0 && (
            <button
              type="button"
              onClick={onResumeLive}
              className="rounded border border-border px-1.5 py-0.5 hover:bg-muted transition-colors normal-case text-foreground/80"
            >
              ▶ Resume live
            </button>
          )}
        </div>
      </div>

      <div className="relative h-6 rounded overflow-hidden border border-border/50 bg-background/40 flex">
        {totalEvents === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/60 italic">
            no events yet
          </div>
        ) : (
          phaseSegments.map((seg, i) => {
            const width = ((seg.endIdx - seg.startIdx) / totalEvents) * 100;
            return (
              <div
                key={i}
                className="flex items-center justify-center text-[9px] font-mono uppercase tracking-wider text-white/90 select-none overflow-hidden whitespace-nowrap"
                style={{
                  width: `${width}%`,
                  backgroundColor: PHASE_COLOR[seg.phase] + 'cc',
                }}
                title={`${seg.phase} (${seg.endIdx - seg.startIdx} events)`}
              >
                {width > 6 ? seg.phase : ''}
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 min-h-[44px]">
        {rounds.length === 0 ? (
          <div className="text-[10px] text-muted-foreground/60 italic px-1">
            rounds appear here once the buyer's first offer is sent
          </div>
        ) : (
          rounds.map(r => (
            <RoundChip
              key={r.round}
              round={r}
              maxGapSoFar={maxGapSoFar}
              onSelectRound={onSelectRound}
            />
          ))
        )}
      </div>

      <div
        ref={ribbonRef}
        className="relative h-7 rounded border border-border/50 bg-background/40 cursor-pointer touch-none select-none"
        onPointerDown={(e) => {
          if (events.length === 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointerStartXRef.current = e.clientX;
          didDragRef.current = false;
          // Seek immediately to the down position; also remember which index
          // we landed on so a pointerup-without-drag can re-emit it for selection.
          const idx = indexFromPointer(e, ribbonRef.current, events.length);
          pointerStartIdxRef.current = idx;
          if (idx !== null) onSeek(idx);
        }}
        onPointerMove={(e) => {
          if (events.length === 0) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          // Promote to drag once movement exceeds threshold.
          if (!didDragRef.current && pointerStartXRef.current !== null) {
            if (Math.abs(e.clientX - pointerStartXRef.current) > CLICK_THRESHOLD_PX) {
              didDragRef.current = true;
            }
          }
          const idx = indexFromPointer(e, ribbonRef.current, events.length);
          if (idx !== null) onSeek(idx);
        }}
        onPointerUp={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          // Click — not a drag. Fire selection for the event at the start index.
          if (!didDragRef.current && pointerStartIdxRef.current !== null && onSelectMessage) {
            const ev = events[pointerStartIdxRef.current];
            if (ev) onSelectMessage(ev.id);
          }
          pointerStartXRef.current = null;
          pointerStartIdxRef.current = null;
          didDragRef.current = false;
        }}
        title="Click a tick to inspect it · drag the dot to scrub"
      >
        {totalEvents > 0 && (
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            preserveAspectRatio="none"
            viewBox={`0 0 ${Math.max(1, totalEvents - 1)} 100`}
          >
            {events.map((ev, i) => {
              const isPhase = ev.kind === 'phase';
              return (
                <line
                  key={ev.id}
                  x1={i}
                  x2={i}
                  y1={isPhase ? 5  : 25}
                  y2={isPhase ? 95 : 75}
                  stroke={tickColorFor(ev)}
                  strokeWidth={isPhase ? 0.6 : 0.4}
                  strokeOpacity={isPhase ? 0.95 : 0.75}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}

        {totalEvents > 0 && (
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 shadow-md transition-colors',
              playheadIsLive
                ? 'bg-emerald-500 border-emerald-300 animate-pulse'
                : 'bg-amber-400 border-amber-200',
            )}
            style={{ left: `${scrubberLeftPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="flex items-center justify-between text-[9px] font-mono text-muted-foreground/70">
        <span>0</span>
        <span className="opacity-60">drag the dot to scrub · click a round chip to jump</span>
        <span>{Math.max(0, totalEvents - 1)}</span>
      </div>
    </div>
  );
}
