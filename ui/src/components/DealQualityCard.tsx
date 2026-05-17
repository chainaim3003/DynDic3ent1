import type { AuditDoc, DecisionTrailEntry, ConstraintDisclosureRecord } from "@/lib/dealQualityApi";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, AlertCircle, TrendingUp, TrendingDown, Scale, ChevronRight, Brain, Shield } from "lucide-react";
import { useState } from "react";

interface Props {
  audit: AuditDoc;
  className?: string;
}

/**
 * DealQualityCard — economic-fairness visualization for a closed/escalated deal.
 *
 * Renders:
 *   - Plain-English one-line summary
 *   - ZOPA bar with sellerMin → buyerMax, NBS midpoint marker, closed-price marker
 *   - Surplus split bar (buyer share / seller share)
 *   - Flag chips (IR satisfied, agreement trap, outside ZOPA, etc.)
 *   - Metric tiles (closed price, NBS, deltas, ZOPA width)
 *   - Decision trail panel (iteration 4 — collapsible)
 *   - Counterparty identity tiles with LEIs
 *   - Disclosed bounds footer (iteration 4)
 *
 * Styling uses the existing UI's glass-card + Tailwind tokens (no new CSS).
 */
export function DealQualityCard({ audit, className }: Props) {
  const q = audit.outcomeQuality;
  const sym = q?.currency === "USD" ? "$" : "₹";

  if (!q) {
    return (
      <div className={cn("glass-card p-6", className)}>
        <p className="text-sm text-muted-foreground">
          No outcome-quality block recorded for {audit.negotiationId}.
        </p>
      </div>
    );
  }

  // Visible price range for the ZOPA bar — extends slightly outside ZOPA when
  // closed price or NBS happens to fall outside (rare; only on escalations).
  const minVisible = Math.min(q.sellerMin, q.closedPrice, q.NBS.fairPrice);
  const maxVisible = Math.max(q.buyerMax,  q.closedPrice, q.NBS.fairPrice);
  const span       = Math.max(1, maxVisible - minVisible);
  const pct = (v: number) => `${((v - minVisible) / span) * 100}%`;

  const buyerSharePct  = Math.round(q.surplusSplit.buyerShare  * 100);
  const sellerSharePct = Math.round(q.surplusSplit.sellerShare * 100);

  const outcomeLabel = audit.outcome === "success" ? "Deal closed" : "Negotiation escalated";
  const outcomeColor = audit.outcome === "success" ? "text-emerald-400" : "text-amber-400";

  return (
    <div className={cn("glass-card p-6 space-y-5", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn("font-semibold text-base", outcomeColor)}>{outcomeLabel}</span>
            <span className="text-xs text-muted-foreground">
              · {audit.negotiation.roundsUsed}/{audit.negotiation.maxRounds} rounds
            </span>
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{audit.negotiationId}</p>
        </div>
        <div className="text-right">
          <p className="font-mono font-bold text-2xl">{sym}{q.closedPrice}</p>
          <p className="text-xs text-muted-foreground">per unit</p>
        </div>
      </div>

      {/* Summary */}
      <div className="p-3 rounded-lg bg-primary/5 border-l-2 border-primary text-sm leading-relaxed">
        {q.summary}
      </div>

      {/* ZOPA bar */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Bargaining zone (ZOPA)
        </h4>
        <div className="grid grid-cols-[60px_1fr_60px] gap-3 items-center">
          <div className="text-xs font-mono text-muted-foreground">
            <div className="text-[10px] uppercase">seller</div>
            <div>{sym}{q.sellerMin}</div>
          </div>

          <div className="relative h-12">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-3 rounded-full bg-muted/40 overflow-hidden">
              {q.ZOPA.wasFeasible && (
                <div
                  className="absolute top-0 bottom-0 bg-gradient-to-r from-purple-500/40 to-blue-500/40"
                  style={{ left: pct(q.sellerMin), right: `calc(100% - ${pct(q.buyerMax)})` }}
                />
              )}
            </div>
            {/* NBS marker (dashed, below) */}
            <div className="absolute top-0 bottom-0 w-px border-l border-dashed border-amber-400"
                 style={{ left: pct(q.NBS.fairPrice) }}>
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-mono text-amber-400 whitespace-nowrap">
                NBS {sym}{q.NBS.fairPrice.toFixed(0)}
              </span>
            </div>
            {/* Closed price marker (solid, above) */}
            <div className="absolute top-0 bottom-0 w-0.5 bg-primary"
                 style={{ left: pct(q.closedPrice), transform: "translateX(-1px)" }}>
              <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] font-mono text-primary font-semibold whitespace-nowrap">
                {sym}{q.closedPrice}
              </span>
            </div>
          </div>

          <div className="text-xs font-mono text-muted-foreground text-right">
            <div className="text-[10px] uppercase">buyer</div>
            <div>{sym}{q.buyerMax}</div>
          </div>
        </div>
      </div>

      {/* Surplus split */}
      {q.ZOPA.wasFeasible && q.ZOPA.width > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Surplus split
          </h4>
          <div className="h-7 flex rounded-md overflow-hidden bg-muted/30">
            <div
              className="flex items-center justify-center bg-blue-500/80 text-white text-xs font-semibold transition-all"
              style={{ width: `${buyerSharePct}%` }}
            >
              {buyerSharePct >= 8 ? `${buyerSharePct}%` : ""}
            </div>
            <div
              className="flex items-center justify-center bg-purple-500/80 text-white text-xs font-semibold transition-all"
              style={{ width: `${sellerSharePct}%` }}
            >
              {sellerSharePct >= 8 ? `${sellerSharePct}%` : ""}
            </div>
          </div>
          <div className="flex justify-between mt-1.5 text-[11px] font-mono text-muted-foreground">
            <span>buyer captured {sym}{q.IR.buyerIR}/unit</span>
            {q.surplusSplit.totalSurplus !== undefined && (
              <span>total surplus {sym}{q.surplusSplit.totalSurplus.toLocaleString()}</span>
            )}
            <span>seller captured {sym}{q.IR.sellerIR}/unit</span>
          </div>
        </div>
      )}

      {/* Flags */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Outcome flags
        </h4>
        <div className="flex flex-wrap gap-1.5">
          <Chip kind={q.IR.bothIR ? "good" : "bad"} icon={q.IR.bothIR ? CheckCircle2 : AlertCircle}>
            {q.IR.bothIR ? "both rational (IR satisfied)" : "one side below reservation"}
          </Chip>
          <Chip kind={q.ZOPA.wasFeasible ? "good" : "bad"} icon={q.ZOPA.wasFeasible ? CheckCircle2 : AlertCircle}>
            {q.ZOPA.wasFeasible ? `ZOPA feasible (${sym}${q.ZOPA.width} wide)` : "no ZOPA – deal infeasible"}
          </Chip>
          {q.flags.agreementTrap && (
            <Chip kind="warn" icon={AlertTriangle}>agreement trap (seller within 2% of floor)</Chip>
          )}
          {q.flags.outsideZOPA && (
            <Chip kind="bad" icon={AlertTriangle}>closed outside ZOPA</Chip>
          )}
          {q.flags.buyerCapturedMost && (
            <Chip kind="dim" icon={TrendingDown}>buyer captured most</Chip>
          )}
          {q.flags.sellerCapturedMost && (
            <Chip kind="dim" icon={TrendingUp}>seller captured most</Chip>
          )}
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Metric label="Closed price"   value={`${sym}${q.closedPrice}`} />
        <Metric label="NBS fair price" value={`${sym}${q.NBS.fairPrice.toFixed(0)}`} />
        <Metric
          label="Δ vs NBS"
          value={`${q.NBS.deviationFromNBS >= 0 ? "+" : ""}${sym}${q.NBS.deviationFromNBS.toFixed(0)}`}
          highlight={q.NBS.deviationFromNBS < 0 ? "good" : q.NBS.deviationFromNBS > 0 ? "warn" : undefined}
        />
        <Metric label="Buyer IR"  value={`${sym}${q.IR.buyerIR}`}  highlight={q.IR.buyerIR  >= 0 ? "good" : "bad"} />
        <Metric label="Seller IR" value={`${sym}${q.IR.sellerIR}`} highlight={q.IR.sellerIR >= 0 ? "good" : "bad"} />
        <Metric label="ZOPA width" value={`${sym}${q.ZOPA.width}`} highlight={q.ZOPA.wasFeasible ? "good" : "bad"} />
      </div>

      {/* Decision Trail (iteration 4) */}
      {audit.decisions && audit.decisions.length > 0 && (
        <DecisionTrailPanel decisions={audit.decisions} sym={sym} />
      )}

      {/* Parties + identity + disclosed bounds */}
      <div className="pt-3 border-t border-border">
        <div className="grid grid-cols-2 gap-2">
          <Party
            role={audit.parties.self.role}
            name={audit.parties.self.legalEntityName ?? "—"}
            lei={audit.parties.self.lei ?? "—"}
          />
          <Party
            role={audit.parties.counterparty.role}
            name={audit.parties.counterparty.legalEntityName ?? "—"}
            lei={audit.parties.counterparty.lei ?? "—"}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
          <Scale size={11} />
          Identity mode: <span className="font-semibold">{audit.identity.credentialMode.toUpperCase()}</span>
          {audit.identity.credentialMode === "plain"
            ? " — GLEIF + agent card only, no KERI/vLEI delegation chain verification"
            : " — KERI delegation chain cryptographically verified"}
        </p>

        {/* Disclosed bounds footer (iteration 4) */}
        {audit.constraintDisclosure && (
          <DisclosedBoundsFooter
            disclosure={audit.constraintDisclosure}
            perspective={audit.perspective}
            sym={sym}
          />
        )}
      </div>
    </div>
  );
}

// ── Iteration 4: Decision Trail panel ────────────────────────────────────
function DecisionTrailPanel({ decisions, sym }: { decisions: DecisionTrailEntry[]; sym: string }) {
  const [open, setOpen] = useState(false);

  // Sort by round, then by perspective (BUYER before SELLER within a round for
  // stable display when both sides' audits are merged in future iterations).
  const sorted = [...decisions].sort((a, b) =>
    a.round - b.round || (a.perspective === "BUYER" ? -1 : 1)
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain size={12} />
        Decision trail
        <span className="text-[10px] font-normal normal-case text-muted-foreground/70">
          ({sorted.length} {sorted.length === 1 ? "entry" : "entries"})
        </span>
        <ChevronRight
          size={12}
          className={cn("transition-transform", open && "rotate-90")}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {sorted.map((d, i) => (
            <DecisionEntry key={i} entry={d} sym={sym} />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionEntry({ entry, sym }: { entry: DecisionTrailEntry; sym: string }) {
  const perspectiveColor = entry.perspective === "BUYER"
    ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
    : "bg-purple-500/10 text-purple-400 border-purple-500/30";

  const actionColor = (action: string) =>
    action === "ACCEPT" ? "text-emerald-400"
    : action === "REJECT" ? "text-rose-400"
    : "text-amber-400";

  const overrideApplied = entry.treasuryOverride && !entry.treasuryOverride.approved;

  return (
    <div className="bg-muted/20 border border-border rounded-md p-3 space-y-2 text-xs">
      {/* Header row — round, perspective, final action */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">R{entry.round}</span>
          <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border", perspectiveColor)}>
            {entry.perspective}
          </span>
          <span className={cn("font-semibold", actionColor(entry.finalDecision.action))}>
            {entry.finalDecision.action}
            {entry.finalDecision.price !== undefined && (
              <span className="ml-1 font-mono">{sym}{entry.finalDecision.price}</span>
            )}
          </span>
          {entry.incomingOffer !== undefined && (
            <span className="text-[10px] text-muted-foreground">
              (vs {sym}{entry.incomingOffer} from counterparty)
            </span>
          )}
        </div>
        {entry.marketContext && (
          <span
            className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded border border-border"
            title={`SOFR source: ${entry.marketContext.sofrSource}\nEffective borrow rate: ${(entry.marketContext.effectiveBorrowingRate * 100).toFixed(2)}%`}
          >
            SOFR {(entry.marketContext.sofrRate * 100).toFixed(2)}%
          </span>
        )}
      </div>

      {/* LLM proposal */}
      <div className="pl-2 border-l-2 border-border">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
          LLM proposed{entry.llmProposal.usedFallback ? " (rule-based fallback)" : ""}
        </div>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className={cn("font-semibold", actionColor(entry.llmProposal.action))}>
            {entry.llmProposal.action}
          </span>
          {entry.llmProposal.price !== undefined && (
            <span className="font-mono">{sym}{entry.llmProposal.price}</span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 line-clamp-2" title={entry.llmProposal.reasoning}>
          {entry.llmProposal.reasoning}
        </p>
      </div>

      {/* Constraint adjustment (only when validator changed something) */}
      {entry.constraintAdjustment && (
        <div className="pl-2 border-l-2 border-amber-500/40">
          <div className="text-[10px] uppercase tracking-wide text-amber-400/80">
            Constraint validator adjusted
          </div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className={cn("font-semibold", actionColor(entry.constraintAdjustment.action))}>
              {entry.constraintAdjustment.action}
            </span>
            {entry.constraintAdjustment.price !== undefined && (
              <span className="font-mono">{sym}{entry.constraintAdjustment.price}</span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 line-clamp-2" title={entry.constraintAdjustment.reasoning}>
            {entry.constraintAdjustment.reasoning}
          </p>
        </div>
      )}

      {/* Treasury override (seller-side only) */}
      {entry.treasuryOverride && (
        <div className={cn(
          "pl-2 border-l-2",
          overrideApplied ? "border-rose-500/40" : "border-emerald-500/40"
        )}>
          <div className="text-[10px] uppercase tracking-wide flex items-center gap-1">
            <Shield size={10} className={overrideApplied ? "text-rose-400" : "text-emerald-400"} />
            <span className={overrideApplied ? "text-rose-400/80" : "text-emerald-400/80"}>
              Treasury {overrideApplied ? "override applied" : "approved"}
            </span>
          </div>
          {overrideApplied && entry.treasuryOverride.minViablePrice !== undefined && (
            <p className="text-muted-foreground mt-1">
              ACTUS minimum viable price: <span className="font-mono">{sym}{entry.treasuryOverride.minViablePrice}</span>
              {entry.treasuryOverride.failReasons && entry.treasuryOverride.failReasons.length > 0 && (
                <span className="block text-[10px] mt-0.5">
                  {entry.treasuryOverride.failReasons.join("; ")}
                </span>
              )}
            </p>
          )}
          {entry.treasuryOverride.approved && (
            <p className="text-muted-foreground mt-1 text-[10px]">
              NPV ok · cash position ok · deal profitable ok
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Iteration 4: Disclosed bounds footer ─────────────────────────────────
function DisclosedBoundsFooter({
  disclosure, perspective, sym,
}: { disclosure: ConstraintDisclosureRecord; perspective: "BUYER" | "SELLER"; sym: string }) {
  // From the audit-owner's perspective, label what is self vs counterparty.
  // BUYER perspective: selfReservationPrice = buyerMax; counterparty = sellerMin
  // SELLER perspective: selfReservationPrice = sellerMin; counterparty = buyerMax
  const selfLabel  = perspective === "BUYER" ? "Buyer maxBudget (self)" : "Seller marginPrice (self)";
  const otherLabel = perspective === "BUYER" ? "Seller marginPrice"     : "Buyer maxBudget";

  const otherValue =
    disclosure.disclosedByCounterparty?.value
    ?? disclosure.fallbackUsed?.value;
  const otherSource =
    disclosure.disclosedByCounterparty
      ? `disclosed in ${disclosure.disclosedByCounterparty.source.replace("disclosed-in-", "")}`
      : disclosure.fallbackUsed
        ? `demo fallback — ${disclosure.fallbackUsed.reason}`
        : "—";
  const otherSourceColor = disclosure.disclosedByCounterparty
    ? "text-emerald-400"
    : "text-amber-400";

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-border">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
        Disclosed reservation prices (audit only)
      </p>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="bg-muted/20 border border-border rounded-md p-2">
          <div className="text-[10px] text-muted-foreground">{selfLabel}</div>
          <div className="font-mono font-semibold mt-0.5">{sym}{disclosure.selfReservationPrice.value}</div>
          <div className="text-[10px] text-emerald-400 mt-0.5">own-config (always known)</div>
        </div>
        <div className="bg-muted/20 border border-border rounded-md p-2">
          <div className="text-[10px] text-muted-foreground">{otherLabel}</div>
          <div className="font-mono font-semibold mt-0.5">
            {otherValue !== undefined ? `${sym}${otherValue}` : "—"}
          </div>
          <div className={cn("text-[10px] mt-0.5", otherSourceColor)}>{otherSource}</div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

type ChipKind = "good" | "warn" | "bad" | "dim";

function Chip({
  kind, icon: Icon, children,
}: { kind: ChipKind; icon: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  const classes: Record<ChipKind, string> = {
    good: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    warn: "bg-amber-500/10  text-amber-400  border-amber-500/20",
    bad:  "bg-rose-500/10   text-rose-400   border-rose-500/20",
    dim:  "bg-muted/40      text-muted-foreground border-border",
  };
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full border",
      classes[kind],
    )}>
      <Icon size={11} />
      {children}
    </span>
  );
}

function Metric({
  label, value, highlight,
}: { label: string; value: string; highlight?: "good" | "warn" | "bad" }) {
  const color = highlight === "good" ? "text-emerald-400"
              : highlight === "warn" ? "text-amber-400"
              : highlight === "bad"  ? "text-rose-400"
              : "";
  return (
    <div className="bg-muted/30 border border-border rounded-md p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-mono font-semibold text-sm mt-0.5", color)}>{value}</div>
    </div>
  );
}

function Party({ role, name, lei }: { role: string; name: string; lei: string }) {
  return (
    <div className="bg-muted/30 border border-border rounded-md p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{role}</div>
      <div className="font-semibold text-sm mt-0.5 truncate">{name}</div>
      <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">LEI {lei}</div>
    </div>
  );
}
