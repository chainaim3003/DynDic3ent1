/**
 * useBackOfficeConsult — pure derivation of credit/inventory/logistics
 * consult state from the SSE event log
 * ---------------------------------------------------------------------------
 * Phase 9d. Mirror of `useTreasuryConsult` but for the three new sub-agents.
 *
 * For each sub-agent, scans the event log for:
 *   • A "start" marker — `Seller → <Agent>` text (without the reverse arrow)
 *   • An "end" marker — `<Agent> → Seller` text, carrying the verdict
 *
 * Returns one state per agent:
 *   active             — consult is in progress (start seen, end not yet)
 *   outcome            — 'pending' | 'approved' | 'rejected' (latest verdict)
 *   verdict            — short chip text extracted from the end-message body
 *   verdictFlashToken  — increments on each new verdict, drives the chip
 *                        pop animation in BackOfficeConsult.tsx
 *
 * Pure useMemo. No setState, no side effects. Recomputes on every events
 * change — which is fine, the loop is O(events) and events is bounded at
 * EVENT_LOG_MAX = 2000.
 *
 * Caveat: the start/end text patterns proposed here do not exist in the
 * backend's SSE today (verified 2026-05-23 by reading
 * A2A/js/src/agents/{credit,inventory,logistics}-agent/index.ts — they're
 * REST-only). The hook is signal-ready: if and when those broadcasts land,
 * the matching here picks them up unchanged. Until then, the Theater's
 * debug buttons feed synthetic events through this hook for development.
 */

import { useMemo } from 'react';
import type { LogEvent } from '@/theater/shared/types';

export type BackOfficeOutcome = 'pending' | 'approved' | 'rejected';

export interface BackOfficeConsultState {
  active: boolean;
  outcome: BackOfficeOutcome;
  /** Short text for the verdict chip. Empty when no verdict has arrived yet. */
  verdict: string;
  /** Increments on each new verdict (end-marker). Drives the GSAP
   *  pop-and-fade in BackOfficeConsult.tsx. Stays 0 until first verdict. */
  verdictFlashToken: number;
  /** Timestamp of the start marker for the current/last consult. Useful
   *  for the Inspector to show "Started Xs ago" if it ever displays this. */
  startedAt: number | null;
}

export interface UseBackOfficeConsultResult {
  credit:    BackOfficeConsultState;
  inventory: BackOfficeConsultState;
  logistics: BackOfficeConsultState;
}

interface UseBackOfficeConsultArgs {
  events: LogEvent[];
  /** When true, the hook still scans events (snapshot replay) but the
   *  output is treated as the snapshot at the end-of-window. Same paused
   *  semantic as useTreasuryConsult. */
  paused: boolean;
}

const INITIAL: BackOfficeConsultState = {
  active: false,
  outcome: 'pending',
  verdict: '',
  verdictFlashToken: 0,
  startedAt: null,
};

/**
 * Pull verdict text from an end-marker SSE body. Strategy: strip the
 * "Credit → Seller" (or equivalent) prefix and take the first non-empty
 * line of what remains, trimmed and capped at 18 chars. If nothing
 * meaningful is left, return a sensible fallback based on outcome.
 */
function deriveVerdict(
  text: string,
  agentDisplay: string,
  outcome: BackOfficeOutcome,
): string {
  const arrowPattern = new RegExp(`${agentDisplay}\\s*[→\\->]+\\s*Seller`, 'i');
  const body = text.replace(arrowPattern, '').trim();
  // Strip leading emoji + punctuation noise so the verdict line reads cleanly.
  const firstLine = body.split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) ?? '';
  const cleaned = firstLine.replace(/^[\s:·•\-—|]+/, '').trim();
  if (cleaned.length > 0) return cleaned.slice(0, 18);
  if (outcome === 'approved') return 'OK ✓';
  if (outcome === 'rejected') return 'FAIL ✗';
  return '…';
}

/**
 * Classify an end-marker body into approved / rejected / pending.
 * Tolerant regex so demo wording variations all land somewhere sensible.
 */
function classifyOutcome(text: string): BackOfficeOutcome {
  // Approved signals: ✓, APPROVED, OK, AVAILABLE, RESERVED, GOOD, AAA-/AA-/A-rated
  if (/✓|APPROVED|\bOK\b|AVAILABLE|RESERVED|GOOD|\bA{1,3}[+-]?\b/i.test(text)) {
    return 'approved';
  }
  // Rejected signals: ✗, REJECTED, FAIL, OUT OF STOCK, INSUFFICIENT, FLAG, HIGH RISK
  if (/✗|REJECTED|FAIL|OUT OF STOCK|INSUFFICIENT|\bFLAG\b|HIGH RISK|UNAVAILABLE|POOR/i.test(text)) {
    return 'rejected';
  }
  return 'pending';
}

export function useBackOfficeConsult(
  { events, paused }: UseBackOfficeConsultArgs,
): UseBackOfficeConsultResult {
  return useMemo(() => {
    const state: UseBackOfficeConsultResult = {
      credit:    { ...INITIAL },
      inventory: { ...INITIAL },
      logistics: { ...INITIAL },
    };

    // Even when paused (snapshot replay), we still derive the state at
    // the current event-log window. The parent controls the window via
    // viewEnd-equivalent slicing of `events` before passing here.
    void paused;

    for (const ev of events) {
      if (ev.kind !== 'sse') continue;
      const text = ev.payload?.text ?? '';

      // Each agent: check start marker FIRST (sets active:true), then end
      // marker (sets active:false + outcome + verdict + bump token).
      // start-marker check uses negative lookahead in spirit ("seller →
      // credit" but not "credit → seller"); we approximate with two checks.

      // ── Credit ────────────────────────────────────────────────────
      if (/Seller\s*[→\->]+\s*Credit/i.test(text) && !/Credit\s*[→\->]+\s*Seller/i.test(text)) {
        state.credit = {
          ...state.credit,
          active: true,
          outcome: 'pending',
          startedAt: ev.ts,
        };
      } else if (/Credit\s*[→\->]+\s*Seller/i.test(text)) {
        const outcome = classifyOutcome(text);
        state.credit = {
          ...state.credit,
          active: false,
          outcome,
          verdict: deriveVerdict(text, 'Credit', outcome),
          verdictFlashToken: state.credit.verdictFlashToken + 1,
        };
      }

      // ── Inventory ─────────────────────────────────────────────────
      if (/Seller\s*[→\->]+\s*Inventory/i.test(text) && !/Inventory\s*[→\->]+\s*Seller/i.test(text)) {
        state.inventory = {
          ...state.inventory,
          active: true,
          outcome: 'pending',
          startedAt: ev.ts,
        };
      } else if (/Inventory\s*[→\->]+\s*Seller/i.test(text)) {
        const outcome = classifyOutcome(text);
        state.inventory = {
          ...state.inventory,
          active: false,
          outcome,
          verdict: deriveVerdict(text, 'Inventory', outcome),
          verdictFlashToken: state.inventory.verdictFlashToken + 1,
        };
      }

      // ── Logistics ─────────────────────────────────────────────────
      if (/Seller\s*[→\->]+\s*Logistics/i.test(text) && !/Logistics\s*[→\->]+\s*Seller/i.test(text)) {
        state.logistics = {
          ...state.logistics,
          active: true,
          outcome: 'pending',
          startedAt: ev.ts,
        };
      } else if (/Logistics\s*[→\->]+\s*Seller/i.test(text)) {
        const outcome = classifyOutcome(text);
        state.logistics = {
          ...state.logistics,
          active: false,
          outcome,
          verdict: deriveVerdict(text, 'Logistics', outcome),
          verdictFlashToken: state.logistics.verdictFlashToken + 1,
        };
      }
    }

    return state;
  }, [events, paused]);
}
