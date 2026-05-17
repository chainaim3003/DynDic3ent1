import type { AuditDoc } from "@/lib/dealQualityApi";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertTriangle, AlertCircle, TrendingUp, TrendingDown, Scale } from "lucide-react";

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
 *   - Counterparty identity tiles with LEIs
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
      {/* ── Header ────────────────────────────────────────── */}
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

      {/* ── Summary ───────────────────────────────────────── */}
      <div className="p-3 rounded-lg bg-primary/5 border-l-2 border-primary text-sm leading-relaxed">
        {q.summary}
      </div>

      {/* ── ZOPA bar ──────────────────────────────────────── */}
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

      {/* ── Surplus split ─────────────────────────────────── */}
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

      {/* ── Flags ─────────────────────────────────────────── */}
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

      {/* ── Metric tiles ──────────────────────────────────── */}
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

      {/* ── Parties + identity ────────────────────────────── */}
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
