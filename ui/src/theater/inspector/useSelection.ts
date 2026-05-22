/**
 * useSelection — selection state for the Inspector right rail
 * ---------------------------------------------------------------------------
 * Selection is what the right-rail Inspector is currently focused on. Four
 * variants from shared/types.ts:
 *
 *   { kind: 'none' }                       — empty/idle state
 *   { kind: 'agent',   agentId }           — an agent disc was clicked
 *   { kind: 'message', eventId }           — a ribbon tick was clicked
 *   { kind: 'round',   round   }           — a round chip was clicked
 *
 * Setters intentionally narrow: callers pass the natural identifier (an
 * AgentId, an event id, a round number) rather than constructing the
 * Selection object themselves.
 *
 * toggleAgent matches the previous TheaterStage UX — clicking the same
 * agent twice clears the selection. Same affordance for messages/rounds.
 */

import { useCallback, useState } from 'react';
import type { AgentId, Selection } from '@/theater/shared/types';

const NONE: Selection = { kind: 'none' };

export interface UseSelectionResult {
  selection: Selection;
  /** Clear selection. */
  selectNone: () => void;
  /** Select an agent. Pass null to clear. */
  selectAgent: (id: AgentId | null) => void;
  /** Select a message by its LogEvent id. */
  selectMessage: (eventId: string) => void;
  /** Select a round by its round number. */
  selectRound: (round: number) => void;
  /** Click-same-clears UX for agent discs. */
  toggleAgent: (id: AgentId) => void;
  /** Click-same-clears UX for ribbon ticks. */
  toggleMessage: (eventId: string) => void;
  /** Click-same-clears UX for round chips. */
  toggleRound: (round: number) => void;
}

export function useSelection(): UseSelectionResult {
  const [selection, setSelection] = useState<Selection>(NONE);

  const selectNone    = useCallback(() => setSelection(NONE), []);
  const selectAgent   = useCallback(
    (id: AgentId | null) => setSelection(id === null ? NONE : { kind: 'agent', agentId: id }),
    [],
  );
  const selectMessage = useCallback(
    (eventId: string) => setSelection({ kind: 'message', eventId }),
    [],
  );
  const selectRound   = useCallback(
    (round: number) => setSelection({ kind: 'round', round }),
    [],
  );

  const toggleAgent = useCallback((id: AgentId) => {
    setSelection(prev =>
      prev.kind === 'agent' && prev.agentId === id ? NONE : { kind: 'agent', agentId: id }
    );
  }, []);

  const toggleMessage = useCallback((eventId: string) => {
    setSelection(prev =>
      prev.kind === 'message' && prev.eventId === eventId ? NONE : { kind: 'message', eventId }
    );
  }, []);

  const toggleRound = useCallback((round: number) => {
    setSelection(prev =>
      prev.kind === 'round' && prev.round === round ? NONE : { kind: 'round', round }
    );
  }, []);

  return {
    selection,
    selectNone,
    selectAgent,
    selectMessage,
    selectRound,
    toggleAgent,
    toggleMessage,
    toggleRound,
  };
}
