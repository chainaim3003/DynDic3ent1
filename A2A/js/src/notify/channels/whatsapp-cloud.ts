// ============================================================================
// src/notify/channels/whatsapp-cloud.ts  —  REMOVED
// ============================================================================
//
// The Meta Cloud API WhatsApp channel was retired from this codebase on
// 2026-05-18 because Meta business verification was never pursued for this
// project. The active WhatsApp channel is Twilio (`whatsapp-twilio.ts`).
//
// This file is intentionally empty. The original implementation can be
// recovered from git history if Meta is ever re-introduced — start from
// tag v1.0.7 or earlier.
//
// To restore Meta as an option:
//   1. Restore this file from git history (the original ~250-line adapter)
//   2. Re-import WhatsappCloudChannel in src/notify/router.ts
//   3. Re-add the `else if (ch.impl === "whatsapp-cloud")` branch there
//   4. Add a `wa-meta-*` channel block to config/notification-routing.yaml
//   5. Set META_TEST_PHONE_ID, META_SYSTEM_USER_TOKEN, META_WABA_ID in .env
//
// ============================================================================

export {};
