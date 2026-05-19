// ================= WEDGE1 / GUARANTEE A — LEGACY CLI DUAL-PARSER =================
//
// Detects which form of "start negotiation" the user invoked and returns a
// discriminated union telling the caller how to route it.
//
// Three forms supported (form 3 added in PROJ1-DYN3-CONT8 / M2-ε):
//
//   1. LEGACY bare-number form (today's product — UNCHANGED behavior)
//      "start negotiation"          -> { form: "legacy" }                  (random opening)
//      "start negotiation 300"      -> { form: "legacy", price: 300 }
//      "start negotiation 250"      -> { form: "legacy", price: 250 }
//
//   2. WEDGE1 FLAGGED form (multi-dimensional, wired in once tier framework lands)
//      "start negotiation --product COTTON-180GSM --qty 50000
//                         --buyer-budget 400 --buyer-style aggressive
//                         --buyer-deadline 2026-06-15"
//
//   3. CONT8 SCENARIO form (intent-driven; loads a named scenario from
//      src/shared/scenarios/*.json and resolves it to a flagged-form-shaped
//      result plus a full scenarioIntent attached)
//      "start negotiation --scenario happy-path-cotton"
//
//      Today only situation.product, situation.quantity, and
//      buyerIntent.hardConstraints.maxBudgetPerUnit flow through to agent
//      behavior. Other intent fields (goal, style, soft preferences,
//      walk-away, sellerIntent) are attached as parsedResult.scenarioIntent
//      for the buyer agent to log; full honoring is deferred to a future
//      CONT iteration (FRAMEWORK-V2 §12 D7 if/when added).
//
// Anything that doesn't begin with "start negotiation" returns null - the
// caller treats that as "not a negotiation command" and continues to its
// other checks (DD flow, data parts, etc).
//
// Anything that DOES begin with "start negotiation" but is malformed returns
// { form: "invalid", error: "..." } - the caller renders the error message
// back to the user. This is more informative than silently ignoring bad input.
//
// Guarantee A invariant:
//   parseNegotiationCommand("start negotiation 300") MUST return
//   { form: "legacy", price: 300 } - byte-identical to today's behavior path.
//   The regression test (scripts/test-cli-parser.ts) enforces this.
//
// IMPORTANT: this parser receives the input AFTER buyer-agent's execute()
// has already lowercased it. So all inputs to this function are lowercase.
// That matches the existing buyer-agent code style. If the flagged form ever
// needs case-preservation (e.g. for product codes), the buyer-agent's
// lowercase step needs to be revisited first.

import { loadScenario, listScenarioIds } from "./scenario-loader.js";
import type { Scenario } from "./intent-types.js";

export type ParsedNegotiationCommand =
  | { form: "legacy"; price?: number }
  | {
      form: "flagged";
      product:       string;
      quantity:      number;
      buyerBudget:   number;
      buyerStyle:    string;
      buyerDeadline: string;
      /** Set only when this result came from --scenario form 3 resolution.
       *  Buyer agent logs this; today does NOT use it to alter behavior.
       *  Future CONT iteration will wire it through to agent decisions. */
      scenarioIntent?: Scenario;
      /** Set only when scenarioIntent is set. List of fields declared in
       *  scenarioIntent that do NOT yet drive agent behavior — logged for
       *  honesty so the operator can see what's being skipped. */
      scenarioDeferred?: string[];
    }
  | { form: "invalid"; error: string };

/**
 * Parse a "start negotiation" command from the user.
 *
 * @param input  text from the user, already lowercased and trimmed by the
 *               caller (matching buyer-agent's existing convention)
 * @returns      a discriminated union, or null if `input` is not a negotiation
 *               command at all (caller continues to its other checks)
 */
export function parseNegotiationCommand(
  input: string,
): ParsedNegotiationCommand | null {
  const trimmed = input.trim();

  // Must start with "start negotiation". This is the cheapest discriminator
  // and matches the existing buyer-agent check (textInput.includes(...)).
  // Using startsWith here is stricter than includes() but legitimately so -
  // a message that merely *contains* "start negotiation" as a substring
  // (e.g. inside a question to the agent) should not trigger a new negotiation.
  if (!trimmed.startsWith("start negotiation")) {
    return null;
  }

  // Strip the "start negotiation" prefix, leaving the args.
  const rest = trimmed.slice("start negotiation".length).trim();

  // No args -> legacy with random opening price (today's behavior).
  if (rest === "") {
    return { form: "legacy" };
  }

  // First arg is a flag (starts with --) -> flagged form.
  if (rest.startsWith("--")) {
    return parseFlaggedForm(rest);
  }

  // First arg is a number -> legacy with explicit price.
  // Anchor the number to the start; reject "300 abc" as ambiguous.
  const numMatch = rest.match(/^(\d+)\s*$/);
  if (numMatch) {
    const price = parseInt(numMatch[1], 10);
    if (Number.isFinite(price) && price > 0) {
      return { form: "legacy", price };
    }
  }

  // Anything else after "start negotiation" is malformed.
  return {
    form: "invalid",
    error:
      `Unrecognized syntax after 'start negotiation': "${rest}". ` +
      `Use either 'start negotiation' / 'start negotiation <price>' ` +
      `(legacy) or 'start negotiation --product X --qty N --buyer-budget $ ` +
      `--buyer-style S --buyer-deadline D' (multi-dimensional, WEDGE1+).`,
  };
}

// --- Internal: flagged-form parser -----------------------------------------

function parseFlaggedForm(rest: string): ParsedNegotiationCommand {
  // Tokenize on whitespace. Simple --key value pairs. No quoted values yet -
  // if a future flag needs spaces in its value (e.g. an entity name), the
  // tokenizer here is the spot to upgrade.
  const tokens = rest.split(/\s+/);
  const flags: Record<string, string> = {};

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const val = tokens[i + 1] ?? "";
    // Don't consume the value if it's itself a flag - leave the missing
    // value detection to the required-flags check below.
    if (val.startsWith("--")) {
      flags[key] = "";
    } else {
      flags[key] = val;
      i++; // skip the value token
    }
  }

  // CONT8 / M2-ε — form 3 detection. If --scenario is present, we resolve
  // it via the loader, fill in the CLI-honored fields from the scenario's
  // intent + situation, and attach the full Scenario object as
  // scenarioIntent for the buyer agent to log. Any other flags passed
  // alongside --scenario are rejected as ambiguous (use one form or the other).
  if (flags["scenario"] !== undefined) {
    return resolveScenarioForm(flags);
  }

  const required = ["product", "qty", "buyer-budget", "buyer-style", "buyer-deadline"];
  const missing = required.filter(r => !flags[r]);
  if (missing.length > 0) {
    return {
      form: "invalid",
      error:
        `Flagged 'start negotiation' is missing required flag(s): ` +
        `${missing.map(m => "--" + m).join(", ")}. ` +
        `Full syntax: 'start negotiation --product X --qty N --buyer-budget $ ` +
        `--buyer-style S --buyer-deadline D'.`,
    };
  }

  // Validate numeric fields.
  const qty = parseInt(flags["qty"], 10);
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      form: "invalid",
      error: `--qty must be a positive integer, got: "${flags["qty"]}"`,
    };
  }
  const budget = parseFloat(flags["buyer-budget"]);
  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      form: "invalid",
      error: `--buyer-budget must be a positive number, got: "${flags["buyer-budget"]}"`,
    };
  }

  // Validate style is one of the known TKI five.
  const validStyles = ["aggressive", "assertive", "balanced", "cooperative", "win-win-seeking"];
  if (!validStyles.includes(flags["buyer-style"])) {
    return {
      form: "invalid",
      error:
        `--buyer-style must be one of: ${validStyles.join(", ")}. ` +
        `Got: "${flags["buyer-style"]}".`,
    };
  }

  // Validate deadline is parseable as a date.
  const deadlineMs = Date.parse(flags["buyer-deadline"]);
  if (Number.isNaN(deadlineMs)) {
    return {
      form: "invalid",
      error: `--buyer-deadline must be a parseable date (e.g. 2026-06-15), got: "${flags["buyer-deadline"]}"`,
    };
  }

  return {
    form:          "flagged",
    product:       flags["product"],
    quantity:      qty,
    buyerBudget:   budget,
    buyerStyle:    flags["buyer-style"],
    buyerDeadline: flags["buyer-deadline"],
  };
}

// --- Internal: scenario-form resolver (CONT8 / M2-ε, form 3) --------------

function resolveScenarioForm(flags: Record<string, string>): ParsedNegotiationCommand {
  const id = flags["scenario"];
  if (!id || id === "") {
    return {
      form: "invalid",
      error:
        `--scenario requires a value. Known scenario ids: ${listScenarioIds().join(", ")}. ` +
        `Example: 'start negotiation --scenario happy-path-cotton'.`,
    };
  }

  // Disallow mixing --scenario with other flags. Either declare the intent
  // via a named scenario OR set flags explicitly — not both. This keeps the
  // contract clear: scenario means "use this declared intent".
  const otherFlags = Object.keys(flags).filter(k => k !== "scenario" && flags[k] !== "");
  if (otherFlags.length > 0) {
    return {
      form: "invalid",
      error:
        `--scenario cannot be combined with other flags (${otherFlags.map(f => "--" + f).join(", ")}). ` +
        `Use one form OR the other: either '--scenario <id>' alone, or the full ` +
        `--product / --qty / --buyer-budget / --buyer-style / --buyer-deadline set.`,
    };
  }

  let scenario: Scenario;
  try {
    scenario = loadScenario(id);
  } catch (e: any) {
    return {
      form:  "invalid",
      error: `Could not load scenario "${id}": ${e?.message ?? e}`,
    };
  }

  // Extract the fields that today's agent path honors.
  const product     = scenario.situation.product;
  const quantity    = scenario.situation.quantity;
  const buyerBudget = scenario.buyerIntent.hardConstraints.maxBudgetPerUnit!;
  // Style mapping: the scenario JSON may use either today's parser set or
  // real TKI five. If the value is in the parser's accepted set, pass
  // through; otherwise normalize to "balanced" (the today's-parser default
  // for a deferred field). This keeps the parser's existing validation
  // satisfied without coupling the scenario contract to Finding #4.
  const parserValidStyles = ["aggressive", "assertive", "balanced", "cooperative", "win-win-seeking"];
  const buyerStyle = parserValidStyles.includes(scenario.buyerIntent.style)
    ? scenario.buyerIntent.style
    : "balanced";
  // Deadline: scenario doesn't require one explicitly; default to today + 60
  // days (matches buyer-agent's getDeliveryDate() fallback for the legacy form).
  const deadlineDate = scenario.buyerIntent.hardConstraints.requiredDeliveryDate ?? defaultDeadline();

  return {
    form:             "flagged",
    product,
    quantity,
    buyerBudget,
    buyerStyle,
    buyerDeadline:    deadlineDate,
    scenarioIntent:   scenario,
    scenarioDeferred: scenario.honored.declaredButDeferred,
  };
}

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 60);
  return d.toISOString().split("T")[0];
}
