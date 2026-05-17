import { useQuery } from "@tanstack/react-query";
import { fetchBaseline, type BaselineMetrics } from "@/lib/dealQualityApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * BaselinePanel — Iteration 5 UI surface.
 *
 * Calls GET /api/baseline (served by buyer-agent on :9090). The endpoint
 * returns either the JSON written by `npm run replay:fixtures` or a 404
 * with a hint. We render both honestly.
 *
 * The script is RE-RUNNABLE — if escalation files are deleted, the next run
 * shrinks the numbers. We show the file mtime so the user knows when the
 * baseline was last refreshed, and a "stale" badge if escalations have been
 * touched since the last replay.
 */
export function BaselinePanel() {
  const q = useQuery({
    queryKey: ["baseline"],
    queryFn:  fetchBaseline,
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database size={14} /> Baseline</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (q.isError) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database size={14} /> Baseline</CardTitle></CardHeader>
        <CardContent className="text-xs text-destructive">Could not reach /api/baseline. Is the buyer agent running on :9090?</CardContent>
      </Card>
    );
  }

  const data = q.data;
  if (data && "notGenerated" in data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database size={14} /> Baseline</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">{data.hint}</p>
          <pre className="text-[10px] bg-muted p-2 rounded select-all">cd A2A/js && npm run replay:fixtures</pre>
          <p className="text-[10px] text-muted-foreground">
            The replay script scans <code>src/escalations/</code> and writes <code>baselines/baseline-latest.json</code>.
            If escalation files are deleted, the next run produces a smaller baseline — numbers always reflect what's on disk.
          </p>
        </CardContent>
      </Card>
    );
  }

  const b = data as BaselineMetrics;
  const fmtPct = (x: number | undefined) => x === undefined ? "—" : `${(x * 100).toFixed(1)}%`;
  const fmtRs  = (x: number | undefined) => x === undefined ? "—" : `₹${x.toFixed(0)}`;
  const gen = new Date(b.generatedAt).toLocaleString();

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Database size={14} /> Baseline (N = {b.totals.uniqueNegotiations})
          </CardTitle>
          {b._meta.stale ? (
            <Badge variant="outline" className="text-xs gap-1">
              <AlertTriangle size={10} /> stale — re-run replay
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 border-green-600 text-green-700">
              <CheckCircle2 size={10} /> fresh
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Metric label="closedPrice samples"    value={b.metrics.sampleCounts.closedPrice} />
          <Metric label="outcomeQuality samples" value={b.metrics.sampleCounts.outcomeQuality} />
          <Metric label="success"  value={b.totals.byOutcome.success}  good />
          <Metric label="escalations" value={b.totals.byOutcome.escalation} warn />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <Metric label="median closed price"     value={fmtRs(b.metrics.medianClosedPrice)} />
          <Metric label="% at-or-below NBS"       value={fmtPct(b.metrics.pctClosedAtOrBelowNBS)} />
          <Metric label="median Δ NBS"            value={fmtRs(b.metrics.medianDeviationFromNBS)} />
          <Metric label="median buyer share"      value={fmtPct(b.metrics.medianBuyerShare)} />
          <Metric label="median seller share"     value={fmtPct(b.metrics.medianSellerShare)} />
          <Metric label="% agreement trap"        value={fmtPct(b.metrics.pctAgreementTrap)} warn />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1 border-t text-[10px] text-muted-foreground">
          <span>Replay generated: {gen}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => q.refetch()}>
            <RefreshCw size={10} className="mr-1" /> refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, good, warn }: { label: string; value: number | string; good?: boolean; warn?: boolean }) {
  return (
    <div className="bg-muted/40 rounded px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${good ? "text-green-700" : ""} ${warn ? "text-amber-700" : ""}`}>
        {value}
      </div>
    </div>
  );
}
