// ================= AGENT CARD LOADER =================
// Shared agent-card I/O used by all providers. Looks up cards in this order:
//   1. LIVE_AGENT_CARDS_DIR (customer-onboarded cards, written by /api/onboard-counterparty)
//   2. DEMO_AGENT_CARDS_DIR (demo Tommy + Jupiter cards, source-controlled)
//
// If both exist, live wins. Honest console warning when both directories have
// the same card.

import fs   from "node:fs";
import path from "node:path";

export interface AgentCardOnDisk {
  name:        string;
  description?: string;
  url?:         string;
  provider?: { organization?: string; url?: string };
  extensions?: {
    gleifIdentity?: {
      lei?: string;
      legalEntityName?: string;
      officialRole?: string;
    };
    vLEImetadata?: {
      agentName?: string;
      oorHolderName?: string;
      verificationPath?: string[];
    };
    keriIdentifiers?: {
      agentAID?: string;
      oorHolderAID?: string;
      legalEntityAID?: string;
      qviAID?: string;
      publicKey?: string;
    };
    /** Iteration 1 extension — onboarding metadata. */
    onboarding?: {
      onboardedAt?: string;
      onboardedBy?: string;
      mode?: "plain" | "vlei";
    };
  };
  // Tolerate any extra fields the existing demo cards have
  [key: string]: unknown;
}

export interface AgentCardSearchResult {
  card:     AgentCardOnDisk;
  fullPath: string;
  origin:   "live" | "demo";
}

function liveDir(): string {
  return process.env.LIVE_AGENT_CARDS_DIR
      ?? path.join(process.cwd(), "live-agent-cards");
}

function demoDir(): string {
  return process.env.DEMO_AGENT_CARDS_DIR
      ?? path.join(process.cwd(), "demo-agent-cards");
}

/**
 * Find and load an agent card by name. Checks `live` first, then `demo`.
 * Returns null if neither directory has it.
 *
 * Logs a warning if the same agent exists in both directories — this usually
 * means the customer onboarded a counterparty that has the same agent name
 * as a demo card; the live one wins but the customer should know.
 */
export function loadAgentCard(agentName: string): AgentCardSearchResult | null {
  const livePath = path.join(liveDir(), `${agentName}-card.json`);
  const demoPath = path.join(demoDir(), `${agentName}-card.json`);

  const liveExists = fs.existsSync(livePath);
  const demoExists = fs.existsSync(demoPath);

  if (liveExists && demoExists) {
    console.warn(
      `[identity] Agent card "${agentName}" exists in BOTH live and demo dirs — using live`
    );
  }

  const chosenPath = liveExists ? livePath : (demoExists ? demoPath : null);
  if (!chosenPath) return null;

  const raw  = fs.readFileSync(chosenPath, "utf8");
  const card = JSON.parse(raw) as AgentCardOnDisk;
  return {
    card,
    fullPath: chosenPath,
    origin:   liveExists ? "live" : "demo",
  };
}

/** Write a new agent card to the LIVE directory (used by onboarding). */
export function writeLiveAgentCard(agentName: string, card: AgentCardOnDisk): string {
  const dir = liveDir();
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, `${agentName}-card.json`);
  fs.writeFileSync(fullPath, JSON.stringify(card, null, 2), "utf8");
  return fullPath;
}
