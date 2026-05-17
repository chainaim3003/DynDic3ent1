// ============================================================================
// src/notify/channels/whatsapp-cloud.ts  —  Iteration 15: Meta Cloud API
// ============================================================================
//
// Sends WhatsApp messages via Meta's Cloud API. Handles both modes:
//
//   1. Inside 24h window  → free-form text (no template needed)
//   2. Outside 24h window → falls back to the configured template
//
// The 24h-window state is tracked in-memory per recipient phone number.
// First send always starts as "outside window" (we haven't heard from them
// yet). After the recipient replies, an inbound-webhook (NOT implemented in
// iter 15 — send-only) would update the window. For the demo flow:
//   - Phase A5 verification of the recipient = recipient replies "OK"
//     to Meta. That OK fires a webhook to Meta, NOT to us — but it opens
//     the conversation on Meta's side. Our first send to them via the API
//     after that point is treated by Meta as the start of a NEW session,
//     so we still need to template-open. The Meta-provided `hello_world`
//     template is the standard test-mode opener.
//
// HONESTY: this class makes no claims it can't back up. If the token is
// missing, initialize() warns and `send()` returns DeliveryReceipt with
// `error` populated — the negotiation continues; the audit records the
// failure. We don't fake a successful send. Ever.
//
// ============================================================================

import type {
  OutboundChannel, Recipient, AgentEvent, RenderedMessage, DeliveryReceipt,
} from "../types.js";

export interface WhatsappCloudChannelOptions {
  /** Meta Graph API version, e.g. "v22.0". */
  apiVersion?:    string;
  /** Meta's WABA phone-number ID (sender). */
  phoneNumberId: string;
  /** Long-lived system-user access token. */
  accessToken:   string;
  /** WABA ID — surfaced in DeliveryReceipt for cross-reference. */
  wabaId?:       string;
  /**
   * Default opener template name. For test-mode = "hello_world" (Meta-provided,
   * pre-approved). For production = your approved Utility template per event.
   */
  templates?: {
    defaultOpener?: string;          // used when window is closed and no event-specific template
    perEvent?: Record<string, {     // keyed by AgentEvent["type"]
      name: string;
      language?: string;             // default "en_US"
    }>;
  };
  /**
   * For test-number mode only — Meta requires recipients to be pre-registered.
   * If you list expected E.164 recipients here, the channel logs a clear
   * "not in allowed list" hint on the first failure for each unknown number.
   * Optional.
   */
  expectedRecipientsE164?: string[];
}

interface WindowState {
  lastInboundAt: number | null;   // ms epoch
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

export class WhatsappCloudChannel implements OutboundChannel {
  public readonly channelId: string;
  public readonly kind = "whatsapp" as const;
  public readonly mode: OutboundChannel["mode"];

  private opts: Required<Pick<WhatsappCloudChannelOptions, "apiVersion" | "phoneNumberId" | "accessToken">>
              & WhatsappCloudChannelOptions;
  private windows = new Map<string, WindowState>();   // key: E.164 phone

  constructor(channelId: string, mode: OutboundChannel["mode"], opts: WhatsappCloudChannelOptions) {
    this.channelId = channelId;
    this.mode      = mode;
    this.opts = {
      apiVersion:    opts.apiVersion ?? "v22.0",
      phoneNumberId: opts.phoneNumberId,
      accessToken:   opts.accessToken,
      wabaId:        opts.wabaId,
      templates:     opts.templates,
      expectedRecipientsE164: opts.expectedRecipientsE164,
    };
  }

  async initialize(): Promise<void> {
    // Sanity-check creds — but don't crash if they're missing. The negotiation
    // can run; the channel just won't deliver until the token is set.
    const issues: string[] = [];
    if (!this.opts.phoneNumberId || this.opts.phoneNumberId.startsWith("${")) {
      issues.push("phoneNumberId missing or unresolved (check .env)");
    }
    if (!this.opts.accessToken || this.opts.accessToken.startsWith("${")) {
      issues.push("accessToken missing or unresolved (check .env)");
    }
    if (issues.length) {
      console.warn(`[notify/whatsapp-cloud:${this.channelId}] initialize: ${issues.join("; ")}`);
      console.warn(`[notify/whatsapp-cloud:${this.channelId}] WhatsApp delivery DISABLED for this channel until env vars are set.`);
    } else {
      console.log(`[notify/whatsapp-cloud:${this.channelId}] ready (mode=${this.mode}, apiVersion=${this.opts.apiVersion})`);
    }
  }

  async shutdown(): Promise<void> { /* no persistent connections */ }

  /**
   * Public: external 24h-window updater. When/if we add an inbound webhook
   * receiver, it should call this on every recipient reply.
   */
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
    const phone  = recipient.channels.find(c => c.channelId === this.channelId)?.address?.phoneE164
                 ?? "";

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

    // Guard: missing creds → fail honestly, do not throw.
    if (!this.opts.phoneNumberId || this.opts.phoneNumberId.startsWith("${")
     || !this.opts.accessToken   || this.opts.accessToken.startsWith("${")) {
      return { ...baseReceipt, error: "whatsapp-cloud channel not configured (missing META env vars)" };
    }
    if (!phone || !/^\+\d{6,15}$/.test(phone)) {
      return { ...baseReceipt, error: `invalid or missing recipient phoneE164: ${JSON.stringify(phone)}` };
    }

    // Decide free-form vs template based on 24h window
    const w = this.windows.get(phone);
    const windowOpen = w?.lastInboundAt !== null && w?.lastInboundAt !== undefined
                    && (Date.now() - (w.lastInboundAt as number) < WINDOW_MS);

    const useTemplate = !windowOpen || !body.freeForm;

    const url = `https://graph.facebook.com/${this.opts.apiVersion}/${this.opts.phoneNumberId}/messages`;
    let httpBody: any;
    let modeUsed: DeliveryReceipt["mode"];
    let templateNameUsed: string | undefined;

    if (useTemplate) {
      const tpl = this.pickTemplate(event.type, body);
      if (!tpl) {
        return { ...baseReceipt, error: `no template configured for event '${event.type}' and recipient is outside the 24h window` };
      }
      templateNameUsed = tpl.name;
      modeUsed = "template";
      httpBody = {
        messaging_product: "whatsapp",
        to:                phone,
        type:              "template",
        template: {
          name:     tpl.name,
          language: { code: tpl.language ?? "en_US" },
          // Variables are positional. Renderers should keep the order stable.
          ...(tpl.variables && tpl.variables.length
            ? { components: [{ type: "body", parameters: tpl.variables.map(v => ({ type: "text", text: String(v) })) }] }
            : {}),
        },
      };
    } else {
      modeUsed = "freeform";
      httpBody = {
        messaging_product: "whatsapp",
        to:                phone,
        type:              "text",
        text:              { body: body.freeForm },
      };
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${this.opts.accessToken}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify(httpBody),
      });
    } catch (e: any) {
      return { ...baseReceipt, mode: modeUsed, templateName: templateNameUsed,
               error: `network error: ${e?.message ?? e}` };
    }

    const text = await response.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* leave parsed null */ }

    if (!response.ok) {
      const metaErr = parsed?.error;
      const detail = metaErr
        ? `${metaErr.code ?? "?"}/${metaErr.type ?? "?"}: ${metaErr.message ?? text}`
        : `HTTP ${response.status}: ${text.slice(0, 200)}`;
      // Helpful hint for the most common test-mode pitfall
      const hint = (response.status === 400 && /not in allowed list|recipient/i.test(text))
        ? " | hint: register this number in Meta API Setup recipient list (Phase A5 of SETUP.md)"
        : "";
      return { ...baseReceipt, mode: modeUsed, templateName: templateNameUsed,
               error: detail + hint };
    }

    const providerMessageId = parsed?.messages?.[0]?.id ?? "";
    return {
      ...baseReceipt,
      providerMessageId,
      mode:           modeUsed,
      templateName:   templateNameUsed,
    };
  }

  private pickTemplate(eventType: string, body: RenderedMessage): { name: string; language?: string; variables: string[] } | null {
    // 1. Renderer-supplied template (e.g. event-specific with vars baked in)
    if (body.template) return body.template;
    // 2. Per-event template from config
    const perEvent = this.opts.templates?.perEvent?.[eventType];
    if (perEvent) return { name: perEvent.name, language: perEvent.language, variables: [] };
    // 3. Default opener (hello_world in test mode, a generic Utility template in prod)
    const opener = this.opts.templates?.defaultOpener;
    if (opener) return { name: opener, variables: [] };
    return null;
  }
}
