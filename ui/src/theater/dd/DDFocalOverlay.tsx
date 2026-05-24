/**
 * DDFocalOverlay — dramatic full-viewport overlay for a pending DD offer
 * ---------------------------------------------------------------------------
 * Phase 6. When a Dynamic Discount offer arrives mid-deal, the user has a
 * human-in-the-loop decision to make: accept (early payment, take the
 * discount) or reject (pay full amount on due date). The overlay is the
 * dramatic surfacing of that moment — fixed-positioned, centered,
 * glassmorphic backdrop dimming the whole stage.
 *
 * The overlay is dismissible without resolving the offer; the persistent
 * HITLPanel in the left rail keeps the same Accept/Reject buttons available
 * after dismissal, so users can review the timeline before deciding.
 *
 * Action buttons (Accept / Reject) dispatch upward via callbacks — the
 * parent (AgentTheater) calls sendToBuyerAgent('dd accept' | 'dd reject').
 * No fetch logic lives here.
 *
 * Animation uses motion/react with useReducedMotion guard. Scale+fade in
 * on appearance, fade out on dismissal or resolution.
 */

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ParsedDDOffer } from '@/lib/a2aService';

interface DDFocalOverlayProps {
  show: boolean;
  offer: ParsedDDOffer | null;
  onAccept: () => void;
  onReject: () => void;
  onDismiss: () => void;
}

export function DDFocalOverlay({ show, offer, onAccept, onReject, onDismiss }: DDFocalOverlayProps) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {show && offer && (
        <motion.div
          key="dd-overlay-root"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.05 : 0.18 }}
          onClick={onDismiss}
          role="dialog"
          aria-modal="true"
          aria-label="Dynamic Discount Offer"
        >
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: 12 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1,    y: 0 }}
            exit={   reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: reduce ? 0.05 : 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-amber-500/50 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-3 border-b border-amber-500/30 bg-amber-500/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">💰</span>
                <div>
                  <div className="text-sm font-bold text-amber-600 dark:text-amber-300">Dynamic Discount Offer</div>
                  <div className="text-[10px] font-mono text-amber-700/70 dark:text-amber-300/70">{offer.invoiceId}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
                aria-label="Dismiss overlay"
                title="Decide later (offer stays open in the left rail)"
              >
                ×
              </button>
            </div>

            {/* Body — offer details */}
            <div className="p-5 space-y-3 text-sm">
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-xs">
                <span className="text-muted-foreground">Invoice date</span>
                <span className="text-right text-foreground/85">{offer.invoiceDate || '—'}</span>

                <span className="text-muted-foreground">Due date</span>
                <span className="text-right text-foreground/85">{offer.dueDate || '—'}</span>

                <span className="text-muted-foreground">Original total</span>
                <span className="text-right text-foreground font-semibold">₹{offer.originalTotal.toLocaleString('en-IN')}</span>

                <span className="text-muted-foreground">Max DD rate</span>
                <span className="text-right text-amber-600 dark:text-amber-300 font-semibold">{(offer.maxDiscountRate * 100).toFixed(2)}%</span>
              </div>

              <div className="border-t border-border/40 pt-3 space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">If you accept the proposed terms</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-xs">
                  <span className="text-muted-foreground">Pay by</span>
                  <span className="text-right text-amber-600 dark:text-amber-300">
                    {offer.proposedSettlementDate} ({offer.discountAtProposedDate.daysEarly} days early)
                  </span>

                  <span className="text-muted-foreground">Applied rate</span>
                  <span className="text-right text-foreground/85">{(offer.discountAtProposedDate.appliedRate * 100).toFixed(2)}%</span>

                  <span className="text-muted-foreground">Discounted to</span>
                  <span className="text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    ₹{offer.discountAtProposedDate.discountedAmount.toLocaleString('en-IN')}
                  </span>

                  <span className="text-muted-foreground">You save</span>
                  <span className="text-right text-emerald-600 dark:text-emerald-400 font-bold">
                    ₹{offer.discountAtProposedDate.savingAmount.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            </div>

            {/* Action footer */}
            <div className="px-5 py-3 border-t border-border/40 bg-background/40 flex items-center gap-2">
              <button
                type="button"
                onClick={onAccept}
                className="flex-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-3 py-2 transition-colors"
              >
                ✓ Accept DD
              </button>
              <button
                type="button"
                onClick={onReject}
                className="flex-1 rounded-md border border-red-500/50 hover:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-semibold px-3 py-2 transition-colors"
              >
                ✗ Reject DD
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-md border border-border hover:bg-muted text-[11px] text-muted-foreground px-2.5 py-2 transition-colors"
                title="Close the overlay; decide via the left-rail panel later."
              >
                later
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
