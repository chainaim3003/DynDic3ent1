import { useQuery } from "@tanstack/react-query";
import { fetchTierStatus, type TierStatus, type NegotiationTier } from "@/lib/dealQualityApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Layers, CheckCircle2, Clock } from "lucide-react";

/**
 * TierFrameworkCard — WEDGE1 / M1 surface.
 *
 * Renders the resolved negotiation tier, capability matrix, provider modes,
 * and evaluation context — sourced from GET /api/tier-status on the buyer
 * agent (port 9090). Mirrors the ModeMatrixCard pattern (read-only,
 * env-sourced, mutating tier requires editing .env and restarting agents).
 *
 * Why this is read-only at runtime: the tier governs which sub-agents and
 * which provider modes are active, and every saved audit JSON records the
 * tier under which the deal closed. Flipping tier mid-session would produce
 * ambiguous audits, which defeats the point of the framework.
 *
 * The post-WEDGE1 tiers (ADVANCED3, ADVANCED4) are listed but visually grayed
 * to make the v1.0 ceiling explicit.
 */
export function TierFrameworkCard() {
  const q = useQuery({
    queryKey: ["tier-status"],
    queryFn:  fetchTierStatus,
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers size={14} /> Negotiation tier framework
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers size={14} /> Negotiation tier framework
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-destructive">
          Could not reach /api/tier-status. Is the buyer agent running on :9090?
        </CardContent>
      </Card>
    );
  }

  const t: TierStatus = q.data;

  // Tier rows in display order. Shippable (WEDGE1) on top; post-WEDGE1 below
  // and grayed. The active tier gets a ring highlight.
  const tierOrder: NegotiationTier[] = [
    "BASIC1", "ADVANCED1", "ADVANCED2",
    "ADVANCED3", "ADVANCED4",
  ];
  const isShippable = (tier: NegotiationTier) =>
    tier === "BASIC1" || tier === "ADVANCED1" || tier === "ADVANCED2";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers size={14} /> Negotiation tier framework
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Active: {t.tier}
            {t.resolvedFromEnv.NEGOTIATION_MODE === null ? "  (default)" : ""}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Tier rows ──────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          {tierOrder.map((tier) => {
            const shippable = isShippable(tier);
            const active    = t.tier === tier;
            const desc      = t.tierDescriptions[tier] ?? "";
            const baseClasses = "border rounded p-2 text-xs flex items-start gap-2";
            const stateClasses = !shippable
              ? "border-dashed opacity-60 bg-muted/20"
              : active
                ? "ring-2 ring-primary border-green-600/40 bg-green-50/30"
                : "border-green-600/30 bg-green-50/10";
            return (
              <div key={tier} className={`${baseClasses} ${stateClasses}`}>
                <div className="pt-0.5">
                  {shippable
                    ? <CheckCircle2 size={12} className="text-green-700" />
                    : <Clock        size={12} className="text-amber-700" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium">{tier}</span>
                    {active && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0">ACTIVE</Badge>
                    )}
                    {!shippable && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        post-WEDGE1
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Provider modes (per-sub-agent: real | demo) ──────────────── */}
        <div className="border-t pt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Provider modes
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(["inventory", "logistics", "credit"] as const).map((k) => {
              const mode = t.providerModes[k];
              const real = mode === "real";
              return (
                <div key={k} className="border rounded p-2 space-y-1">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{k}</div>
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${real ? "bg-green-600" : "bg-amber-500"}`} />
                    <span className="font-mono text-[11px]">{mode}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Evaluation context ────────────────────────────────────────── */}
        <div className="border-t pt-3 flex items-center justify-between text-xs">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Evaluation context
          </span>
          <Badge variant="outline" className="text-[11px] font-mono">
            {t.evaluationContext}
            {t.resolvedFromEnv.EVALUATION_CONTEXT === null ? "  (default)" : ""}
          </Badge>
        </div>

        {/* ── How to change it ──────────────────────────────────────────── */}
        <p className="text-[10px] text-muted-foreground border-t pt-2 leading-relaxed">
          {t.changeInstructions} The active tier is recorded in every saved
          audit JSON under <code>negotiationMode</code>.
        </p>
      </CardContent>
    </Card>
  );
}
