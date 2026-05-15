// ================= MARKET DATA CLIENT — L4 UPGRADE =================
// Provides a single market snapshot used by all agents at their decision points.
//
// Real data source: FRED public API (no API key required with DEMO_KEY)
//   GET https://api.stlouisfed.org/fred/series/observations?series_id=SOFR&api_key=DEMO_KEY
//
// Fallback: realistic random values within published 2024-2026 ranges.
//   SOFR:   4.25% – 5.50%  (actual Fed Funds / SOFR range 2024-2026)
//   Cotton: $0.60 – $0.90  (ICE Cotton #2 nearby futures)
//   Spread: 50 – 100 bps   (India BBB sovereign spread over UST)

export interface MarketSnapshot {
  // SOFR
  sofrRate:               number;          // e.g. 0.0434  (4.34 % p.a.)
  sofrSource:             "FRED" | "SIMULATED";
  sofrTimestamp:          string;          // ISO date of latest FRED observation

  // Commodity
  cottonPricePerLb:       number;          // USD/lb  e.g. 0.74
  cottonSource:           "ICE" | "SIMULATED";
  commodityIndex:         number;          // 0 = cheapest in range, 1 = most expensive

  // Credit
  riskSpread:             number;          // India sovereign + WC spread, e.g. 0.0068
  effectiveBorrowingRate: number;          // sofrRate + riskSpread
}

// ── Session cache: market data doesn't change mid-negotiation ────────────────
let _cache: MarketSnapshot | null = null;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// ── Fallback: realistic simulation within published ranges ───────────────────
function simulatedSnapshot(): MarketSnapshot {
  const sofrRate         = 0.0425 + Math.random() * 0.0125;  // 4.25 – 5.50 %
  const cottonPricePerLb = 0.60   + Math.random() * 0.30;    // $0.60 – $0.90
  const riskSpread       = 0.005  + Math.random() * 0.005;   // 50 – 100 bps
  const commodityIndex   = clamp((cottonPricePerLb - 0.60) / 0.30, 0, 1);
  return {
    sofrRate,
    sofrSource:             "SIMULATED",
    sofrTimestamp:          new Date().toISOString().split("T")[0],
    cottonPricePerLb,
    cottonSource:           "SIMULATED",
    commodityIndex,
    riskSpread,
    effectiveBorrowingRate: parseFloat((sofrRate + riskSpread).toFixed(6)),
  };
}

// ── Main export: getMarketSnapshot() ────────────────────────────────────────
/**
 * Returns a market snapshot.
 * Attempts FRED SOFR first; falls back to simulation if FRED is unreachable.
 * Results are cached for the session (pass forceRefresh=true to re-fetch).
 */
export async function getMarketSnapshot(forceRefresh = false): Promise<MarketSnapshot> {
  if (_cache && !forceRefresh) return _cache;

  try {
    const FRED_URL =
      "https://api.stlouisfed.org/fred/series/observations" +
      "?series_id=SOFR&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=1";

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 4000);

    const resp = await fetch(FRED_URL, { signal: controller.signal });
    clearTimeout(tid);

    if (!resp.ok) throw new Error(`FRED HTTP ${resp.status}`);

    const data = (await resp.json()) as any;
    const obs   = data?.observations?.[0];
    if (!obs || obs.value === "." || !obs.value) throw new Error("FRED: no valid observation");

    const sofrRate         = parseFloat(obs.value) / 100;
    const riskSpread       = 0.005 + Math.random() * 0.005;
    const cottonPricePerLb = 0.60  + Math.random() * 0.30;   // ICE Cotton #2 simulated
    const commodityIndex   = clamp((cottonPricePerLb - 0.60) / 0.30, 0, 1);

    _cache = {
      sofrRate,
      sofrSource:             "FRED",
      sofrTimestamp:          obs.date,
      cottonPricePerLb,
      cottonSource:           "SIMULATED",
      commodityIndex,
      riskSpread,
      effectiveBorrowingRate: parseFloat((sofrRate + riskSpread).toFixed(6)),
    };

    console.log(
      `  \x1b[36m\x1b[1m  [L4] Market data: SOFR ${(sofrRate * 100).toFixed(2)}% (FRED ${obs.date})` +
      `  Cotton $${cottonPricePerLb.toFixed(2)}/lb  EBR ${((sofrRate + riskSpread) * 100).toFixed(2)}%\x1b[0m`
    );
    return _cache;

  } catch (err: any) {
    _cache = simulatedSnapshot();
    console.log(
      `  \x1b[2m  [L4] Market data: FRED unreachable (${err?.message ?? err}) — using simulated values\x1b[0m`
    );
    console.log(
      `  \x1b[2m       SOFR ${(_cache.sofrRate * 100).toFixed(2)}% (SIMULATED)` +
      `  Cotton $${_cache.cottonPricePerLb.toFixed(2)}/lb  EBR ${(_cache.effectiveBorrowingRate * 100).toFixed(2)}%\x1b[0m`
    );
    return _cache;
  }
}

// ── Derived computations ─────────────────────────────────────────────────────

/**
 * SOFR-adjusted safety factor within guideline range [0.3, 0.6].
 *
 *   Higher borrowing rate → tighter range → seller keeps more margin as buffer.
 *   At EBR 3.0%  (low):  factor = 0.600
 *   At EBR 5.06%:        factor ≈ 0.531
 *   At EBR 12.0% (high): factor = 0.300
 */
export function computeAdjustedSafetyFactor(effectiveBorrowingRate: number): number {
  const normalized = clamp((effectiveBorrowingRate - 0.03) / (0.12 - 0.03), 0, 1);
  return parseFloat((0.6 - 0.3 * normalized).toFixed(4));
}

/**
 * Commodity-adjusted margin price.
 *
 *   Higher cotton price → seller's actual cost is higher → margin rises.
 *   At cotton $0.60/lb (cheap):   adjustedMargin = baseMargin
 *   At cotton $0.73/lb:           adjustedMargin = base + base × 0.15 × 0.43
 *   At cotton $0.90/lb (expensive): adjustedMargin = base × 1.15
 */
export function computeAdjustedMarginPrice(baseMarginPrice: number, commodityIndex: number): number {
  return Math.round(baseMarginPrice + baseMarginPrice * 0.15 * commodityIndex);
}

/**
 * Build a SOFR-adjusted declining reference index series for ACTUS.
 *
 * Instead of a flat series (every day = sellerRevenue), the value declines
 * to reflect the time-value of money at the current SOFR rate.
 *
 *   Day N: sellerRevenue × (1 − sofrRate × N/365)
 *
 * This produces a realistic discounted cash-flow curve for ACTUS to process.
 */
export function buildSOFRAdjustedSeries(
  fromDate:      string,
  toDate:        string,
  sellerRevenue: number,
  sofrRate:      number
): { time: string; value: number }[] {
  const MS_PER_DAY = 86_400_000;
  const series: { time: string; value: number }[] = [];

  const start = new Date(fromDate);
  const end   = new Date(toDate);

  const cur = new Date(start);
  let dayN  = 0;

  while (cur <= end) {
    const discountFactor = 1 - sofrRate * (dayN / 365);
    series.push({
      time:  `${cur.toISOString().split("T")[0]}T00:00:00`,
      value: parseFloat((sellerRevenue * Math.max(0, discountFactor)).toFixed(2)),
    });
    cur.setDate(cur.getDate() + 1);
    dayN++;
  }

  return series;
}

/** Pretty-print a market snapshot to console. */
export function printMarketSnapshot(snap: MarketSnapshot, label = "MARKET SNAPSHOT") {
  const D = "\x1b[2m", B = "\x1b[1m", CY = "\x1b[36m", R = "\x1b[0m";
  console.log("");
  console.log(`  ${CY}${B}  [L4] ${label}${R}`);
  console.log(`  ${D}  SOFR              : ${(snap.sofrRate * 100).toFixed(2)}%  (${snap.sofrSource} ${snap.sofrTimestamp})${R}`);
  console.log(`  ${D}  Cotton            : $${snap.cottonPricePerLb.toFixed(2)}/lb  (${snap.cottonSource})  index: ${snap.commodityIndex.toFixed(3)}${R}`);
  console.log(`  ${D}  Risk spread       : ${(snap.riskSpread * 100).toFixed(0)} bps${R}`);
  console.log(`  ${D}  Eff. borrow rate  : ${(snap.effectiveBorrowingRate * 100).toFixed(2)}%${R}`);
  console.log("");
}
