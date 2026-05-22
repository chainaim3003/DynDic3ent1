/**
 * HITLPanel — persistent human-in-the-loop decision panel in the left rail
 * ---------------------------------------------------------------------------
 * Phase 6. When useDDOffer reports a pending DD offer, this panel renders
 * a compact summary + Accept/Reject buttons. Unlike DDFocalOverlay, the
 * panel does NOT disappear on dismissal — only on actual resolution (the
 * user accepts/rejects, or a DD invoice arrives over SSE). This is the
 * "I closed the overlay but still need to decide" UX.
 *
 * When no DD is pending, the panel shows a quiet "nothing pending" state
 * to keep the left rail layout consistent across deal lifecycle phases.
 *
 * Action callbacks are passed through to the parent — this component
 * doesn't call sendToBuyerAgent itself. Same separation as DDFocalOverlay.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { ParsedDDOffer } from '@/lib/a2aService';

interface HITLPanelProps {
  pending: boolean;
  offer: ParsedDDOffer | null;
  onAccept: () => void;
  onReject: () => void;
}

export function HITLPanel({ pending, offer, onAccept, onReject }: HITLPanelProps) {
  if (!pending || !offer) {
    return (
      <div className="rounded border border-border/40 bg-background/20 px-2.5 py-2 text-[10px] font-mono">
        <div className="text-muted-foreground uppercase tracking-wider mb-0.5">HITL</div>
        <div className="text-muted-foreground/70 italic normal-case">no decision pending</div>
      </div>
    );
  }

  const saving = offer.discountAtProposedDate.savingAmount;
  const rate = offer.discountAtProposedDate.appliedRate;

  return (
    <div className={cn(
      'rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 space-y-2',
    )}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">
          HITL · decision needed
        </span>
        <span className="text-[9px] font-mono text-amber-700/70 dark:text-amber-300/70">
          {offer.invoiceId}
        </span>
      </div>

      <div className="text-[10px] font-mono text-foreground/80 leading-relaxed">
        Save <span className="text-emerald-600 dark:text-emerald-400 font-bold">
          ₹{saving.toLocaleString('en-IN')}
        </span> @ {(rate * 100).toFixed(2)}% if paid by{' '}
        <span className="text-amber-700 dark:text-amber-300">{offer.proposedSettlementDate}</span>
        {' '}({offer.discountAtProposedDate.daysEarly} days early).
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onAccept}
          className="flex-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-2 py-1.5 transition-colors"
        >
          ✓ Accept
        </button>
        <button
          type="button"
          onClick={onReject}
          className="flex-1 rounded border border-red-500/50 hover:bg-red-500/10 text-red-600 dark:text-red-400 text-[11px] font-semibold px-2 py-1.5 transition-colors"
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
