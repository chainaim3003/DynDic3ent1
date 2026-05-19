// =============================================================================
// PROJ1-DYN3-CONT8 / M2-ε — Intent-driven negotiation types
// =============================================================================
//
// Shared between:
//   - cli-parser.ts            (resolves --scenario <id> to an Intent + situation)
//   - buyer-agent/index.ts     (consumes BuyerIntent; today: extracts CLI args
//                                 only, full honoring deferred to CONT9+)
//   - seller-agent/index.ts    (consumes SellerIntent; today: receives but
//                                 does not act on it differently, full
//                                 honoring deferred — needs envelope wire)
//   - UI components            (renders intents in ScenarioCard for the demo
//                                 picker; mirrored in ui/src/lib/intent-types.ts)
//
// Design notes
// ------------
//
// 1. An *Intent* declares what an agent is TRYING to do, not what it WILL do.
//    Hard constraints define walk-away conditions. Soft preferences shape
//    direction. Style (TKI-ish) shapes how aggressively the agent moves from
//    anchor toward soft target. Walk-away behavior defines what happens when
//    hard constraints can't be met.
//
// 2. The agent's existing decision logic (LLM + advisor consultation + math
//    aggregator + guardrails) becomes the MACHINERY that EXECUTES the intent.
//    The intent is the goal; guardrails enforce the hard constraints; LLM
//    reasoning navigates the soft preferences. This means we are NOT
//    replacing the agent's brain — we are giving it a goal to pursue.
//
// 3. This is the OPPOSITE of the CONT5 --buyer-anchor / --rounds /
//    --seller-margin-price flags approach, which would have made agents
//    puppets to script demo outcomes. Intent-driven keeps agents autonomous
//    and makes the SCENARIO describe what was attempted, not what literally
//    happens. Outcomes remain probabilistic in a bounded, explainable way.
//
// 4. The Scenario shape pairs BuyerIntent + SellerIntent + situation. It is
//    the unit a scenario card declares and the unit cli-parser loads when
//    `--scenario <id>` is passed.
//
// 5. Today (CONT8), only `situation.product`, `situation.quantity`, and
//    `buyerIntent.hardConstraints.maxBudgetPerUnit` flow through to agent
//    behavior — these are what the existing multi-dim CLI form already
//    accepts. Everything else (goals, styles, soft preferences, walk-away,
//    sellerIntent in any form) is declared in the scenario JSON, displayed
//    to the user in the card, and logged by the buyer agent's parsedResult
//    handler, but does not yet drive agent decisions. Wiring this through
//    is the explicit deliverable of a future CONT iteration (see
//    FRAMEWORK-V2 §12 D7 if/when added).
// =============================================================================

/**
 * What the buyer (procurement side) is trying to achieve in this negotiation.
 */
export interface BuyerIntent {
  /** Primary objective. Shapes how the LLM prompt frames trade-offs. */
  goal:
    | "secure-supply"        // priority: get the order placed; price flexible
    | "minimize-cost"        // priority: lowest unit price; supply secondary
    | "test-market"          // priority: learn prices; willing to walk away
    | "build-relationship";  // priority: long-term value; cooperative

  /** Conditions under which the buyer WILL walk away. Enforced as hard floors
   *  / ceilings on the buyer agent's decision space. */
  hardConstraints: {
    /** Buyer will never pay above this unit price. Today: maps to
     *  state.maxBudget and the BUYER_CONFIG.maxBudget override path. */
    maxBudgetPerUnit?: number;

    /** Buyer will walk away if seller offers below this quantity. Maps to
     *  state.targetQuantity. Today: required (parser fills from situation). */
    minQuantity?: number;

    /** Walks if delivery promise misses this ISO date. Maps to
     *  state.deliveryDate. */
    requiredDeliveryDate?: string;
  };

  /** What the buyer prefers, all else equal. Shapes the LLM prompt's
   *  framing of "good enough" vs "ideal" but does not block deals. */
  softPreferences: {
    /** Where the buyer hopes to land. Anchors opening offers. */
    targetPricePerUnit?: number;

    /** Preferred payment terms string (e.g. "Net 30", "Net 60"). */
    preferredPaymentTerms?: string;

    /** 0 = pure transactional / 1 = build-for-future. Shapes how much value
     *  the LLM should put on relationship signaling vs short-term price. */
    relationshipWeight?: number;
  };

  /** Negotiation style — shapes how aggressively the agent moves from anchor
   *  toward soft target. Today's parser uses a non-TKI 5-name set, which
   *  is its own historical artifact (Finding #4 in M2-DELTA-PROGRESS.md).
   *  L3_STYLE_AND_AUTONOMY (post-WEDGE1) will replace this with the real
   *  TKI five. For CONT8 we accept BOTH name sets to avoid coupling this
   *  scenario contract to the parser's quirk. */
  style:
    | "aggressive" | "assertive" | "balanced" | "cooperative" | "win-win-seeking"  // today's parser set
    | "competing"  | "collaborating" | "compromising" | "avoiding" | "accommodating"; // real TKI five

  /** What the buyer does when hard constraints can't be met. */
  walkAwayBehavior:
    | "escalate"               // → human procurement officer
    | "accept-best-available"  // → take the best offer received and live with it
    | "abandon";               // → close the deal as failed with no escalation
}

/**
 * What the seller (sales side) is trying to achieve in this negotiation.
 *
 * IMPORTANT (CONT8): Today the seller agent's behavior is driven entirely by
 * its .env (SELLER_RESPONSE_MODE) and its hard-coded SELLER_CONFIG. A
 * scenario-declared sellerIntent is captured in the scenario JSON, displayed
 * to the user in the card (so the demo story makes sense), but NOT yet
 * transmitted to the seller agent. Doing so requires extending the OFFER
 * envelope schema (or a separate handshake) — explicitly out of CONT8 scope
 * and flagged for a future design pass.
 */
export interface SellerIntent {
  /** Primary objective. */
  goal:
    | "fill-capacity"       // priority: close volume; margin secondary
    | "maximize-margin"     // priority: profit per unit; willing to walk
    | "build-relationship"  // priority: long-term value
    | "clear-inventory";    // priority: move specific SKU; price elastic

  /** Conditions under which the seller will walk away or refuse to close. */
  hardConstraints: {
    /** Required mode. Card declares the mode the demo expects the seller
     *  to run in; if the actual seller's SELLER_RESPONSE_MODE differs, the
     *  scenario will still execute but the card's expected behavior may
     *  not match what the agent does. */
    sellerResponseMode?:
      | "BASIC_SALES_QUOTING_1"
      | "L1_DELEGATED_ADVISORS"
      | "L2_EXECUTIVE_REASONER"
      | "L3_STYLE_AND_AUTONOMY"
      | "L4_LEARNED_PROFILES_AND_PD";

    /** Minimum margin % the seller will accept. Today: implicit from
     *  SELLER_CONFIG.targetProfitPercentage and SELLER_CONFIG.marginPrice. */
    minMarginPct?: number;

    /** Below this unit price, seller refuses regardless of mode. */
    floorPricePerUnit?: number;
  };

  /** Seller's preferred direction, all else equal. */
  softPreferences: {
    /** Where the seller hopes to land. */
    targetMarginPct?: number;
    preferredPaymentTerms?: string;
  };

  /** Same style enum as BuyerIntent. */
  style: BuyerIntent["style"];

  /** What the seller does when hard constraints can't be met. */
  walkAwayBehavior:
    | "escalate"            // → human CSO (current default)
    | "accept-loss-leader"  // → close at below-margin to win the relationship
    | "abandon";            // → reject final, no escalation
}

/**
 * Context for the negotiation: what's being traded, in what conditions.
 */
export interface Situation {
  /** SKU code, e.g. "FAB-COTTON-180GSM". Today: routes the inventory advisor
   *  to DEMO-DATA/inventory/erpnext-bin-<product>.json. */
  product: string;

  /** Quantity. Today: required, becomes state.targetQuantity. */
  quantity: number;

  /** Market regime hint for the card display. Not consumed by agent yet —
   *  could be used post-WEDGE1 to adjust market-snapshot fixtures. */
  market?: "normal" | "tight" | "loose" | "shortage" | "outage";
}

/**
 * Honest expectation of what will probably happen, written by the scenario
 * author. Captures the probabilistic nature of intent-driven outcomes:
 * the card SHOULDN'T claim "closes at ₹373" because real agents may close
 * at any feasible price, escalate, or fail. The card SHOULD say what the
 * likely-outcome range is and what the failure modes are.
 */
export interface ExpectedOutcome {
  /** One-line summary of the most likely outcome. */
  likely: string;

  /** Conditions under which a less-likely outcome occurs. */
  possible?: string;

  /** What specific failure mode this scenario can reveal. */
  failureMode?: string;
}

/**
 * A complete scenario, ready to be loaded by `--scenario <id>` or by the
 * UI scenario picker.
 */
export interface Scenario {
  /** Stable identifier, used in the CLI flag and as the JSON filename. */
  id: string;

  /** Short title for the card chip. */
  title: string;

  /** One-paragraph description shown in the card hover-tooltip. */
  description: string;

  buyerIntent:  BuyerIntent;
  sellerIntent: SellerIntent;
  situation:    Situation;

  expectedOutcome: ExpectedOutcome;

  /** Honest disclaimer about what the agents actually honor today vs what
   *  the intent declares. Shown in the card to keep the demo honest. */
  honored: {
    /** Fields from the intent that DO flow through to agent behavior today. */
    today: string[];
    /** Fields declared but NOT yet honored (display-only / logged). */
    declaredButDeferred: string[];
  };
}
