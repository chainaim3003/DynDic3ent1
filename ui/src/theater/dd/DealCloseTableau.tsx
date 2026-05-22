/**
 * DealCloseTableau — emerald "DD INVOICE — FINAL" celebration card
 * ---------------------------------------------------------------------------
 * Phase 7 starter. Recreates the deal-completion card from
 * AgentCenter.tsx (ChatBubbleEntry's emerald `bg-emerald-950/50` block)
 * and surfaces it as a centered overlay in Theater the moment a DD-discounted
 * invoice arrives over SSE.
 *
 * Display lifecycle:
 *   1. New DD invoice eventId arrives + event timestamp is < 60s old
 *      (freshness gate; prevents stale re-trigger after page reload).
 *   2. Tableau fades+scales in. Close button is HIDDEN for the first 5
 *      seconds — user has a guaranteed minimum viewing window.
 *   3. After 5s, the × button appears. User clicks → tableau fades out.
 *   4. No auto-dismiss after that. User controls when it closes.
 *
 * If another DD invoice arrives later (new deal), the eventId changes and
 * the lifecycle restarts: 5s lockout, then dismissible.
 *
 * Background backdrop is a dimmed blur (matches DDFocalOverlay style) but
 * does NOT dismiss on backdrop click — only the × button after 5s. This is
 * a celebration moment; we don't want accidental clicks killing it before
 * the user has read it.
 */

import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { DealCloseParsed } from './useDealClose';

// Only show the tableau when the event is fresh (arrived within this window
// of mount time). Older events (e.g., a reload mid-session) shouldn't pop
// up a stale celebration. 60s is generous enough to cover slow SSE delivery
// + the user navigating between tabs.
const FRESH_WINDOW_MS = 60_000;
// Minimum time the card stays visible before the × button appears.
const MIN_VISIBLE_MS = 5_000;

interface DealCloseTableauProps {
  eventId: string | null;
  ts: number;
  parsed: DealCloseParsed | null;
}

export function DealCloseTableau({ eventId, ts, parsed }: DealCloseTableauProps) {
  const reduce = useReducedMotion();

  // Which event is currently being displayed. When a NEW (different,
  // non-stale) eventId arrives, we replace this and restart the timer.
  const [shownEventId, setShownEventId] = useState<string | null>(null);
  // User has explicitly dismissed THIS event's tableau.
  const [dismissed, setDismissed] = useState(false);
  // Close button becomes interactive after MIN_VISIBLE_MS.
  const [canDismiss, setCanDismiss] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    if (eventId === shownEventId) return;
    // Freshness gate — skip stale events surfaced by a re-render after mount.
    if (Date.now() - ts > FRESH_WINDOW_MS) return;

    setShownEventId(eventId);
    setDismissed(false);
    setCanDismiss(false);

    const t = window.setTimeout(() => setCanDismiss(true), MIN_VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [eventId, ts, shownEventId]);

  const show = !!shownEventId && !dismissed && !!parsed;

  return (
    <AnimatePresence>
      {show && parsed && (
        <motion.div
          key="deal-close-tableau-root"
          className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-background/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.05 : 0.22 }}
          role="dialog"
          aria-modal="false"
          aria-label="Deal closed — final DD invoice"
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 16 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1,   y: 0  }}
            exit={   reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8  }}
            transition={{ duration: reduce ? 0.05 : 0.32, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-emerald-950/95 border border-emerald-500/60 rounded-2xl overflow-hidden shadow-2xl shadow-emerald-500/20"
          >
            {/* Header — matches AgentCenter's emerald-400 bold label */}
            <div className="px-4 py-3 border-b border-emerald-500/30 bg-emerald-500/10 flex items-center justify-between">
              <span className="text-emerald-400 text-sm font-bold tracking-wide">
                ✅ DD INVOICE — FINAL
              </span>
              {canDismiss ? (
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="text-emerald-300/70 hover:text-emerald-100 text-lg leading-none px-1.5"
                  aria-label="Dismiss"
                  title="Close"
                >
                  ×
                </button>
              ) : (
                <span className="text-[10px] text-emerald-400/60 font-mono uppercase tracking-wider">
                  deal complete
                </span>
              )}
            </div>

            {/* Body — six fields, same layout as AgentCenter's emerald card */}
            <div className="px-5 py-4 space-y-2 font-mono text-sm text-foreground">
              {parsed.original && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Original</span>
                  <span>₹{parsed.original}</span>
                </div>
              )}
              {parsed.rate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Applied rate</span>
                  <span className="text-emerald-400">{parsed.rate}%</span>
                </div>
              )}
              {parsed.payable && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payable</span>
                  <span className="text-green-400 font-bold text-base">₹{parsed.payable}</span>
                </div>
              )}
              {parsed.save && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">You save</span>
                  <span className="text-emerald-400 font-bold text-base">₹{parsed.save}</span>
                </div>
              )}
              {parsed.settle && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Settle by</span>
                  <span className="text-amber-300">{parsed.settle}</span>
                </div>
              )}
              {parsed.actus && (
                <div className="flex justify-between border-t border-emerald-500/20 pt-2 mt-2">
                  <span className="text-muted-foreground">ACTUS</span>
                  <span className={parsed.actusOk ? 'text-green-400' : 'text-orange-400'}>
                    {parsed.actus}
                  </span>
                </div>
              )}
            </div>

            {/* Footer — status hint, 5s lockout messaging */}
            <div className="px-4 py-2 border-t border-emerald-500/20 bg-emerald-500/5 text-center">
              <p className="text-[10px] text-emerald-400/70">
                {canDismiss
                  ? 'Tap × to close'
                  : 'Holding for 5 seconds…'}
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
