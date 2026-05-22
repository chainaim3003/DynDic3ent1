/**
 * AgentTheater — Phase 3c: stage + envelopes + river + IPEX ballet + treasury consult
 * ---------------------------------------------------------------------------
 * Phase 0: route + shell.
 * Phase 1: event log + playhead.
 * Phase 2: static stage.
 * Phase 3a: envelope flights.
 * Phase 3b: VerificationRiver — DrawSVG trust-chain cascade.
 * Phase 3c (current): IpexBallet + TreasuryConsult.
 *   • IpexBallet — on every kind==='invoice' SSE event, fetches
 *     :4000/api/ipex-status and animates two parchment credential packets
 *     (GRANT seller→buyer, then ADMIT buyer→seller 800ms later). Silent
 *     no-op when :4000 isn't reachable (plain mode).
 *   • TreasuryConsult — on '📨 Seller → Treasury' SSE: dims the stage
 *     with an SVG mask spotlight on treasury + an expanding "thinking"
 *     ring. On '🏦 Treasury → Seller': parses APPROVED ✓ / REJECTED ✗
 *     from the response body, flashes the chip, then fades out.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { useEventLog } from '@/hooks/useEventLog';
import { usePlayhead } from '@/hooks/usePlayhead';
import { TheaterStage } from '@/theater/stage/TheaterStage';
import { useVerificationRiver } from '@/theater/stage/useVerificationRiver';
import { useIpexBallet } from '@/theater/stage/useIpexBallet';
import { useTreasuryConsult } from '@/theater/stage/useTreasuryConsult';
import { useVleiStatus } from '@/hooks/useVleiStatus';
import { useNegotiationRounds } from '@/theater/timeline/useNegotiationRounds';
import { usePhaseClassification } from '@/theater/timeline/usePhaseClassification';
import { BottomTimeline } from '@/theater/timeline/BottomTimeline';
import { useSelection } from '@/theater/inspector/useSelection';
import { Inspector } from '@/theater/inspector/Inspector';
// Phase 6 — left rail + DD focal overlay
import { useDDOffer } from '@/theater/dd/useDDOffer';
import { DDFocalOverlay } from '@/theater/dd/DDFocalOverlay';
// Phase 7 starter — deal-close tableau (emerald DD INVOICE — FINAL card)
import { useDealClose } from '@/theater/dd/useDealClose';
import { DealCloseTableau } from '@/theater/dd/DealCloseTableau';
import { LeftRail } from '@/theater/leftrail/LeftRail';
import { ModeBadge } from '@/theater/leftrail/ModeBadge';
import { ScenarioLauncher } from '@/theater/leftrail/ScenarioLauncher';
import { HITLPanel } from '@/theater/leftrail/HITLPanel';
// Phase 7 — TheaterTopBar (cinematic page header with presentation mode toggle)
import { TheaterTopBar } from '@/theater/topbar/TheaterTopBar';
// Phase 8b — keyboard navigation (arrow keys, Home/End, Space, Esc)
import { useTheaterKeyboard } from '@/theater/shared/useTheaterKeyboard';
import { sendToBuyerAgent } from '@/lib/a2aService';

interface AgentTheaterProps {
  simulation: ReturnType<typeof useSimulation>;
}

export function AgentTheater({ simulation }: AgentTheaterProps) {
  const { events, count, clear, push } = useEventLog();
  const playhead = usePlayhead({ total: count });
  const vlei = useVleiStatus({ pushEvent: push, paused: playhead.isFrozen });
  const river = useVerificationRiver({ simulation, events });
  // Phase 3c hooks — IPEX ballet + treasury consult overlay.
  const ipex = useIpexBallet({ events, paused: playhead.isFrozen, pushEvent: push });
  const consult = useTreasuryConsult({ events, paused: playhead.isFrozen });
  // Phase 4b hooks — pure-derivation round inference (twice: live + view).
  // Live snapshot drives the phase side-effect push so the log gains 'phase'
  // boundary markers as new SSE arrives, even while the user is scrubbing.
  // View snapshot drives the BottomTimeline display — rounds/status/final-price
  // roll back with the scrubber.
  const liveNeg = useNegotiationRounds({ events, paused: false });
  const viewNeg = useNegotiationRounds({ events, paused: false, viewEnd: playhead.index });
  const phaseInfo = usePhaseClassification({
    events,
    liveRounds:  liveNeg.rounds,
    liveStatus:  liveNeg.status,
    viewRounds:  viewNeg.rounds,
    viewStatus:  viewNeg.status,
    viewEnd:     playhead.index,
    pushEvent:   push,
  });
  // Phase 5 — selection state for the right-rail Inspector.
  const selection = useSelection();
  const selectedAgentId = selection.selection.kind === 'agent' ? selection.selection.agentId : null;
  // Phase 6 — DD-pending detection + per-offer overlay dismissal tracking.
  // dismissedDDId is the eventId of the offer the user has chosen to dismiss
  // the overlay for. The overlay stays hidden for THAT offer, but resurfaces
  // for any subsequent new DD offer (different eventId). The HITLPanel in
  // the left rail is unaffected by dismissal — it stays visible until the
  // offer is actually accepted, rejected, or settled.
  const dd = useDDOffer(events);
  const [dismissedDDId, setDismissedDDId] = useState<string | null>(null);
  const showOverlay = dd.pending && dismissedDDId !== dd.eventId;

  // Phase 7 starter — deal-close tableau detection. Hook is pure; the
  // DealCloseTableau component owns the 5s minimum-visible timer.
  const dealClose = useDealClose(events);

  // Single error-handler shared by all three buyer-agent dispatches. Pushes
  // a synthetic SSE event into the log so failures are visible in the
  // timeline / Inspector rather than swallowed.
  const pushAgentError = useCallback((origin: string, err: string) => {
    push({
      kind: 'sse',
      payload: {
        channel: 'buyer',
        text: `⚠️ ${origin} failed: ${err}`,
        from: 'BUYER',
        kind: 'info',
        seq: -1,
        rawTimestamp: new Date().toISOString(),
      },
    });
  }, [push]);

  const handleRunScenario = useCallback((scenarioId: string) => {
    sendToBuyerAgent(
      `start negotiation --scenario ${scenarioId}`,
      (e) => pushAgentError('Run scenario', e),
      () => { /* fire-and-forget; messages arrive via SSE */ },
    );
  }, [pushAgentError]);

  const handleAcceptDD = useCallback(() => {
    sendToBuyerAgent(
      'dd accept',
      (e) => pushAgentError('DD accept', e),
      () => {},
    );
  }, [pushAgentError]);

  const handleRejectDD = useCallback(() => {
    sendToBuyerAgent(
      'dd reject',
      (e) => pushAgentError('DD reject', e),
      () => {},
    );
  }, [pushAgentError]);

  const handleDismissOverlay = useCallback(() => {
    if (dd.eventId) setDismissedDDId(dd.eventId);
  }, [dd.eventId]);

  // Phase 8b — keyboard nav. Hook is no-op while focus is on inputs/buttons
  // or while a non-Shift modifier is held, so it doesn't fight the browser.
  useTheaterKeyboard({
    playheadIndex:  playhead.index,
    isLive:         playhead.isLive,
    totalEvents:    count,
    seek:           playhead.seek,
    pause:          playhead.pause,
    play:           playhead.play,
    resumeLive:     playhead.resumeLive,
    hasSelection:   selection.selection.kind !== 'none',
    clearSelection: selection.selectNone,
  });

  // Phase 7 — presentation (cinema) mode. Hides Debug accordion + Build
  // progress chrome. Persisted across reloads via theater_* localStorage.
  // Re-enterable via the TopBar 'Cinema' button OR the Debug button below.
  const [presentationMode, setPresentationMode] = useState<boolean>(() => {
    try { return localStorage.getItem('theater_presentation_mode') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('theater_presentation_mode', presentationMode ? '1' : '0'); }
    catch { /* ignore quota / privacy-mode errors */ }
  }, [presentationMode]);

  const [debugOpen, setDebugOpen] = useState(false);
  const current = playhead.index >= 0 && playhead.index < events.length
    ? events[playhead.index]
    : undefined;

  return (
    <div className="min-h-[calc(100vh-4rem)] w-full bg-background text-foreground">
      <div className="container mx-auto px-6 py-8 max-w-[1400px]">
        <TheaterTopBar
          livePhase={phaseInfo.livePhase}
          status={viewNeg.status}
          finalPrice={viewNeg.finalPrice}
          roundCount={viewNeg.rounds.length}
          isLive={playhead.isLive}
          playheadIndex={playhead.index}
          onResumeLive={playhead.resumeLive}
          onReplayAll={() => { clear(); playhead.resumeLive(); }}
          presentationMode={presentationMode}
          onTogglePresentationMode={() => setPresentationMode(p => !p)}
        />

        {/* Phase 6: three-column layout on ≥1280px — LeftRail (controls + HITL),
            stage+timeline center, Inspector right rail. On smaller breakpoints
            everything stacks single-column; `order-*` classes put the stage
            first so the controls don't push it below the fold on tablet. */}
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_320px] gap-4">
          <div className="order-2 xl:order-1 xl:sticky xl:top-4 xl:self-start">
            <LeftRail>
              <ModeBadge />
              <ScenarioLauncher onRun={handleRunScenario} />
              <HITLPanel
                pending={dd.pending}
                offer={dd.offer}
                onAccept={handleAcceptDD}
                onReject={handleRejectDD}
              />
            </LeftRail>
          </div>

          <div className="order-1 xl:order-2 min-w-0 space-y-4">
            <TheaterStage
              simulation={simulation}
              events={events}
              paused={playhead.isFrozen}
              riverPlayToken={river.playToken}
              vlei={vlei}
              ballets={ipex.ballets}
              onBalletComplete={ipex.completeBallet}
              consult={{ active: consult.active, outcome: consult.outcome }}
              actusFlashToken={consult.actusFlashToken}
              selectedAgentId={selectedAgentId}
              onAgentClick={selection.toggleAgent}
              onClearSelection={selection.selectNone}
            />

            {/* Phase 4b: temporal view — rounds/status/phase reflect the SCRUBBED
                moment (viewNeg), not the live state. */}
            <BottomTimeline
              events={events}
              rounds={viewNeg.rounds}
              status={viewNeg.status}
              finalPrice={viewNeg.finalPrice}
              totalValue={viewNeg.totalValue}
              phase={phaseInfo.phase}
              playheadIndex={playhead.index}
              playheadIsLive={playhead.isLive}
              onSeek={playhead.seek}
              onResumeLive={playhead.resumeLive}
              onSelectMessage={selection.selectMessage}
              onSelectRound={(roundNum) => {
                selection.selectRound(roundNum);
                // Also seek to the round's originating event for visual context.
                const r = viewNeg.rounds.find(x => x.round === roundNum);
                const eventId = r?.buyerEventId ?? r?.sellerEventId;
                if (eventId) {
                  const idx = events.findIndex(e => e.id === eventId);
                  if (idx >= 0) playhead.seek(idx);
                }
              }}
            />
          </div>

          <aside className="order-3 xl:order-3 xl:sticky xl:top-4 xl:self-start">
            <Inspector
              selection={selection.selection}
              events={events}
              rounds={viewNeg.rounds}
              vlei={vlei}
              onSeek={playhead.seek}
              onSelectMessage={selection.selectMessage}
              onClose={selection.selectNone}
            />
          </aside>
        </div>

        {!presentationMode && (<>
        <div className="mt-6 rounded-lg border border-border bg-card/30">
          <button
            type="button"
            onClick={() => setDebugOpen(o => !o)}
            className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-expanded={debugOpen}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono">{debugOpen ? '▼' : '▶'}</span>
              Debug · SSE event log + manual triggers
              <span className="opacity-60">({count} events)</span>
            </span>
            <span className="opacity-60">
              {playhead.isLive ? 'live' : `paused @ index ${playhead.index}`}
            </span>
          </button>

          {debugOpen && (
            <div className="border-t border-border p-4 space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <DebugStat label="Event log" value={count.toString()} />
                <DebugStat label="View rounds" value={`${viewNeg.rounds.length} (${viewNeg.status})`} />
                <DebugStat label="View phase" value={phaseInfo.phase} />
                <DebugStat label="Live phase" value={phaseInfo.livePhase} />
              </div>

              <div className="rounded border border-border bg-background/50 p-3">
                <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
                  Current event
                </div>
                {current ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-muted-foreground">{current.id}</span>
                      <span className="rounded bg-muted px-1 py-0.5">{current.kind}</span>
                      {current.kind === 'sse' && (
                        <span className="rounded bg-muted px-1 py-0.5">
                          {current.payload.channel} → {current.payload.kind}
                        </span>
                      )}
                    </div>
                    <pre className="text-[10px] whitespace-pre-wrap break-words font-mono text-foreground/70 max-h-24 overflow-auto">
                      {current.kind === 'sse'
                        ? current.payload.text
                        : JSON.stringify(current.payload, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="text-[10px] text-muted-foreground italic">
                    No events yet. Run a scenario in /agents (another tab).
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <DebugBtn onClick={playhead.isLive ? playhead.pause : playhead.play}>
                  {playhead.isLive ? 'Pause' : 'Resume live'}
                </DebugBtn>
                <DebugBtn
                  onClick={() => playhead.seek(Math.max(0, playhead.index - 1))}
                  disabled={count === 0}
                >
                  ← Prev
                </DebugBtn>
                <DebugBtn
                  onClick={() => playhead.seek(Math.min(count - 1, playhead.index + 1))}
                  disabled={count === 0 || playhead.index >= count - 1}
                >
                  Next →
                </DebugBtn>
                <DebugBtn onClick={clear} disabled={count === 0}>
                  Clear log
                </DebugBtn>
                {/* Phase 3b manual trigger */}
                <DebugBtn onClick={river.replay}>
                  ▶ Replay river
                </DebugBtn>
                {/* Phase 3c manual triggers — inject synthetic SSE events that
                    flow through the real useIpexBallet / useTreasuryConsult
                    pipelines. IPEX trigger will fetch :4000/api/ipex-status;
                    silent no-op if vLEI api-server isn't running. */}
                <DebugBtn onClick={() => push({
                  kind: 'sse',
                  payload: {
                    channel: 'seller',
                    text: '📄 INVOICE GENERATED (debug trigger)',
                    from: 'SELLER',
                    kind: 'invoice',
                    seq: -1,
                    rawTimestamp: new Date().toISOString(),
                  },
                })}>
                  ▶ Test invoice + IPEX
                </DebugBtn>
                <DebugBtn onClick={() => {
                  push({
                    kind: 'sse',
                    payload: {
                      channel: 'treasury',
                      text: '📨 Seller → Treasury\nRequest: approval for escalation',
                      from: 'TREASURY',
                      kind: 'info',
                      seq: -1,
                      rawTimestamp: new Date().toISOString(),
                    },
                  });
                  window.setTimeout(() => push({
                    kind: 'sse',
                    payload: {
                      channel: 'treasury',
                      text: '🏦 Treasury → Seller\nDecision: APPROVED ✓',
                      from: 'TREASURY',
                      kind: 'info',
                      seq: -1,
                      rawTimestamp: new Date().toISOString(),
                    },
                  }), 3000);
                }}>
                  ▶ Test consult (approve)
                </DebugBtn>
                <DebugBtn onClick={() => {
                  push({
                    kind: 'sse',
                    payload: {
                      channel: 'treasury',
                      text: '📨 Seller → Treasury\nRequest: approval for over-limit deal',
                      from: 'TREASURY',
                      kind: 'info',
                      seq: -1,
                      rawTimestamp: new Date().toISOString(),
                    },
                  });
                  window.setTimeout(() => push({
                    kind: 'sse',
                    payload: {
                      channel: 'treasury',
                      text: '🏦 Treasury → Seller\nDecision: REJECTED ✗ — exceeds policy',
                      from: 'TREASURY',
                      kind: 'info',
                      seq: -1,
                      rawTimestamp: new Date().toISOString(),
                    },
                  }), 3000);
                }}>
                  ▶ Test consult (reject)
                </DebugBtn>
                <DebugBtn onClick={() => push({
                  kind: 'sse',
                  payload: {
                    channel: 'treasury',
                    text: '🏦 Treasury → Seller\nACTUS DD Cashflow Invoice : INV-DEBUG\nSettlement ✓ SUCCESS',
                    from: 'TREASURY',
                    kind: 'info',
                    seq: -1,
                    rawTimestamp: new Date().toISOString(),
                  },
                })}>
                  ▶ Test ACTUS notification
                </DebugBtn>
                {/* Phase 6 manual trigger — synthesizes a DD offer SSE so the
                    overlay + HITL panel light up. Uses parseDDOffer-compatible
                    text format (matches what the real seller agent emits). */}
                <DebugBtn onClick={() => push({
                  kind: 'sse',
                  payload: {
                    channel: 'seller',
                    text: [
                      '💰 Dynamic Discount Offer',
                      'Invoice : INV-DEBUG-001',
                      'Invoice date : 2025-01-15',
                      'Due date : 2025-02-14',
                      'Full amount : ₹1,250,000',
                      'Max DD rate : 4.50%',
                      'Pay by 2025-01-20 (25 days early)',
                      '@ 3.75% → ₹1,203,125 (save ₹46,875)',
                    ].join('\n'),
                    from: 'SELLER',
                    kind: 'dd',
                    seq: -1,
                    rawTimestamp: new Date().toISOString(),
                  },
                })}>
                  ▶ Test DD offer (overlay + HITL)
                </DebugBtn>
                {/* Phase 7 starter — synthesizes a DD-discounted invoice SSE.
                    Same text format the seller agent emits at end of pipeline.
                    Triggers the emerald DD INVOICE — FINAL tableau with 5s lockout. */}
                <DebugBtn onClick={() => push({
                  kind: 'sse',
                  payload: {
                    channel: 'seller',
                    text: [
                      '✅ DD Invoice',
                      'Original    : ₹1,250,000',
                      '3.75% off',
                      'Discounted  : ₹1,203,125',
                      'Saving      : ₹46,875',
                      'Settle by   : 2025-01-20',
                      'ACTUS       : Settlement ✓ SUCCESS',
                    ].join('\n'),
                    from: 'SELLER',
                    kind: 'invoice',
                    seq: -1,
                    rawTimestamp: new Date().toISOString(),
                  },
                })}>
                  ▶ Test DD INVOICE FINAL (5s tableau)
                </DebugBtn>
                {/* Phase 7 — toggle presentation mode from inside the debug
                    panel. Note: clicking this hides the entire debug
                    accordion. Re-enter via the TopBar 'Cinema' button. */}
                <DebugBtn onClick={() => setPresentationMode(p => !p)}>
                  ▶ Toggle presentation mode
                </DebugBtn>
              </div>

              <div className="rounded border border-border bg-background/50 max-h-48 overflow-auto">
                {events.length === 0 ? (
                  <div className="px-3 py-4 text-[10px] text-muted-foreground italic text-center">
                    waiting for events…
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {[...events].reverse().slice(0, 20).map(ev => (
                      <li key={ev.id} className="px-3 py-1.5 text-[10px] font-mono flex items-baseline gap-2">
                        <span className="text-muted-foreground tabular-nums">
                          {new Date(ev.ts).toLocaleTimeString()}
                        </span>
                        <span className="rounded bg-muted px-1 shrink-0">{ev.kind}</span>
                        <span className="truncate text-foreground/70">
                          {ev.kind === 'sse'
                            ? `${ev.payload.channel}: ${ev.payload.text.slice(0, 80)}`
                            : JSON.stringify(ev.payload).slice(0, 80)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <details className="mt-6 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground transition-colors">
            Build progress
          </summary>
          <ul className="mt-2 space-y-1 pl-6 list-disc">
            <li>Phase 0: ✅ route + shell + package install</li>
            <li>Phase 1: ✅ shared types, constants, useEventLog, usePlayhead</li>
            <li>Phase 2: ✅ TheaterStage static — agents on stage, SSE wired</li>
            <li>Phase 3a: ✅ EnvelopeLayer + GSAP MotionPath flights</li>
            <li>Phase 3b: ✅ VerificationRiver — DrawSVG cascade</li>
            <li>Phase 3c: ✅ IpexBallet + TreasuryConsult + TreasuryActusBadge (end-of-deal CASHFLOW pill)</li>
            <li>Phase 4a: ✅ BottomTimeline — phase strip, round chips (Iter-4.3 inference), draggable scrubber</li>
            <li>Phase 4b: ✅ Snapshot replay — rounds/status/phase derive from scrub position</li>
            <li>Phase 5: ✅ Right-rail Inspector — agent / message / round variants with motion/react AnimatePresence</li>
            <li>Phase 6: ✅ LeftRail (ModeBadge + ScenarioLauncher + HITLPanel) + DDFocalOverlay</li>
            <li>Phase 7: ✅ DealCloseTableau + TheaterTopBar + nav entry + presentation mode</li>
            <li><strong>Phase 8 (current):</strong> ✅ prefers-reduced-motion (8a) · ✅ keyboard nav (8b) · responsive (8c) · soak (8d)</li>
          </ul>
        </details>
        </>)}
      </div>

      {/* Phase 6: DD focal overlay — fixed-positioned, sits outside the main
          container's max-width constraint. Visible only when a DD offer is
          pending AND the user hasn't dismissed THIS specific offer. */}
      <DDFocalOverlay
        show={showOverlay}
        offer={dd.offer}
        onAccept={handleAcceptDD}
        onReject={handleRejectDD}
        onDismiss={handleDismissOverlay}
      />

      {/* Phase 7 starter: emerald DD INVOICE — FINAL tableau. Shows for at
          least 5 seconds when a DD-discounted invoice SSE arrives. Close
          button becomes available after the lockout window. */}
      <DealCloseTableau
        eventId={dealClose.eventId}
        ts={dealClose.ts}
        parsed={dealClose.parsed}
      />
    </div>
  );
}

function DebugStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-background/50 px-2.5 py-1.5">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

function DebugBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-2.5 py-1 text-[10px] font-medium rounded border border-border hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

export default AgentTheater;
