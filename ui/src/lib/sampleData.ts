// Real agent and organization data — sourced from agent cards and task-data
// No mock/fake data. All values come from the actual vLEI workflow.

import { Contract } from './calculations';

// No pre-loaded sample contracts — contracts come from real ACTUS negotiations via treasury agent (:7070)
export const sampleContracts: Contract[] = [];

// Real counterparties from the vLEI workflow
export const counterparties = [
  {
    name: 'JUPITER KNITTING COMPANY',
    lei: '3358004DXAMRWRUIYJ05',
    role: 'Seller',
    agentName: 'jupiterSellerAgent',
    agentAID: 'ENR7Xj2xCtdwMUAbCbBHYSu1Iv029w2qtc_zjLyo740b',
    oorHolder: 'Jupiter_Chief_Sales_Officer',
    daysOverdue: 0,
    paymentVariance: 0,
    invoiceCount: 0,
  },
  {
    name: 'TOMMY HILFIGER EUROPE B.V.',
    lei: '54930012QJWZMYHNJW95',
    role: 'Buyer',
    agentName: 'tommyBuyerAgent',
    agentAID: 'ED_YWt1tpDFlTX-h_4ILS3QfIJbO4g5pSiH9soD1ZMg4',
    oorHolder: 'Tommy_Chief_Procurement_Officer',
    daysOverdue: 0,
    paymentVariance: 0,
    invoiceCount: 0,
  },
];

// No fake cash flow projection — real data comes from treasury agent ACTUS events
export const cashFlowProjection: never[] = [];

// No fake transactions — real transactions come from negotiation SSE streams
export function generateSampleTransactions() { return []; }

// No fake working capital — real data comes from treasury agent (:7070/health)
export const workingCapitalData = {
  accountsReceivable: 0,
  accountsPayable: 0,
  inventory: 0,
  annualRevenue: 0,
  annualCOGS: 0,
};
