/**
 * useDealClose — pure derivation for the DD INVOICE — FINAL card
 * ---------------------------------------------------------------------------
 * Phase 7 starter. Detects the SSE event that represents end-of-deal:
 * an invoice-kind message whose text identifies it as the post-DD
 * discounted invoice (the emerald "✅ DD INVOICE — FINAL" card in
 * AgentCenter's ChatBubbleEntry).
 *
 * Same six markers AgentCenter uses to identify a DD invoice (case-sensitive,
 * matched verbatim from src/pages/AgentCenter.tsx ~line 122):
 *   • 'DD Invoice'
 *   • '✅ DD Invoice'
 *   • 'End-to-end'
 *   • 'DD INVOICE'
 *
 * Same six fields AgentCenter parses out of the SSE text:
 *   Original  ← /Original\s*:\s*₹([\d,]+(?:\.\d+)?)/
 *   rate      ← /([\d.]+)%\s*off/             (e.g. "3.75% off")
 *   Payable   ← /Discounted\s*:\s*₹([\d,]+(?:\.\d+)?)/
 *   save      ← /Saving\s*:\s*₹([\d,]+(?:\.\d+)?)/
 *   Settle by ← /Settle by\s*:\s*([\d-]+)/
 *   ACTUS     ← /ACTUS\s*:\s*(.+)/m
 *
 * The hook is a pure useMemo — no side effects. Component layer decides
 * whether and how long to display the card.
 */

import { useMemo } from 'react';
import type { LogEvent } from '@/theater/shared/types';

export interface DealCloseParsed {
  /** "1,250,000" (no ₹ prefix — component renders it). */
  original?: string;
  /** "3.75" (no % suffix — component renders it). */
  rate?: string;
  /** "1,203,125" (no ₹ prefix). */
  payable?: string;
  /** "46,875" (no ₹ prefix). */
  save?: string;
  /** "2025-01-20". */
  settle?: string;
  /** Raw ACTUS line, e.g. "Settlement ✓ SUCCESS". */
  actus?: string;
  /** True if the ACTUS line contains a ✓ — drives green vs orange render. */
  actusOk?: boolean;
}

export interface UseDealCloseResult {
  /** ID of the originating SSE event, or null if no DD invoice in the log. */
  eventId: string | null;
  /** Event timestamp (ms since epoch). Used by the component for the
   *  freshness gate so reloading mid-session doesn't re-trigger the
   *  tableau for a stale event. 0 when eventId is null. */
  ts: number;
  /** Parsed fields, or null when no DD invoice present. */
  parsed: DealCloseParsed | null;
}

const DD_INVOICE_MARKERS = ['DD Invoice', '✅ DD Invoice', 'End-to-end', 'DD INVOICE'];

function isDDInvoiceText(text: string): boolean {
  for (const m of DD_INVOICE_MARKERS) {
    if (text.includes(m)) return true;
  }
  return false;
}

function parseDealCloseFields(text: string): DealCloseParsed {
  const original = text.match(/Original\s*:\s*₹([\d,]+(?:\.\d+)?)/)?.[1];
  const rate     = text.match(/([\d.]+)%\s*off/)?.[1];
  const payable  = text.match(/Discounted\s*:\s*₹([\d,]+(?:\.\d+)?)/)?.[1];
  const save     = text.match(/Saving\s*:\s*₹([\d,]+(?:\.\d+)?)/)?.[1];
  const settle   = text.match(/Settle by\s*:\s*([\d-]+)/)?.[1];
  const actusRaw = text.match(/ACTUS\s*:\s*(.+)/m)?.[1]?.trim();
  return {
    original,
    rate,
    payable,
    save,
    settle,
    actus: actusRaw,
    actusOk: actusRaw ? actusRaw.includes('✓') : undefined,
  };
}

export function useDealClose(events: LogEvent[]): UseDealCloseResult {
  return useMemo<UseDealCloseResult>(() => {
    // Walk backwards — the most recent DD invoice wins. If a new deal
    // produces another DD invoice later, that becomes the active one and
    // the component's eventId-change detection triggers a fresh show.
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind !== 'sse') continue;
      if (ev.payload.kind !== 'invoice') continue;
      if (!isDDInvoiceText(ev.payload.text)) continue;
      return {
        eventId: ev.id,
        ts:      ev.ts,
        parsed:  parseDealCloseFields(ev.payload.text),
      };
    }
    return { eventId: null, ts: 0, parsed: null };
  }, [events]);
}
