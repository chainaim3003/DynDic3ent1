/**
 * TheaterStage — the cinematic arena where agents live
 * ---------------------------------------------------------------------------
 * Phase 2:  static layout (backdrop + rings + auras + clickable discs).
 * Phase 3a: EnvelopeLayer (GSAP MotionPath flights).
 * Phase 3b: VerificationRiver (GSAP DrawSVG trust-chain cascade).
 * Phase 3c (current): IpexBallet (parchment GRANT/ADMIT packets) +
 *   TreasuryConsult (SVG-mask spotlight overlay + outcome chip).
 *
 * SVG layer z-order (back to front):
 *   1. StageBackdrop (grid + gradient)
 *   2. VerificationRiver (trust chain, faint trace after first play)
 *   3. per-agent PhaseRing + StateAura
 *   4. TreasuryConsult (dim mask + spotlight + thinking ring + chip)
 *   5. EnvelopeLayer (envelopes draw on top of dim, including seller↔treasury)
 *   6. TreasuryActusBadge (small ACTUS ✓ pill, end-of-deal flash)
 *   7. IpexBallet (parchment packets drawn last, top of stack)
 *
 * HTML overlay (sits over SVG): AvatarDiscs + labels. Envelopes and
 * packets intentionally pass under discs on arrival; the river also
 * passes under discs at endpoints.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { useSimulation } from '@/hooks/useSimulation';
import type { AgentId, LogEvent } from '@/theater/shared/types';
import { IDENTITIES } from '@/theater/shared/identities';
import { StageBackdrop } from './StageBackdrop';
import { StateAura, type AuraState } from './StateAura';
import { PhaseRing } from './PhaseRing';
import { AgentNode } from './AgentNode';
import { EnvelopeLayer } from './EnvelopeLayer';
import { useEnvelopeFlights } from './useEnvelopeFlights';
import { VerificationRiver } from './VerificationRiver';
import { IpexBallet } from './IpexBallet';
import type { BalletInstance } from './useIpexBallet';
import { TreasuryConsult } from './TreasuryConsult';
import type { TreasuryConsultOutcome } from './useTreasuryConsult';
import { TreasuryActusBadge } from './TreasuryActusBadge';
import { BackOfficeRail } from './BackOfficeRail';
// Phase 9c — per-agent character animations for the back-row sub-agents.
import { CreditScoreline } from './CreditScoreline';
import { InventoryStacks } from './InventoryStacks';
import { LogisticsRoute } from './LogisticsRoute';
// Phase 9d — back-office consult overlay (spotlight + thinking ring + chip).
import { BackOfficeConsult } from './BackOfficeConsult';
import type { UseBackOfficeConsultResult } from './useBackOfficeConsult';
// Phase 9g — lift-and-grow wrapper for sub-agents (rest ⇔ active).
import { SubAgentSlot } from './SubAgentSlot';
import { useStageLayout, STAGE_VIEWBOX } from './useStageLayout';
import type { VleiStatus } from '@/hooks/useVleiStatus';

interface TheaterStageProps {
  simulation: ReturnType<typeof useSimulation>;
  events: LogEvent[];
  paused: boolean;
  /** Increments from parent's useVerificationRiver hook to trigger the river. */
  riverPlayToken: number;
  /** Live vLEI api-server status — drives the top-right indicator badge. */
  vlei: VleiStatus;
  /** Phase 3c: active IPEX ballets from useIpexBallet. */
  ballets: BalletInstance[];
  /** Phase 3c: called by IpexBallet when a ballet's GRANT+ADMIT pair finishes. */
  onBalletComplete: (balletId: string) => void;
  /** Phase 3c: treasury consult overlay state from useTreasuryConsult. */
  consult: { active: boolean; outcome: TreasuryConsultOutcome };
  /** Phase 3c addendum: increments on every ACTUS-only treasury message,
   *  driving the small TreasuryActusBadge pop near treasury. */
  actusFlashToken: number;
  /** Phase 9d — back-office consult state per sub-agent
   *  (credit/inventory/logistics). Drives the back-office overlay, the
   *  per-agent dim flip, and the aura state. */
  backOfficeConsult: UseBackOfficeConsultResult;
  /** Phase 5: which agent (if any) is currently selected in the Inspector.
   *  Drives the disc highlight and the top-right 'Selected: X' chip. */
  selectedAgentId: AgentId | null;
  /** Phase 5: called when an agent disc is clicked. Toggle semantics
   *  (click-same-clears) are the CALLER's responsibility. */
  onAgentClick: (id: AgentId) => void;
  /** Phase 5: called when the user dismisses the selection via the
   *  top-right chip's × button. */
  onClearSelection: () => void;
}

const VISIBLE_AGENTS: Array<{ id: AgentId }> = [
  // Front row — the negotiation deal floor
  { id: 'buyer'        },
  { id: 'seller'       },
  { id: 'vleiVerifier' },
  // Back row — Jupiter sub-agents (Phase 9b). Order matters: same
  // left-to-right ordering as useStageLayout's BACK_Y placements.
  { id: 'treasury'     },
  { id: 'credit'       },
  { id: 'inventory'    },
  { id: 'logistics'    },
];

function deriveAuraState(
  agentId: AgentId,
  simulation: ReturnType<typeof useSimulation>,
  backOfficeConsult: UseBackOfficeConsultResult,
): AuraState {
  const agents = simulation.state.agents;
  if (agentId === 'buyer')          return agents.buyer.status === 'active'          ? 'active'     : 'idle';
  if (agentId === 'seller')         return agents.seller.status === 'active'         ? 'active'     : 'idle';
  if (agentId === 'treasury')       return agents.sellerTreasury.status === 'active' ? 'consulting' : 'idle';
  if (agentId === 'sellerTreasury') return agents.sellerTreasury.status === 'active' ? 'consulting' : 'idle';
  // Phase 9d — sub-agents flip to 'consulting' aura while their consult
  // is active. When idle, the gentle 'idle' breath continues.
  if (agentId === 'credit')         return backOfficeConsult.credit.active    ? 'consulting' : 'idle';
  if (agentId === 'inventory')      return backOfficeConsult.inventory.active ? 'consulting' : 'idle';
  if (agentId === 'logistics')      return backOfficeConsult.logistics.active ? 'consulting' : 'idle';
  return 'idle';
}

function deriveStatusLabel(agentId: AgentId, simulation: ReturnType<typeof useSimulation>): string {
  const agents = simulation.state.agents;
  if (agentId === 'buyer')          return agents.buyer.status;
  if (agentId === 'seller')         return agents.seller.status;
  if (agentId === 'treasury')       return agents.sellerTreasury.status;
  if (agentId === 'sellerTreasury') return agents.sellerTreasury.status;
  // Phase 9b — sub-agents default to 'idle' until consult signals exist.
  if (agentId === 'credit' || agentId === 'inventory' || agentId === 'logistics') return 'idle';
  return 'idle';
}

export function TheaterStage({
  simulation,
  events,
  paused,
  riverPlayToken,
  vlei,
  ballets,
  onBalletComplete,
  consult,
  actusFlashToken,
  backOfficeConsult,
  selectedAgentId,
  onAgentClick,
  onClearSelection,
}: TheaterStageProps) {
  const layout = useStageLayout();
  const { flights, completeFlight } = useEnvelopeFlights({ events, paused });
  const { width: vbW, height: vbH } = STAGE_VIEWBOX;

  // Phase 9f — vLEI node is conditional. In plain mode (api-server :4000
  // unreachable) it disappears from stage; in vLEI mode it re-appears at
  // top-center as the real third-party trust root. The vLEI status badge
  // in the top-right corner still shows reachable/offline either way.
  const vleiOnStage = vlei.reachable;

  const isDimmed = (id: AgentId): boolean => {
    if (id === 'treasury' || id === 'sellerTreasury' || id === 'vleiVerifier') {
      return deriveStatusLabel(id, simulation) !== 'active';
    }
    // Phase 9d — back-row sub-agents brighten while their consult is
    // active, and otherwise default to the dimmed stage-curtain state.
    if (id === 'credit')    return !backOfficeConsult.credit.active;
    if (id === 'inventory') return !backOfficeConsult.inventory.active;
    if (id === 'logistics') return !backOfficeConsult.logistics.active;
    return false;
  };

  return (
    <div
      className={cn(
        'relative w-full max-w-[1100px] mx-auto rounded-xl border border-border bg-card/30 backdrop-blur-sm overflow-hidden',
      )}
      style={{ aspectRatio: `${vbW} / ${vbH}` }}
    >
      {/* ─── SVG layer ──────────────────────────────────────────────── */}
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full text-foreground"
        role="img"
        aria-label="Theater stage with agents, envelopes, and verification river"
      >
        <StageBackdrop />

        {/* Phase 9b — BackOfficeRail: faint band behind the back-row
            sub-agents. Drawn right above the StageBackdrop and below
            the verification river so the river overlays the band
            naturally. No animation — pure static scaffold. */}
        <BackOfficeRail />

        {/* Phase 3b: verification river — sits above backdrop, below
            agents so endpoints disappear into the avatar discs nicely. */}
        <VerificationRiver playToken={riverPlayToken} />

        {VISIBLE_AGENTS.map(({ id }) => {
          // Phase 9f — vLEI node hidden in plain mode.
          if (id === 'vleiVerifier' && !vleiOnStage) return null;
          const pos = layout.positions[id];
          if (!pos) return null;

          // Phase 9g — sub-agents render through SubAgentSlot which animates
          // them between rest (icon-strip under seller) and active (lifted
          // to the cluster position with full visuals). Treasury also lifts;
          // its existing TreasuryConsult spotlight reads its live position
          // dynamically, so the spotlight follows the lift naturally.
          const isSubAgent = id === 'credit' || id === 'inventory' || id === 'logistics' || id === 'treasury';
          if (isSubAgent) {
            const active =
              id === 'credit'    ? backOfficeConsult.credit.active :
              id === 'inventory' ? backOfficeConsult.inventory.active :
              id === 'logistics' ? backOfficeConsult.logistics.active :
              /* treasury */       consult.active;
            const restPos = layout.restPositions[id];
            return (
              <SubAgentSlot key={id} active={active} restPos={restPos} activePos={pos}>
                {(p) => (
                  <g>
                    <PhaseRing cx={p.x} cy={p.y} r={p.r} />
                    <StateAura
                      cx={p.x}
                      cy={p.y}
                      r={p.r}
                      state={deriveAuraState(id, simulation, backOfficeConsult)}
                      colorToken={IDENTITIES[id as keyof typeof IDENTITIES]?.colorToken ?? 'buyer'}
                    />
                    {/* Character animations hidden at rest (the visuals
                        are sized for r=30, would be noise at r=11).
                        Reappear when the agent lifts. */}
                    {active && id === 'credit'    && <CreditScoreline cx={p.x} cy={p.y} r={p.r} />}
                    {active && id === 'inventory' && <InventoryStacks cx={p.x} cy={p.y} r={p.r} />}
                    {active && id === 'logistics' && <LogisticsRoute  cx={p.x} cy={p.y} r={p.r} />}
                  </g>
                )}
              </SubAgentSlot>
            );
          }

          // Front-row agents (buyer / seller / vlei) render as before.
          const dimmed = isDimmed(id);
          return (
            <g key={id} opacity={dimmed ? 0.35 : 1} style={{ transition: 'opacity 200ms' }}>
              <PhaseRing cx={pos.x} cy={pos.y} r={pos.r} />
              <StateAura
                cx={pos.x}
                cy={pos.y}
                r={pos.r}
                state={deriveAuraState(id, simulation, backOfficeConsult)}
                colorToken={IDENTITIES[id as keyof typeof IDENTITIES]?.colorToken ?? 'buyer'}
              />
            </g>
          );
        })}

        {/* Phase 9f — plain-mode handshake lock. When the vLEI verifier
            node is NOT on stage (api-server unreachable, i.e. plain mode),
            draw a small lock icon midway between buyer and seller.
            Telegraphs "these two verified each other directly via GLEIF +
            agent cards" — a symmetric, bidirectional relationship,
            no third party. */}
        {!vleiOnStage && (() => {
          const buyer = layout.positions.buyer;
          const seller = layout.positions.seller;
          const midX = (buyer.x + seller.x) / 2;
          const midY = (buyer.y + seller.y) / 2;
          return (
            <g aria-label="Buyer and seller verified directly (plain mode)" opacity={0.55}>
              <circle cx={midX} cy={midY} r={18} fill="currentColor" fillOpacity={0.04} />
              <circle cx={midX} cy={midY} r={14} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={0.8} />
              <rect
                x={midX - 7} y={midY - 2}
                width={14} height={11}
                rx={2}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.7}
                strokeWidth={1.2}
              />
              <path
                d={`M ${midX - 4.5} ${midY - 2} L ${midX - 4.5} ${midY - 7} A 4.5 4.5 0 0 1 ${midX + 4.5} ${midY - 7} L ${midX + 4.5} ${midY - 2}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.7}
                strokeWidth={1.2}
                strokeLinecap="round"
              />
              <circle cx={midX} cy={midY + 3.5} r={1.2} fill="currentColor" fillOpacity={0.7} />
              <text
                x={midX}
                y={midY + 22}
                textAnchor="middle"
                fontSize={7}
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                fill="currentColor"
                fillOpacity={0.45}
                letterSpacing={1.5}
              >
                GLEIF · PLAIN
              </text>
            </g>
          );
        })()}

        {/* Phase 3c: treasury consult overlay — drawn AFTER static
            agents (so they dim into the background) but BEFORE EnvelopeLayer
            so in-flight envelopes (including seller↔treasury) remain crisp
            over the spotlight. */}
        <TreasuryConsult
          active={consult.active}
          outcome={consult.outcome}
          treasuryX={layout.positions.treasury.x}
          treasuryY={layout.positions.treasury.y}
          treasuryR={layout.positions.treasury.r}
          viewBoxW={vbW}
          viewBoxH={vbH}
        />

        {/* Phase 9d — back-office consult overlay (credit/inventory/logistics).
            Drawn after TreasuryConsult so its spotlights layer ON TOP of
            any treasury dim mask. Uses additive light (no dim of its own),
            so multiple sub-agents can consult in parallel without
            compounding darkness. Drawn BEFORE EnvelopeLayer so envelopes
            still fly visibly on top of glows. */}
        <BackOfficeConsult
          states={backOfficeConsult}
          positions={{
            credit:    layout.positions.credit,
            inventory: layout.positions.inventory,
            logistics: layout.positions.logistics,
          }}
        />

        {/* Phase 3a: envelope flights — drawn over the treasury dim so the
            seller↔treasury exchange stays visible during a consult.
            Still visually under HTML AvatarDisc. */}
        <EnvelopeLayer
          flights={flights}
          positions={layout.positions}
          onFlightComplete={completeFlight}
        />

        {/* Phase 3c addendum: small ACTUS confirmation pill near treasury.
            Drawn over envelopes so the end-of-deal cashflow notification
            isn't obscured by any in-flight envelopes settling at treasury. */}
        <TreasuryActusBadge
          flashToken={actusFlashToken}
          treasuryX={layout.positions.treasury.x}
          treasuryY={layout.positions.treasury.y}
          treasuryR={layout.positions.treasury.r}
        />

        {/* Phase 3c: IPEX credential ballets — drawn LAST so the parchment
            packets appear above all other animations. Triggered in parallel
            with the invoice envelope (per Phase 3c decision (b)). */}
        <IpexBallet
          ballets={ballets}
          positions={layout.positions}
          onBalletComplete={onBalletComplete}
        />
      </svg>

      {/* ─── HTML layer ─────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        {VISIBLE_AGENTS.map(({ id }) => {
          // Phase 9f — vLEI node hidden in plain mode; skip its label too.
          if (id === 'vleiVerifier' && !vleiOnStage) return null;

          // Phase 9g — sub-agent HTML labels are hidden at rest. The icon-
          // strip is meant to be compact; the full label cluster (name +
          // LEI snippet + status pill) is too wide to fit there and would
          // overlap neighbors. Labels reappear with the disc when active.
          const isSubAgent = id === 'credit' || id === 'inventory' || id === 'logistics' || id === 'treasury';
          if (isSubAgent) {
            const active =
              id === 'credit'    ? backOfficeConsult.credit.active :
              id === 'inventory' ? backOfficeConsult.inventory.active :
              id === 'logistics' ? backOfficeConsult.logistics.active :
              /* treasury */       consult.active;
            if (!active) return null;  // strip-mode: no HTML label
          }

          const pos = layout.positions[id];
          const identity = IDENTITIES[id as keyof typeof IDENTITIES];
          if (!pos || !identity) return null;
          const leftPct = (pos.x / vbW) * 100;
          const topPct  = (pos.y / vbH) * 100;
          return (
            <AgentNode
              key={id}
              identity={identity}
              leftPct={leftPct}
              topPct={topPct}
              statusLabel={deriveStatusLabel(id, simulation)}
              dimmed={isDimmed(id)}
              selected={selectedAgentId === id}
              onClick={() => onAgentClick(id)}
            />
          );
        })}
      </div>

      {selectedAgentId && (
        <div className="absolute top-3 right-3 rounded-md bg-card/80 backdrop-blur border border-border px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">Selected:</span>{' '}
          <span className="font-semibold">{IDENTITIES[selectedAgentId as keyof typeof IDENTITIES]?.shortName}</span>
          <button
            onClick={onClearSelection}
            className="ml-2 text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
          >
            ×
          </button>
        </div>
      )}

      <div className="absolute top-3 left-3 flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 select-none pointer-events-none">
        <span>Stage · Phase 9g (lift-and-grow strip)</span>
        {flights.length > 0 && (
          <span className="text-foreground/80 normal-case">
            {flights.length} in flight
          </span>
        )}
        {ballets.length > 0 && (
          <span className="text-yellow-700 dark:text-yellow-300 normal-case">
            {ballets.length} ipex
          </span>
        )}
        {consult.active && (
          <span className="text-purple-700 dark:text-purple-300 normal-case">
            consult · {consult.outcome}
          </span>
        )}
      </div>

      {/* ─── vLEI status badge (top-right, below selection chip) ──────── */}
      <div
        className={cn(
          'absolute right-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-mono border backdrop-blur',
          selectedAgentId ? 'top-12' : 'top-3',
          vlei.reachable
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
        )}
        title={vlei.lastChecked ? `Last checked ${vlei.lastChecked.toLocaleTimeString()}` : 'Polling …'}
      >
        <span
          className={cn(
            'inline-block w-1.5 h-1.5 rounded-full',
            vlei.reachable ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500',
          )}
        />
        <span className="font-bold">vLEI</span>
        <span className="opacity-70">
          {vlei.reachable ? `${vlei.verifiedCount}/3` : 'offline'}
        </span>
      </div>
    </div>
  );
}
