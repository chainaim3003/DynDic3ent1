// ================= GLEIF TYPES =================
// Types mirroring the public GLEIF API v1 response shape for LEI lookups.
// Reference: https://documenter.getpostman.com/view/7679680/SVYrrxuU

/** GLEIF registration status — only ACTIVE LEIs are valid for live trading. */
export type GleifStatus =
  | "ISSUED"        // active and registered
  | "LAPSED"        // registration renewal overdue
  | "RETIRED"       // LE no longer exists (merged/dissolved)
  | "DUPLICATE"
  | "MERGED"
  | "ANNULLED"
  | "TRANSFERRED"
  | "CANCELLED"
  | "PENDING_TRANSFER"
  | "PENDING_ARCHIVAL"
  | "PUBLISHED"
  | "UNKNOWN";      // we use this when GLEIF returns a value we don't recognize

/** Top-level legal entity status from GLEIF. */
export type LegalEntityStatus = "ACTIVE" | "INACTIVE" | "NULL" | "UNKNOWN";

/**
 * Normalized record we expose to the rest of the system.
 * NOT a 1:1 mirror of the GLEIF API response — we keep only fields we use.
 */
export interface LeiRecord {
  lei:               string;
  legalEntityName:   string;
  registrationStatus: GleifStatus;
  entityStatus:      LegalEntityStatus;
  country:           string;          // ISO 3166-1 alpha-2 (e.g. "NL", "IN")
  countryName?:      string;
  legalForm?:        string;
  initialRegistrationDate?: string;
  lastUpdateDate?:   string;
  nextRenewalDate?:  string;
  source:            "GLEIF_API_LIVE" | "GLEIF_CACHE";
  fetchedAt:         string;          // ISO timestamp
  rawResponseHash?:  string;          // sha256 of GLEIF's raw response, for audit reproducibility
}

/**
 * The compliance result we return to callers. The honest list of checks is
 * preserved in `checksPerformed` so the audit can show exactly what ran.
 */
export interface ComplianceResult {
  ok:                boolean;          // true if ALL hard checks passed
  lei:               string;
  record?:           LeiRecord;        // present iff we got a record from GLEIF
  checksPerformed:   string[];         // honest list — what we actually checked
  warnings:          string[];         // soft flags (lapsed, sanctioned country, etc.)
  errors:            string[];         // hard failures (not found, invalid format)
}

/** Configuration for the GLEIF client. */
export interface GleifConfig {
  apiBaseUrl:    string;   // default "https://api.gleif.org/api/v1"
  timeoutMs:     number;   // default 8000
  cacheTtlMs:    number;   // default 24h
  sanctionedCountries: string[];   // ISO 3166-1 alpha-2 codes
}
