#!/usr/bin/env node
// ================= NEGOTIATION CLIENT CLI =================

import readline from "node:readline";
import crypto   from "node:crypto";

import {
  MessageSendParams,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
  Task,
  AgentCard,
  Part,
} from "@a2a-js/sdk";
import { A2AClient } from "@a2a-js/sdk/client";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
};

const dim    = (s: string) => `${C.dim}${s}${C.reset}`;
const bold   = (s: string) => `${C.bold}${s}${C.reset}`;
const green  = (s: string) => `${C.green}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const cyan   = (s: string) => `${C.cyan}${s}${C.reset}`;
const red    = (s: string) => `${C.red}${s}${C.reset}`;

// ── State ─────────────────────────────────────────────────────────────────────
let currentTaskId:    string | undefined;
let currentContextId: string | undefined;

const serverUrl = process.argv[2] || "http://localhost:41241";
const client    = new A2AClient(serverUrl);
let   agentName = "Agent";

// ── Readline ──────────────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
  prompt: `\n${C.cyan}You${C.reset}${C.dim} ›${C.reset} `,
});

// ── Pretty-print an agent response ───────────────────────────────────────────
const BAR_W = 58;

function printAgentResponse(text: string) {
  if (!text.trim()) return;

  const ts    = new Date().toLocaleTimeString();
  const lines = text.split("\n");
  const bar   = `${C.dim}${"─".repeat(BAR_W)}${C.reset}`;

  // Header row: agent name + timestamp
  console.log("");
  console.log(
    `  ${C.cyan}${C.bold}${agentName}${C.reset}` +
    `  ${C.dim}·  ${ts}${C.reset}`
  );
  console.log(`  ${bar}`);

  // Content lines — uniform left-padding + vertical bar
  for (const line of lines) {
    console.log(`  ${C.dim}│${C.reset}  ${line}`);
  }

  console.log(`  ${bar}`);
}

// ── Extract all text parts from an A2A message ────────────────────────────────
function extractText(parts: Part[]): string {
  return parts
    .filter((p) => p.kind === "text")
    .map((p) => (p as any).text as string)
    .join("\n")
    .trim();
}

// ── Process one stream event ──────────────────────────────────────────────────
function handleEvent(event: any) {
  if (event.kind === "status-update") {
    const e    = event as TaskStatusUpdateEvent;
    const text = e.status.message ? extractText(e.status.message.parts) : "";
    if (!currentTaskId)    currentTaskId    = e.taskId;
    if (!currentContextId) currentContextId = e.contextId;
    if (text) printAgentResponse(text);

  } else if (event.kind === "artifact-update") {
    const e    = event as TaskArtifactUpdateEvent;
    const text = extractText(e.artifact.parts);
    if (text) printAgentResponse(text);

  } else if (event.kind === "message") {
    const e    = event as Message;
    const text = extractText(e.parts);
    if (e.taskId    && e.taskId    !== currentTaskId)    currentTaskId    = e.taskId;
    if (e.contextId && e.contextId !== currentContextId) currentContextId = e.contextId;
    if (text) printAgentResponse(text);

  } else if (event.kind === "task") {
    const e    = event as Task;
    if (e.id        !== currentTaskId)    currentTaskId    = e.id;
    if (e.contextId !== currentContextId) currentContextId = e.contextId;
    const text = e.status.message ? extractText(e.status.message.parts) : "";
    if (text) printAgentResponse(text);
  }
}

// ── Agent card ────────────────────────────────────────────────────────────────
async function fetchAgentCard() {
  try {
    const card: AgentCard = await client.getAgentCard();
    agentName = card.name || "Agent";
    console.log(`  ${green("✓")}  Connected to: ${bold(agentName)}`);
    if (card.description) {
      // Wrap description at 70 chars
      const words = card.description.split(" ");
      let line = "";
      for (const w of words) {
        if ((line + w).length > 70) { console.log(dim(`     ${line.trim()}`)); line = ""; }
        line += w + " ";
      }
      if (line.trim()) console.log(dim(`     ${line.trim()}`));
    }
  } catch {
    console.log(yellow(`  ⚠  Could not reach agent at ${serverUrl} — is it running?`));
    throw new Error("Agent unreachable");
  }
}

// ── Startup banner ────────────────────────────────────────────────────────────
function printBanner(url: string) {
  const W = 58;
  const hr = "═".repeat(W);
  console.log(`\n  ${C.bold}╔${hr}╗${C.reset}`);
  console.log(`  ${C.bold}║${"  NEGOTIATION CLIENT".padEnd(W)}║${C.reset}`);
  console.log(`  ${C.bold}╚${hr}╝${C.reset}`);
  console.log(dim(`  Agent URL : ${url}`));
  console.log("");
}

function printHelp() {
  const W    = 58;
  const rows: [string, string][] = [
    ["start negotiation",         "begin negotiation (random opening price)"],
    ["start negotiation <price>", "begin negotiation at a specific price"],
    ["/new",                      "reset session (start fresh)"],
    ["/exit",                     "quit"],
  ];
  const cmdW = Math.max(...rows.map(([c]) => c.length)) + 2;

  console.log(dim(`  ${"─".repeat(W)}`));
  console.log(dim("  COMMANDS"));
  console.log(dim(`  ${"─".repeat(W)}`));
  for (const [cmd, desc] of rows) {
    console.log(`  ${C.cyan}${cmd.padEnd(cmdW)}${C.reset}${C.dim}${desc}${C.reset}`);
  }
  console.log(dim(`  ${"─".repeat(W)}`));
  console.log(dim("  DD is handled autonomously by the buyer agent."));
  console.log(dim(`  ${"─".repeat(W)}`));
  console.log("");
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  printBanner(serverUrl);
  await fetchAgentCard();
  printHelp();

  rl.setPrompt(`\n${C.cyan}You${C.reset}${C.dim} ›${C.reset} `);
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input.toLowerCase() === "/new") {
      currentTaskId    = undefined;
      currentContextId = undefined;
      console.log(dim("\n  Session reset."));
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === "/exit") {
      rl.close();
      return;
    }

    const messagePayload: Message = {
      messageId: crypto.randomUUID(),
      kind:      "message",
      role:      "user",
      parts:     [{ kind: "text", text: input }],
    };
    if (currentTaskId)    messagePayload.taskId    = currentTaskId;
    if (currentContextId) messagePayload.contextId = currentContextId;

    try {
      const stream = client.sendMessageStream({ message: messagePayload } as MessageSendParams);
      for await (const event of stream) {
        handleEvent(event);
      }
    } catch (error: any) {
      console.error(red(`\n  Error: ${error.message || error}`));
    } finally {
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log(yellow("\n  Goodbye!\n"));
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(red("  Fatal error:"), err);
  process.exit(1);
});
