import { useQuery } from "@tanstack/react-query";
import { fetchModeMatrix, type ModeMatrix } from "@/lib/dealQualityApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, Clock } from "lucide-react";

/**
 * ModeMatrixCard — Iteration 6 UI surface.
 *
 * Shows the 2×2 trust-posture matrix (Credential × Signing) with the cell
 * currently active highlighted. The matrix is sourced from the buyer agent's
 * env vars at startup; to change it, edit .env and restart the agent.
 *
 * Mode is intentionally NOT user-toggleable at runtime — the audit trail
 * embeds the mode into every audit JSON, so flipping mid-session would
 * produce ambiguous artifacts. This is by design, called out in the `note`
 * field returned from the API.
 */
export function ModeMatrixCard() {
  const q = useQuery({
    queryKey: ["mode-matrix"],
    queryFn:  fetchModeMatrix,
    refetchInterval: 30_000,
  });

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield size={14} /> Trust posture</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (q.isError || !q.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield size={14} /> Trust posture</CardTitle></CardHeader>
        <CardContent className="text-xs text-destructive">Could not reach /api/mode-matrix. Is the buyer agent running on :9090?</CardContent>
      </Card>
    );
  }

  const m: ModeMatrix = q.data;

  // Lay out as a true 2×2 grid keyed by (credential, signing)
  const cellAt = (credential: "plain" | "vlei", signing: "plain" | "vlei") =>
    m.cells.find(c => c.credential === credential && c.signing === signing);
  const isActive = (credential: "plain" | "vlei", signing: "plain" | "vlei") =>
    m.current.credential === credential && m.current.signing === signing;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield size={14} /> Trust posture (Credential × Signing)
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Active: {m.current.credential} / {m.current.signing}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-[120px_1fr_1fr] gap-1 text-xs">
          <div /> {/* spacer */}
          <ColHeader label="Signing: plain" sub="hash envelope" />
          <ColHeader label="Signing: vlei"  sub="KERI Ed25519" />

          <RowHeader label="Credential" value="plain" sub="GLEIF only" />
          <Cell cell={cellAt("plain", "plain")} active={isActive("plain", "plain")} />
          <Cell cell={cellAt("plain", "vlei")}  active={isActive("plain", "vlei")} />

          <RowHeader label="Credential" value="vlei" sub="KERI delegation" />
          <Cell cell={cellAt("vlei", "plain")} active={isActive("vlei", "plain")} />
          <Cell cell={cellAt("vlei", "vlei")}  active={isActive("vlei", "vlei")} />
        </div>
        <p className="text-[10px] text-muted-foreground border-t pt-2">{m.note}</p>
      </CardContent>
    </Card>
  );
}

function ColHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="text-center font-medium">
      <div>{label}</div>
      <div className="text-[10px] font-normal text-muted-foreground">{sub}</div>
    </div>
  );
}

function RowHeader({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="font-medium">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{value}</div>
      <div className="text-[10px] font-normal text-muted-foreground">{sub}</div>
    </div>
  );
}

function Cell({ cell, active }: { cell: ReturnType<ModeMatrix["cells"]["find"]>; active: boolean }) {
  if (!cell) return <div className="border border-dashed rounded p-2 text-muted-foreground text-xs">—</div>;
  const supportedColor = cell.supported ? "border-green-600/40 bg-green-50/30" : "border-amber-500/40 bg-amber-50/30";
  const activeRing = active ? "ring-2 ring-primary" : "";
  return (
    <div className={`border rounded p-2 space-y-1 ${supportedColor} ${activeRing}`}>
      <div className="flex items-center gap-1.5">
        {cell.supported
          ? <CheckCircle2 size={12} className="text-green-700" />
          : <Clock        size={12} className="text-amber-700" />}
        <span className="text-xs font-medium">{cell.supported ? "Supported" : "Deferred"}</span>
        {active && <Badge variant="default" className="text-[10px] px-1.5 py-0">ACTIVE</Badge>}
      </div>
      <div className="text-[11px] leading-tight">{cell.label}</div>
      <div className="text-[9px] font-mono text-muted-foreground break-all">{cell.envHint}</div>
    </div>
  );
}
