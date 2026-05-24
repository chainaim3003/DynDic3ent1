/**
 * ScenarioLauncher — wraps the existing ScenarioPicker with a Run button
 * ---------------------------------------------------------------------------
 * Phase 6. AgentCenter's ScenarioPicker is a clean controlled component:
 * chips select a scenario, the parent populates a chat input, and the user
 * presses Send. Theater has no chat input — we run scenarios directly.
 *
 * This launcher reuses the picker as-is (so chip styling, rich tooltips,
 * scenario list, and the "queued: start negotiation --scenario X" hint all
 * come for free), then adds a "▶ Run scenario" button below that calls
 * onRun(scenarioId). The parent (AgentTheater) handles the actual
 * sendToBuyerAgent dispatch.
 *
 * Note on enablement: AgentCenter gates the picker on seller verification
 * (`!!buyerVerificationResult?.success`). Theater doesn't track that state
 * directly — instead we always enable the picker and let the BUYER AGENT
 * gate the command. If verification hasn't happened, the agent responds
 * via SSE with its own "🔒 Cannot start negotiation — seller not verified"
 * message which the user sees in the timeline. That keeps Theater
 * stateless about verification and avoids drift between the two surfaces.
 */

import React, { useState } from 'react';
import { ScenarioPicker } from '@/components/ScenarioPicker';
import type { Scenario } from '@/lib/scenarios';

interface ScenarioLauncherProps {
  /** Called when the user clicks ▶ Run with a selected scenario.
   *  Receives the scenario id (e.g. 'firm-buyer-soft-seller'). */
  onRun: (scenarioId: string) => void;
}

export function ScenarioLauncher({ onRun }: ScenarioLauncherProps) {
  const [selected, setSelected] = useState<Scenario | null>(null);

  const handleSelect = (s: Scenario | null) => setSelected(s);
  const handleRun = () => {
    if (!selected) return;
    onRun(selected.id);
    setSelected(null);
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Scenarios
      </div>
      <ScenarioPicker
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
        enabled={true}
        disabledHint=""
      />
      <button
        type="button"
        onClick={handleRun}
        disabled={!selected}
        className="w-full rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 transition-colors"
        title={selected
          ? `Sends 'start negotiation --scenario ${selected.id}' to the buyer agent`
          : 'Pick a scenario chip first'}
      >
        {selected ? `▶ Run · ${selected.title}` : '▶ Run scenario'}
      </button>
      <p className="text-[9px] text-muted-foreground/70 italic">
        Theater doesn't gate on verification — if seller isn't verified yet, the buyer
        agent will respond with its own error message, visible in the event timeline.
      </p>
    </div>
  );
}
