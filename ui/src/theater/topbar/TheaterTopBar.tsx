/**
 * TheaterTopBar — Phase 7
 * ---------------------------------------------------------------------------
 * Cinematic page header for /agents-2. Sticky beneath the global Layout
 * header (top-16, z-40). Pure presentation; all state owned by parent.
 *
 * Slots:
 *   LEFT   — title + live-phase pill + status/round chip
 *   CENTER — LIVE indicator (clickable when paused → resumes live)
 *   RIGHT  — Replay-all + Cinema (presentation mode) toggle
 *
 * Settled-state pill prefers `finalPrice !== null` over `status === 'settled'`
 * so it lights up correctly even if the status string vocabulary shifts;
 * the two checks together are belt-and-suspenders.
 */

import { Eye, EyeOff, RotateCcw, Clapperboard } from 'lucide-react';

interface TheaterTopBarProps {
  livePhase: string;
  status: string;            // viewNeg.status (e.g. 'negotiating' | 'settled' | ...)
  finalPrice: number | null | undefined;
  roundCount: number;        // viewNeg.rounds.length
  isLive: boolean;
  playheadIndex: number;
  onResumeLive: () => void;
  onReplayAll: () => void;
  presentationMode: boolean;
  onTogglePresentationMode: () => void;
}

export function TheaterTopBar({
  livePhase,
  status,
  finalPrice,
  roundCount,
  isLive,
  playheadIndex,
  onResumeLive,
  onReplayAll,
  presentationMode,
  onTogglePresentationMode,
}: TheaterTopBarProps) {
  // Settled pill lights up when we have an actual numeric finalPrice. Note
  // viewNeg.finalPrice can be undefined (not just null) before a deal closes,
  // so we use typeof rather than `!== null` — the latter is true for undefined
  // and would cause a runtime crash on toLocaleString().
  const hasPrice = typeof finalPrice === 'number';
  const isSettled = status === 'settled' || hasPrice;

  return (
    <div className="sticky top-16 z-40 -mx-6 mb-4 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="px-6 py-3 flex items-center gap-4">
        {/* LEFT — title + phase + status/round chip */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Clapperboard size={20} className="text-primary shrink-0" />
          <h1 className="text-lg font-bold tracking-tight shrink-0">Agent Theater</h1>

          {livePhase && livePhase !== 'idle' && (
            <span className="hidden sm:inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {livePhase}
            </span>
          )}

          {isSettled && typeof finalPrice === 'number' ? (
            <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-0.5 text-[11px] font-medium text-emerald-900 dark:text-emerald-200 tabular-nums">
              ✓ Settled · ₹{finalPrice.toLocaleString('en-IN')}/fabric unit
            </span>
          ) : roundCount > 0 ? (
            <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/40 px-2.5 py-0.5 text-[11px] font-medium text-blue-900 dark:text-blue-200">
              Round {roundCount}
            </span>
          ) : (
            <span className="hidden md:inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground italic">
              Awaiting scenario
            </span>
          )}
        </div>

        {/* CENTER — LIVE / PAUSED indicator. Clickable when paused → resumes live. */}
        <button
          type="button"
          onClick={isLive ? undefined : onResumeLive}
          disabled={isLive}
          className={
            isLive
              ? 'flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 cursor-default'
              : 'flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-900/30 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors'
          }
          title={isLive ? 'Receiving live SSE' : 'Paused — click to resume live'}
        >
          {isLive ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              LIVE
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              PAUSED <span className="opacity-70 tabular-nums">@ {playheadIndex}</span>
              <span className="ml-1 opacity-70 hidden md:inline">— resume</span>
            </>
          )}
        </button>

        {/* RIGHT — controls */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onReplayAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Clear log and resume live"
          >
            <RotateCcw size={13} />
            <span className="hidden md:inline">Replay all</span>
          </button>

          <button
            type="button"
            onClick={onTogglePresentationMode}
            className={
              presentationMode
                ? 'inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors'
                : 'inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            }
            title={presentationMode ? 'Exit cinema mode (show debug + build progress)' : 'Enter cinema mode (hide debug + build progress)'}
            aria-pressed={presentationMode}
          >
            {presentationMode ? <EyeOff size={13} /> : <Eye size={13} />}
            <span className="hidden md:inline">{presentationMode ? 'Exit cinema' : 'Cinema'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default TheaterTopBar;
