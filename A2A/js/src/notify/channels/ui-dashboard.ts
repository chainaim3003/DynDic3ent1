// ============================================================================
// src/notify/channels/ui-dashboard.ts  —  Iteration 15: UI channel adapter
// ============================================================================
//
// Adapter that wraps the existing SSEBroadcaster so the router can treat the
// dashboard as just-another-channel. This lets us record dashboard delivery
// receipts in the audit (proving "yes, the dashboard was notified at this
// timestamp") with the same shape as WhatsApp / SMS / email.
//
// We DON'T duplicate every agent message — the agents already call
// sseBroadcaster.broadcast() at the right points. This channel exists so
// the router can publish *additional* structured notifications without
// going around the SSE layer.
//
// ============================================================================

import type {
  OutboundChannel, Recipient, AgentEvent, RenderedMessage, DeliveryReceipt,
} from "../types.js";
import { SSEBroadcaster } from "../../shared/sse-broadcaster.js";

export interface UiDashboardChannelOptions {
  /**
   * Optional shared broadcaster. If provided, this adapter pushes into the
   * existing agent SSE stream instead of starting its own. Pass the
   * sseBroadcaster instance from buyer-agent / seller-agent.
   */
  sharedBroadcaster?: SSEBroadcaster;
}

export class UiDashboardChannel implements OutboundChannel {
  public readonly channelId: string;
  public readonly kind = "ui-dashboard" as const;
  public readonly mode = "n/a" as const;

  private broadcaster: SSEBroadcaster;

  constructor(channelId: string, opts: UiDashboardChannelOptions = {}) {
    this.channelId   = channelId;
    this.broadcaster = opts.sharedBroadcaster ?? new SSEBroadcaster("notify");
  }

  async initialize(): Promise<void> { /* nothing to do */ }
  async shutdown():   Promise<void> { /* nothing to do */ }

  async send(
    recipient: Recipient,
    event:     AgentEvent,
    body:      RenderedMessage,
  ): Promise<DeliveryReceipt> {
    const text = body.freeForm ?? `[${event.type}] ${event.negotiationId}`;
    const sentAt = new Date().toISOString();
    try {
      this.broadcaster.broadcast(text);
      return {
        channelId:         this.channelId,
        channelKind:       this.kind,
        channelMode:       this.mode,
        recipientRole:     recipient.role,
        eventType:         event.type,
        negotiationId:     event.negotiationId,
        providerMessageId: `sse-${sentAt}`,  // synthetic; SSE has no provider message id
        sentAt,
        mode:              "broadcast",
      };
    } catch (e: any) {
      return {
        channelId:         this.channelId,
        channelKind:       this.kind,
        channelMode:       this.mode,
        recipientRole:     recipient.role,
        eventType:         event.type,
        negotiationId:     event.negotiationId,
        providerMessageId: "",
        sentAt,
        mode:              "skipped",
        error:             e?.message ?? String(e),
      };
    }
  }
}
