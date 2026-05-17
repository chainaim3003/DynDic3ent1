import type { AuditDoc } from "../api";

interface Props { audit: AuditDoc; }

/**
 * DealQualityCard
 *
 * Visualizes the outcome-quality block from an audit JSON:
 *   - ZOPA bar with sellerMin/buyerMax endpoints, NBS midpoint marker, closed-price marker
 *   - Surplus-split horizontal stacked bar (buyer share / seller share)
 *   - IR + NBS + ZOPA metric tiles
 *   - Flag chips (agreement trap / buyer-captured / seller-captured / outside-ZOPA)
 *   - Identity tiles (counterparty LEI + entity)
 *
 * Renders honest "no metrics" state if outcomeQuality is missing.
 */
export function DealQualityCard({ audit }: Props) {
  const q = audit.outcomeQuality;
  const sym = q?.currency === "USD" ? "$" : "₹";

  if (!q) {
    return (
      <div className="card">
        <div className="card-title">{audit.outcome === "success" ? "Deal closed" : "Negotiation escalated"}</div>
        <div className="card-id">{audit.negotiationId}</div>
        <div className="state">No outcome-quality block recorded for this negotiation.</div>
      </div>
    );
  }

  // Marker positions on the ZOPA bar as percentages.
  // The visible range is the ZOPA itself when feasible; when infeasible we
  // extend a little outside so closedPrice can still be plotted.
  const minVisible = Math.min(q.sellerMin, q.closedPrice, q.NBS.fairPrice);
  const maxVisible = Math.max(q.buyerMax,  q.closedPrice, q.NBS.fairPrice);
  const span       = Math.max(1, maxVisible - minVisible);
  const pct        = (v: number) => `${((v - minVisible) / span) * 100}%`;

  const buyerSharePct  = Math.round(q.surplusSplit.buyerShare * 100);
  const sellerSharePct = Math.round(q.surplusSplit.sellerShare * 100);

  return (
    <div className="card">
      <div className="card-title">
        {audit.outcome === "success" ? "Deal closed" : "Negotiation escalated"}
        {" · "}
        <span style={{ color: "var(--text-dim)" }}>
          {audit.negotiation.roundsUsed}/{audit.negotiation.maxRounds} rounds
        </span>
      </div>
      <div className="card-id">{audit.negotiationId}</div>

      <div className="summary-line">{q.summary}</div>

      {/* ── ZOPA bar ───────────────────────────────────────── */}
      <div className="section">
        <div className="section-title">Bargaining zone (ZOPA)</div>
        <div className="zopa-row">
          <div>seller<br />{sym}{q.sellerMin}</div>
          <div className="zopa-bar-wrap">
            <div className="zopa-bar">
              {q.ZOPA.wasFeasible && (
                <div
                  className="zopa-bar-inner"
                  style={{ left: pct(q.sellerMin), right: `calc(100% - ${pct(q.buyerMax)})` }}
                />
              )}
            </div>
            <div className="zopa-marker nbs" style={{ left: pct(q.NBS.fairPrice) }}>
              <div className="zopa-marker-label">NBS {sym}{q.NBS.fairPrice.toFixed(0)}</div>
            </div>
            <div className="zopa-marker closed" style={{ left: pct(q.closedPrice) }}>
              <div className="zopa-marker-label">{sym}{q.closedPrice}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>buyer<br />{sym}{q.buyerMax}</div>
        </div>
      </div>

      {/* ── Surplus split ──────────────────────────────────── */}
      {q.ZOPA.wasFeasible && q.ZOPA.width > 0 && (
        <div className="section">
          <div className="section-title">Surplus split</div>
          <div className="split-bar">
            <div className="split-segment buyer"  style={{ width: `${buyerSharePct}%`  }}>
              {buyerSharePct  >= 8 ? `${buyerSharePct}%`  : ""}
            </div>
            <div className="split-segment seller" style={{ width: `${sellerSharePct}%` }}>
              {sellerSharePct >= 8 ? `${sellerSharePct}%` : ""}
            </div>
          </div>
          <div className="split-legend">
            <span>buyer captured {sym}{q.IR.buyerIR}/unit</span>
            {q.surplusSplit.totalSurplus !== undefined && (
              <span>total surplus: {sym}{q.surplusSplit.totalSurplus.toLocaleString()}</span>
            )}
            <span>seller captured {sym}{q.IR.sellerIR}/unit</span>
          </div>
        </div>
      )}

      {/* ── Flag chips ─────────────────────────────────────── */}
      <div className="section">
        <div className="section-title">Outcome flags</div>
        <div className="chips">
          <Chip kind={q.IR.bothIR ? "good" : "bad"}>
            {q.IR.bothIR ? "✓ both rational (IR satisfied)" : "✗ one side below reservation"}
          </Chip>
          <Chip kind={q.ZOPA.wasFeasible ? "good" : "bad"}>
            {q.ZOPA.wasFeasible ? `✓ ZOPA feasible (${sym}${q.ZOPA.width} wide)` : "✗ no ZOPA — deal infeasible"}
          </Chip>
          {q.flags.agreementTrap && (
            <Chip kind="warn">⚠ agreement trap (seller within 2% of floor)</Chip>
          )}
          {q.flags.outsideZOPA && (
            <Chip kind="bad">⚠ closed outside ZOPA</Chip>
          )}
          {q.flags.buyerCapturedMost && (
            <Chip kind="dim">buyer captured most of surplus</Chip>
          )}
          {q.flags.sellerCapturedMost && (
            <Chip kind="dim">seller captured most of surplus</Chip>
          )}
        </div>
      </div>

      {/* ── Metric tiles ───────────────────────────────────── */}
      <div className="section">
        <div className="section-title">Numbers</div>
        <div className="metrics">
          <Metric label="Closed price"    value={`${sym}${q.closedPrice}`} />
          <Metric label="NBS fair price"  value={`${sym}${q.NBS.fairPrice.toFixed(0)}`} />
          <Metric label="Δ vs NBS"        value={`${q.NBS.deviationFromNBS >= 0 ? "+" : ""}${sym}${q.NBS.deviationFromNBS.toFixed(0)}`} />
          <Metric label="Buyer IR"        value={`${sym}${q.IR.buyerIR}`} />
          <Metric label="Seller IR"       value={`${sym}${q.IR.sellerIR}`} />
          <Metric label="ZOPA width"      value={`${sym}${q.ZOPA.width}`} />
        </div>
      </div>

      {/* ── Identity ────────────────────────────────────────── */}
      <div className="section">
        <div className="section-title">Counterparties</div>
        <div className="parties">
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
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
          Identity mode: <strong>{audit.identity.credentialMode.toUpperCase()}</strong>
          {audit.identity.credentialMode === "plain"
            ? " — GLEIF + agent card only, no KERI/vLEI delegation chain verification"
            : " — KERI delegation chain cryptographically verified"}
        </div>
      </div>
    </div>
  );
}

// ── Small subcomponents ────────────────────────────────────────────────

function Chip({ kind, children }: { kind: "good" | "warn" | "bad" | "dim"; children: React.ReactNode }) {
  return <span className={`chip ${kind}`}>{children}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function Party({ role, name, lei }: { role: string; name: string; lei: string }) {
  return (
    <div className="party">
      <div className="party-role">{role}</div>
      <div className="party-name">{name}</div>
      <div className="party-lei">LEI {lei}</div>
    </div>
  );
}
