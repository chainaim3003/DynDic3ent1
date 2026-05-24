/**
 * gsap-setup — one-time GSAP plugin registration for the Theater
 * ---------------------------------------------------------------------------
 * Import this module ONCE at the top of any theater component that uses GSAP.
 * The plugin registration is idempotent — multiple imports are safe.
 *
 * Plugins registered here:
 *   - MotionPathPlugin  — bezier flights for envelopes (Phase 3a)
 *   - DrawSVGPlugin     — verification river cascade           (Phase 3b)
 *
 * Plugins to add in later phases (all free as of GSAP 3.13, May 2024 acquisition):
 *   - MorphSVGPlugin    — envelope ↔ document shape morph (Phase 3 polish)
 *   - Flip              — treasury consult zoom (Phase 3c)
 *   - ScrollTrigger     — timeline scrubber (Phase 4)
 *
 * Why a separate module: putting gsap.registerPlugin() inside a component
 * causes it to run on every render. A dedicated module + side-effect import
 * runs it exactly once when the file is first evaluated.
 */

import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';

gsap.registerPlugin(MotionPathPlugin, DrawSVGPlugin);

// Re-export for convenience so consumers can `import { gsap } from
// '@/theater/stage/gsap-setup'` and be sure plugins are registered.
export { gsap };
