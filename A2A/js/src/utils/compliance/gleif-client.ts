// ================= GLEIF CLIENT =================
// Real GLEIF API calls. NO MOCKS. NO FALLBACKS to fake data.
//
// Public API: https://api.gleif.org/api/v1/lei-records/{lei}
// Documentation: https://www.gleif.org/en/lei-data/gleif-api
// No authentication required for read-only LEI lookups.
//
// Caching strategy: in-memory cache, TTL configurable via env var
// (GLEIF_CACHE_TTL_HOURS, default 24). Cache hits return source="GLEIF_CACHE";
// fresh fetches return source="GLEIF_API_LIVE". The audit captures source so
// auditors can reproduce.

import crypto from "node:crypto";
import {
  LeiRecord,
  ComplianceResult,
  GleifConfig,
  GleifStatus,
  LegalEntityStatus,
} from "./gleif-types.js";

// ── Config (read from env at call time, not module load) ────────────────────

function loadConfig(): GleifConfig {
  return {
    apiBaseUrl:          process.env.GLEIF_API_URL ?? "https://api.gleif.org/api/v1",
    timeoutMs:           Number(process.env.GLEIF_TIMEOUT_MS ?? 8000),
    cacheTtlMs:          Number(process.env.GLEIF_CACHE_TTL_HOURS ?? 24) * 60 * 60 * 1000,
    sanctionedCountries: (process.env.SANCTIONED_COUNTRIES ?? "")
      .split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
  };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

interface CacheEntry { record: LeiRecord; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

/** Clear the entire cache. Useful for tests and forced re-checks. */
export function clearGleifCache(): void { cache.clear(); }

// ── LEI format validation (ISO 17442) ────────────────────────────────────────

const LEI_REGEX = /^[A-Z0-9]{18}[0-9]{2}$/;

/**
 * Validate LEI format per ISO 17442:
 *   - exactly 20 characters
 *   - chars 1-18: uppercase letters or digits
 *   - chars 19-20: numeric checksum (ISO/IEC 7064:2003 MOD 97-10)
 *
 * Returns true for well-formed LEIs (does NOT check GLEIF registration).
 */
export function isValidLeiFormat(lei: string): boolean {
  if (!lei || lei.length !== 20) return false;
  if (!LEI_REGEX.test(lei)) return false;

  // ISO/IEC 7064 MOD 97-10 checksum
  // Convert letters to digits (A=10, B=11, ..., Z=35), then check that
  // the resulting number mod 97 equals 1.
  let numeric = "";
  for (const ch of lei) {
    if (ch >= "0" && ch <= "9") numeric += ch;
    else                        numeric += String(ch.charCodeAt(0) - "A".charCodeAt(0) + 10);
  }
  // Modulo on a string of up to ~40 digits — process in chunks to stay within
  // safe-integer range.
  let mod = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const chunk = String(mod) + numeric.slice(i, i + 7);
    mod = Number(chunk) % 97;
  }
  return mod === 1;
}

// ── Core lookup ──────────────────────────────────────────────────────────────

/**
 * Look up an LEI against the real GLEIF API. Returns a normalized LeiRecord
 * or null if the LEI is not found in GLEIF's database.
 *
 * @param lei      20-char LEI code
 * @param options  { forceFresh: true } bypasses cache
 *
 * Throws on:
 *   - invalid LEI format (caller should validate first)
 *   - network errors after timeout
 *   - non-200/404 HTTP responses
 *
 * The 404 case (LEI not found) returns null, not an error — distinguishes
 * "GLEIF says this LEI does not exist" from "we couldn't reach GLEIF".
 */
export async function lookupLei(
  lei: string,
  options: { forceFresh?: boolean } = {}
): Promise<LeiRecord | null> {
  const cfg = loadConfig();
  const key = lei.toUpperCase();

  if (!options.forceFresh) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.record, source: "GLEIF_CACHE" };
    }
  }

  // Real GLEIF API call. NO mock data, NO fallback to test fixtures.
  const url = `${cfg.apiBaseUrl}/lei-records/${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { "Accept": "application/vnd.api+json" },
      signal:  controller.signal,
    });
  } catch (err: any) {
    clearTimeout(tid);
    if (err?.name === "AbortError") {
      throw new Error(`GLEIF API timeout after ${cfg.timeoutMs}ms (${url})`);
    }
    throw new Error(`GLEIF API network error: ${err?.message ?? err}`);
  }
  clearTimeout(tid);

  if (resp.status === 404) return null;
  if (!resp.ok) {
    throw new Error(`GLEIF API HTTP ${resp.status} for ${key}`);
  }

  const rawText = await resp.text();
  const raw     = JSON.parse(rawText) as any;
  const data    = raw?.data;
  if (!data || data.type !== "lei-records") {
    throw new Error(`GLEIF API returned unexpected shape for ${key}`);
  }
  const attrs    = data.attributes ?? {};
  const entity   = attrs.entity ?? {};
  const reg      = attrs.registration ?? {};

  const record: LeiRecord = {
    lei:                     attrs.lei ?? key,
    legalEntityName:         entity.legalName?.name ?? "",
    registrationStatus:      normalizeGleifStatus(reg.status),
    entityStatus:            normalizeEntityStatus(entity.status),
    country:                 (entity.legalAddress?.country ?? "").toUpperCase(),
    countryName:             entity.legalAddress?.country,
    legalForm:               entity.legalForm?.id,
    initialRegistrationDate: reg.initialRegistrationDate,
    lastUpdateDate:          reg.lastUpdateDate,
    nextRenewalDate:         reg.nextRenewalDate,
    source:                  "GLEIF_API_LIVE",
    fetchedAt:               new Date().toISOString(),
    rawResponseHash:         crypto.createHash("sha256").update(rawText).digest("hex"),
  };

  cache.set(key, { record, expiresAt: Date.now() + cfg.cacheTtlMs });
  return record;
}

function normalizeGleifStatus(s: unknown): GleifStatus {
  const v = (typeof s === "string" ? s : "").toUpperCase();
  const known: GleifStatus[] = [
    "ISSUED", "LAPSED", "RETIRED", "DUPLICATE", "MERGED", "ANNULLED",
    "TRANSFERRED", "CANCELLED", "PENDING_TRANSFER", "PENDING_ARCHIVAL", "PUBLISHED",
  ];
  return (known as string[]).includes(v) ? (v as GleifStatus) : "UNKNOWN";
}

function normalizeEntityStatus(s: unknown): LegalEntityStatus {
  const v = (typeof s === "string" ? s : "").toUpperCase();
  if (v === "ACTIVE" || v === "INACTIVE" || v === "NULL") return v as LegalEntityStatus;
  return "UNKNOWN";
}

// ── Compliance check (orchestrates format + GLEIF + sanctions) ──────────────

/**
 * Run all compliance checks on a single LEI and return an honest result.
 *
 * Checks performed (each appears in result.checksPerformed):
 *   - "lei-format-valid"        (always run)
 *   - "gleif-lookup"             (always run if format valid)
 *   - "registration-active"     (ISSUED required for ok=true)
 *   - "entity-active"            (entity status ACTIVE required for ok=true)
 *   - "country-not-sanctioned"  (only when SANCTIONED_COUNTRIES env var is set)
 *
 * @param options.forceFresh  bypass cache (used when GLEIF_RECHECK_AT_NEGOTIATION=true)
 */
export async function checkCompliance(
  lei: string,
  options: { forceFresh?: boolean } = {}
): Promise<ComplianceResult> {
  const cfg            = loadConfig();
  const checksPerformed: string[] = [];
  const warnings:        string[] = [];
  const errors:          string[] = [];

  // ── Format check ─────────────────────────────────────────────────────────
  checksPerformed.push("lei-format-valid");
  if (!isValidLeiFormat(lei)) {
    errors.push(`LEI format invalid (expected 20 chars, ISO 17442 checksum): "${lei}"`);
    return { ok: false, lei, checksPerformed, warnings, errors };
  }

  // ── GLEIF lookup ─────────────────────────────────────────────────────────
  checksPerformed.push("gleif-lookup");
  let record: LeiRecord | null;
  try {
    record = await lookupLei(lei, { forceFresh: options.forceFresh });
  } catch (err: any) {
    errors.push(`GLEIF lookup failed: ${err.message ?? err}`);
    return { ok: false, lei, checksPerformed, warnings, errors };
  }
  if (!record) {
    errors.push(`LEI not found in GLEIF database: ${lei}`);
    return { ok: false, lei, checksPerformed, warnings, errors };
  }

  // ── Registration status ─────────────────────────────────────────────────
  checksPerformed.push("registration-active");
  if (record.registrationStatus !== "ISSUED") {
    warnings.push(`LEI registration status is ${record.registrationStatus} (expected ISSUED)`);
  }

  // ── Entity status ───────────────────────────────────────────────────────
  checksPerformed.push("entity-active");
  if (record.entityStatus !== "ACTIVE") {
    warnings.push(`Entity status is ${record.entityStatus} (expected ACTIVE)`);
  }

  // ── Sanctions ───────────────────────────────────────────────────────────
  if (cfg.sanctionedCountries.length > 0) {
    checksPerformed.push("country-not-sanctioned");
    if (cfg.sanctionedCountries.includes(record.country)) {
      errors.push(`Country ${record.country} is in sanctions watchlist`);
    }
  }

  const ok = errors.length === 0
          && record.registrationStatus === "ISSUED"
          && record.entityStatus === "ACTIVE";

  return { ok, lei, record, checksPerformed, warnings, errors };
}
