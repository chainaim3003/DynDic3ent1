// ============================================================================
// src/shared/audit-pdf.ts  —  Iteration 7: Signed PDF audit generator
// ============================================================================
//
// Renders a regulator-grade PDF from the buyer-side audit JSON (and optionally
// the seller-side audit for richer treasury detail). Streams to any
// `NodeJS.WritableStream` (Express `res`, file write stream, etc.).
//
// Sections (in order):
//   1. Cover                — counterparties, LEIs, deal terms, timestamp
//   2. Outcome Quality      — IR, ZOPA, NBS, surplus split (iter 3 metrics)
//   3. Decision Trail       — per-round LLM proposal + constraint adjust +
//                             treasury override + final decision (iter 4)
//   4. Market Context       — SOFR per round, effective borrowing rate
//   5. GLEIF / vLEI Chain   — identity provenance for both parties
//   6. Envelope Hashes      — signing-mode disclosure, monotonic counters
//   7. Document Provenance  — generation timestamp + audit source
//   8. External Notifications — WhatsApp / email / SMS delivery receipts (iter 15)
//
// Library: pdfkit (mature, zero-config, sync stream API).
//
// HONESTY NOTE: this PDF is *summary-of-record*, not a notarized artifact.
// The cryptographic claims (hash-envelope counters, GLEIF chain) come from
// the audit JSON; the PDF reproduces them faithfully. If you want a
// counter-signed PDF, sign the output stream externally — out of scope for
// May 19.
//
// ============================================================================

import PDFDocument from "pdfkit";

// Minimal shape we rely on — same as ui/src/lib/dealQualityApi.ts but with
// `any` escape hatches so we never crash on partial JSON.
type AnyRecord = Record<string, any>;

// ── Colours (chosen for grayscale-friendly contrast) ───────────────────────
const C = {
  ink:     "#1a1a1a",
  muted:   "#666666",
  rule:    "#cccccc",
  band:    "#f2f2f2",
  good:    "#1f7a3a",
  warn:    "#a4671d",
  bad:     "#8c1e1e",
  accent:  "#2c3e8a",
} as const;

// ── Small helpers ──────────────────────────────────────────────────────────

function fmtCurrency(value: number | undefined, currency: string = "INR"): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  const sym = currency === "USD" ? "$" : "₹";
  return `${sym}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtPct(value: number | undefined): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toUTCString(); } catch { return iso; }
}
function safe(s: any, fallback = "—"): string {
  if (s === undefined || s === null || s === "") return fallback;
  return String(s);
}

// ── Section drawers ────────────────────────────────────────────────────────

function drawHeader(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  doc.fillColor(C.accent).fontSize(18).font("Helvetica-Bold")
     .text("LegentPro Negotiation Audit", { align: "left" });
  doc.moveDown(0.2);
  doc.fillColor(C.muted).fontSize(9).font("Helvetica")
     .text(`Negotiation ID: ${safe(audit.negotiationId)}    •    Generated: ${fmtDate(new Date().toISOString())}`);
  doc.moveDown(0.3);
  doc.strokeColor(C.rule).lineWidth(0.5)
     .moveTo(doc.page.margins.left, doc.y)
     .lineTo(doc.page.width - doc.page.margins.right, doc.y)
     .stroke();
  doc.moveDown(0.5);
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > doc.page.height - 150) doc.addPage();
  doc.moveDown(0.4);
  doc.fillColor(C.accent).fontSize(12).font("Helvetica-Bold").text(title);
  doc.strokeColor(C.accent).lineWidth(0.5)
     .moveTo(doc.page.margins.left, doc.y + 2)
     .lineTo(doc.page.margins.left + 60, doc.y + 2)
     .stroke();
  doc.moveDown(0.4);
  doc.fillColor(C.ink).fontSize(10).font("Helvetica");
}

function drawKV(doc: PDFKit.PDFDocument, k: string, v: string, valueColor: string = C.ink) {
  const startX = doc.page.margins.left;
  const labelWidth = 160;
  const valueX = startX + labelWidth;
  const valueWidth = doc.page.width - doc.page.margins.right - valueX;
  const y = doc.y;
  doc.fillColor(C.muted).fontSize(9).font("Helvetica").text(k, startX, y, { width: labelWidth });
  doc.fillColor(valueColor).fontSize(10).font("Helvetica").text(v, valueX, y, { width: valueWidth });
  doc.moveDown(0.25);
}

// 1. Cover ----------------------------------------------------------------
function drawCover(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "1. Deal Summary");

  const neg = audit.negotiation ?? {};
  const self = audit.parties?.self ?? {};
  const cp   = audit.parties?.counterparty ?? {};

  drawKV(doc, "Outcome",        audit.outcome === "success" ? "DEAL CLOSED" : "ESCALATED",
                                  audit.outcome === "success" ? C.good : C.warn);
  drawKV(doc, "Final price",    fmtCurrency(neg.finalPrice, audit.outcomeQuality?.currency));
  drawKV(doc, "Quantity",       neg.quantity !== undefined ? `${neg.quantity.toLocaleString()} units` : "—");
  drawKV(doc, "Total value",    neg.finalPrice && neg.quantity ? fmtCurrency(neg.finalPrice * neg.quantity, audit.outcomeQuality?.currency) : "—");
  drawKV(doc, "Delivery date",  safe(neg.deliveryDate));
  drawKV(doc, "Payment terms",  safe(neg.paymentTerms));
  drawKV(doc, "Rounds used",    `${safe(neg.roundsUsed)} of ${safe(neg.maxRounds)}`);
  drawKV(doc, "Started at",     fmtDate(audit.startedAt));
  drawKV(doc, "Completed at",   fmtDate(audit.generatedAt));

  doc.moveDown(0.4);
  doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique").text("Buyer party (this audit's perspective):");
  doc.fillColor(C.ink).fontSize(10).font("Helvetica");
  drawKV(doc, "Legal entity",  safe(self.legalEntityName));
  drawKV(doc, "LEI",           safe(self.lei));
  drawKV(doc, "Role",          safe(self.role));

  doc.moveDown(0.3);
  doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique").text("Counterparty:");
  doc.fillColor(C.ink).fontSize(10).font("Helvetica");
  drawKV(doc, "Legal entity",  safe(cp.legalEntityName));
  drawKV(doc, "LEI",           safe(cp.lei));
  drawKV(doc, "Role",          safe(cp.role));
}

// 2. Outcome Quality ------------------------------------------------------
function drawOutcomeQuality(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "2. Outcome Quality");

  const oq = audit.outcomeQuality;
  if (!oq) {
    doc.fillColor(C.muted).fontSize(10).font("Helvetica-Oblique")
       .text("Outcome-quality block not present in this audit (older deal, pre-iteration-3).");
    doc.moveDown(0.4);
    return;
  }

  doc.fillColor(C.ink).fontSize(10).font("Helvetica").text(safe(oq.summary, ""), { width: 500 });
  doc.moveDown(0.4);

  drawKV(doc, "Closed price",        fmtCurrency(oq.closedPrice, oq.currency));
  drawKV(doc, "Buyer max budget",    fmtCurrency(oq.buyerMax, oq.currency));
  drawKV(doc, "Seller margin floor", fmtCurrency(oq.sellerMin, oq.currency));
  drawKV(doc, "ZOPA width",          fmtCurrency(oq.ZOPA?.width, oq.currency));
  drawKV(doc, "ZOPA feasible",       oq.ZOPA?.wasFeasible ? "Yes" : "No",
                                       oq.ZOPA?.wasFeasible ? C.good : C.bad);
  drawKV(doc, "NBS fair price",      fmtCurrency(oq.NBS?.fairPrice, oq.currency));
  drawKV(doc, "Δ from NBS",          fmtCurrency(oq.NBS?.deviationFromNBS, oq.currency));
  drawKV(doc, "Buyer IR",            fmtCurrency(oq.IR?.buyerIR, oq.currency));
  drawKV(doc, "Seller IR",           fmtCurrency(oq.IR?.sellerIR, oq.currency));
  drawKV(doc, "Both parties IR",     oq.IR?.bothIR ? "Yes" : "No",
                                       oq.IR?.bothIR ? C.good : C.bad);
  drawKV(doc, "Buyer surplus share", fmtPct(oq.surplusSplit?.buyerShare));
  drawKV(doc, "Seller surplus share",fmtPct(oq.surplusSplit?.sellerShare));
  drawKV(doc, "Total surplus",       fmtCurrency(oq.surplusSplit?.totalSurplus, oq.currency));

  const flags = oq.flags ?? {};
  const active = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k);
  drawKV(doc, "Quality flags raised", active.length ? active.join(", ") : "None",
                                        active.length ? C.warn : C.good);
}

// 3. Decision Trail -------------------------------------------------------
function drawDecisionTrail(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "3. Decision Trail (per round)");

  const decisions: any[] = Array.isArray(audit.decisions) ? audit.decisions : [];
  if (!decisions.length) {
    doc.fillColor(C.muted).fontSize(10).font("Helvetica-Oblique")
       .text("No decision trail recorded (pre-iteration-4 deal).");
    doc.moveDown(0.4);
    return;
  }

  for (const d of decisions) {
    if (doc.y > doc.page.height - 200) doc.addPage();
    doc.fillColor(C.band)
       .rect(doc.page.margins.left, doc.y, doc.page.width - doc.page.margins.left - doc.page.margins.right, 16)
       .fill();
    doc.fillColor(C.ink).fontSize(10).font("Helvetica-Bold")
       .text(`Round ${safe(d.round)} — ${safe(d.perspective)} — ${fmtDate(d.timestamp)}`,
             doc.page.margins.left + 6, doc.y - 13);
    doc.moveDown(0.4);
    doc.fillColor(C.ink).fontSize(9).font("Helvetica");

    if (d.incomingOffer !== undefined) drawKV(doc, "Incoming offer", fmtCurrency(d.incomingOffer));

    if (d.llmProposal) {
      drawKV(doc, "LLM action",     safe(d.llmProposal.action));
      drawKV(doc, "LLM price",      d.llmProposal.price !== undefined ? fmtCurrency(d.llmProposal.price) : "—");
      doc.fillColor(C.muted).fontSize(9).font("Helvetica").text("LLM reasoning:");
      doc.fillColor(C.ink).fontSize(9).font("Helvetica-Oblique")
         .text(safe(d.llmProposal.reasoning), { width: 480, indent: 10 });
      doc.moveDown(0.2);
      if (d.llmProposal.usedFallback) {
        doc.fillColor(C.warn).fontSize(9).font("Helvetica-Bold")
           .text("⚠ Used rule-based fallback (LLM unavailable for this round)", { indent: 10 });
        doc.moveDown(0.2);
      }
    }

    if (d.constraintAdjustment) {
      drawKV(doc, "Constraint adj.", `${safe(d.constraintAdjustment.action)} @ ${fmtCurrency(d.constraintAdjustment.price)}`);
      doc.fillColor(C.muted).fontSize(9).font("Helvetica").text("Reason:");
      doc.fillColor(C.ink).fontSize(9).font("Helvetica-Oblique")
         .text(safe(d.constraintAdjustment.reasoning), { width: 480, indent: 10 });
      doc.moveDown(0.2);
    }

    if (d.treasuryOverride) {
      drawKV(doc, "Treasury approved", d.treasuryOverride.approved ? "Yes" : "No",
                                         d.treasuryOverride.approved ? C.good : C.bad);
      if (d.treasuryOverride.minViablePrice !== undefined)
        drawKV(doc, "Min viable price", fmtCurrency(d.treasuryOverride.minViablePrice));
      if (d.treasuryOverride.npvOfDeal !== undefined)
        drawKV(doc, "Deal NPV", fmtCurrency(d.treasuryOverride.npvOfDeal));
      if (d.treasuryOverride.netProfit !== undefined)
        drawKV(doc, "Net profit (adj.)", fmtCurrency(d.treasuryOverride.netProfit));
      if (Array.isArray(d.treasuryOverride.failReasons) && d.treasuryOverride.failReasons.length)
        drawKV(doc, "Fail reasons", d.treasuryOverride.failReasons.join("; "), C.bad);
    }

    if (d.finalDecision) {
      drawKV(doc, "Final decision",
             `${safe(d.finalDecision.action)} @ ${d.finalDecision.price !== undefined ? fmtCurrency(d.finalDecision.price) : "—"}`,
             C.accent);
    }
    doc.moveDown(0.4);
  }
}

// 4. Market Context -------------------------------------------------------
function drawMarketContext(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "4. Market Context (live per-round)");

  const decisions: any[] = Array.isArray(audit.decisions) ? audit.decisions : [];
  const withMarket = decisions.filter(d => d.marketContext);
  if (!withMarket.length) {
    doc.fillColor(C.muted).fontSize(10).font("Helvetica-Oblique")
       .text("No per-round market snapshots recorded (pre-iteration-4 deal).");
    doc.moveDown(0.4);
    return;
  }
  for (const d of withMarket) {
    const m = d.marketContext;
    drawKV(doc, `Round ${d.round} SOFR`, `${(m.sofrRate * 100).toFixed(3)}% (source: ${safe(m.sofrSource)})`);
    if (m.effectiveBorrowingRate !== undefined)
      drawKV(doc, `Round ${d.round} eff. rate`, `${(m.effectiveBorrowingRate * 100).toFixed(3)}%`);
    if (m.cottonPricePerLb !== undefined)
      drawKV(doc, `Round ${d.round} cotton`, `$${m.cottonPricePerLb.toFixed(4)}/lb`);
    drawKV(doc, `Round ${d.round} captured`, fmtDate(m.capturedAt));
    doc.moveDown(0.15);
  }
}

// 5. GLEIF / vLEI Chain ---------------------------------------------------
function drawIdentity(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "5. Identity Provenance");

  const mode = audit.identity?.credentialMode ?? "plain";
  drawKV(doc, "Credential mode", mode, mode === "vlei" ? C.good : C.muted);
  if (mode === "plain") {
    doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique")
       .text("CREDENTIAL_MODE=plain — GLEIF identity fields verified against agent card; KERI/vLEI delegation chain NOT cryptographically verified.", { width: 480 });
    doc.moveDown(0.3);
  } else {
    doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique")
       .text("CREDENTIAL_MODE=vlei — KERI/vLEI delegation chain verified via api-server (DEEP-EXT).", { width: 480 });
    doc.moveDown(0.3);
  }

  const self = audit.parties?.self ?? {};
  const cp   = audit.parties?.counterparty ?? {};
  drawKV(doc, "Self LEI",         safe(self.lei));
  drawKV(doc, "Self entity",      safe(self.legalEntityName));
  drawKV(doc, "Counterparty LEI", safe(cp.lei));
  drawKV(doc, "Counterparty entity", safe(cp.legalEntityName));
}

// 6. Envelope hashes ------------------------------------------------------
function drawEnvelopes(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "6. Wire Signing");

  // No envelope log persisted in current audit JSON shape (iter 2 logs to
  // stdout); record what we DO know about signing mode honestly.
  const signingMode = audit.signingMode ?? audit.identity?.signingMode ?? "plain (assumed)";
  drawKV(doc, "Signing mode", String(signingMode));
  doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique")
     .text(signingMode === "vlei"
       ? "Per-message KERI Ed25519 signing (iter 14)."
       : "Per-message sha256 HASH envelope with monotonic counter + freshness window. NOT a KERI seal — provides tamper-evidence + replay protection only.",
       { width: 480 });
  doc.moveDown(0.3);
}

// 7. Footer ---------------------------------------------------------------
function drawFooter(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "7. Document Provenance");
  drawKV(doc, "Source audit file", `${safe(audit.negotiationId)}_${audit.outcome === "success" ? "success" : "escalation"}_BUYER.audit.json`);
  drawKV(doc, "PDF generated at",  fmtDate(new Date().toISOString()));
  drawKV(doc, "Generator",         "LegentPro audit-pdf.ts (iteration 7)");
  doc.moveDown(0.3);
  doc.fillColor(C.muted).fontSize(8).font("Helvetica-Oblique")
     .text("This PDF is a faithful rendering of the audit JSON written by the buyer agent at deal close. It is summary-of-record, not a cryptographically counter-signed document. Hash counters, GLEIF identities, and decision logs reproduce values stored in the source audit JSON; any tampering must be verified against that source.",
       { width: 500 });
}

// 8. External Notifications (iter 15) -------------------------------------
//
// Lists every WhatsApp / SMS / email / dashboard notification the router
// shipped during this negotiation, with provider-assigned message IDs.
// Each row is the auditable proof that party X was notified of event Y
// at time Z via channel C in mode M (test-number vs production vs BSP).
function drawExternalNotifications(doc: PDFKit.PDFDocument, audit: AnyRecord) {
  drawSectionTitle(doc, "8. External Notifications");

  const receipts: any[] = Array.isArray(audit.notifications) ? audit.notifications : [];
  const summary = audit.notificationsSummary;

  if (!receipts.length) {
    doc.fillColor(C.muted).fontSize(10).font("Helvetica-Oblique")
       .text("No external notifications recorded for this negotiation. (May indicate pre-iter-15 deal, or notifications were disabled in config.)",
             { width: 500 });
    doc.moveDown(0.4);
    return;
  }

  // Summary line
  if (summary) {
    doc.fillColor(C.ink).fontSize(10).font("Helvetica");
    drawKV(doc, "Total receipts",   String(summary.total ?? receipts.length));
    drawKV(doc, "Delivered",        String(summary.delivered ?? 0), summary.delivered ? C.good : C.muted);
    drawKV(doc, "Failed",           String(summary.failed ?? 0),    summary.failed    ? C.bad  : C.muted);
    drawKV(doc, "Skipped",          String(summary.skipped ?? 0));
    if (summary.byChannelKind) {
      const kinds = Object.entries(summary.byChannelKind)
        .map(([k, v]) => `${k}: ${v}`).join(", ");
      drawKV(doc, "By channel kind", kinds);
    }
    doc.moveDown(0.3);
  }

  // Per-receipt detail. Group visually by channel kind so the page reads
  // "all WhatsApp deliveries, then all UI broadcasts, then anything else."
  const byKind: Record<string, any[]> = {};
  for (const r of receipts) {
    const k = String(r.channelKind ?? "unknown");
    (byKind[k] ??= []).push(r);
  }

  const kindOrder = ["whatsapp", "sms", "email", "ui-dashboard", "unknown"];
  const orderedKinds = [
    ...kindOrder.filter(k => byKind[k]),
    ...Object.keys(byKind).filter(k => !kindOrder.includes(k)),
  ];

  for (const kind of orderedKinds) {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.2);
    doc.fillColor(C.muted).fontSize(9).font("Helvetica-Oblique")
       .text(`Channel kind: ${kind} (${byKind[kind].length})`);
    doc.moveDown(0.1);

    for (const r of byKind[kind]) {
      if (doc.y > doc.page.height - 110) doc.addPage();

      // Banded row header
      doc.fillColor(C.band)
         .rect(doc.page.margins.left,
               doc.y,
               doc.page.width - doc.page.margins.left - doc.page.margins.right,
               14)
         .fill();
      const headerText =
        `${safe(r.eventType)} → ${safe(r.recipientRole)}` +
        (r.channelMode && r.channelMode !== "n/a" ? ` [mode: ${r.channelMode}]` : "");
      doc.fillColor(C.ink).fontSize(9).font("Helvetica-Bold")
         .text(headerText, doc.page.margins.left + 6, doc.y - 11);
      doc.moveDown(0.35);

      doc.fillColor(C.ink).fontSize(9).font("Helvetica");
      drawKV(doc, "Channel ID",     safe(r.channelId));
      drawKV(doc, "Sent at",        fmtDate(r.sentAt));
      drawKV(doc, "Send mode",      safe(r.mode));
      if (r.templateName)        drawKV(doc, "Template used", String(r.templateName));
      if (r.providerMessageId)   drawKV(doc, "Provider msg ID", String(r.providerMessageId));
      if (r.recipientAddress) {
        const addr = Object.entries(r.recipientAddress)
          .map(([k, v]) => `${k}=${redactPhone(String(v))}`)
          .join(", ");
        drawKV(doc, "Recipient", addr);
      }
      if (r.cost) drawKV(doc, "Cost", `${r.cost.amount} ${r.cost.currency}`);
      if (r.error) {
        doc.fillColor(C.muted).fontSize(9).font("Helvetica").text("Error:");
        doc.fillColor(C.bad).fontSize(9).font("Helvetica")
           .text(safe(r.error), { width: 480, indent: 10 });
        doc.moveDown(0.2);
      }
      doc.moveDown(0.15);
    }
  }

  doc.moveDown(0.2);
  doc.fillColor(C.muted).fontSize(8).font("Helvetica-Oblique")
     .text("Honesty note: receipts record what the LegentPro router shipped. " +
           "Channel mode `test-number` indicates a Meta-provided WhatsApp test " +
           "sender (not a production WABA); recipient phone numbers are " +
           "middle-redacted to preserve PII while keeping each delivery uniquely " +
           "identifiable via providerMessageId.",
       { width: 500 });
  doc.moveDown(0.2);
}

/**
 * Middle-redact a phone number so the audit can be shared without leaking
 * the full E.164. Keep country code + last 4 digits.
 *   "+919876543210" → "+91……3210"
 */
function redactPhone(s: string): string {
  if (!s || !s.startsWith("+")) return s;
  if (s.length <= 7) return s;
  // Country code = up to first 3 digits (best-effort; not perfect for all countries)
  const cc = s.slice(0, 3);
  const tail = s.slice(-4);
  return `${cc}…${tail}`;
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Render the audit JSON to a PDF and stream it.
 *
 * @param audit       BUYER-perspective audit JSON
 * @param sellerAudit (optional) SELLER-perspective audit JSON — used if buyer
 *                    side is missing treasury info
 * @param out         writable stream (express res, fs.createWriteStream, ...)
 */
export async function generateAuditPdf(
  audit:       AnyRecord,
  sellerAudit: AnyRecord | null,
  out:         NodeJS.WritableStream,
): Promise<void> {
  const doc = new PDFDocument({
    size:    "A4",
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    info: {
      Title:    `LegentPro Audit — ${audit.negotiationId ?? "unknown"}`,
      Author:   "LegentPro",
      Subject:  "Negotiation audit",
      Keywords: "procurement, audit, GLEIF, vLEI, agent",
    },
  });

  doc.pipe(out);

  // If buyer audit lacks decisions but seller has them, splice them in for
  // the decision-trail section (read-only — does not modify source files).
  if ((!Array.isArray(audit.decisions) || audit.decisions.length === 0) && sellerAudit && Array.isArray(sellerAudit.decisions)) {
    audit = { ...audit, decisions: sellerAudit.decisions };
  }

  drawHeader(doc, audit);
  drawCover(doc, audit);
  drawOutcomeQuality(doc, audit);
  drawDecisionTrail(doc, audit);
  drawMarketContext(doc, audit);
  drawIdentity(doc, audit);
  drawEnvelopes(doc, audit);
  drawFooter(doc, audit);
  drawExternalNotifications(doc, audit);

  doc.end();

  await new Promise<void>((resolve, reject) => {
    out.on("finish", () => resolve());
    out.on("end",    () => resolve());
    out.on("error",  reject);
    doc.on("error",  reject);
  });
}
