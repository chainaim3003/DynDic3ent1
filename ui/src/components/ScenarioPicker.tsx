// =============================================================================
// PROJ1-DYN3-CONT8 / M2-ε — Scenario picker
// PROJ1-DYN3-CONT9 — UI revamp: drop the ▶ Run button, populate chat input on
// chip click, let the user submit via the existing Send icon. Stronger
// selected-state visual (border + ring + ✓ marker).
// =============================================================================
//
// Renders a row of clickable scenario chips below the buyer chat input.
// Each chip:
//   - has a 2-3 word title visible on the chip
//   - shows a rich tooltip on hover with the full intent declaration
//   - becomes visibly "selected" on click — strong border + ring + check
//
// Behavior (CONT9): clicking a chip does NOT fire the negotiation. It calls
// onSelect(scenario), and the host (AgentCenter) is expected to populate the
// buyer chat input with `start negotiation --scenario <id>`. The user then
// submits via the existing chat Send icon. Selection is a CONTROLLED prop
// (selectedId) so the parent can clear it after submit. This matches the
// CONT9 UX directive: "instead of the RUN button, populate input and let me
// click the chat go icon."
//
// Honest UX note shown to user: each tooltip includes a footer line saying
// which intent fields are honored today (product/qty/budget) vs declared but
// deferred (goal/style/walk-away/sellerIntent). Mode-comparison scenarios
// surface the .env-flip caveat in their tooltip body.

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { listScenarios, type Scenario } from '@/lib/scenarios';

interface ScenarioPickerProps {
  /** Currently selected scenario id (controlled by parent). null = none. */
  selectedId: string | null;
  /** Called when the user clicks a chip. Passes the full Scenario object so
   *  the parent can populate the chat input with the right command. Clicking
   *  the already-selected chip clears the selection (passes null). */
  onSelect: (scenario: Scenario | null) => void;
  /** Whether the picker is allowed to fire (e.g. is the seller verified?). */
  enabled: boolean;
  /** Optional hint shown when disabled. */
  disabledHint?: string;
}

// Compact chip rendered inline. CONT9: clicking populates the chat input
// (via onSelect in the parent), it does NOT directly fire the negotiation.
function ScenarioChip({
  scenario,
  selected,
  enabled,
  onSelect,
}: {
  scenario: Scenario;
  selected: boolean;
  enabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!enabled}
      title={buildTooltip(scenario)}
      className={cn(
        'px-2.5 py-1 rounded-md border text-[10px] font-medium transition-all flex-shrink-0 inline-flex items-center gap-1',
        !enabled && 'opacity-40 cursor-not-allowed',
        selected && enabled
          // STRONG selected state — border, ring, accent bg, check icon
          ? 'bg-agent-buyer/40 border-2 border-agent-buyer text-foreground ring-2 ring-agent-buyer/40 shadow-sm'
          : enabled
            ? 'bg-background/40 border border-border/60 text-muted-foreground hover:border-agent-buyer/60 hover:text-foreground hover:bg-agent-buyer/10'
            : 'bg-background/20 border border-border/40 text-muted-foreground',
      )}
    >
      {selected && enabled && <Check size={10} className="text-agent-buyer" />}
      {scenario.title}
    </button>
  );
}

// Build the hover tooltip body. Browser `title` attribute renders this as
// a plain-text multi-line tooltip — no HTML, but newlines and indentation
// work. Keeps the dependency surface small (no Radix tooltip needed).
function buildTooltip(s: Scenario): string {
  const lines: string[] = [];
  lines.push(s.description);
  lines.push('');
  lines.push('— BUYER intent —');
  lines.push(`  goal:  ${s.buyerIntent.goal}`);
  lines.push(`  style: ${s.buyerIntent.style}`);
  lines.push(`  walk:  ${s.buyerIntent.walkAwayBehavior}`);
  if (s.buyerIntent.hardConstraints.maxBudgetPerUnit !== undefined) {
    lines.push(`  max budget/unit: ₹${s.buyerIntent.hardConstraints.maxBudgetPerUnit}`);
  }
  if (s.buyerIntent.softPreferences.targetPricePerUnit !== undefined) {
    lines.push(`  target price:    ₹${s.buyerIntent.softPreferences.targetPricePerUnit}`);
  }
  lines.push('');
  lines.push('— SELLER intent —');
  lines.push(`  goal:  ${s.sellerIntent.goal}`);
  lines.push(`  style: ${s.sellerIntent.style}`);
  lines.push(`  mode:  ${s.sellerIntent.hardConstraints.sellerResponseMode ?? '(unset)'}`);
  lines.push('');
  lines.push('— SITUATION —');
  lines.push(`  product:  ${s.situation.product}`);
  lines.push(`  quantity: ${s.situation.quantity.toLocaleString()}`);
  if (s.situation.market) lines.push(`  market:   ${s.situation.market}`);
  lines.push('');
  lines.push('— EXPECTED OUTCOME —');
  lines.push(`  likely:   ${s.expectedOutcome.likely}`);
  if (s.expectedOutcome.possible)    lines.push(`  possible: ${s.expectedOutcome.possible}`);
  if (s.expectedOutcome.failureMode) lines.push(`  if fails: ${s.expectedOutcome.failureMode}`);
  lines.push('');
  lines.push('ⓘ Today the agents honor: product, quantity, max budget/unit.');
  lines.push('   Other intent fields are declared but not yet wired into agent decisions.');
  return lines.join('\n');
}

export function ScenarioPicker({ selectedId, onSelect, enabled, disabledHint }: ScenarioPickerProps) {
  const scenarios = listScenarios();
  if (scenarios.length === 0) return null;

  const selected = selectedId ? scenarios.find(s => s.id === selectedId) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          — or pick a scenario —
        </span>
        {selected ? (
          <span className="text-[10px] text-agent-buyer flex-shrink-0 font-medium">
            ▸ queued: <span className="font-mono">start negotiation --scenario {selected.id}</span>
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground/70 italic flex-shrink-0">
            click a chip to load the command, then press Send ↗
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {scenarios.map(s => (
          <ScenarioChip
            key={s.id}
            scenario={s}
            selected={selectedId === s.id}
            enabled={enabled}
            onSelect={() => {
              // Toggle: if already selected, clear it. Otherwise select it.
              if (selectedId === s.id) {
                onSelect(null);
              } else {
                onSelect(s);
              }
            }}
          />
        ))}
      </div>
      <p className="text-[9px] text-muted-foreground/70 italic">
        {!enabled
          ? (disabledHint ?? 'Verify seller first to enable scenarios.')
          : 'Hover a chip for full buyer/seller intent + expected outcome. Outcomes vary — agents act autonomously toward intent within guardrails.'}
      </p>
    </div>
  );
}
