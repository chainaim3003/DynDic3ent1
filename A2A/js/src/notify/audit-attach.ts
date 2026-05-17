// ============================================================================
// src/notify/audit-attach.ts  —  Iteration 15: attach delivery receipts to audit
// ============================================================================
//
// After the agent calls logger.saveAuditJson(), the audit JSON is on disk.
// This helper reads it back, appends `notifications[]` from the drained
// router receipts, and writes it back. Idempotent: safe to call multiple
// times (it concatenates new receipts, deduplicating by providerMessageId).
//
// Why a post-write attach instead of weaving receipts into the audit-writer?
//   - Keeps the existing audit-writer untouched (less merge risk).
//   - Receipts are drained from the router AT the moment the audit is closed,
//     which is exactly the right semantic point.
//   - Honest: if the WhatsApp send is still in flight when audit is written,
//     the receipt may include `error: "pending"` — but we never lie about
//     what actually shipped.
//
// ============================================================================

import fs from "fs";
import { getNotifier } from "./router.js";
import type { DeliveryReceipt } from "./types.js";

export interface AttachOptions {
  /** Set to false to keep receipts in the router after attach (default: drain). */
  drain?: boolean;
}

/**
 * Attach notification delivery receipts to an audit JSON file in-place.
 *
 * Safe to call even if:
 *   - the audit file doesn't exist yet (no-op, logs a warning)
 *   - the router has no receipts for this negotiation (writes an empty array)
 *   - the audit file is malformed (logs and aborts WITHOUT corrupting the file)
 */
export function attachNotificationsToAudit(
  auditFilePath: string,
  negotiationId: string,
  opts: AttachOptions = {},
): DeliveryReceipt[] {
  const drain = opts.drain !== false;

  if (!fs.existsSync(auditFilePath)) {
    console.warn(`[notify/audit-attach] audit file not found: ${auditFilePath} — skipping attach`);
    return [];
  }

  let receipts: DeliveryReceipt[] = [];
  try {
    receipts = drain
      ? getNotifier().drainReceiptsFor(negotiationId)
      : getNotifier().getReceiptsFor(negotiationId);
  } catch (e: any) {
    console.warn(`[notify/audit-attach] could not read receipts: ${e?.message ?? e}`);
    return [];
  }

  let audit: any;
  try {
    audit = JSON.parse(fs.readFileSync(auditFilePath, "utf8"));
  } catch (e: any) {
    console.warn(`[notify/audit-attach] audit JSON unparseable, leaving untouched: ${e?.message ?? e}`);
    return receipts;
  }

  // Merge with any existing notifications (deduplicate by providerMessageId).
  const existing: DeliveryReceipt[] = Array.isArray(audit.notifications) ? audit.notifications : [];
  const seen = new Set(existing.map(r => r.providerMessageId).filter(Boolean));
  const merged = [...existing];
  for (const r of receipts) {
    if (r.providerMessageId && seen.has(r.providerMessageId)) continue;
    merged.push(r);
    if (r.providerMessageId) seen.add(r.providerMessageId);
  }

  audit.notifications = merged;
  // Add a small summary for easy PDF/UI consumption
  audit.notificationsSummary = summarize(merged);

  try {
    fs.writeFileSync(auditFilePath, JSON.stringify(audit, null, 2), "utf8");
  } catch (e: any) {
    console.warn(`[notify/audit-attach] could not write audit: ${e?.message ?? e}`);
  }

  return receipts;
}

function summarize(rs: DeliveryReceipt[]) {
  let delivered = 0, failed = 0, skipped = 0;
  const byChannelKind: Record<string, number> = {};
  for (const r of rs) {
    if (r.error)             failed++;
    else if (r.mode === "skipped") skipped++;
    else                     delivered++;
    byChannelKind[r.channelKind] = (byChannelKind[r.channelKind] ?? 0) + 1;
  }
  return { total: rs.length, delivered, failed, skipped, byChannelKind };
}
