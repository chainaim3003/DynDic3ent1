/**
 * Agent Theater — shared constants
 * ---------------------------------------------------------------------------
 * Single home for backend URLs, ring-buffer sizes, animation timings,
 * localStorage keys, and the strict playhead speed tuple.
 *
 * Mirrors the URLs in src/lib/a2aService.ts (which keeps them module-private)
 * so the Theater can wire endpoints that aren't already exposed (vLEI :4000,
 * IPEX status, agent-card fetch, etc.) without re-importing from a2aService.
 *
 * If a2aService ever changes its hardcoded URLs, both files must be updated.
 * Cross-reference checked: a2aService.ts lines 3-5 as of the read on Phase 1.
 */

import type { PlayheadSpeed } from './types';

// ─── Backend endpoints ────────────────────────────────────────────────────
// These mirror the const declarations at the top of a2aService.ts.
// The buyer agent serves both the JSON-RPC entrypoint AND the
// /negotiate-events SSE stream from the same origin.

export const BACKENDS = {
  buyer:    'http://localhost:9090',
  seller:   'http://localhost:8080',
  treasury: 'http://localhost:7070',
  vlei:     'http://localhost:4000',
} as const;

// SSE endpoint path is always /negotiate-events on whichever agent.
// (Confirmed by reading openEventSource in a2aService.ts.)
export const SSE_PATH = '/negotiate-events';

// Optional REST endpoints that AgentCenter calls today — Theater will
// reuse some of these as event sources for kind='ipex', 'agent-card', 'audit'.
export const REST_PATHS = {
  identityMode:   '/api/identity-mode',          // GET (buyer or seller)
  verify:         '/api/verify',                 // POST :{caller}/api/verify/{target}
  modeStatus:     '/api/self/mode-status',       // GET (seller :8080 — CONT8 refactor)
  recentDeals:    '/api/recent-deals',           // GET (buyer :9090)
  quality:        '/api/quality',                // GET /api/quality/:id
  qualityPdf:     '/api/quality',                // GET /api/quality/:id/pdf
  baseline:       '/api/baseline',               // GET (buyer)
  modeMatrix:     '/api/mode-matrix',            // GET (buyer)
  agentCard:      '/.well-known/agent-card.json',
  ipexStatus:     '/api/ipex-status',            // GET (vlei :4000)
  vleiStatus:     '/api/status',                 // GET (vlei :4000)
} as const;

// ─── Event log ────────────────────────────────────────────────────────────
// Hard cap on the ring buffer. At ~20 events per negotiation and ~5 SSE
// channels active simultaneously, 2000 gives ~100 full negotiations of
// history before old events scroll off. Beyond that the soak test in
// Phase 8 will tell us whether to bump it.

export const EVENT_LOG_MAX = 2000;

// Window in ms within which we treat duplicate SSE messages (by id) as
// belonging to the same React StrictMode double-invoke vs. an actual replay.
export const SSE_DEDUP_WINDOW_MS = 500;

// ─── Animation durations (ms) ─────────────────────────────────────────────
// Centralized here so a single tweak adjusts the whole feel without
// hunting across components. All consumed by Phase 3+ animation code.

export const ANIM = {
  envelopeFlight:     600,    // bezier flight buyer ↔ seller
  envelopeStagger:    100,    // delay between adjacent envelopes in a burst
  envelopeFadeIn:     180,
  envelopeFadeOut:    240,
  riverDraw:          800,    // DrawSVG verification cascade
  treasuryZoom:       400,    // GSAP Flip stage-zoom into consult bubble
  ipexBalletStep:     500,    // grant → admit step in IPEX choreography
  phaseTransition:    350,    // bottom-timeline phase strip recolor
  inspectorSwap:      200,    // AnimatePresence layout swap for right rail
  metricCountUp:      600,    // animated counter for price/value chips
  reducedMotionFade:  50,     // single value used everywhere when user
                              // has prefers-reduced-motion enabled
} as const;

// ─── Playhead ─────────────────────────────────────────────────────────────

export const PLAYHEAD_SPEEDS: readonly PlayheadSpeed[] = [0.25, 0.5, 1, 2, 4];
export const PLAYHEAD_DEFAULT_SPEED: PlayheadSpeed = 1;

// ─── LocalStorage keys (theater_* namespace) ──────────────────────────────
// AgentCenter / Dashboard / Risk / ContractManagement use the unprefixed
// `actus_dd_contracts_history` key. Theater MUST NOT touch that — its keys
// all live under the theater_ prefix to avoid any chance of collision.

export const STORAGE_KEYS = {
  scenarioQueue:  'theater_scenario_queue',
  preferences:    'theater_preferences',
  lastSelection:  'theater_last_selection',
} as const;

// ─── Round inference (Iter-4.3 replication) ───────────────────────────────
// AgentCenter solved a bug where agents broadcast wrong round numbers by
// counting per-side offer counts via refs + deduping by msg.id. Theater
// replicates this in useNegotiationRounds (Phase 4). Constants below are
// the tunables used by that hook.

export const ROUND_INFERENCE = {
  // When a counter-offer arrives without a matching opposite-side offer
  // yet, hold it for this many ms before accepting it as out-of-order.
  outOfOrderToleranceMs: 200,
} as const;
