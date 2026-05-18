// ============================================================================
// src/notify/config.ts  —  Iteration 15: YAML config loader (no hardcoding)
// ============================================================================
//
// Loads config/notification-routing.yaml, substitutes ${ENV_VAR} placeholders
// from process.env, validates the shape, and returns a typed config object.
//
// If the YAML is missing or unreadable, returns an empty config — the system
// continues to function (UI dashboard works via the existing SSEBroadcaster);
// only the WhatsApp side goes silent. This is intentional: notification
// failures must NEVER stop a negotiation.
//
// ============================================================================

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// project root is A2A/js (config/ sits alongside src/)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH  = process.env.NOTIFICATION_ROUTING_CONFIG
                   ?? path.join(PROJECT_ROOT, "config", "notification-routing.yaml");

/** Shape of the parsed config. Mirrors notification-routing.yaml. */
export interface NotificationConfig {
  channels:   ChannelConfig[];
  recipients: RecipientConfig[];
  defaults?: {
    quietHours?: { startHour?: number; endHour?: number; tz?: string };
  };
}
export interface ChannelConfig {
  id:   string;
  kind: "whatsapp" | "sms" | "email" | "ui-dashboard";
  impl: string;          // "whatsapp-twilio" | "ui-dashboard"
  mode: "test-number" | "production" | "bsp" | "n/a";
  config: Record<string, any>;
}
export interface RecipientConfig {
  role:            string;
  legalEntityName: string;
  lei?:            string;
  channels: Array<{
    channelId: string;
    events:    string[];
    address?:  Record<string, string>;
  }>;
}

/** Cached singleton — loaded once per process. */
let cached: NotificationConfig | null = null;

export function loadNotificationConfig(): NotificationConfig {
  if (cached) return cached;
  cached = doLoad();
  return cached;
}

function doLoad(): NotificationConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn(`[notify] config file not found at ${CONFIG_PATH} — notifications disabled (UI dashboard unaffected).`);
    return { channels: [], recipients: [] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (e: any) {
    console.warn(`[notify] could not read config: ${e?.message ?? e} — notifications disabled.`);
    return { channels: [], recipients: [] };
  }

  // Substitute ${ENV_VAR} placeholders BEFORE YAML parse so env-templated
  // values can be unquoted scalars or appear inside maps.
  const substituted = substituteEnv(raw);

  let parsed: any;
  try {
    // tiny YAML parser to avoid a dep; we control the schema so we can be strict
    parsed = parseTinyYaml(substituted);
  } catch (e: any) {
    console.error(`[notify] YAML parse failed: ${e?.message ?? e}`);
    return { channels: [], recipients: [] };
  }

  // Shape validation — tolerant: log + skip bad entries rather than throw.
  const channels: ChannelConfig[] = [];
  for (const c of (parsed.channels ?? [])) {
    if (!c.id || !c.kind || !c.impl || !c.mode) {
      console.warn(`[notify] skipping malformed channel entry: ${JSON.stringify(c)}`);
      continue;
    }
    channels.push({
      id:     String(c.id),
      kind:   c.kind,
      impl:   String(c.impl),
      mode:   c.mode,
      config: c.config ?? {},
    });
  }

  const recipients: RecipientConfig[] = [];
  for (const r of (parsed.recipients ?? [])) {
    if (!r.role || !Array.isArray(r.channels)) {
      console.warn(`[notify] skipping malformed recipient entry: ${JSON.stringify(r)}`);
      continue;
    }
    recipients.push({
      role:            String(r.role),
      legalEntityName: String(r.legalEntityName ?? r.role),
      lei:             r.lei ? String(r.lei) : undefined,
      channels:        r.channels.map((cs: any) => ({
        channelId: String(cs.channelId),
        events:    Array.isArray(cs.events) ? cs.events.map(String) : [],
        address:   cs.address ?? undefined,
      })),
    });
  }

  return {
    channels,
    recipients,
    defaults: parsed.defaults ?? undefined,
  };
}

// ── ${ENV_VAR} substitution ────────────────────────────────────────────────

function substituteEnv(input: string): string {
  // Match ${VAR_NAME} or ${VAR_NAME:-fallback}
  return input.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, fallback) => {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v;
    if (fallback !== undefined)     return fallback;
    // Leave unresolved; the channel will surface the failure honestly in
    // its initialize() rather than us silently injecting empty strings.
    return `\${${name}}`;
  });
}

// ── Minimal YAML parser ────────────────────────────────────────────────────
// We avoid pulling in the `yaml` package as a dep. Our schema is small,
// well-known, and we control it: support `key: value`, nested maps with
// indentation, arrays via `-`. No anchors, no flow style. If the user
// adds something exotic, we fail loud and they fix it.

function parseTinyYaml(text: string): any {
  const lines = text.split(/\r?\n/);
  // Strip comments and blank lines
  const cleaned: { indent: number; line: string; raw: string; n: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i];
    const commentIdx = findCommentStart(raw);
    const noComment = (commentIdx >= 0 ? raw.slice(0, commentIdx) : raw).replace(/\s+$/, "");
    if (noComment.trim() === "") continue;
    const indent = noComment.length - noComment.trimStart().length;
    cleaned.push({ indent, line: noComment.trimStart(), raw, n: i + 1 });
  }
  // Recursive descent
  const [val] = parseBlock(cleaned, 0, 0);
  return val;
}

function findCommentStart(s: string): number {
  // # only counts as comment when not inside quotes; we don't allow # in our values
  let inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD) return i;
  }
  return -1;
}

function parseBlock(rows: { indent: number; line: string; n: number }[], start: number, baseIndent: number): [any, number] {
  if (start >= rows.length) return [null, start];

  const first = rows[start];
  if (first.line.startsWith("- ") || first.line === "-") {
    // Array
    const arr: any[] = [];
    let i = start;
    while (i < rows.length && rows[i].indent === baseIndent && (rows[i].line.startsWith("- ") || rows[i].line === "-")) {
      const itemLine = rows[i].line.slice(2).trim();
      if (itemLine === "") {
        // Block child after "-"
        const [child, next] = parseBlock(rows, i + 1, baseIndent + 2);
        arr.push(child);
        i = next;
      } else if (itemLine.includes(":") && !itemLine.match(/^[^"']*:\s*[^\s].*$/) ) {
        // looks like inline map starting on same line as "-"; treat first key, then continue indented block
        const inlineKV = parseInlineMap(itemLine);
        const [more, next] = parseBlock(rows, i + 1, baseIndent + 2);
        arr.push({ ...inlineKV, ...(more && typeof more === "object" ? more : {}) });
        i = next;
      } else if (itemLine.match(/^[^:]+:\s*$/)) {
        // "- key:" with block under it
        const key = itemLine.slice(0, -1).trim();
        const [child, next] = parseBlock(rows, i + 1, baseIndent + 2);
        arr.push({ [key]: child });
        i = next;
      } else if (itemLine.match(/^[^:]+:\s+\S/)) {
        // "- key: value" with more keys following at the indented level
        const inline = parseInlineMap(itemLine);
        // peek: is the next row deeper-indented?
        if (i + 1 < rows.length && rows[i + 1].indent > baseIndent) {
          const [more, next] = parseBlock(rows, i + 1, rows[i + 1].indent);
          arr.push({ ...inline, ...(more && typeof more === "object" ? more : {}) });
          i = next;
        } else {
          arr.push(inline);
          i++;
        }
      } else {
        // Scalar item
        arr.push(coerceScalar(itemLine));
        i++;
      }
    }
    return [arr, i];
  }

  // Map
  const map: Record<string, any> = {};
  let i = start;
  while (i < rows.length && rows[i].indent === baseIndent && !rows[i].line.startsWith("- ")) {
    const colon = rows[i].line.indexOf(":");
    if (colon < 0) throw new Error(`Line ${rows[i].n}: expected "key:" in ${JSON.stringify(rows[i].line)}`);
    const key = rows[i].line.slice(0, colon).trim();
    const rest = rows[i].line.slice(colon + 1).trim();
    if (rest === "") {
      // Block child
      if (i + 1 < rows.length && rows[i + 1].indent > baseIndent) {
        const [child, next] = parseBlock(rows, i + 1, rows[i + 1].indent);
        map[key] = child;
        i = next;
      } else {
        map[key] = null;
        i++;
      }
    } else if (rest.startsWith("{") && rest.endsWith("}")) {
      // Inline map: { phoneE164: "+91..." }
      map[key] = parseFlowMap(rest);
      i++;
    } else if (rest.startsWith("[") && rest.endsWith("]")) {
      // Inline array
      map[key] = parseFlowArray(rest);
      i++;
    } else {
      map[key] = coerceScalar(rest);
      i++;
    }
  }
  return [map, i];
}

function parseInlineMap(s: string): Record<string, any> {
  // "key: value" → { key: value }
  const colon = s.indexOf(":");
  if (colon < 0) return {};
  const k = s.slice(0, colon).trim();
  const v = s.slice(colon + 1).trim();
  return { [k]: coerceScalar(v) };
}
function parseFlowMap(s: string): Record<string, any> {
  const inner = s.slice(1, -1).trim();
  const out: Record<string, any> = {};
  if (!inner) return out;
  for (const part of splitTopLevel(inner, ",")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    out[part.slice(0, colon).trim()] = coerceScalar(part.slice(colon + 1).trim());
  }
  return out;
}
function parseFlowArray(s: string): any[] {
  const inner = s.slice(1, -1).trim();
  if (!inner) return [];
  return splitTopLevel(inner, ",").map(p => coerceScalar(p.trim()));
}
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, inS = false, inD = false, buf = "";
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === "{" || c === "[") depth++;
      else if (c === "}" || c === "]") depth--;
      else if (c === sep && depth === 0) { out.push(buf); buf = ""; continue; }
    }
    buf += c;
  }
  if (buf.length) out.push(buf);
  return out;
}
function coerceScalar(s: string): any {
  const t = s.trim();
  if (t === "") return null;
  if (t === "null" || t === "~") return null;
  if (t === "true")  return true;
  if (t === "false") return false;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  // Strip surrounding quotes
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
