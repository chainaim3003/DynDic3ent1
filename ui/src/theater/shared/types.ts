/**
 * Agent Theater — shared type definitions
 * ---------------------------------------------------------------------------
 * Single source of truth for types used across the /agents-2 route.
 * These are theater-local — they do NOT replace or extend the types in
 * `src/lib/agents.ts`. They sit ON TOP of the existing system.
 *
 * Naming convention: anything Theater-only is prefixed with Theater* in
 * components but kept un-prefixed in this shared file for readability.
 */

import type { AgentType } from '@/lib/agents';
import type { NegotiationMessage } from '@/lib/a2aService';

// ─── Node identities on the stage ─────────────────────────────────────────
// AgentType (from lib/agents.ts) is { buyer | seller | treasury } — that's
// what the existing system tracks. Theater adds conceptual stage nodes that
// aren't standalone agents: the vLEI verifier (port 4000), the IPEX mailbox
// (visual abstraction for the grant/admit flow), and the ACTUS engine
// (visual abstraction for treasury-side computation). These extras don't
// participate in SSE — they appear/animate as part of choreographed scenes.

export type AgentId =
  | AgentType            // 'buyer' | 'seller' | 'treasury'
  | 'buyerTreasury'      // future: distinct buyer-side treasury node (not in current backend)
  | 'sellerTreasury'     // alias for AgentType 'treasury' when we need to be explicit
  | 'vleiVerifier'       // :4000 api-server
  | 'ipexMailbox'        // visual-only node for grant/admit ballet
  | 'actusEngine';       // visual-only node for treasury ACTUS computation

// ─── Semantic negotiation phases ──────────────────────────────────────────
// These are computed from the event stream, not declared by any agent.
// Used by BottomTimeline's PhaseStrip and by the master GSAP timeline to
// trigger phase-boundary animations.

export type Phase =
  | 'idle'
  | 'verify'             // vLEI / GLEIF identity verification cascade
  | 'request'            // buyer initial 'start negotiation'
  | 'handshake'          // seller's initial offer
  | 'negotiate'          // back-and-forth rounds
  | 'consult'            // treasury consultation (📨 Seller → Treasury)
  | 'ipex'               // IPEX grant/admit before invoice
  | 'close'              // final accept + PO/invoice
  | 'escalate';          // escalation outcome

// ─── LogEvent — discriminated union ───────────────────────────────────────
// Every visible thing in the Theater is driven by a LogEvent in the ring
// buffer. The kind discriminator tells consumers which payload variant
// they're looking at.

export type LogEventKind =
  | 'sse'                // raw SSE message from buyer / seller / treasury
  | 'user-cmd'           // user typed a command (start negotiation, dd accept, etc.)
  | 'verify'             // verification step result (step1..step5)
  | 'ipex'               // IPEX grant or admit fetched from :4000
  | 'agent-card'         // /.well-known/agent-card.json result
  | 'audit'              // deal quality audit fetched from /api/quality/:id
  | 'phase';             // computed phase boundary marker

export interface SseEventPayload {
  channel: 'buyer' | 'seller' | 'treasury';
  text: string;
  from: NegotiationMessage['from'];            // 'BUYER' | 'SELLER' | 'TREASURY'
  kind: NegotiationMessage['kind'];            // offer | counter | accept | ...
  seq: number;
  rawTimestamp: string;                        // ISO from agent
}

export interface UserCmdEventPayload {
  command: string;                             // raw text user typed
  intent?: 'start' | 'dd-accept' | 'dd-reject' | 'message' | 'reset';
}

export interface VerifyEventPayload {
  side: 'buyer' | 'seller';                    // which side did the verification
  step: 1 | 2 | 3 | 4 | 5;
  status: 'pending' | 'ok' | 'na' | 'fail';
  label: string;
  detail?: string;
}

export interface IpexEventPayload {
  phase: 'grant' | 'admit';
  grantSAID?: string;
  credentialSAID?: string;
  invoiceNumber?: string;
  amount?: number;
  currency?: string;
  selfAttested?: boolean;
  sellerLEI?: string;
  buyerLEI?: string;
}

export interface AgentCardEventPayload {
  agentType: AgentType;
  lei?: string;
  legalEntityName?: string;
  officialRole?: string;
  agentAID?: string;
  oorHolderAID?: string;
}

export interface AuditEventPayload {
  negotiationId: string;
  outcome: 'COMPLETED' | 'ESCALATED' | 'FAILED';
  finalPrice?: number;
  totalValue?: number;
}

export interface PhaseEventPayload {
  phase: Phase;
  reason?: string;
}

// Discriminated union. Consumers should switch on `kind` then narrow `payload`.
export type LogEvent =
  | { id: string; ts: number; kind: 'sse';         payload: SseEventPayload         }
  | { id: string; ts: number; kind: 'user-cmd';    payload: UserCmdEventPayload     }
  | { id: string; ts: number; kind: 'verify';      payload: VerifyEventPayload      }
  | { id: string; ts: number; kind: 'ipex';        payload: IpexEventPayload        }
  | { id: string; ts: number; kind: 'agent-card';  payload: AgentCardEventPayload   }
  | { id: string; ts: number; kind: 'audit';       payload: AuditEventPayload       }
  | { id: string; ts: number; kind: 'phase';       payload: PhaseEventPayload       };

// ─── Playhead state machine ───────────────────────────────────────────────

export type PlayheadMode = 'live' | 'paused' | 'scrubbing';

// Strict tuple of supported speeds — see constants.ts PLAYHEAD_SPEEDS.
export type PlayheadSpeed = 0.25 | 0.5 | 1 | 2 | 4;

export interface PlayheadState {
  mode: PlayheadMode;
  index: number;       // 0..total-1, position in log; -1 if empty
  total: number;
  speed: PlayheadSpeed;
}

// ─── Round bookkeeping ────────────────────────────────────────────────────
// Replicates the AgentCenter Iter-4.3 fix: agents broadcast wrong round
// numbers, so the UI infers rounds from per-side offer counts.

export interface Round {
  round: number;                                // 1, 2, 3, ...
  buyerOffer?: number;
  sellerOffer?: number;
  buyerEventId?: string;                        // LogEvent.id for the buyer offer
  sellerEventId?: string;                       // LogEvent.id for the seller offer
  outcome?: 'IN_PROGRESS' | 'COMPLETED' | 'ESCALATED' | 'FAILED';
}

// ─── Selection model for the right-side Inspector ─────────────────────────

export type Selection =
  | { kind: 'none' }
  | { kind: 'agent'; agentId: AgentId }
  | { kind: 'message'; eventId: string }
  | { kind: 'round'; round: number };
