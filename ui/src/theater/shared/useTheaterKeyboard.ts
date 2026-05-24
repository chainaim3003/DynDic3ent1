/**
 * useTheaterKeyboard — keyboard shortcuts for /agents-2
 * ---------------------------------------------------------------------------
 * Phase 8b. Attaches a window-scoped keydown listener that only lives while
 * the AgentTheater page is mounted, so `/agents` is unaffected. All actions
 * are wired to the existing playhead + selection APIs — no new state.
 *
 * Keymap:
 *   ←  / →           Scrub by 1 event (clamped to [0, last])
 *   Shift+← / Shift+→  Scrub by 10 events
 *   Home              Seek to event 0
 *   End               Jump to live (resumeLive)
 *   Space             Toggle pause/play (mirrors TopBar + Debug button)
 *   Esc               Clear selection (only when something is selected)
 *
 * Exemptions — the listener bails early when:
 *   • Focus is inside <input>, <textarea>, <select>, <button>, or any
 *     contenteditable element. This keeps native keyboard behavior intact
 *     (typing in the DD overlay, activating a Debug button via Space, etc).
 *   • A modifier other than Shift is held (Cmd/Ctrl/Alt) — so OS / browser
 *     shortcuts like Cmd+R, Ctrl+F always win.
 *
 * preventDefault is called only when we actually handle the key, so unhandled
 * keys (typing, tabbing, etc) propagate normally.
 */

import { useEffect } from 'react';

interface UseTheaterKeyboardOptions {
  playheadIndex: number;
  isLive: boolean;
  totalEvents: number;
  seek: (idx: number) => void;
  pause: () => void;
  play: () => void;
  resumeLive: () => void;
  hasSelection: boolean;
  clearSelection: () => void;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  // Defensive — some shadcn/radix triggers wrap in role="combobox" etc.
  // If the element claims to be a textbox via ARIA, treat it as editable.
  const role = target.getAttribute('role');
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
  return false;
}

export function useTheaterKeyboard({
  playheadIndex,
  isLive,
  totalEvents,
  seek,
  pause,
  play,
  resumeLive,
  hasSelection,
  clearSelection,
}: UseTheaterKeyboardOptions): void {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Bail if focus is on an editable element — typing wins.
      if (isEditableTarget(e.target)) return;
      // Bail on modifier-laden combos (except Shift, which is our own step-10).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const last = totalEvents - 1;
      const step = e.shiftKey ? 10 : 1;

      switch (e.key) {
        case 'ArrowLeft': {
          if (totalEvents === 0) return;
          e.preventDefault();
          seek(Math.max(0, playheadIndex - step));
          return;
        }
        case 'ArrowRight': {
          if (totalEvents === 0) return;
          e.preventDefault();
          seek(Math.min(last, playheadIndex + step));
          return;
        }
        case 'Home': {
          if (totalEvents === 0) return;
          e.preventDefault();
          seek(0);
          return;
        }
        case 'End': {
          if (totalEvents === 0) return;
          e.preventDefault();
          // End means "rejoin live" — semantically clearer than seek(last),
          // because seek(last) stays scrubbed and new SSE arrivals wouldn't
          // pull the playhead forward.
          resumeLive();
          return;
        }
        case ' ':
        case 'Spacebar': {  // legacy IE/Edge value, defensive
          e.preventDefault();
          if (isLive) pause();
          else play();
          return;
        }
        case 'Escape': {
          if (hasSelection) {
            e.preventDefault();
            clearSelection();
          }
          return;
        }
        default:
          return;
      }
    }

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [
    playheadIndex,
    isLive,
    totalEvents,
    seek,
    pause,
    play,
    resumeLive,
    hasSelection,
    clearSelection,
  ]);
}
