// ============================================================================
// src/notify/router.ts  —  Iteration 15: NotificationRouter (Seam 4)
// ============================================================================
//
// Singleton router. Agents call `notify.publish(event)`; the router walks
// recipients, picks subscribed channels, renders, sends, collects receipts.
//
// Two design rules, both intentional:
//
//   1. Notification failures NEVER stop the negotiation.
//      send() catches everything, returns DeliveryReceipt with `error`, and
//      the audit records the failure honestly.
//
//   2. The router is stateless apart from registered channels & recipients.
//      No per-negotiation memory. The audit JSON is the system of record.
//
// Receipts are exposed via getReceiptsFor(negotiationId) so the audit-writer
// can attach them to the audit JSON at deal close / escalation.
//
// ============================================================================

import type { AgentEvent, OutboundChannel, Recipient, DeliveryReceipt } from "./types.js";
import { renderForChannel } from "./render.js";
import { loadNotificationConfig } from "./config.js";
import { UiDashboardChannel } from "./channels/ui-dashboard.js";
import { WhatsappTwilioChannel } from "./channels/whatsapp-twilio.js";
import { SSEBroadcaster } from "../shared/sse-broadcaster.js";

export interface RouterInitOptions {
  /** Pass the agent's SSEBroadcaster so the ui-dashboard channel reuses it. */
  sharedBroadcaster?: SSEBroadcaster;
  /** Which agent is initialising — used only for log prefixes. */
  agentLabel?: string;
}

class NotificationRouter {
  private channels  = new Map<string, OutboundChannel>();
  private recipients: Recipient[] = [];
  private receiptsByNegId = new Map<string, DeliveryReceipt[]>();
  private initialized = false;
  private agentLabel = "agent";

  /** Idempotent. Loads YAML, registers channels, primes recipients. */
  async initialize(opts: RouterInitOptions = {}): Promise<void> {
    if (this.initialized) return;
    this.agentLabel = opts.agentLabel ?? "agent";
    const cfg = loadNotificationConfig();

    // Register channels by their declared `impl`
    for (const ch of cfg.channels) {
      try {
        let inst: OutboundChannel | null = null;
        if (ch.impl === "ui-dashboard") {
          inst = new UiDashboardChannel(ch.id, { sharedBroadcaster: opts.sharedBroadcaster });
        } else if (ch.impl === "whatsapp-twilio") {
          inst = new WhatsappTwilioChannel(ch.id, ch.mode, ch.config as any);
        } else {
          console.warn(`[notify:${this.agentLabel}] unknown channel impl '${ch.impl}' for channel '${ch.id}' — skipping`);
          continue;
        }
        await inst.initialize();
        this.channels.set(ch.id, inst);
      } catch (e: any) {
        console.warn(`[notify:${this.agentLabel}] failed to init channel '${ch.id}': ${e?.message ?? e} — skipping`);
      }
    }

    this.recipients = cfg.recipients.map(r => ({
      role:            r.role,
      legalEntityName: r.legalEntityName,
      lei:             r.lei,
      channels: r.channels.map(cs => ({
        channelId: cs.channelId,
        events:    cs.events as AgentEvent["type"][],
        address:   cs.address,
      })),
    }));

    this.initialized = true;
    console.log(`[notify:${this.agentLabel}] initialized with ${this.channels.size} channel(s), ${this.recipients.length} recipient(s).`);
  }

  /**
   * Publish an event. Best-effort: never throws, always returns the
   * receipts produced (possibly empty if no recipient subscribed).
   *
   * The agent fires this at decision points; the router decides routing.
   */
  async publish(event: AgentEvent): Promise<DeliveryReceipt[]> {
    if (!this.initialized) {
      // Soft-fail: a misordered agent setup shouldn't crash a negotiation.
      console.warn(`[notify:${this.agentLabel}] publish called before initialize; event dropped: ${event.type}`);
      return [];
    }

    const receipts: DeliveryReceipt[] = [];
    for (const r of this.recipients) {
      // Optional role-filter: events are global, but the renderer decides
      // perspective. We still walk every recipient — the YAML controls who
      // sees what via the `events: [...]` subscription list.
      for (const sub of r.channels) {
        if (!sub.events.includes(event.type)) continue;
        const channel = this.channels.get(sub.channelId);
        if (!channel) continue;
        try {
          const rendered = renderForChannel(event, r, channel.kind);
          // Skip channels with nothing to say (e.g. renderer returned empty)
          if (!rendered.freeForm && !rendered.template) continue;
          const rec = await channel.send(r, event, rendered);
          receipts.push(rec);
        } catch (e: any) {
          // Belt-and-suspenders: send() should never throw, but if it does,
          // capture rather than propagate.
          receipts.push({
            channelId:         channel.channelId,
            channelKind:       channel.kind,
            channelMode:       channel.mode,
            recipientRole:     r.role,
            recipientAddress:  sub.address,
            eventType:         event.type,
            negotiationId:     event.negotiationId,
            providerMessageId: "",
            sentAt:            new Date().toISOString(),
            mode:              "skipped",
            error:             e?.message ?? String(e),
          });
        }
      }
    }

    // Accumulate for audit attachment
    if (receipts.length) {
      const list = this.receiptsByNegId.get(event.negotiationId) ?? [];
      list.push(...receipts);
      this.receiptsByNegId.set(event.negotiationId, list);
    }

    return receipts;
  }

  /** Drain receipts for a negotiation, for inclusion in the audit JSON. */
  drainReceiptsFor(negotiationId: string): DeliveryReceipt[] {
    const list = this.receiptsByNegId.get(negotiationId) ?? [];
    this.receiptsByNegId.delete(negotiationId);
    return list;
  }

  /** Non-destructive peek. */
  getReceiptsFor(negotiationId: string): DeliveryReceipt[] {
    return [...(this.receiptsByNegId.get(negotiationId) ?? [])];
  }

  /** For diagnostics / /api/notify-status endpoint. */
  status(): { channelId: string; kind: string; mode: string }[] {
    const out: { channelId: string; kind: string; mode: string }[] = [];
    for (const [id, ch] of this.channels) out.push({ channelId: id, kind: ch.kind, mode: ch.mode });
    return out;
  }
}

// Singleton — one router per process, shared across agent code
let _router: NotificationRouter | null = null;
export function getNotifier(): NotificationRouter {
  if (!_router) _router = new NotificationRouter();
  return _router;
}

// Convenience re-exports for agents
export type { AgentEvent, DeliveryReceipt };
