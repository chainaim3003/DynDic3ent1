# Agent Theater — Soak Test Checklist

Operator-facing watchlist for verifying that `/agents-2` survives a long
session (several hours, many scenarios). Phase 8d ships the in-app
diagnostics; this doc tells you what to do with them.

---

## How to run a soak

1. Open `/agents-2` in Chrome.
2. Open DevTools → **Performance** tab (for the heap snapshots later) and
   **Network** tab (to watch SSE liveness).
3. Open the Debug accordion at the bottom of the page. Leave it expanded.
4. Run scenarios back-to-back from the LeftRail's ScenarioLauncher. Aim
   for 50+ negotiations over 2–4 hours.
5. Mix in:
   - Manual pauses + scrubs via BottomTimeline (exercises Path A data
     scrubs / pure-derivation rounds).
   - Keyboard nav: ←/→, Shift+←/→, Home/End, Space, Esc.
   - Inspector selections (click agents + round chips + messages).
   - Cinema-mode toggles via TopBar (mounts/unmounts the Debug accordion).
   - Resize the window across xl/lg/md breakpoints to exercise the
     responsive grid.
6. Periodically check the four metrics below.

---

## What to watch in the Debug panel

| Metric | Healthy | Warning sign |
|---|---|---|
| **Event log** | Climbs to ≤2000 then plateaus | Stuck at 0 after scenarios — SSE down |
| **Peak buffer** | Plateaus at exactly 2000 once you've run enough | Climbing past 2000 — ring buffer broken |
| **Dropped (evicted)** | Grows by roughly (total events emitted − 2000) | Growing while buffer is below 2000 — eviction logic bug |
| **Oldest event** | Stays under ~30 minutes during a busy session | Drifts to multi-hour with low event volume — buffer not rolling |

Rule of thumb: once **Peak buffer** hits 2000, every new event should
match a new tick on **Dropped**. If those numbers diverge, the ring buffer
isn't doing its job.

---

## What to watch outside the panel

### SSE liveness (Network tab → EventStream filter)
Three streams must stay open the whole soak:
- `:9090/negotiate-events`
- `:8080/negotiate-events`
- `:7070/negotiate-events`

If any of them shows `(failed)` or is missing, the agent's SSE singleton
in `a2aService.ts` is supposed to reconnect — verify it does. The Theater
itself can't reconnect; it's a passive subscriber.

### GSAP context cleanup (Memory tab → Heap snapshot)
Take three snapshots: at start, after 10 scenarios, after 50 scenarios.
Filter for `gsap` and `Tween`. The retained counts should stabilize, not
climb unbounded. Common leak suspect: `MessageEnvelope` / `CredentialPacket`
keeping refs to completed timelines. Their `useEffect` cleanup calls
`tl.kill()` — if you see growth, suspect a path that doesn't reach the
cleanup (e.g. `reduce`-mode short-circuit; that path doesn't create a
timeline at all, so it can't leak).

### AnimatePresence exit completion
The Inspector, DDFocalOverlay, and DealCloseTableau all use
`motion/react`'s `AnimatePresence` for enter/exit. After many
mount/unmount cycles, no `motion.div` should be retained in the DOM
inspector with `display: none` or off-screen position. If you see
stale ones, the `<AnimatePresence mode>` config is wrong or `key` is
not changing.

### CPU during idle
After the last scenario settles, leave the page idle for 5 minutes. CPU
should drop to <1% in DevTools' Performance Monitor. If it stays elevated,
suspect:
- The infinite GSAP "thinking ring" loop in `TreasuryConsult` not being
  killed when `active` flips back to `false` (it tracks via `loopTlRef`).
- A `setInterval` in some debug code that wasn't cleared.
- The CSS keyframe pulse in `StateAura` running for an agent stuck in a
  non-resting state.

### prefers-reduced-motion (manual sanity check)
DevTools → Rendering → "Emulate CSS media feature
`prefers-reduced-motion: reduce`". Trigger each debug button. Confirm:
- River snaps to drawn end-state, no cascade.
- Envelopes vanish without flight.
- IPEX GRANT/ADMIT vanish without flight (still staggered by `delay`).
- Treasury consult overlay appears statically, no thinking-ring pulse.
- ACTUS badge appears, holds ~1.4s, vanishes — no scale.
- StateAura outer rings are flat (no breathing).
- Avatar discs don't scale on hover.

Untoggle and verify all animations resume.

---

## Reset between soak sessions

- **Debug → Clear log** zeroes `Event log`, `Peak buffer`, `Dropped` and
  empties the dedup set inside `useEventLog`. Use this between soak
  sessions if you want clean stats — but note the underlying SSE
  singletons in `a2aService.ts` keep running.
- A full page reload re-creates the SSE singletons too.

---

## Known non-leaks (don't panic)

- The event log's `peak` ref persists across `Cinema` mode toggles
  because `AgentTheater` doesn't unmount when you toggle — only the
  Debug accordion does. Expected.
- The `theater_presentation_mode` localStorage entry is intentional
  state, not a leak.
- The dedup `Set<string>` inside `useEventLog` grows monotonically per
  session (one entry per unique SSE message id). At ~50 chars per id ×
  thousands of events it's still trivial. Cleared by `Debug → Clear log`
  and by page reload.
