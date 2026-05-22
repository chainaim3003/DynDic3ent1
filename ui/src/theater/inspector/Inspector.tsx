/**
 * Inspector — right-rail context panel
 * ---------------------------------------------------------------------------
 * Phase 5. Sticky right column on ≥1280px (xl breakpoint); stacks below on
 * smaller screens (Phase 8 polishes the responsive collapse).
 *
 * Four variants, switched by Selection.kind, animated via motion/react
 * AnimatePresence with mode="wait" so transitions don't stack:
 *
 *   none     → helpful tip with example actions
 *   agent    → identity card (LEI, AID, role), live vLEI badge, recent msgs
 *   message  → full SSE text + parsed fields + Prev/Next walker
 *   round    → round number, buyer/seller offers, gap, jump-to-event buttons
 *
 * useReducedMotion() collapses transitions to a 50ms fade with no y shift
 * for users who've requested reduced motion in their OS settings.
 *
 * No special data fetching — all data is passed in by AgentTheater. The
 * Inspector is a pure projection of (selection, events, rounds, vlei) and
 * dispatches actions via the provided callbacks (onSeek, onSelectMessage,
 * onClose).
 */

import React, { useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import type { AgentId, LogEvent, Round, Selection } from '@/theater/shared/types';
import { IDENTITIES } from '@/theater/shared/identities';
import { parseNegotiationUpdate } from '@/lib/a2aService';
import type { VleiStatus } from '@/hooks/useVleiStatus';

interface InspectorProps {
  selection: Selection;
  events: LogEvent[];
  rounds: Round[];
  vlei: VleiStatus;
  /** Jump playhead to event index. */
  onSeek: (index: number) => void;
  /** Change selection to a specific message. */
  onSelectMessage: (eventId: string) => void;
  /** Dismiss to selection {kind:'none'}. */
  onClose: () => void;
}

// Animation tokens — kept consistent across variants so the Inspector feels
// like one component swapping content, not four unrelated panels.
const MOTION_VARIANTS = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -8 },
};
const REDUCED_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
};

export function Inspector({
  selection,
  events,
  rounds,
  vlei,
  onSeek,
  onSelectMessage,
  onClose,
}: InspectorProps) {
  const reduce = useReducedMotion();
  const variants = reduce ? REDUCED_VARIANTS : MOTION_VARIANTS;
  const duration = reduce ? 0.05 : 0.18;

  // Stable key per variant so AnimatePresence treats each as distinct content.
  const key =
    selection.kind === 'none'    ? 'none' :
    selection.kind === 'agent'   ? `agent:${selection.agentId}` :
    selection.kind === 'message' ? `message:${selection.eventId}` :
    /* round */                    `round:${selection.round}`;

  return (
    <aside
      className="rounded-lg border border-border bg-card/30 backdrop-blur-sm overflow-hidden xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
      aria-label="Inspector"
    >
      {/* Header strip — shows current selection kind + close button */}
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>Inspector · {selection.kind}</span>
        {selection.kind !== 'none' && (
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 py-0.5 hover:bg-muted transition-colors normal-case"
            aria-label="Clear selection"
          >
            ×
          </button>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration, ease: 'easeOut' }}
          className="p-3"
        >
          {selection.kind === 'none'    && <EmptyVariant />}
          {selection.kind === 'agent'   && (
            <AgentVariant
              agentId={selection.agentId}
              events={events}
              vlei={vlei}
              onSeek={onSeek}
              onSelectMessage={onSelectMessage}
            />
          )}
          {selection.kind === 'message' && (
            <MessageVariant
              eventId={selection.eventId}
              events={events}
              onSeek={onSeek}
              onSelectMessage={onSelectMessage}
            />
          )}
          {selection.kind === 'round'   && (
            <RoundVariant
              round={selection.round}
              rounds={rounds}
              events={events}
              onSeek={onSeek}
              onSelectMessage={onSelectMessage}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}

// ─── Variant: Empty ───────────────────────────────────────────────────────
function EmptyVariant() {
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">No selection</p>
      <p>Click anything to inspect it:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>An <span className="text-foreground">agent disc</span> on the stage → identity + recent traffic</li>
        <li>A <span className="text-foreground">round chip</span> below → offer details + jump links</li>
        <li>A <span className="text-foreground">tick on the ribbon</span> → full event payload</li>
      </ul>
      <p className="pt-1 text-[10px] italic">Round chip click also moves the scrubber.</p>
    </div>
  );
}

// ─── Variant: Agent ───────────────────────────────────────────────────────
interface AgentVariantProps {
  agentId: AgentId;
  events: LogEvent[];
  vlei: VleiStatus;
  onSeek: (idx: number) => void;
  onSelectMessage: (eventId: string) => void;
}

function AgentVariant({ agentId, events, vlei, onSeek, onSelectMessage }: AgentVariantProps) {
  const identity = IDENTITIES[agentId as keyof typeof IDENTITIES];
  const recentMessages = useMemo(() => {
    if (!identity) return [];
    // Map agent → SSE 'from' label. vleiVerifier doesn't appear in SSE,
    // so we surface its verify events instead.
    const fromFilter =
      agentId === 'buyer'    ? 'BUYER' :
      agentId === 'seller'   ? 'SELLER' :
      agentId === 'treasury' || agentId === 'sellerTreasury' ? 'TREASURY' :
      null;

    const matches: Array<{ ev: LogEvent; idx: number }> = [];
    for (let i = events.length - 1; i >= 0 && matches.length < 5; i--) {
      const ev = events[i];
      if (agentId === 'vleiVerifier' && ev.kind === 'verify') {
        matches.push({ ev, idx: i });
        continue;
      }
      if (fromFilter && ev.kind === 'sse' && ev.payload.from === fromFilter) {
        matches.push({ ev, idx: i });
      }
    }
    return matches.reverse();
  }, [agentId, events, identity]);

  if (!identity) {
    return <p className="text-xs text-muted-foreground">No identity data for {String(agentId)}.</p>;
  }

  const isVleiSubject = agentId !== 'vleiVerifier';

  return (
    <div className="space-y-3">
      {/* Identity card */}
      <div className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Identity</div>
        <div className="text-sm font-semibold text-foreground">{identity.legalName}</div>
        <div className="text-[11px] text-muted-foreground">{identity.role ?? '—'}</div>
      </div>

      {/* LEI + AID */}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] font-mono">
        <span className="text-muted-foreground">LEI</span>
        <span className="text-foreground/80 break-all">{identity.lei === '—' ? '—' : identity.lei}</span>
        {identity.agentAID && (
          <>
            <span className="text-muted-foreground">AID</span>
            <span className="text-foreground/80 break-all" title={identity.agentAID}>
              {identity.agentAID.slice(0, 12)}…{identity.agentAID.slice(-6)}
            </span>
          </>
        )}
      </div>

      {/* Live vLEI status — only meaningful for buyer/seller/treasury */}
      {isVleiSubject && (
        <div
          className={cn(
            'rounded border px-2 py-1.5 text-[10px] font-mono flex items-center gap-2',
            vlei.reachable
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
          )}
        >
          <span
            className={cn(
              'inline-block w-1.5 h-1.5 rounded-full',
              vlei.reachable ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500',
            )}
          />
          <span className="font-bold">vLEI api</span>
          <span className="opacity-80">
            {vlei.reachable ? `${vlei.verifiedCount}/3 verified` : 'unreachable (plain mode or :4000 down)'}
          </span>
        </div>
      )}

      {/* Recent messages list */}
      <div className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Recent {agentId === 'vleiVerifier' ? 'verify events' : 'messages'}
        </div>
        {recentMessages.length === 0 ? (
          <div className="text-[10px] text-muted-foreground/60 italic">
            None yet on this channel.
          </div>
        ) : (
          <ul className="space-y-1">
            {recentMessages.map(({ ev, idx }) => {
              const preview =
                ev.kind === 'sse'
                  ? ev.payload.text.replace(/\s+/g, ' ').slice(0, 70)
                  : ev.kind === 'verify'
                  ? `${ev.payload.label} (${ev.payload.status})`
                  : JSON.stringify(ev.payload).slice(0, 70);
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => { onSeek(idx); onSelectMessage(ev.id); }}
                    className="w-full text-left rounded border border-border/40 hover:border-border bg-background/40 hover:bg-muted/40 px-2 py-1 transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[9px] font-mono text-muted-foreground">
                      <span>{new Date(ev.ts).toLocaleTimeString()}</span>
                      <span className="rounded bg-muted px-1">{ev.kind}</span>
                    </div>
                    <div className="text-[11px] text-foreground/85 truncate font-mono">{preview}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Variant: Message ─────────────────────────────────────────────────────
interface MessageVariantProps {
  eventId: string;
  events: LogEvent[];
  onSeek: (idx: number) => void;
  onSelectMessage: (eventId: string) => void;
}

function MessageVariant({ eventId, events, onSeek, onSelectMessage }: MessageVariantProps) {
  const { ev, idx } = useMemo(() => {
    const i = events.findIndex(e => e.id === eventId);
    return { ev: i >= 0 ? events[i] : undefined, idx: i };
  }, [events, eventId]);

  if (!ev || idx < 0) {
    return <p className="text-xs text-muted-foreground">Event no longer in the log buffer.</p>;
  }

  const goPrev = () => {
    if (idx > 0) {
      const prev = events[idx - 1];
      onSeek(idx - 1);
      onSelectMessage(prev.id);
    }
  };
  const goNext = () => {
    if (idx < events.length - 1) {
      const next = events[idx + 1];
      onSeek(idx + 1);
      onSelectMessage(next.id);
    }
  };

  const parsed = ev.kind === 'sse' ? parseNegotiationUpdate(ev.payload.text) : null;

  return (
    <div className="space-y-3">
      {/* Header — index, kind, channel, timestamp */}
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="text-muted-foreground">#{idx + 1} / {events.length}</span>
        <div className="flex items-center gap-1">
          <span className="rounded bg-muted px-1.5 py-0.5">{ev.kind}</span>
          {ev.kind === 'sse' && (
            <>
              <span className="rounded bg-muted px-1.5 py-0.5">{ev.payload.channel}</span>
              <span className="rounded bg-muted px-1.5 py-0.5">{ev.payload.kind}</span>
            </>
          )}
        </div>
      </div>

      <div className="text-[9px] font-mono text-muted-foreground">
        {new Date(ev.ts).toLocaleString()}
      </div>

      {/* Payload — SSE text gets a pre block; structured payloads get JSON */}
      <div className="rounded border border-border/50 bg-background/40 p-2 max-h-64 overflow-y-auto">
        {ev.kind === 'sse' ? (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/85 leading-relaxed">
            {ev.payload.text}
          </pre>
        ) : (
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-words text-foreground/85">
            {JSON.stringify(ev.payload, null, 2)}
          </pre>
        )}
      </div>

      {/* Parsed fields — only for SSE events that parseNegotiationUpdate recognises */}
      {parsed && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Parsed fields
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10px] font-mono">
            {parsed.status      && <><span className="text-muted-foreground">status</span><span className="text-foreground/80">{parsed.status}</span></>}
            {parsed.round       !== undefined && <><span className="text-muted-foreground">round</span><span className="text-foreground/80">{parsed.round}</span></>}
            {parsed.buyerOffer  !== undefined && <><span className="text-muted-foreground">buyer offer</span><span className="text-blue-500">₹{parsed.buyerOffer.toLocaleString('en-IN')}</span></>}
            {parsed.sellerOffer !== undefined && <><span className="text-muted-foreground">seller offer</span><span className="text-emerald-500">₹{parsed.sellerOffer.toLocaleString('en-IN')}</span></>}
            {parsed.finalPrice  !== undefined && <><span className="text-muted-foreground">final price</span><span className="text-emerald-500 font-bold">₹{parsed.finalPrice.toLocaleString('en-IN')}</span></>}
            {parsed.totalValue  !== undefined && <><span className="text-muted-foreground">total value</span><span className="text-foreground/80">₹{parsed.totalValue.toLocaleString('en-IN')}</span></>}
          </div>
        </div>
      )}

      {/* Prev/Next walker */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={goPrev}
          disabled={idx <= 0}
          className="rounded border border-border px-2 py-1 text-[10px] font-mono hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-[9px] font-mono text-muted-foreground/60">id {ev.id.slice(0, 14)}…</span>
        <button
          type="button"
          onClick={goNext}
          disabled={idx >= events.length - 1}
          className="rounded border border-border px-2 py-1 text-[10px] font-mono hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── Variant: Round ───────────────────────────────────────────────────────
interface RoundVariantProps {
  round: number;
  rounds: Round[];
  events: LogEvent[];
  onSeek: (idx: number) => void;
  onSelectMessage: (eventId: string) => void;
}

function RoundVariant({ round, rounds, events, onSeek, onSelectMessage }: RoundVariantProps) {
  const r = rounds.find(x => x.round === round);
  if (!r) {
    return (
      <div className="space-y-2 text-xs">
        <p className="font-medium text-foreground">Round {round}</p>
        <p className="text-muted-foreground">Not in current view. Scrub forward to see this round.</p>
      </div>
    );
  }

  const gap = (r.buyerOffer !== undefined && r.sellerOffer !== undefined)
    ? Math.abs(r.sellerOffer - r.buyerOffer)
    : undefined;

  const jumpTo = (eventId: string | undefined) => {
    if (!eventId) return;
    const idx = events.findIndex(e => e.id === eventId);
    if (idx >= 0) {
      onSeek(idx);
      onSelectMessage(eventId);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold text-foreground">Round {r.round}</span>
        {gap !== undefined && (
          <span className={cn(
            'text-xs font-mono tabular-nums',
            gap === 0 ? 'text-emerald-500 font-bold' : 'text-muted-foreground',
          )}>
            gap Δ{gap}
          </span>
        )}
      </div>

      {/* Buyer offer block */}
      <div className="rounded border border-blue-500/30 bg-blue-500/10 p-2 space-y-1">
        <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-wider">
          <span className="text-blue-600 dark:text-blue-400">Buyer ↑</span>
          {r.buyerOffer !== undefined && (
            <span className="text-blue-600 dark:text-blue-400 font-bold tabular-nums normal-case">
              ₹{r.buyerOffer.toLocaleString('en-IN')}
            </span>
          )}
        </div>
        {r.buyerEventId ? (
          <button
            type="button"
            onClick={() => jumpTo(r.buyerEventId)}
            className="w-full text-left text-[10px] font-mono text-blue-600/80 dark:text-blue-300/80 hover:text-blue-700 dark:hover:text-blue-200 transition-colors"
          >
            → jump to buyer offer event
          </button>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground/60 italic">no buyer offer yet</div>
        )}
      </div>

      {/* Seller offer block */}
      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 space-y-1">
        <div className="flex items-baseline justify-between text-[10px] font-mono uppercase tracking-wider">
          <span className="text-emerald-600 dark:text-emerald-400">Seller ↓</span>
          {r.sellerOffer !== undefined && (
            <span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums normal-case">
              ₹{r.sellerOffer.toLocaleString('en-IN')}
            </span>
          )}
        </div>
        {r.sellerEventId ? (
          <button
            type="button"
            onClick={() => jumpTo(r.sellerEventId)}
            className="w-full text-left text-[10px] font-mono text-emerald-600/80 dark:text-emerald-300/80 hover:text-emerald-700 dark:hover:text-emerald-200 transition-colors"
          >
            → jump to seller offer event
          </button>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground/60 italic">no seller offer yet</div>
        )}
      </div>

      {/* Outcome chip */}
      {r.outcome && (
        <div className="text-[10px] font-mono text-muted-foreground">
          status: <span className="text-foreground">{r.outcome}</span>
        </div>
      )}
    </div>
  );
}
