// =============================================================================
// PROJ1-DYN3-CONT8 / M2-ε — Scenario picker
// =============================================================================
//
// Renders a row of clickable scenario chips below the buyer chat input.
// Each chip:
//   - has a 2-3 word title visible on the chip
//   - shows a rich tooltip on hover with the full intent declaration
//   - becomes "selected" on click
// A separate "▶ Run scenario" action button on the right fires the selected
// scenario via the existing sendToBuyerAgent('start negotiation --scenario <id>')
// path. The CLI parser resolves the id to a full intent via scenario-loader.ts.
//
// Honest UX note shown to user: each tooltip includes a footer line saying
// which intent fields are honored today (product/qty/budget) vs declared but
// deferred (goal/style/walk-away/sellerIntent). This keeps the demo honest
// per the M2-ε design discussion.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Play } from 'lucide-react';
import { listScenarios, type Scenario } from '@/lib/scenarios';

interface ScenarioPickerProps {
  /** Called when the user clicks the run button after selecting a scenario.
   *  The host wires this to sendToBuyerAgent('start negotiation --scenario <id>'). */
  onRun: (scenario: Scenario) => void;
  /** Whether the picker is allowed to fire (e.g. is the seller verified?). */
  enabled: boolean;
  /** Optional hint shown when disabled. */
  disabledHint?: string;
}

// Compact chip rendered inline. Selection is visual only — firing requires
// the Run button on the right.
function ScenarioChip({
  scenario,
  selected,
  onSelect,
}: {
  scenario: Scenario;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={buildTooltip(scenario)}
      className={cn(
        'px-2 py-1 rounded-md border text-[10px] font-medium transition-colors flex-shrink-0',
        selected
          ? 'bg-agent-buyer/30 border-agent-buyer text-foreground'
          : 'bg-background/40 border-border/60 text-muted-foreground hover:border-agent-buyer/60 hover:text-foreground',
      )}
    >
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

export function ScenarioPicker({ onRun, enabled, disabledHint }: ScenarioPickerProps) {
  const scenarios = listScenarios();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (scenarios.length === 0) return null;

  const selected = selectedId ? scenarios.find(s => s.id === selectedId) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground flex-shrink-0">— or pick a scenario —</span>
        {selected && (
          <span className="text-[10px] text-agent-buyer flex-shrink-0">
            ▸ {selected.title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
          {scenarios.map(s => (
            <ScenarioChip
              key={s.id}
              scenario={s}
              selected={selectedId === s.id}
              onSelect={() => setSelectedId(s.id)}
            />
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant={selected && enabled ? 'default' : 'ghost'}
          disabled={!selected || !enabled}
          onClick={() => {
            if (selected) onRun(selected);
          }}
          title={
            !enabled
              ? (disabledHint ?? 'Verify seller first')
              : !selected
                ? 'Pick a scenario chip first'
                : `Run scenario: ${selected.title}`
          }
          className="h-7 px-2 gap-1 text-[10px] flex-shrink-0"
        >
          <Play size={12} />
          Run
        </Button>
      </div>
      <p className="text-[9px] text-muted-foreground/70 italic">
        Hover a chip for full buyer/seller intent + expected outcome.
        Outcomes vary — agents act autonomously toward intent within guardrails.
      </p>
    </div>
  );
}
