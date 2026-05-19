// ================= JUPITER LOGISTICS SUB-AGENT =================
// Carrier quotes + transit time sub-agent. Serves the same DEMO-DATA
// fixture that the in-process LogisticsProvider currently reads, but over
// HTTP so it can run as a separate process on its own port.
//
// In M2-β real-mode (post-WEDGE1), this agent will call a DCSA Track &
// Trace conformant endpoint. For now (M2-γ demo path), it serves the
// handcrafted-to-spec fixture verbatim.
//
// REST interface (no A2A SDK):
//   POST /consult   — synchronous consultation
//   GET  /health    — liveness probe
//   GET  /fixture   — raw fixture for inspection

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const PORT          = Number(process.env.PORT ?? 7073);
const FIXTURE_FILE  = process.env.LOGISTICS_FIXTURE ?? "dcsa-MAA-LAX-50000units.json";
const SUBAGENT_NAME = "logistics";

function fixturePath(): string {
  return path.resolve(__dirname, "..", "..", "..", "DEMO-DATA", SUBAGENT_NAME, FIXTURE_FILE);
}

interface FixtureFile {
  __source?: Record<string, any>;
  result?:   Record<string, any>;
}

function loadFixture(): { ok: true; data: FixtureFile } | { ok: false; error: string } {
  const p = fixturePath();
  if (!fs.existsSync(p)) {
    return { ok: false, error: `fixture not found: ${p}` };
  }
  try {
    const raw = fs.readFileSync(p, "utf8");
    return { ok: true, data: JSON.parse(raw) as FixtureFile };
  } catch (err: any) {
    return { ok: false, error: `fixture read/parse failed: ${err?.message ?? err}` };
  }
}

function logConsultation(input: Record<string, unknown>, success: boolean, summary: string) {
  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m",
  };
  const ts = new Date().toISOString();
  console.log("");
  console.log(`  ${C.cyan}${C.bold}  🚢  LOGISTICS CONSULTATION — ${ts}${C.reset}`);
  console.log(`  ${C.dim}  Input    : ${JSON.stringify(input)}${C.reset}`);
  console.log(`  ${C.dim}  Fixture  : ${FIXTURE_FILE}${C.reset}`);
  if (success) {
    console.log(`  ${C.green}${C.bold}  ✓ ${summary}${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}  ✗ ${summary}${C.reset}`);
  }
  console.log("");
}

const app = express();
app.use(cors());
app.use(express.json());

app.post("/consult", (req, res) => {
  const performedAt = new Date().toISOString();
  const start       = Date.now();

  const input = req.body ?? {};
  if (typeof input.originPort !== "string" || typeof input.destinationPort !== "string") {
    const err = "missing required fields: originPort, destinationPort";
    logConsultation(input, false, err);
    res.status(400).json({
      metadata: {
        subAgent:   SUBAGENT_NAME,
        dataMode:   "real",
        performedAt,
        dataSource: `JupiterLogisticsAgent /consult @ http://localhost:${PORT}`,
        latencyMs:  Date.now() - start,
      },
      success: false,
      error:   err,
    });
    return;
  }

  const fixture = loadFixture();
  if (!fixture.ok) {
    logConsultation(input, false, fixture.error);
    res.status(500).json({
      metadata: {
        subAgent:   SUBAGENT_NAME,
        dataMode:   "real",
        performedAt,
        dataSource: `JupiterLogisticsAgent /consult @ http://localhost:${PORT}`,
        latencyMs:  Date.now() - start,
      },
      success: false,
      error:   fixture.error,
    });
    return;
  }

  const { __source, result } = fixture.data;
  if (!__source || !result) {
    const err = "fixture missing __source or result block";
    logConsultation(input, false, err);
    res.status(500).json({
      metadata: {
        subAgent:   SUBAGENT_NAME,
        dataMode:   "real",
        performedAt,
        dataSource: `JupiterLogisticsAgent /consult @ http://localhost:${PORT}`,
        latencyMs:  Date.now() - start,
      },
      success: false,
      error:   err,
    });
    return;
  }

  // Sanity check carrier list — same defensive check the in-process provider does.
  if (!Array.isArray(result.carriers) || result.carriers.length === 0) {
    const err = "fixture has empty carriers array";
    logConsultation(input, false, err);
    res.status(500).json({
      metadata: {
        subAgent:   SUBAGENT_NAME,
        dataMode:   "real",
        performedAt,
        dataSource: `JupiterLogisticsAgent /consult @ http://localhost:${PORT}`,
        latencyMs:  Date.now() - start,
      },
      success: false,
      error:   err,
    });
    return;
  }

  const latencyMs = Date.now() - start;
  const response  = {
    metadata: {
      subAgent:       SUBAGENT_NAME,
      dataMode:       "real",
      performedAt,
      dataSource:     `JupiterLogisticsAgent /consult @ http://localhost:${PORT}`,
      demoSourceKind: __source.demoSourceKind ?? "fixture",
      demoSourceRef:  __source.demoSourceRef  ?? `DEMO-DATA/${SUBAGENT_NAME}/${FIXTURE_FILE}`,
      latencyMs,
    },
    success: true,
    result,
  };

  const summary = `${result.originPort}→${result.destinationPort} | ${result.carriers.length} carriers | bestRate=$${result.bestRateUsd} | ${latencyMs}ms`;
  logConsultation(input, true, summary);
  res.json(response);
});

app.get("/health", (_req, res) => {
  const fixture = loadFixture();
  res.json({
    status:   fixture.ok ? "ok" : "fixture-error",
    subAgent: SUBAGENT_NAME,
    port:     PORT,
    fixture:  FIXTURE_FILE,
    fixturePath: fixturePath(),
    fixtureLoadable: fixture.ok,
    fixtureError: fixture.ok ? null : fixture.error,
  });
});

app.get("/fixture", (_req, res) => {
  const fixture = loadFixture();
  if (!fixture.ok) {
    res.status(500).json({ error: fixture.error });
    return;
  }
  res.json(fixture.data);
});

app.listen(PORT, () => {
  const fixture = loadFixture();
  console.log("");
  console.log(`🚢  Jupiter Logistics Sub-Agent  →  http://localhost:${PORT}`);
  console.log(`    Fixture file       : ${FIXTURE_FILE}`);
  console.log(`    Fixture path       : ${fixturePath()}`);
  console.log(`    Fixture loadable   : ${fixture.ok ? "yes" : "NO — " + fixture.error}`);
  console.log(`    REST endpoint      : POST http://localhost:${PORT}/consult`);
  console.log(`    Health probe       : GET  http://localhost:${PORT}/health`);
  console.log(`    Fixture dump       : GET  http://localhost:${PORT}/fixture`);
  console.log("");
});
