import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { DealQualityCard } from "@/components/DealQualityCard";
import { BaselinePanel } from "@/components/BaselinePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  fetchFilteredDeals,
  fetchQuality,
  downloadAuditPdf,
  type DealSummary,
  type DealFilter,
} from "@/lib/dealQualityApi";
import { MessageSquare, RefreshCw, AlertCircle, CheckCircle2, FileDown, Filter, X } from "lucide-react";

/**
 * DealQuality page — list of recent negotiations + DealQualityCard for selection.
 *
 * Read-only. To START a negotiation, use the existing chat interface on the
 * /agents page; this page just visualizes the audit JSON the buyer agent
 * writes after a deal closes or escalates.
 *
 * Auto-refreshes the deal list every 5 seconds via react-query so a deal
 * triggered in /agents (or via the CLI) appears here automatically.
 *
 * Iteration 5 — adds a BaselinePanel above the list showing the latest
 *               replay-fixtures benchmark.
 * Iteration 7 — adds filter bar (counterparty, outcome, date range, limit)
 *               and a "Download Signed Audit (PDF)" button on the selected
 *               deal card.
 */
export function DealQuality() {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DealFilter>({ limit: 50 });
  const [showFilters, setShowFilters] = useState(false);

  const dealsQuery = useQuery({
    queryKey: ["recent-deals", filter],
    queryFn:  () => fetchFilteredDeals(filter),
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
      {/* Header */}
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
              variant={showFilters ? "default" : "outline"}
              onClick={() => setShowFilters(s => !s)}
              className="gap-1.5"
              size="sm"
            >
              <Filter size={14} />
              Filter
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/agents")}
              className="gap-1.5"
              size="sm"
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

        {showFilters && (
          <div className="mt-4 pt-4 border-t grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <FilterField label="Counterparty">
              <Input
                value={filter.counterparty ?? ""}
                onChange={e => setFilter(f => ({ ...f, counterparty: e.target.value || undefined }))}
                placeholder="e.g. Tommy"
                className="h-8 text-sm"
              />
            </FilterField>
            <FilterField label="Outcome">
              <select
                className="h-8 text-sm rounded-md border bg-background px-2 w-full"
                value={filter.outcome ?? ""}
                onChange={e => setFilter(f => ({ ...f, outcome: (e.target.value || undefined) as DealFilter["outcome"] }))}
              >
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="escalation">Escalation</option>
              </select>
            </FilterField>
            <FilterField label="From">
              <Input type="date" value={filter.from ?? ""} className="h-8 text-sm"
                onChange={e => setFilter(f => ({ ...f, from: e.target.value || undefined }))} />
            </FilterField>
            <FilterField label="To">
              <Input type="date" value={filter.to ?? ""} className="h-8 text-sm"
                onChange={e => setFilter(f => ({ ...f, to: e.target.value || undefined }))} />
            </FilterField>
            <FilterField label="Limit">
              <Input type="number" min={1} max={500} value={filter.limit ?? 50} className="h-8 text-sm"
                onChange={e => setFilter(f => ({ ...f, limit: parseInt(e.target.value, 10) || 50 }))} />
            </FilterField>
            <div className="sm:col-span-2 lg:col-span-5 flex justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setFilter({ limit: 50 })}>
                <X size={12} /> Clear filters
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Baseline banner (iter 5) */}
      <BaselinePanel />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Deal list */}
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
              No deals match these filters.<br />
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

        {/* Selected deal card */}
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
            <div className="space-y-3">
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => downloadAuditPdf(selectedId)}
                >
                  <FileDown size={14} />
                  Download Signed Audit (PDF)
                </Button>
              </div>
              <DealQualityCard audit={auditQuery.data} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

// Row in the left-hand list
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
