/**
 * Agent identity display data — single source of truth for the Theater stage.
 * ---------------------------------------------------------------------------
 * These are HARDCODED to match what the live backend agents serve. They are
 * the same identities AgentCenter.tsx displays directly in JSX (see the
 * "Buyer Organization" / "Seller Organization" cards in AgentCenter):
 *   - Buyer:    TOMMY HILFIGER EUROPE B.V., LEI 54930012QJWZMYHNJW95
 *   - Seller:   JUPITER KNITTING COMPANY,  LEI 3358004DXAMRWRUIYJ05
 *   - Treasury: same LEI as seller (sub-delegated from seller's OOR holder)
 *
 * Phase 6/7 will replace the hardcoded values with data fetched live from
 * each agent's /.well-known/agent-card.json. For Phase 2 (static stage)
 * the hardcoded values are sufficient and exactly mirror AgentCenter.
 */

import type { AgentId } from './types';

export interface AgentIdentity {
  id: AgentId;
  shortName: string;          // chip label
  legalName: string;          // full org name
  lei: string;                // 20-char LEI
  agentAID?: string;          // KERI AID
  role?: string;              // OOR holder role
  /** Tailwind color tokens — 'buyer', 'seller', 'treasury', 'vlei' use CSS
   *  vars declared in tailwind.config.ts (text-agent-buyer etc).
   *  Phase 9a — 'credit', 'inventory', 'logistics' use standard Tailwind
   *  palette colors hardcoded in AvatarDisc + StateAura, so no Tailwind
   *  config / globals.css edits are required for the new tokens. */
  colorToken: 'buyer' | 'seller' | 'treasury' | 'vlei' | 'credit' | 'inventory' | 'logistics';
}

// Hardcoded to mirror the values AgentCenter.tsx renders in the
// "Buyer Organization" / "Seller Organization" cards (verified by reading
// AgentCenter source at lines ~1130 and ~1310).
export const IDENTITIES: Record<Exclude<AgentId, 'buyerTreasury' | 'ipexMailbox' | 'actusEngine'>, AgentIdentity> = {
  buyer: {
    id: 'buyer',
    shortName: 'Buyer',
    legalName: 'TOMMY HILFIGER EUROPE B.V.',
    lei: '54930012QJWZMYHNJW95',
    agentAID: 'ED_YWt1tpDFlTX-h_4ILS3QfIJbO4g5pSiH9soD1ZMg4',
    role: 'Tommy_Chief_Procurement_Officer',
    colorToken: 'buyer',
  },
  seller: {
    id: 'seller',
    shortName: 'Seller',
    legalName: 'JUPITER KNITTING COMPANY',
    lei: '3358004DXAMRWRUIYJ05',
    agentAID: 'ENR7Xj2xCtdwMUAbCbBHYSu1Iv029w2qtc_zjLyo740b',
    role: 'Jupiter_Chief_Sales_Officer',
    colorToken: 'seller',
  },
  treasury: {
    id: 'treasury',
    shortName: 'Treasury',
    legalName: 'JUPITER KNITTING COMPANY · Treasury',
    lei: '3358004DXAMRWRUIYJ05',
    agentAID: 'EPKQM5lB9ci8HjIOpNLMy-Q36DSwrgp2rvzoIoV7vRwZ',
    role: 'Sub-delegated treasury operations',
    colorToken: 'treasury',
  },
  sellerTreasury: {
    id: 'sellerTreasury',
    shortName: 'Treasury',
    legalName: 'JUPITER KNITTING COMPANY · Treasury',
    lei: '3358004DXAMRWRUIYJ05',
    agentAID: 'EPKQM5lB9ci8HjIOpNLMy-Q36DSwrgp2rvzoIoV7vRwZ',
    role: 'Sub-delegated treasury operations',
    colorToken: 'treasury',
  },
  vleiVerifier: {
    id: 'vleiVerifier',
    shortName: 'vLEI',
    legalName: 'GLEIF vLEI api-server',
    lei: '—',
    role: 'Identity verification',
    colorToken: 'vlei',
  },
  // Phase 9a — Jupiter sub-agents on the back row. Internal modules of the
  // seller (no independent LEI/AID per locked design decision Q1=(c) on
  // 2026-05-23). If full delegation is added later, the lei + agentAID
  // fields are ready to accept real values.
  credit: {
    id: 'credit',
    shortName: 'Credit',
    legalName: 'JUPITER KNITTING COMPANY · Credit',
    lei: '—',
    role: 'Counterparty default-risk assessment',
    colorToken: 'credit',
  },
  inventory: {
    id: 'inventory',
    shortName: 'Inventory',
    legalName: 'JUPITER KNITTING COMPANY · Inventory',
    lei: '—',
    role: 'Stock availability + lead time',
    colorToken: 'inventory',
  },
  logistics: {
    id: 'logistics',
    shortName: 'Logistics',
    legalName: 'JUPITER KNITTING COMPANY · Logistics',
    lei: '—',
    role: 'Carrier quotes + transit time',
    colorToken: 'logistics',
  },
};

// Convenience: get last N chars of LEI for compact labels.
export function shortLei(lei: string, chars: number = 8): string {
  return lei === '—' ? '—' : `…${lei.slice(-chars)}`;
}
