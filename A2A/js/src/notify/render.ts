// ============================================================================
// src/notify/render.ts  —  Iteration 15: Event → channel-specific message text
// ============================================================================
//
// Each (event-type × channel-kind × recipient-role) combination has a render
// function. The split matters:
//   - UI dashboard messages can be rich, multi-line, info-dense
//   - WhatsApp messages must be SHORT and decision-grade — the dashboard
//     is for the transcript, WhatsApp is for the moments that matter
//   - "Your agent did X" vs "they did X" must reflect the RECIPIENT's
//     perspective, not the event's perspective (event says BUYER acted;
//     when rendering for the seller recipient, that becomes "Tommy
//     countered ₹340")
//
// Renderers are pure: (event, recipient, channelKind) → RenderedMessage
// No I/O, no side effects, no time-of-day branching here. (Quiet-hours
// logic lives in the router.)
//
// ============================================================================

import type { AgentEvent, Recipient, RenderedMessage, OutboundChannel } from "./types.js";

type ChannelKind = OutboundChannel["kind"];

/**
 * Render an event for a given recipient on a given channel kind.
 * Falls back to a generic representation if no specific renderer is
 * registered — guarantees the router never crashes on a new event type.
 */
export function renderForChannel(
  event:       AgentEvent,
  recipient:   Recipient,
  channelKind: ChannelKind,
): RenderedMessage {
  if (channelKind === "whatsapp") return renderWhatsapp(event, recipient);
  if (channelKind === "sms")      return renderSms(event, recipient);
  if (channelKind === "email")    return renderEmail(event, recipient);
  if (channelKind === "ui-dashboard") return renderUiDashboard(event, recipient);
  return { freeForm: genericFallback(event) };
}

// ── Perspective helpers ────────────────────────────────────────────────────

/**
 * "OWN" or "COUNTERPARTY" for this recipient.
 *   - Event perspective BUYER + recipient role buyer-* → OWN
 *   - Event perspective BUYER + recipient role seller-* → COUNTERPARTY
 *   - Event perspective TREASURY → contextual (the buyer's treasury is OWN
 *     to the buyer; the seller treasury would be OWN to the seller — but
 *     in our setup TREASURY is buyer-side, so treat it as OWN for buyer)
 */
function perspectiveFor(event: AgentEvent, recipient: Recipient): "OWN" | "COUNTERPARTY" {
  const r = recipient.role.toLowerCase();
  if (event.perspective === "BUYER"  && r.startsWith("buyer"))  return "OWN";
  if (event.perspective === "SELLER" && r.startsWith("seller")) return "OWN";
  if (event.perspective === "TREASURY" && r.startsWith("buyer")) return "OWN";
  return "COUNTERPARTY";
}

// ── WhatsApp renderer ──────────────────────────────────────────────────────
// Keep each message short. Lead with an emoji so the thread skims well.

function renderWhatsapp(event: AgentEvent, recipient: Recipient): RenderedMessage {
  const persp = perspectiveFor(event, recipient);
  const neg   = shortNegId(event.negotiationId);
  const p     = event.payload as any;

  let body: string;
  switch (event.type) {
    case "negotiation-started":
      body = persp === "OWN"
        ? `🤝 *${neg}* — Your agent opened a negotiation with ${p.counterpartyName ?? "counterparty"} for ${fmtQty(p.quantity)} ${p.product ?? "units"}.`
        : `📩 *${neg}* — ${p.counterpartyName ?? "Counterparty"} opened a negotiation for ${fmtQty(p.quantity)} ${p.product ?? "units"}.`;
      break;

    case "own-offer-sent":
      body = `💬 *${neg}* Round ${event.round ?? "?"} — Your agent ${actionVerb(p.action)} ${fmtPrice(p.price)}${gapPart(p.gap)}`;
      if (p.reasoning) body += `\n_${truncate(String(p.reasoning), 120)}_`;
      break;

    case "counterparty-offer-received":
      body = `📩 *${neg}* Round ${event.round ?? "?"} — Counterparty ${actionVerb(p.action)} ${fmtPrice(p.price)}${gapPart(p.gap)}`;
      break;

    case "deal-closed":
      body = `✅ *${neg}* — DEAL CLOSED at ${fmtPrice(p.finalPrice)}`;
      if (p.quantity) body += ` × ${fmtQty(p.quantity)} = ${fmtPrice(p.finalPrice * p.quantity, true)}`;
      if (p.buyerShare !== undefined) body += `\nSurplus split: ${Math.round(p.buyerShare * 100)}% buyer / ${Math.round((p.sellerShare ?? 1 - p.buyerShare) * 100)}% seller`;
      if (p.auditUrl)   body += `\n📎 Audit: ${p.auditUrl}`;
      break;

    case "purchase-order-sent":
      body = `📝 *${neg}* — PO sent. ${p.poId ?? ""}${p.poId ? " · " : ""}${fmtPrice(p.total, true)} · delivery ${p.deliveryDate ?? "TBD"}`;
      break;

    case "escalation":
      body = `⚠️ *${neg}* — Negotiation ESCALATED. Human attention needed.`;
      if (p.reason) body += `\nReason: ${truncate(String(p.reason), 140)}`;
      if (p.auditUrl) body += `\n📎 ${p.auditUrl}`;
      break;

    case "treasury-block":
      body = `🛑 *${neg}* — Treasury blocked offer at ${fmtPrice(p.priceQueried)}`;
      if (p.minViablePrice) body += ` (min viable: ${fmtPrice(p.minViablePrice)})`;
      if (p.reason) body += `\n${truncate(String(p.reason), 120)}`;
      break;

    default:
      body = genericFallback(event);
  }

  // Always append the Note: footer with the full negotiation ID. Future call
  // sites can thread additional context via payload.note (string) or
  // payload.notes (string[]) — see buildNoteLine() for the contract.
  body += buildNoteLine(event);

  return { freeForm: body };
}

// ── SMS renderer (future: iter 16) ─────────────────────────────────────────
// Stub for now; same shape as WhatsApp but no emojis and tighter limit.
function renderSms(event: AgentEvent, recipient: Recipient): RenderedMessage {
  const wa = renderWhatsapp(event, recipient);
  // strip emojis and markdown, cap at 160 chars
  const stripped = (wa.freeForm ?? "")
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[*_~`]/g, "")
    .trim();
  return { freeForm: stripped.slice(0, 160) };
}

// ── Email renderer (future: iter 7.5) ──────────────────────────────────────
// Stub. Real version would build HTML + plain-text alternative.
function renderEmail(event: AgentEvent, recipient: Recipient): RenderedMessage {
  return { freeForm: genericFallback(event) };
}

// ── UI dashboard renderer ──────────────────────────────────────────────────
// The existing SSEBroadcaster already produces dashboard messages from the
// agents directly. The UI channel just acknowledges the event; it doesn't
// duplicate the broadcast. Keeping this minimal so we don't double-render.
function renderUiDashboard(event: AgentEvent, recipient: Recipient): RenderedMessage {
  return { freeForm: `[${event.type}] ${event.negotiationId}` };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function shortNegId(id: string): string {
  // NEG-1778992109283 → NEG-…9283
  return id.length > 8 ? `NEG-…${id.slice(-4)}` : id;
}
function actionVerb(action: unknown): string {
  const a = String(action ?? "").toLowerCase();
  if (a.includes("accept"))  return "ACCEPTED at";
  if (a.includes("reject"))  return "REJECTED";
  if (a.includes("counter")) return "countered";
  if (a.includes("offer"))   return "offered";
  return "moved";
}
function fmtPrice(n: unknown, total = false): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  const formatted = n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return total ? `₹${formatted}` : `₹${formatted}/unit`;
}
function fmtQty(n: unknown): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN");
}
function gapPart(gap: unknown): string {
  if (typeof gap !== "number" || Number.isNaN(gap) || gap === 0) return "";
  return ` (gap ₹${Math.abs(gap)})`;
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
function genericFallback(event: AgentEvent): string {
  return `[${event.type}] ${shortNegId(event.negotiationId)}${event.round !== undefined ? " R" + event.round : ""}`;
}

/**
 * Build the "Note:" footer line that closes every WhatsApp message.
 *
 * Contract:
 *   1. The full negotiation ID is ALWAYS present. The message header uses a
 *      shortened form (NEG-…9283) for skimmability; the Note line carries
 *      the unambiguous full ID, so a forwarded screenshot is self-contained.
 *   2. Extra context can be threaded via the event payload:
 *        payload.note  : string    — single annotation appended after the ID
 *        payload.notes : string[]  — multiple annotations, each appended
 *      Both forms can be used together. Empty/non-string values are skipped.
 *      Items are joined with ` · ` for compactness on one line.
 *   3. Prefixed with a blank line so it visually separates from the body.
 *
 * To extend later (timestamps, audit URLs, mode tags, deadlines, etc.):
 *   — Either the call site passes the extra context via payload.notes
 *     (no code change here needed), OR
 *   — A new well-known payload key is added below with a clear contract.
 *   The renderer is the single point of authority over the footer format,
 *   so audits and replays can never see drift between agents.
 */
function buildNoteLine(event: AgentEvent): string {
  const parts: string[] = [event.negotiationId];
  const p = event.payload as any;
  if (typeof p?.note === "string" && p.note.trim() !== "") {
    parts.push(p.note.trim());
  }
  if (Array.isArray(p?.notes)) {
    for (const n of p.notes) {
      if (typeof n === "string" && n.trim() !== "") parts.push(n.trim());
    }
  }
  return `\n\nNote: ${parts.join(" · ")}`;
}
