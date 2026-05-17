import { useEffect, useState } from "react";
import { DealQualityCard }   from "./components/DealQualityCard";
import { fetchRecentDeals, fetchQuality, DealSummary, AuditDoc } from "./api";

/**
 * LegentPro Dashboard
 *
 * Two-pane layout:
 *   - Left:  list of recent negotiations (sorted newest first)
 *   - Right: DealQualityCard for the currently-selected negotiation
 *
 * Auto-refreshes the deal list every 10s so a new negotiation completed in
 * another window appears without a manual reload.
 */
export default function App() {
  const [deals,      setDeals]      = useState<DealSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audit,      setAudit]      = useState<AuditDoc | null>(null);
  const [listError,  setListError]  = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);

  // Load deal list on mount and every 10s afterwards.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const d = await fetchRecentDeals();
        if (cancelled) return;
        setDeals(d);
        setListError(null);
        // Auto-select the newest deal if nothing chosen yet.
        if (d.length > 0 && selectedId === null) {
          setSelectedId(d[0].negotiationId);
        }
      } catch (err: any) {
        if (cancelled) return;
        setListError(err?.message ?? "Failed to load deals");
      }
    }

    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the audit for the currently-selected negotiation.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    setAuditError(null);
    fetchQuality(selectedId)
      .then(a => { if (!cancelled) setAudit(a); })
      .catch(err => { if (!cancelled) setAuditError(err?.message ?? "Failed to load audit"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  return (
    <div className="app">
      <div className="header">
        <h1>📊 LegentPro · Deal Quality Dashboard</h1>
        <div className="sub">Buyer-side audit · /api/recent-deals + /api/quality</div>
      </div>

      <div className="layout">
        <aside>
          <div className="deal-list">
            <div className="deal-list-header">Recent negotiations</div>
            {listError && <div className="state error">{listError}</div>}
            {!listError && deals.length === 0 && (
              <div className="state">
                No completed negotiations yet.<br />
                Start one via the CLI to populate this list.
              </div>
            )}
            {deals.map(d => (
              <DealRow
                key={d.negotiationId}
                deal={d}
                active={d.negotiationId === selectedId}
                onClick={() => setSelectedId(d.negotiationId)}
              />
            ))}
          </div>
        </aside>

        <main>
          {!selectedId && (
            <div className="state">Select a deal from the list to see its outcome-quality breakdown.</div>
          )}
          {selectedId && loading && <div className="state">Loading audit JSON…</div>}
          {selectedId && auditError && (
            <div className="state error">
              Could not load audit for {selectedId}:<br />{auditError}
            </div>
          )}
          {selectedId && audit && !loading && !auditError && (
            <DealQualityCard audit={audit} />
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
  return (
    <div
      className={`deal-item${active ? " active" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
    >
      <div className="deal-item-id">{deal.negotiationId}</div>
      <div className="deal-item-headline">
        {deal.finalPrice !== undefined ? `₹${deal.finalPrice}/unit` : "—"}
        {deal.quantity !== undefined && ` · ${deal.quantity.toLocaleString()} units`}
      </div>
      <div className="deal-item-meta">
        <span className={`outcome-pill ${deal.outcome}`}>{deal.outcome}</span>
        {deal.counterparty && <> · {deal.counterparty}</>}
        {deal.closedAt && <> · {new Date(deal.closedAt).toLocaleString()}</>}
      </div>
    </div>
  );
}
