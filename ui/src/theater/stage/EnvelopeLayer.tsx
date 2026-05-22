/**
 * EnvelopeLayer — renders all in-flight envelopes as siblings in the SVG
 * ---------------------------------------------------------------------------
 * Thin component. Reads the active flights from useEnvelopeFlights and
 * mounts one MessageEnvelope per flight. Each envelope handles its own
 * GSAP timeline and calls back to remove itself on completion.
 *
 * Z-order:
 *   This component should be mounted AFTER the per-agent PhaseRing/StateAura
 *   group in TheaterStage's SVG so envelopes draw on top of the rings.
 *   It will still draw UNDER the HTML AvatarDisc layer (which lives in a
 *   sibling DOM node) — this is intentional: envelopes flying into an
 *   agent visually "deliver" into the disc by passing behind it.
 */

import React from 'react';
import { MessageEnvelope } from './MessageEnvelope';
import type { ActiveFlight } from './useEnvelopeFlights';
import type { AgentPosition } from './useStageLayout';

interface EnvelopeLayerProps {
  flights: ActiveFlight[];
  /** Map of agent id → stage position. */
  positions: Record<string, AgentPosition>;
  onFlightComplete: (flightId: string) => void;
}

export function EnvelopeLayer({ flights, positions, onFlightComplete }: EnvelopeLayerProps) {
  return (
    <g aria-hidden="true">
      {flights.map(flight => {
        const fromPos = positions[flight.from];
        const toPos = positions[flight.to];
        // If either endpoint is missing (shouldn't happen, but defensive),
        // immediately complete the flight so it doesn't get stuck in state.
        if (!fromPos || !toPos) {
          // Defer to next tick to avoid mutating parent state during render.
          queueMicrotask(() => onFlightComplete(flight.id));
          return null;
        }
        // Treasury flights arc downward; everything else arcs upward.
        const arcDirection: 'up' | 'down' =
          flight.from === 'treasury' || flight.to === 'treasury' ? 'down' : 'up';

        return (
          <MessageEnvelope
            key={flight.id}
            fromX={fromPos.x}
            fromY={fromPos.y}
            toX={toPos.x}
            toY={toPos.y}
            kind={flight.kind}
            arcDirection={arcDirection}
            onComplete={() => onFlightComplete(flight.id)}
          />
        );
      })}
    </g>
  );
}
