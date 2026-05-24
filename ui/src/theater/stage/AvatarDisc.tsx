/**
 * AvatarDisc — the circular icon at the heart of an AgentNode
 * ---------------------------------------------------------------------------
 * HTML (not SVG) because:
 *   1) lucide-react icons are React components, easier to drop into JSX
 *   2) Tailwind theme tokens (text-agent-buyer etc) work natively
 *   3) Hover/tap states use familiar CSS
 *
 * Positioned via absolute coordinates derived from SVG viewBox space — the
 * parent TheaterStage handles the math (containerWidth × viewBoxX/viewBoxW
 * etc) so this component just receives final pixel positions or percentages.
 *
 * Phase 2: static. Phase 3 will hook up onClick → useSelection. Phase 5
 * will add motion/react hover scale.
 */

import React from 'react';
import { ShoppingBag, Factory, Building2, ShieldCheck, Landmark, Boxes, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentIdentity } from '@/theater/shared/identities';

interface AvatarDiscProps {
  identity: AgentIdentity;
  /** Disc diameter in pixels. The HTML disc visually overlays the SVG
   *  AvatarRadius; values around 56-72px work with the default stage size. */
  size?: number;
  /** Dimmed when not yet relevant to current phase (e.g. vLEI before verify). */
  dimmed?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

const ICON_BY_TOKEN: Record<AgentIdentity['colorToken'], React.ComponentType<{ size?: number; className?: string }>> = {
  buyer:     ShoppingBag,
  seller:    Factory,
  treasury:  Building2,
  vlei:      ShieldCheck,
  // Phase 9a — Jupiter sub-agents (back row).
  credit:    Landmark,    // bank/ledger feel for creditworthiness
  inventory: Boxes,       // stacked goods
  logistics: Truck,       // movement / shipping
};

// Tailwind ring color per token — matched to the SVG StateAura hex.
// Tokens 'buyer'..'vlei' use CSS-var-backed agent-* utilities declared in
// tailwind.config.ts. Phase 9a tokens use standard Tailwind palette colors
// directly so no Tailwind config or globals.css edits are required.
const RING_BY_TOKEN: Record<AgentIdentity['colorToken'], string> = {
  buyer:     'border-agent-buyer/60 bg-agent-buyer/15 text-agent-buyer',
  seller:    'border-agent-seller/60 bg-agent-seller/15 text-agent-seller',
  treasury:  'border-agent-treasury/60 bg-agent-treasury/15 text-agent-treasury',
  vlei:      'border-slate-500/60 bg-slate-500/15 text-slate-500',
  credit:    'border-amber-500/60 bg-amber-500/15 text-amber-500',
  inventory: 'border-orange-500/60 bg-orange-500/15 text-orange-500',
  logistics: 'border-teal-500/60 bg-teal-500/15 text-teal-500',
};

const RING_SELECTED_BY_TOKEN: Record<AgentIdentity['colorToken'], string> = {
  buyer:     'ring-agent-buyer/40',
  seller:    'ring-agent-seller/40',
  treasury:  'ring-agent-treasury/40',
  vlei:      'ring-slate-500/40',
  credit:    'ring-amber-500/40',
  inventory: 'ring-orange-500/40',
  logistics: 'ring-teal-500/40',
};

export function AvatarDisc({
  identity,
  size = 64,
  dimmed = false,
  selected = false,
  onClick,
}: AvatarDiscProps) {
  const Icon = ICON_BY_TOKEN[identity.colorToken];
  const iconSize = Math.round(size * 0.45);
  const isInteractive = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isInteractive}
      aria-label={`${identity.shortName} agent — ${identity.legalName}`}
      className={cn(
        'rounded-full border-2 flex items-center justify-center transition-all duration-200',
        RING_BY_TOKEN[identity.colorToken],
        dimmed && 'opacity-35 saturate-50',
        selected && cn('ring-4 ring-offset-2 ring-offset-background', RING_SELECTED_BY_TOKEN[identity.colorToken]),
        isInteractive && !dimmed && 'motion-safe:hover:scale-105 hover:shadow-lg cursor-pointer',
        !isInteractive && 'cursor-default',
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={iconSize} className="shrink-0" />
    </button>
  );
}
