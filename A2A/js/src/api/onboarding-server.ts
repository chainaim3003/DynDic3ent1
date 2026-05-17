// ================= ONBOARDING API SERVER =================
// Customer-facing API for registering counterparties. Replaces all hardcoded
// LEIs in the codebase with a real, auditable onboarding flow.
//
// Endpoints:
//   POST   /api/onboard-counterparty   register a new agent identity
//   GET    /api/counterparties         list onboarded agents
//   GET    /api/counterparties/:name   get one
//   DELETE /api/counterparties/:name   tombstone one (no hard delete)
//   GET    /health                     liveness probe
//
// NO mocks. NO hardcoded LEIs. NO fallback to local-only validation.

import express, { Request, Response } from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

import { checkCompliance } from "../utils/compliance/gleif-client.js";
import {
  loadAgentCard,
  writeLiveAgentCard,
  AgentCardOnDisk,
} from "../identity/agent-card-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config({ path: path.join(process.cwd(), ".env") });

interface OnboardRequest {
  leiCode:    string;
  agentRole:  "seller" | "buyer";
  agentName:  string;
  oorOfficer: string;
  url?:       string;
}

interface OnboardResponse {
  ok:               boolean;
  agentName:        string;
  agentCardPath?:   string;
  lei:              string;
  legalEntityName?: string;
  leiStatus?:       string;
  entityStatus?:    string;
  country?:         string;
  checksPerformed:  string[];
  warnings:         string[];
  errors:           string[];
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "onboarding", at: new Date().toISOString() });
});

app.post("/api/onboard-counterparty", async (req: Request, res: Response) => {
  const body = req.body as Partial<OnboardRequest>;

  // ── Input validation ──────────────────────────────────────────────────
  const validationErrors: string[] = [];
  if (!body.leiCode    || typeof body.leiCode    !== "string") validationErrors.push("leiCode is required (string)");
  if (!body.agentRole  || (body.agentRole !== "seller" && body.agentRole !== "buyer"))
    validationErrors.push("agentRole must be 'seller' or 'buyer'");
  if (!body.agentName  || typeof body.agentName  !== "string") validationErrors.push("agentName is required (string)");
  if (!body.oorOfficer || typeof body.oorOfficer !== "string") validationErrors.push("oorOfficer is required (string)");

  if (validationErrors.length > 0) {
    return res.status(400).json({
      ok:              false,
      agentName:       body.agentName ?? "",
      lei:             body.leiCode  ?? "",
      checksPerformed: [],
      warnings:        [],
      errors:          validationErrors,
    } satisfies OnboardResponse);
  }

  // ── Real GLEIF compliance check ──────────────────────────────────────
  const compliance = await checkCompliance(body.leiCode!, { forceFresh: true });

  if (!compliance.ok) {
    return res.status(400).json({
      ok:               false,
      agentName:        body.agentName!,
      lei:              body.leiCode!,
      checksPerformed:  compliance.checksPerformed,
      warnings:         compliance.warnings,
      errors:           compliance.errors,
    } satisfies OnboardResponse);
  }

  // ── Check the name isn't already onboarded ───────────────────────────
  const existing = loadAgentCard(body.agentName!);
  if (existing && existing.origin === "live") {
    return res.status(409).json({
      ok:               false,
      agentName:        body.agentName!,
      lei:              body.leiCode!,
      checksPerformed:  compliance.checksPerformed,
      warnings:         compliance.warnings,
      errors:           [`Agent "${body.agentName}" already onboarded. DELETE first to replace.`],
    } satisfies OnboardResponse);
  }

  // ── Build agent card ─────────────────────────────────────────────────
  const rec  = compliance.record!;
  const port = body.agentRole === "seller" ? 8080 : 9090;
  const card: AgentCardOnDisk = {
    name:        formatDisplayName(body.agentName!),
    description: `${body.agentRole === "seller" ? "Seller" : "Buyer"} agent for ${rec.legalEntityName}, onboarded via API.`,
    url:         body.url ?? `http://localhost:${port}/`,
    // A2A SDK requires version + capabilities + at-least-one skill
    version: "1.0.0",
    capabilities: {
      streaming:              true,
      stateTransitionHistory: true,
    },
    skills: [
      {
        id:          body.agentRole === "seller" ? "procurement_management" : "purchase_order_management",
        name:        body.agentRole === "seller" ? "Procurement Management"  : "Purchase Order Management",
        description: `${body.agentRole === "seller" ? "Negotiates incoming purchase orders and manages sales fulfillment" : "Submits, negotiates, and tracks purchase orders"} on behalf of ${rec.legalEntityName}.`,
        tags:        [body.agentRole, "negotiation", "trade", "gleif", "compliance"],
      },
    ],
    provider: {
      organization: rec.legalEntityName,
    },
    extensions: {
      gleifIdentity: {
        lei:             rec.lei,
        legalEntityName: rec.legalEntityName,
        officialRole:    body.oorOfficer!,
      },
      vLEImetadata: {
        agentName:        body.agentName!,
        oorHolderName:    body.oorOfficer!,
        verificationPath: [
          `GLEIF[${rec.lei}/${rec.registrationStatus}]`,
          `legalEntity[${rec.legalEntityName}]`,
          `agent[${body.agentName}]  (plain mode — no cryptographic delegation)`,
        ],
      },
      keriIdentifiers: {
        agentAID:       "",
        oorHolderAID:   "",
        legalEntityAID: "",
        qviAID:         "",
      },
      onboarding: {
        onboardedAt: new Date().toISOString(),
        onboardedBy: "api/onboard-counterparty",
        mode:        "plain",
      },
    },
  };

  const fullPath = writeLiveAgentCard(body.agentName!, card);

  return res.json({
    ok:               true,
    agentName:        body.agentName!,
    agentCardPath:    path.relative(process.cwd(), fullPath),
    lei:              rec.lei,
    legalEntityName:  rec.legalEntityName,
    leiStatus:        rec.registrationStatus,
    entityStatus:     rec.entityStatus,
    country:          rec.country,
    checksPerformed:  compliance.checksPerformed,
    warnings:         compliance.warnings,
    errors:           [],
  } satisfies OnboardResponse);
});

app.get("/api/counterparties", (_req, res) => {
  const dir = process.env.LIVE_AGENT_CARDS_DIR ?? path.join(process.cwd(), "live-agent-cards");
  if (!fs.existsSync(dir)) return res.json({ ok: true, counterparties: [] });
  const files = fs.readdirSync(dir).filter(f => f.endsWith("-card.json"));
  const list  = files.map(f => {
    try {
      const raw  = fs.readFileSync(path.join(dir, f), "utf8");
      const card = JSON.parse(raw);
      const ext  = card.extensions ?? {};
      return {
        agentName:        f.replace("-card.json", ""),
        displayName:      card.name,
        lei:              ext.gleifIdentity?.lei ?? "",
        legalEntityName:  ext.gleifIdentity?.legalEntityName ?? "",
        oorOfficer:       ext.vLEImetadata?.oorHolderName ?? "",
        mode:             ext.onboarding?.mode ?? "unknown",
        onboardedAt:      ext.onboarding?.onboardedAt ?? "",
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  res.json({ ok: true, counterparties: list });
});

app.get("/api/counterparties/:name", (req, res) => {
  const found = loadAgentCard(req.params.name);
  if (!found || found.origin !== "live") {
    return res.status(404).json({ ok: false, error: `Not found in live-agent-cards: ${req.params.name}` });
  }
  res.json({ ok: true, ...found.card, _origin: "live", _path: found.fullPath });
});

app.delete("/api/counterparties/:name", (req, res) => {
  const dir = process.env.LIVE_AGENT_CARDS_DIR ?? path.join(process.cwd(), "live-agent-cards");
  const filePath = path.join(dir, `${req.params.name}-card.json`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: `Not found: ${req.params.name}` });
  }
  const tombstoneDir = path.join(dir, ".tombstones");
  fs.mkdirSync(tombstoneDir, { recursive: true });
  const tombstonePath = path.join(tombstoneDir, `${req.params.name}-${Date.now()}-card.json`);
  fs.renameSync(filePath, tombstonePath);
  res.json({ ok: true, agentName: req.params.name, tombstonedAt: tombstonePath });
});

function formatDisplayName(agentName: string): string {
  return agentName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, c => c.toUpperCase())
    .trim();
}

const PORT = Number(process.env.ONBOARDING_PORT ?? 6060);
app.listen(PORT, () => {
  console.log(`\n📋  Onboarding API  →  http://localhost:${PORT}`);
  console.log(`    POST   /api/onboard-counterparty`);
  console.log(`    GET    /api/counterparties`);
  console.log(`    GET    /api/counterparties/:name`);
  console.log(`    DELETE /api/counterparties/:name`);
  console.log(`    GET    /health`);
  console.log(`    Live cards dir: ${process.env.LIVE_AGENT_CARDS_DIR ?? "./live-agent-cards"}`);
  console.log(`    Demo cards dir: ${process.env.DEMO_AGENT_CARDS_DIR ?? "./demo-agent-cards"}`);
  console.log(`    GLEIF API     : ${process.env.GLEIF_API_URL ?? "https://api.gleif.org/api/v1"}\n`);
});
