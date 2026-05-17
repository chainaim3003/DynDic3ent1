// ============================================================================
// src/notify/types.ts  —  Iteration 15: Notification abstraction (the contract)
// ============================================================================
//
// Four seams. Everything in src/notify/ is built around these. If any agent
// file references `whatsapp`, a phone number, or a channel implementation
// directly, the abstraction has leaked — fix that, don't extend the leak.
//
//   Seam 1  AgentEvent       — what an agent emits (channel-agnostic)
//   Seam 2  Recipient        — a role + its channel subscriptions
//   Seam 3  OutboundChannel  — the interface every provider implements
//   Seam 4  NotificationRouter (in router.ts) — the only orchestrator
//
// Adding a new event type ⇒ extend the AgentEvent["type"] union here, then
// add a renderer in render.ts. No other file changes.
//
// Adding a new channel kind (e.g. SMS, Slack, email) ⇒ implement
// OutboundChannel in src/notify/channels/<name>.ts, register an `impl` value
// in config.ts. Agents and router untouched.
//
// ============================================================================

/** Seam 1 — semantic events emitted by agents. Channel-agnostic. */
export interface AgentEvent {
  /**
   * The set of events recipients can subscribe to. When extending this list,
   * also extend the renderer in render.ts and (if applicable) document the
   * variable bindings for production WhatsApp template substitution.
   */
  type:
    | "negotiation-started"
    | "own-offer-sent"            // "your agent did X" from the recipient's perspective
    | "counterparty-offer-received"  // "they did X"
    | "deal-closed"
    | "escalation"
    | "treasury-block"
    | "purchase-order-sent";

  /**
   * From the EVENT'S perspective, who is acting.
   * Used by the renderer to flip "your agent / their agent" wording.
   */
  perspective: "BUYER" | "SELLER" | "TREASURY";

  /** ID of the negotiation this event belongs to. */
  negotiationId: string;

  /** Round number (1-based). Optional for non-round events like PO sent. */
  round?: number;

  /**
   * Event-specific payload. Renderers know how to read this; the router
   * just forwards it. Keep it small and human-readable; details belong in
   * the audit JSON, not in this payload.
   */
  payload: Record<string, unknown>;

  /** ISO timestamp when the event was emitted. */
  timestamp: string;
}

/** Seam 2 — a role that should receive notifications. */
export interface Recipient {
  /** Logical role label, e.g. "buyer-cpo", "seller-cso". */
  role: string;

  /** Legal name, for display in the audit log. */
  legalEntityName: string;

  /** Optional GLEIF LEI of the legal entity this recipient represents. */
  lei?: string;

  /** Which channels this recipient is subscribed to, with per-channel events. */
  channels: ChannelSubscription[];
}

/** A recipient's binding to one channel. */
export interface ChannelSubscription {
  /** Matches an OutboundChannel.channelId registered in config. */
  channelId: string;

  /** Which event types should be forwarded to this channel for this recipient. */
  events: AgentEvent["type"][];

  /**
   * Channel-specific address. For WhatsApp: { phoneE164: "+91..." }.
   * For email (future): { emailAddress: "user@..." }. For ui-dashboard,
   * usually empty — the dashboard broadcasts to whoever is watching the SSE.
   */
  address?: Record<string, string>;
}

/** Seam 3 — the contract every channel provider implements. */
export interface OutboundChannel {
  /** Unique channel ID, referenced by ChannelSubscription.channelId. */
  readonly channelId: string;

  /** What kind of channel this is — informational, used by renderers. */
  readonly kind: "whatsapp" | "sms" | "email" | "ui-dashboard";

  /**
   * Operating mode. SURFACES IN THE AUDIT — be honest about which mode
   * actually shipped the message.
   *   "test-number" — Meta-provided 90-day test number (no business verif.)
   *   "production"  — real registered WABA, production traffic
   *   "bsp"         — going through a Business Solution Provider (e.g. Twilio)
   *   "n/a"         — the channel concept doesn't apply (ui-dashboard)
   */
  readonly mode: "test-number" | "production" | "bsp" | "n/a";

  /**
   * Send one message. The router calls this; the channel handles the
   * provider-specific HTTP/SDK work and returns a DeliveryReceipt.
   *
   * IMPORTANT: implementations must NEVER throw on a transient send failure
   * (e.g. recipient outside 24h window). Instead, return a DeliveryReceipt
   * with `error` populated so the router can log it in the audit without
   * crashing the negotiation.
   */
  send(
    recipient: Recipient,
    event:     AgentEvent,
    body:      RenderedMessage,
  ): Promise<DeliveryReceipt>;

  /** Lifecycle. May verify creds, open webhooks, etc. Idempotent. */
  initialize(): Promise<void>;

  /** Lifecycle. Channels with persistent connections must shutdown cleanly. */
  shutdown(): Promise<void>;
}

/** What the renderer produces and the channel consumes. */
export interface RenderedMessage {
  /**
   * Free-form text. Used inside the WhatsApp 24h customer-service window,
   * or for channels that don't have a template concept (ui-dashboard, SMS).
   */
  freeForm?: string;

  /**
   * Template-based message. Used outside the 24h WhatsApp window. The
   * template MUST have been pre-approved by Meta in production mode. In
   * test-number mode, the only pre-approved template is `hello_world`,
   * which is used as a fallback opener if the window has expired.
   */
  template?: {
    name:      string;
    language?: string;       // default "en_US"
    variables: string[];     // positional, substitute {{1}}, {{2}}, ...
  };
}

/** What a channel returns after attempting to send. Persisted in the audit. */
export interface DeliveryReceipt {
  channelId:         string;
  channelKind:       OutboundChannel["kind"];
  channelMode:       OutboundChannel["mode"];

  recipientRole:     string;
  recipientAddress?: Record<string, string>;  // PII-aware; included as recorded

  eventType:         AgentEvent["type"];
  negotiationId:     string;

  /**
   * Provider-assigned message ID (e.g. wamid.xxx for Meta WhatsApp).
   * Empty string if the send failed before the provider responded.
   */
  providerMessageId: string;

  /** When the send was attempted. */
  sentAt: string;

  /** How the message was sent (free-form vs templated). */
  mode: "freeform" | "template" | "broadcast" | "skipped";

  /** Template name, if mode === "template". */
  templateName?: string;

  /** Best-effort cost record from the provider, when available. */
  cost?: { currency: string; amount: number };

  /** If the send failed, the error message. Otherwise undefined. */
  error?: string;
}
