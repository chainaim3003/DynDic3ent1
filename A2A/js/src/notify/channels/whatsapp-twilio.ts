// ============================================================================
// src/notify/channels/whatsapp-twilio.ts — Iteration 16: WhatsApp via Twilio
// ============================================================================
//
// Sends WhatsApp messages via Twilio's Programmable Messaging API.
//
// Two operating modes are supported on the same code path:
//
//   1. mode: "bsp"           Twilio Sandbox (free, demo-only). Recipients must
//                            opt-in once by sending "join <code>" to Twilio's
//                            sandbox number. No template approval needed; the
//                            24h customer-service window still applies.
//
//   2. mode: "production"    Real Twilio WhatsApp Sender (verified via Meta).
//                            Same code; only the from-number changes.
//
// HONESTY DISCIPLINE (identical to whatsapp-cloud.ts):
//   - If creds are missing, initialize() warns but never crashes.
//   - send() never throws on transient/HTTP/network errors — it returns a
//     DeliveryReceipt with `error` populated so the audit records the
//     attempt and reason transparently.
//
// WHY A SECOND CHANNEL EXISTS (since whatsapp-cloud.ts already does WhatsApp):
//   - Demonstrates the abstraction: agents stayed untouched; one new file
//     adds an entire new provider path.
//   - Meta-direct requires business verification (days). Twilio Sandbox is
//     available in 10 minutes. This is the operational fallback when Meta's
//     verification is in review.
//
// ============================================================================

import type {
  OutboundChannel, Recipient, AgentEvent, RenderedMessage, DeliveryReceipt,
} from "../types.js";

export interface WhatsappTwilioChannelOptions {
  /** Twilio Account SID — starts with "AC". */
  accountSid: string;
  /** Twilio Auth Token. */
  authToken: string;
  /**
   * Sender number in E.164 form, no "whatsapp:" prefix.
   * Sandbox is typically "+14155238886". Twilio prepends "whatsapp:"
   * internally at send time.
   */
  fromPhoneE164: string;
  /** Optional Twilio Messaging Service SID, if using one. Overrides fromPhoneE164. */
  messagingServiceSid?: string;
  /**
   * For sandbox mode only: a hint to the operator that recipients must opt
   * in once. Not enforced — Twilio's API will tell us at send time if a
   * recipient hasn't joined. We surface that hint in the error.
   */
  sandboxJoinCode?: string;
}

interface WindowState {
  lastInboundAt: number | null;   // ms epoch
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsappTwilioChannel implements OutboundChannel {
  public readonly channelId: string;
  public readonly kind = "whatsapp" as const;
  public readonly mode: OutboundChannel["mode"];

  private opts: WhatsappTwilioChannelOptions;
  private windows = new Map<string, WindowState>();
  private disabledReason: string | null = null;

  constructor(channelId: string, mode: OutboundChannel["mode"], opts: WhatsappTwilioChannelOptions) {
    this.channelId = channelId;
    this.mode      = mode;
    this.opts      = opts;
  }

  async initialize(): Promise<void> {
    const issues: string[] = [];
    if (!this.opts.accountSid || this.opts.accountSid.startsWith("${")) {
      issues.push("accountSid missing or unresolved (check .env)");
    } else if (!this.opts.accountSid.startsWith("AC")) {
      issues.push(`accountSid does not look like a Twilio SID (should start with 'AC'); got: '${this.opts.accountSid.slice(0, 10)}...'`);
    }
    if (!this.opts.authToken || this.opts.authToken.startsWith("${")) {
      issues.push("authToken missing or unresolved (check .env)");
    }
    if (!this.opts.fromPhoneE164 || this.opts.fromPhoneE164.startsWith("${")) {
      issues.push("fromPhoneE164 missing or unresolved (check .env)");
    } else if (!/^\+\d{6,15}$/.test(this.opts.fromPhoneE164)) {
      issues.push(`fromPhoneE164 not in E.164 (expected '+...', got: '${this.opts.fromPhoneE164}')`);
    }

    if (issues.length) {
      this.disabledReason = issues.join("; ");
      console.warn(`[notify/whatsapp-twilio:${this.channelId}] initialize: ${this.disabledReason}`);
      console.warn(`[notify/whatsapp-twilio:${this.channelId}] WhatsApp delivery DISABLED for this channel until env vars are set.`);
    } else {
      this.disabledReason = null;
      const hint = this.opts.sandboxJoinCode
        ? `; sandbox mode — recipients must send 'join ${this.opts.sandboxJoinCode}' to ${this.opts.fromPhoneE164} once`
        : "";
      console.log(`[notify/whatsapp-twilio:${this.channelId}] ready (mode=${this.mode}, from=${this.opts.fromPhoneE164}${hint})`);
    }
  }

  async shutdown(): Promise<void> { /* no persistent connections */ }

  /** For future inbound-webhook support: open the 24h window for a number. */
  public noteInboundFrom(phoneE164: string, atMs: number = Date.now()): void {
    const w = this.windows.get(phoneE164) ?? { lastInboundAt: null };
    w.lastInboundAt = atMs;
    this.windows.set(phoneE164, w);
  }

  async send(
    recipient: Recipient,
    event:     AgentEvent,
    body:      RenderedMessage,
  ): Promise<DeliveryReceipt> {
    const sentAt = new Date().toISOString();
    const phone  = recipient.channels.find(c => c.channelId === this.channelId)?.address?.phoneE164 ?? "";

    const baseReceipt: DeliveryReceipt = {
      channelId:         this.channelId,
      channelKind:       this.kind,
      channelMode:       this.mode,
      recipientRole:     recipient.role,
      recipientAddress:  { phoneE164: phone },
      eventType:         event.type,
      negotiationId:     event.negotiationId,
      providerMessageId: "",
      sentAt,
      mode:              "skipped",
    };

    // Guard 1: channel disabled (missing/invalid creds)
    if (this.disabledReason) {
      return { ...baseReceipt, error: `whatsapp-twilio channel not configured (${this.disabledReason})` };
    }
    // Guard 2: recipient phone not present or malformed
    if (!phone || !/^\+\d{6,15}$/.test(phone)) {
      return { ...baseReceipt, error: `invalid or missing recipient phoneE164: ${JSON.stringify(phone)}` };
    }
    // Guard 3: nothing to send
    if (!body.freeForm && !body.template) {
      return { ...baseReceipt, error: "renderer produced empty message (no freeForm and no template)" };
    }

    // Twilio Sandbox supports text. Templates ARE supported by Twilio, but they
    // require a Content SID (separate from Meta's template registry). For iter 16
    // we send free-form text and let Twilio enforce its own 24h window rule —
    // when outside the window, Twilio returns a clear error we surface honestly.
    //
    // The renderer always provides freeForm (the WhatsApp renderer in render.ts
    // does this). If a future event has only `template`, we degrade to a
    // human-readable label so the audit trail is still complete.
    const textBody = body.freeForm
      ?? `[${event.type}] ${event.negotiationId} — see audit for details.`;

    // Twilio's Messages API uses application/x-www-form-urlencoded
    const form = new URLSearchParams();
    if (this.opts.messagingServiceSid) {
      form.set("MessagingServiceSid", this.opts.messagingServiceSid);
    } else {
      form.set("From", `whatsapp:${this.opts.fromPhoneE164}`);
    }
    form.set("To",   `whatsapp:${phone}`);
    form.set("Body", textBody);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.opts.accountSid)}/Messages.json`;
    const basicAuth = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString("base64");

    let response: Response;
    try {
      response = await fetch(url, {
        method:  "POST",
        headers: {
          "Authorization": `Basic ${basicAuth}`,
          "Content-Type":  "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch (e: any) {
      return { ...baseReceipt, mode: "freeform", error: `network error: ${e?.message ?? e}` };
    }

    const text = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* leave null */ }

    if (!response.ok) {
      // Twilio error JSON: { code: 63016, message: "...", more_info: "https://www.twilio.com/docs/errors/63016" }
      const twErr  = parsed;
      const detail = twErr?.code
        ? `${twErr.code}/${twErr.status ?? response.status}: ${twErr.message ?? text}`
        : `HTTP ${response.status}: ${text.slice(0, 200)}`;

      // Helpful hints for the two most common sandbox pitfalls
      let hint = "";
      if (twErr?.code === 63015 || twErr?.code === 63016) {
        // 63016 = "Failed to send freeform message because you are outside the allowed window"
        // 63015 = "Channel template does not exist"
        hint = " | hint: recipient is outside the 24h Twilio window. Have them send any message to your sandbox number, or use a Twilio Content Template.";
      } else if (twErr?.code === 63007) {
        // 63007 = "Channel could not find a 'From' / sandbox not joined"
        hint = this.opts.sandboxJoinCode
          ? ` | hint: recipient has not joined the sandbox. Have them send 'join ${this.opts.sandboxJoinCode}' to ${this.opts.fromPhoneE164}`
          : " | hint: recipient has not joined the Twilio Sandbox (one-time opt-in).";
      } else if (response.status === 401) {
        hint = " | hint: 401 Unauthorized — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env";
      } else if (twErr?.code === 21211) {
        hint = " | hint: invalid To number — must be E.164 format with +countrycode";
      }

      return { ...baseReceipt, mode: "freeform", error: detail + hint };
    }

    // Twilio returns the message SID as `sid` (e.g. "SM..." or "MMxxxx"). Some
    // WhatsApp messages return `sid` as a "wamid"-equivalent in `messaging_service_sid`
    // or in a top-level `sid` — either way we record what Twilio gave us.
    const providerMessageId = parsed?.sid ?? "";

    // Twilio also reports the price in `price` (negative number, e.g. "-0.005")
    // and currency in `price_unit`. Some sandbox responses report null — handle.
    let cost: DeliveryReceipt["cost"] | undefined;
    if (parsed?.price !== undefined && parsed?.price !== null && parsed?.price_unit) {
      const amt = Number(parsed.price);
      if (!Number.isNaN(amt)) {
        cost = { currency: String(parsed.price_unit), amount: Math.abs(amt) };
      }
    }

    return {
      ...baseReceipt,
      providerMessageId,
      mode:           "freeform",
      cost,
    };
  }
}
