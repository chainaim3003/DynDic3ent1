// ================= BOOTSTRAP DEMO COUNTERPARTIES =================
// Loads Tommy and Jupiter into live-agent-cards/ via the SAME onboarding API
// path a customer uses. This means the demo isn't "special" — Tommy and
// Jupiter are onboarded exactly the way any customer counterparty is.
//
// Usage:
//   1. Start the onboarding server: npm run api:onboarding
//   2. Run this script: npm run bootstrap:demo
//
// Honest about what this does:
//   - It DOES call the real GLEIF API (no mocks)
//   - It does NOT pre-populate KERI/vLEI metadata. The plain-mode card written
//     by the API has empty KERI AIDs by design. For vLEI-mode demos, use the
//     existing demo-agent-cards/ which DO have KERI metadata.
//   - If the onboarding API is unreachable, this script fails — no fallback.

const ONBOARDING_URL = process.env.ONBOARDING_URL ?? "http://localhost:6060";

interface CounterpartySpec {
  leiCode:    string;
  agentRole:  "seller" | "buyer";
  agentName:  string;
  oorOfficer: string;
}

const DEMO_COUNTERPARTIES: CounterpartySpec[] = [
  {
    leiCode:    "54930012QJWZMYHNJW95",
    agentRole:  "buyer",
    agentName:  "tommyBuyerAgent",
    oorOfficer: "Tommy_Chief_Procurement_Officer",
  },
  {
    leiCode:    "3358004DXAMRWRUIYJ05",
    agentRole:  "seller",
    agentName:  "jupiterSellerAgent",
    oorOfficer: "Jupiter_Chief_Sales_Officer",
  },
];

async function ensureOnboardingServerUp(): Promise<void> {
  try {
    const resp = await fetch(`${ONBOARDING_URL}/health`);
    if (!resp.ok) throw new Error(`Health check returned HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`✓ Onboarding API up at ${ONBOARDING_URL} (${data.service})`);
  } catch (err: any) {
    console.error(`❌ Onboarding API not reachable at ${ONBOARDING_URL}`);
    console.error(`   Start it with: npm run api:onboarding`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

async function onboardOne(spec: CounterpartySpec): Promise<void> {
  console.log(`\n→ Onboarding ${spec.agentName} (LEI ${spec.leiCode}, role ${spec.agentRole})`);

  const resp = await fetch(`${ONBOARDING_URL}/api/onboard-counterparty`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(spec),
  });

  const body = await resp.json() as {
    ok: boolean; lei: string; legalEntityName?: string; leiStatus?: string;
    entityStatus?: string; country?: string; agentCardPath?: string;
    checksPerformed: string[]; warnings: string[]; errors: string[];
  };

  if (!body.ok) {
    // 409 conflict (already onboarded) is OK — print and continue
    if (resp.status === 409) {
      console.log(`  ⚠ Already onboarded — skipping (delete via DELETE first to replace)`);
      return;
    }
    console.error(`  ❌ Onboarding failed:`);
    for (const e of body.errors)   console.error(`     - ${e}`);
    for (const w of body.warnings) console.error(`     ⚠ ${w}`);
    process.exit(1);
  }

  console.log(`  ✓ LEI               : ${body.lei}`);
  console.log(`  ✓ Legal entity      : ${body.legalEntityName}`);
  console.log(`  ✓ Registration      : ${body.leiStatus}`);
  console.log(`  ✓ Entity status     : ${body.entityStatus}`);
  console.log(`  ✓ Country           : ${body.country}`);
  console.log(`  ✓ Card written to   : ${body.agentCardPath}`);
  console.log(`  ✓ Checks performed  : ${body.checksPerformed.join(", ")}`);
  if (body.warnings.length > 0) {
    for (const w of body.warnings) console.log(`  ⚠ ${w}`);
  }
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Bootstrap Demo Counterparties (Tommy + Jupiter)         ║");
  console.log("║  Iteration 1: real GLEIF lookups via the onboarding API  ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  await ensureOnboardingServerUp();

  for (const spec of DEMO_COUNTERPARTIES) {
    await onboardOne(spec);
  }

  console.log("\n✓ Bootstrap complete. live-agent-cards/ now contains:");
  console.log("   - tommyBuyerAgent-card.json");
  console.log("   - jupiterSellerAgent-card.json");
  console.log("\nNote: these are plain-mode cards (no KERI AIDs). For vLEI-mode");
  console.log("demos, the agents fall through to demo-agent-cards/ which have");
  console.log("full KERI metadata pre-populated.");
  console.log("\nStart the agents and run a negotiation as usual.");
}

main().catch(err => {
  console.error("\n❌ Bootstrap failed:", err);
  process.exit(1);
});
