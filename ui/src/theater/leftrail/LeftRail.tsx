/**
 * LeftRail — sticky left-side container, 280px on xl breakpoint
 * ---------------------------------------------------------------------------
 * Phase 6. Mirrors the Inspector right rail's visual treatment for symmetry:
 * rounded card, subtle border, sticky positioning on xl, scrollable when
 * content exceeds viewport height.
 *
 * Composition-based — accepts any children. AgentTheater renders the
 * panels (ModeBadge, ScenarioLauncher, HITLPanel) inside; the rail itself
 * doesn't know what's in it. Keeps responsibility narrow.
 */

import React from 'react';

interface LeftRailProps {
  children: React.ReactNode;
}

export function LeftRail({ children }: LeftRailProps) {
  return (
    <aside
      className="rounded-lg border border-border bg-card/30 backdrop-blur-sm xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto"
      aria-label="Left rail — controls and HITL"
    >
      {/* Header strip — kept minimal to match Inspector header */}
      <div className="border-b border-border/60 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Controls
      </div>
      <div className="p-3 space-y-4">
        {children}
      </div>
    </aside>
  );
}
