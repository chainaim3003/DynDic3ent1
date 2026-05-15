// Autonomous Agent System

import { Contract, calculateDiscountSavings, calculatePDScore } from './calculations';

export type AgentType = 'buyer' | 'seller' | 'treasury';
export type AgentStatus = 'idle' | 'active' | 'thinking' | 'paused';

export interface AgentAction {
  id: string;
  timestamp: Date;
  agent: AgentType;
  action: string;
  status: 'success' | 'pending' | 'warning' | 'error';
  details?: string;
  calculation?: string;
}

export interface AgentMessage {
  id: string;
  timestamp: Date;
  from: AgentType;
  to: AgentType;
  message: string;
  type: 'question' | 'response' | 'notification';
  // Link to transaction event when applicable
  eventId?: string;
  // Optional UI helpers
  highlight?: boolean;
  badge?: string;
} 

export interface TransactionEvent {
  id: string;
  timestamp?: Date;
  actor?: AgentType;
  action?: string;
  message?: string;
  highlight?: boolean;
  badge?: string;
}

export interface Transaction {
  id: string;
  poId: string;
  originalAmount: number;
  discountPercent?: number;
  finalAmount?: number;
  invoiceId?: string;
  events: TransactionEvent[];
  currentEventIndex: number;
  status: 'open' | 'complete';
}


export interface Agent {
  type: AgentType;
  name: string;
  status: AgentStatus;
  objective: string;
  taskQueue: string[];
  lastAction: AgentAction | null;
  successRate: number;
  totalActions: number;
  metrics: Record<string, number>;
}

export interface AgentState {
  buyer: Agent;
  seller: Agent;
  buyerTreasury: Agent;
  sellerTreasury: Agent;
}

// Real agent identity — sourced from agent cards
export const REAL_AGENTS = {
  buyer: {
    name: 'Tommy Buyer Agent',
    organization: 'TOMMY HILFIGER EUROPE B.V.',
    lei: '54930012QJWZMYHNJW95',
    agentAID: 'ED_YWt1tpDFlTX-h_4ILS3QfIJbO4g5pSiH9soD1ZMg4',
    oorHolder: 'Tommy_Chief_Procurement_Officer',
    role: 'ChiefProcurementOfficer',
    url: 'http://localhost:9090',
  },
  seller: {
    name: 'Jupiter Seller Agent',
    organization: 'JUPITER KNITTING COMPANY',
    lei: '3358004DXAMRWRUIYJ05',
    agentAID: 'ENR7Xj2xCtdwMUAbCbBHYSu1Iv029w2qtc_zjLyo740b',
    oorHolder: 'Jupiter_Chief_Sales_Officer',
    role: 'ChiefSalesOfficer',
    url: 'http://localhost:8080',
  },
  treasury: {
    name: 'Jupiter Treasury Agent',
    organization: 'JUPITER KNITTING COMPANY',
    lei: '3358004DXAMRWRUIYJ05',
    agentAID: 'EPKQM5lB9ci8HjIOpNLMy-Q36DSwrgp2rvzoIoV7vRwZ',
    oorHolder: 'Jupiter_Chief_Sales_Officer',
    role: 'ChiefFinancialOfficer',
    url: 'http://localhost:7070',
  },
};

// Initial agent states
export function createInitialAgentState(): AgentState {
  return {
    buyer: {
      type: 'buyer',
      name: REAL_AGENTS.buyer.name,
      status: 'idle',
      objective: 'Awaiting negotiation — vLEI verification required',
      taskQueue: [],
      lastAction: null,
      successRate: 0,
      totalActions: 0,
      metrics: { poCreated: 0, discountsTaken: 0, savingsRealized: 0 },
    },
    seller: {
      type: 'seller',
      name: REAL_AGENTS.seller.name,
      status: 'idle',
      objective: 'Awaiting negotiation — vLEI verification required',
      taskQueue: [],
      lastAction: null,
      successRate: 0,
      totalActions: 0,
      metrics: { invoicesGenerated: 0, discountsOffered: 0, collectionRate: 0 },
    },
    buyerTreasury: {
      type: 'treasury',
      name: REAL_AGENTS.treasury.name,
      status: 'idle',
      objective: 'Monitoring Jupiter Knitting Company liquidity',
      taskQueue: [],
      lastAction: null,
      successRate: 0,
      totalActions: 0,
      metrics: { cashPosition: 0, liquidityAlerts: 0, optimizations: 0 },
    },
    sellerTreasury: {
      type: 'treasury',
      name: REAL_AGENTS.treasury.name,
      status: 'idle',
      objective: 'Monitoring Jupiter Knitting Company liquidity',
      taskQueue: [],
      lastAction: null,
      successRate: 0,
      totalActions: 0,
      metrics: { cashPosition: 0, liquidityAlerts: 0, optimizations: 0 },
    },
  };
}







// Format timestamp
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// Get agent color class
export function getAgentColorClass(agent: AgentType): string {
  switch (agent) {
    case 'buyer':
      return 'text-agent-buyer';
    case 'seller':
      return 'text-agent-seller';
    case 'treasury':
      return 'text-agent-treasury';
  }
}

// Get agent background class
export function getAgentBgClass(agent: AgentType): string {
  switch (agent) {
    case 'buyer':
      return 'bg-agent-buyer/20';
    case 'seller':
      return 'bg-agent-seller/20';
    case 'treasury':
      return 'bg-agent-treasury/20';
  }
}

// Get agent icon
export function getAgentEmoji(agent: AgentType): string {
  switch (agent) {
    case 'buyer':
      return '🛒';
    case 'seller':
      return '📦';
    case 'treasury':
      return '💼';
  }
}
