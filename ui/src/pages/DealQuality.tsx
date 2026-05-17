import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { DealQualityCard } from "@/components/DealQualityCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchRecentDeals,
  fetchQuality,
  type DealSummary,
} from "@/lib/dealQualityApi";
import { MessageSquare, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * DealQuality page — list of recent negotiations + DealQualityCard for selection.
 *
 * Read-only. To START a negotiation, use the existing chat interface on the
 * /agents page; this page just visualizes the audit JSON the buyer agent
 * writes after a deal closes or escalates.
 *
 * Auto-refreshes the deal list every 5 seconds via react-query so a deal
 * triggered in /agents (or via the CLI) appears here automatically.
 */
export function DealQuality() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const dealsQuery = useQuery({
    queryKey: ["recent-deals"],
    queryFn:  fetchRecentDeals,
    refetchInterval: 5_000,
  });

  // Auto-select the newest deal when the list first loads.
  useEffect(() => {
    if (selectedId === null && dealsQuery.data && dealsQuery.data.length > 0) {
      setSelectedId(dealsQuery.data[0].negotiationId);
    }
  }, [dealsQuery.data, selectedId]);

  const auditQuery = useQuery({
    queryKey: ["quality", selectedId],
    queryFn:  () => fetchQuality(selectedId!),
    enabled:  !!selectedId,
  });

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────── */}
      <div className="glass-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lg">Deal Quality</h2>
            <p className="text-sm text-muted-foreground">
              Economic-fairness metrics for every negotiation closed by the buyer agent.
              To start a new negotiation, use the chat interface on the Agents page.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/agents")}
              className="gap-1.5"
            >
              <MessageSquare size={14} />
              Open chat
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => dealsQuery.refetch()}
              disabled={dealsQuery.isFetching}
              title="Refresh"
            >
              <RefreshCw size={14} className={cn(dealsQuery.isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* ── Deal list ─────────────────────────────────── */}
        <aside className="glass-card p-0 overflow-hidden h-fit max-h-[80vh] overflow-y-auto">
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent negotiations
            </h3>
          </div>

          {dealsQuery.isError && (
            <div className="p-4 text-sm text-rose-400">
              Buyer agent unreachable. Is it running on :9090?
            </div>
          )}

          {dealsQuery.data && dealsQuery.data.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No completed negotiations yet.<br />
              Open the <button className="text-primary underline" onClick={() => navigate("/agents")}>chat</button> and type <code className="font-mono text-xs">start negotiation</code>.
            </div>
          )}

          {dealsQuery.data?.map((d) => (
            <DealRow
              key={d.negotiationId}
              deal={d}
              active={d.negotiationId === selectedId}
              onClick={() => setSelectedId(d.negotiationId)}
            />
          ))}
        </aside>

        {/* ── Selected deal card ────────────────────────── */}
        <main>
          {!selectedId && (
            <div className="glass-card p-10 text-center text-sm text-muted-foreground">
              Select a deal on the left to see its outcome-quality breakdown.
            </div>
          )}
          {selectedId && auditQuery.isLoading && (
            <div className="glass-card p-10 text-center text-sm text-muted-foreground">
              Loading audit JSON…
            </div>
          )}
          {selectedId && auditQuery.isError && (
            <div className="glass-card p-6 text-sm text-rose-400">
              Could not load audit for {selectedId}:<br />
              {(auditQuery.error as any)?.message ?? "Unknown error"}
            </div>
          )}
          {selectedId && auditQuery.data && (
            <DealQualityCard audit={auditQuery.data} />
          )}
        </main>
      </div>
    </div>
  );
}

// ── Row in the left-hand list ─────────────────────────────────────────

function DealRow({
  deal, active, onClick,
}: { deal: DealSummary; active: boolean; onClick: () => void }) {
  const outcomePill =
    deal.outcome === "success"     ? "bg-emerald-500/10 text-emerald-400"
  : deal.outcome === "escalation"  ? "bg-amber-500/10 text-amber-400"
  :                                  "bg-muted text-muted-foreground";
  const Icon = deal.outcome === "success" ? CheckCircle2 : AlertCircle;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-4 py-3 border-b border-border transition-colors",
        active ? "bg-primary/10 border-l-2 border-l-primary"
               : "hover:bg-muted/30 border-l-2 border-l-transparent",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground truncate">
          {deal.negotiationId}
        </span>
        <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded", outcomePill)}>
          <Icon size={10} />
          {deal.outcome}
        </span>
      </div>
      <div className="font-semibold text-sm mt-1">
        {deal.finalPrice !== undefined ? `₹${deal.finalPrice}/unit` : "—"}
        {deal.quantity !== undefined && (
          <span className="text-muted-foreground font-normal ml-1.5">· {deal.quantity.toLocaleString()} units</span>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
        {deal.counterparty ?? "—"}
        {deal.closedAt && <> · {new Date(deal.closedAt).toLocaleString()}</>}
      </div>
    </button>
  );
}
