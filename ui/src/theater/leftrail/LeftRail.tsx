/**
 * LeftRail — horizontal control band (Phase 9a: was sticky left rail)
 * ---------------------------------------------------------------------------
 * Phase 6 introduced this as a sticky 280px sidebar on xl. Phase 9a moved
 * it out of the main grid into a horizontal band BELOW the stage so the
 * stage gets the full width — the cinematic centerpiece, as designed.
 *
 * Composition-based — accepts any children. AgentTheater renders the
 * panels (ModeBadge, ScenarioLauncher, HITLPanel) inside; the rail itself
 * doesn't know what's in it. Keeps responsibility narrow.
 *
 * Layout:
 *   - sm and below: children stack vertically (single column)
 *   - sm and up:    children flow horizontally, wrapping when narrow
 *   - HITLPanel renders only when DD is pending, so the row has 2–3 items
 *     depending on state
 */

import React from 'react';

interface LeftRailProps {
  children: React.ReactNode;
}

export function LeftRail({ children }: LeftRailProps) {
  return (
    <aside
      className="rounded-lg border border-border bg-card/30 backdrop-blur-sm"
      aria-label="Control band — scenario launcher + HITL"
    >
      {/* Header strip — kept minimal to match Inspector header */}
      <div className="border-b border-border/60 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Controls
      </div>
      {/* Horizontal flow at sm+, stacked below. items-stretch so each
          child card grows to the row's natural height. */}
      <div className="p-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-stretch">
        {children}
      </div>
    </aside>
  );
}
