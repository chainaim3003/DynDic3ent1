// ============================================================================
// src/notify/index.ts  —  Iteration 15: public surface
// ============================================================================
//
// Agents import from this file ONLY. Internal modules (config, render,
// channels) are implementation detail. Keeping the surface small means
// future refactors don't ripple through agent code.
//
// Usage:
//   import { getNotifier, type AgentEvent } from "../../notify/index.js";
//   await getNotifier().initialize({ sharedBroadcaster: sse, agentLabel: "buyer" });
//   await getNotifier().publish({ type: "negotiation-started", ... });
//
// ============================================================================

export { getNotifier } from "./router.js";
export type { AgentEvent, Recipient, OutboundChannel, DeliveryReceipt, RenderedMessage } from "./types.js";
