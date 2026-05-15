// A2A Agent Service — connects to buyer/seller agents via persistent SSE

const BUYER_AGENT_URL    = 'http://localhost:9090';
const SELLER_AGENT_URL   = 'http://localhost:8080';
const TREASURY_AGENT_URL = 'http://localhost:7070';

let currentTaskId: string | undefined;
let currentContextId: string | undefined;

export function resetSession() {
  currentTaskId = undefined;
  currentContextId = undefined;
}

// ── Message type ──────────────────────────────────────────────────────────────
export type NegotiationMessageFrom = 'BUYER' | 'SELLER' | 'TREASURY';

export interface NegotiationMessage {
  id: string;
  text: string;
  from: NegotiationMessageFrom;
  timestamp: string;
  seq: number;
  kind: 'offer' | 'counter' | 'accept' | 'reject' | 'po' | 'invoice' | 'dd' | 'escalate' | 'info';
}

// ── Classify a message into a kind ───────────────────────────────────────────
export function classifyMessage(text: string): NegotiationMessage['kind'] {
  if (text.includes('📝 PURCHASE ORDER') || text.includes('📝  PURCHASE ORDER') || text.includes('PO ID    :') || text.includes('Purchase Order sent')) return 'po';
  if (text.includes('💰 Dynamic Discount Offer') || text.includes('DD OFFER RECEIVED')) return 'dd';
  // Discounted invoice — only after DD_ACCEPT is processed by seller
  if (text.includes('✅ DD Invoice') || text.includes('🎉 End-to-end') || text.includes('DD Invoice received')) return 'invoice';
  // Standard invoice
  if (text.includes('📄 INVOICE GENERATED') || text.includes('📄  INVOICE GENERATED') || text.includes('GST 18%') || text.includes('📄 Invoice sent') || text.includes('Invoice sent')) return 'invoice';
  // DD accept/reject confirmations → info (not invoice)
  if (text.includes('✓ DD accepted') || text.includes('DD offer declined') || text.includes('Awaiting discounted invoice')) return 'info';
  if (text.includes('Deal Closed') || text.includes('✓✓') || text.includes('DEAL CLOSED')) return 'accept';
  if (text.includes('escalated') && text.includes('human')) return 'escalate';
  if (text.includes('escalated to human')) return 'escalate';
  if ((text.includes('✗') || text.includes('failed') || text.includes('rejected')) && !text.includes('✓')) return 'reject';
  if (text.includes('Initial offer:') || text.includes('Negotiation started') || text.includes('✓ Negotiation started')) return 'offer';
  if (text.includes('Counter-offer sent') || text.includes('↑ Counter') || text.includes('↓ Counter')) return 'counter';
  if (text.includes('Accepting seller') || text.includes('Accepting buyer') || text.includes('✓ Accepting')) return 'accept';
  return 'info';
}

// ── Negotiation round parsing ─────────────────────────────────────────────────
export function parseNegotiationUpdate(text: string): {
  status?: 'IN_PROGRESS' | 'COMPLETED' | 'ESCALATED' | 'FAILED';
  round?: number;
  buyerOffer?: number;
  sellerOffer?: number;
  finalPrice?: number;
  totalValue?: number;
} | null {
  if (text.includes('Negotiation started') || text.includes('Initial offer:')) {
    const price = extractPrice(text);
    return price ? { status: 'IN_PROGRESS', round: 1, buyerOffer: price } : null;
  }
  // Seller counter (↓) vs buyer counter (↑)
  if (text.includes('↓ Counter-offer sent') || text.startsWith('↓')) {
    const price = extractPrice(text);
    const round = extractRound(text);
    return price ? { status: 'IN_PROGRESS', round: round ?? 2, sellerOffer: price } : null;
  }
  if (text.includes('↑ Counter-offer sent') || text.includes('Counter-offer sent')) {
    const price = extractPrice(text);
    const round = extractRound(text);
    return price ? { status: 'IN_PROGRESS', round: round ?? 2, buyerOffer: price } : null;
  }
  if (text.includes('Accepting seller') || text.includes('Accepting')) {
    const price = extractPrice(text);
    return price ? { status: 'IN_PROGRESS', buyerOffer: price } : null;
  }
  if (text.includes('Deal Closed') || text.includes('✓✓')) {
    return {
      status: 'COMPLETED',
      finalPrice: extractPrice(text) ?? undefined,
      totalValue: extractTotal(text) ?? undefined,
    };
  }
  if (text.includes('escalated') && text.includes('human')) return { status: 'ESCALATED' };
  if (text.includes('Negotiation failed') || (text.includes('✗') && text.includes('failed'))) return { status: 'FAILED' };
  return null;
}

function extractPrice(text: string): number | null {
  const m = text.match(/₹([\d,]+)\s*\/(?:fabric\s+)?unit/);
  return m ? parseInt(m[1].replace(/,/g, '')) : null;
}
function extractTotal(text: string): number | null {
  // Matches "Total : ₹..." or "Total       : ₹..." or "Total Value ₹..."
  const m = text.match(/Total[\w\s]*[:\s→]+₹([\d,]+)/i);
  return m ? parseInt(m[1].replace(/,/g, '')) : null;
}
function extractRound(text: string): number | null {
  const m = text.match(/Round\s+(\d+)/i);
  return m ? parseInt(m[1]) : null;
}

// ── Parse DD offer data from SSE message text ─────────────────────────────────
export interface ParsedDDOffer {
  invoiceId: string;
  invoiceDate: string;
  dueDate: string;
  originalTotal: number;
  maxDiscountRate: number;
  proposedSettlementDate: string;
  discountAtProposedDate: {
    daysEarly: number;
    totalDays: number;
    appliedRate: number;
    discountedAmount: number;
    savingAmount: number;
  };
}

export function parseDDOffer(text: string): ParsedDDOffer | null {
  if (!text.includes('Dynamic Discount Offer') && !text.includes('DD OFFER')) return null;
  try {
    const invoiceId   = text.match(/Invoice\s*:\s*(INV-[\w-]+)/)?.[1] ?? '';
    const invoiceDate = text.match(/Invoice date\s*:\s*([\d-]+)/)?.[1] ?? '';
    const dueDate     = text.match(/Due date\s*:\s*([\d-]+)/)?.[1] ?? '';
    const fullAmt     = text.match(/Full amount\s*:\s*₹([\d,]+)/)?.[1]?.replace(/,/g, '');
    const maxRate     = text.match(/Max DD rate\s*:\s*([\d.]+)%/)?.[1];
    const propDate    = text.match(/Pay by ([\d-]+)\s+\((\d+) days early\)/)?.[1] ?? '';
    const daysEarly   = parseInt(text.match(/Pay by [\d-]+\s+\((\d+) days early\)/)?.[1] ?? '0');
    const totalDays   = parseInt(text.match(/\((\d+)\/(\d+) days early\)/)?.[2] ?? text.match(/\((\d+) days early\)/)?.[1] ?? '30');
    const discAmt     = text.match(/→\s*₹([\d,]+)\s+\(save/)?.[1]?.replace(/,/g, '');
    const saveAmt     = text.match(/save ₹([\d,]+)/)?.[1]?.replace(/,/g, '');
    const propPct     = text.match(/@\s*([\d.]+)%/)?.[1];

    if (!invoiceId || !fullAmt || !maxRate) return null;

    return {
      invoiceId,
      invoiceDate,
      dueDate,
      originalTotal:   parseInt(fullAmt),
      maxDiscountRate: parseFloat(maxRate) / 100,
      proposedSettlementDate: propDate,
      discountAtProposedDate: {
        daysEarly,
        totalDays,
        appliedRate:      propPct ? parseFloat(propPct) / 100 : 0,
        discountedAmount: discAmt ? parseInt(discAmt) : 0,
        savingAmount:     saveAmt ? parseInt(saveAmt) : 0,
      },
    };
  } catch {
    return null;
  }
}

// ── SSE subscriptions ─────────────────────────────────────────────────────────
type MsgListener = (msg: NegotiationMessage) => void;

let buyerEventSource: EventSource | null = null;
let sellerEventSource: EventSource | null = null;
let buyerListeners: MsgListener[] = [];
let sellerListeners: MsgListener[] = [];

function openEventSource(
  url: string,
  from: NegotiationMessageFrom,
  listeners: MsgListener[]
): EventSource {
  const es = new EventSource(`${url}/negotiate-events`);
  es.onmessage = (e) => {
    try {
      const { text, timestamp, seq } = JSON.parse(e.data);
      if (!text) return;
      const msg: NegotiationMessage = {
        id: crypto.randomUUID(),
        text,
        from,
        timestamp: timestamp ?? new Date().toISOString(),
        seq: seq ?? 0,
        kind: classifyMessage(text),
      };
      for (const l of listeners) l(msg);
    } catch { /* ignore */ }
  };
  return es;
}

export function subscribeToNegotiationEvents(onMsg: MsgListener): () => void {
  buyerListeners.push(onMsg);
  if (!buyerEventSource || buyerEventSource.readyState === EventSource.CLOSED) {
    buyerEventSource = openEventSource(BUYER_AGENT_URL, 'BUYER', buyerListeners);
  }
  return () => {
    buyerListeners = buyerListeners.filter(l => l !== onMsg);
    if (buyerListeners.length === 0 && buyerEventSource) {
      buyerEventSource.close();
      buyerEventSource = null;
    }
  };
}

export function subscribeToSellerEvents(onMsg: MsgListener): () => void {
  sellerListeners.push(onMsg);
  if (!sellerEventSource || sellerEventSource.readyState === EventSource.CLOSED) {
    sellerEventSource = openEventSource(SELLER_AGENT_URL, 'SELLER', sellerListeners);
  }
  return () => {
    sellerListeners = sellerListeners.filter(l => l !== onMsg);
    if (sellerListeners.length === 0 && sellerEventSource) {
      sellerEventSource.close();
      sellerEventSource = null;
    }
  };
}

let treasuryEventSource: EventSource | null = null;
let treasuryListeners: MsgListener[] = [];

export function subscribeToTreasuryEvents(onMsg: MsgListener): () => void {
  treasuryListeners.push(onMsg);
  if (!treasuryEventSource || treasuryEventSource.readyState === EventSource.CLOSED) {
    treasuryEventSource = openEventSource(TREASURY_AGENT_URL, 'TREASURY', treasuryListeners);
  }
  return () => {
    treasuryListeners = treasuryListeners.filter(l => l !== onMsg);
    if (treasuryListeners.length === 0 && treasuryEventSource) {
      treasuryEventSource.close();
      treasuryEventSource = null;
    }
  };
}

// ── Verify agent via legentvLEI api-server (port 4000) ───────────────────────
// NOTE: api-server runs in WSL. If localhost:4000 doesn't work,
// set VITE_VLEI_API_URL in ui/.env to your WSL IP e.g. http://172.x.x.x:4000
const VLEI_API_URL = (import.meta as any).env?.VITE_VLEI_API_URL || 'http://localhost:4000';

export interface VerificationResult {
  success: boolean;
  error?: string;
  output?: string;
  verificationType?: string;
  timestamp?: string;
  agent?: string;
  oorHolder?: string;
  validation?: {
    delegationChain?: {
      verified?: boolean;
      agentAID?: string;
      delegatorAID?: string;
      oorHolderAID?: string;
      match?: boolean;
    };
    kelVerification?: {
      agentKEL?: { verified?: boolean; exists?: boolean };
      oorHolderKEL?: { verified?: boolean; exists?: boolean };
    };
    credentialStatus?: {
      revoked?: boolean;
      expired?: boolean;
    };
  };
}

/**
 * Calls /api/status — reads already-verified task-data files.
 * No re-running of scripts. Returns instantly from completed vLEI workflow.
 */
export async function verifyAgent(
  caller: 'buyer' | 'seller',
  target: 'seller' | 'buyer'
): Promise<VerificationResult> {
  try {
    const res = await fetch(`${VLEI_API_URL}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;
    const agentData = data[target]; // 'seller' or 'buyer'
    if (!agentData) throw new Error('No data for ' + target);
    return {
      success: agentData.verified === true,
      agent:   target === 'seller' ? 'jupiterSellerAgent' : 'tommyBuyerAgent',
      oorHolder: target === 'seller' ? 'Jupiter_Chief_Sales_Officer' : 'Tommy_Chief_Procurement_Officer',
      timestamp: data.timestamp,
      // Pack step results into output string so GleifPipeline can parse them
      output: agentData.verified ? [
        agentData.steps?.step1_aidsLoaded      ? '✓ Step 1: AIDs loaded from info files' : '',
        agentData.steps?.step2_delegationField ? '✓ Step 2: Delegation field (di) verified' : '',
        agentData.steps?.step3_delegationSeal  ? '✓ Step 3: Delegation seal found/confirmed' : '',
        agentData.steps?.step4_cryptoProof     ? '✅ CRYPTOGRAPHIC VERIFICATION PASSED!' : '',
        agentData.steps?.step5_publicKey       ? '✅ Public key found in agent info file' : '',
        'Delegation is CRYPTOGRAPHICALLY VERIFIED.',
      ].join('\n') : '',
      error: agentData.verified ? undefined : `Agent ${target} not verified in task-data`,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Could not reach vLEI api-server on port 4000' };
  }
}

// ── Fetch real agent card from live agent server ──────────────────────────────
export interface AgentCardData {
  name: string;
  description?: string;
  url?: string;
  provider?: { organization?: string; url?: string };
  version?: string;
  capabilities?: Record<string, unknown>;
  skills?: Array<{ id: string; name: string; description?: string; tags?: string[] }>;
  extensions?: {
    gleifIdentity?: {
      lei?: string;
      legalEntityName?: string;
      officialRole?: string;
      engagementRole?: string;
    };
    vLEImetadata?: {
      verificationPath?: string[];
      status?: string;
      timestamp?: string;
    };
    keriIdentifiers?: {
      agentAID?: string;
      oorHolderAID?: string;
      legalEntityAID?: string;
    };
  };
}

export async function fetchAgentCard(agentType: 'buyer' | 'seller' | 'treasury'): Promise<AgentCardData | null> {
  const url = agentType === 'buyer' ? BUYER_AGENT_URL : agentType === 'treasury' ? TREASURY_AGENT_URL : SELLER_AGENT_URL;
  try {
    const res = await fetch(`${url}/.well-known/agent-card.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as AgentCardData;
  } catch {
    return null;
  }
}

// ── Send initial negotiation command ─────────────────────────────────────────
export async function sendToBuyerAgent(
  userText: string,
  onError: (err: string) => void,
  onDone: () => void
): Promise<void> {
  if (userText.toLowerCase().startsWith('start negotiation')) resetSession();
  // DD commands must use a fresh task — the negotiation task is already completed
  if (userText.toLowerCase().startsWith('dd ')) resetSession();

  const messagePayload: any = {
    messageId: crypto.randomUUID(),
    kind: 'message',
    role: 'user',
    parts: [{ kind: 'text', text: userText }],
  };
  if (currentTaskId) messagePayload.taskId = currentTaskId;
  if (currentContextId) messagePayload.contextId = currentContextId;

  try {
    const response = await fetch(`${BUYER_AGENT_URL}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'message/stream',
        params: { message: messagePayload },
      }),
    });
    if (!response.ok) { onError(`Agent returned ${response.status}`); onDone(); return; }

    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const parsed = JSON.parse(raw);
            const event = parsed.result ?? parsed;
            if (event.taskId && !currentTaskId) currentTaskId = event.taskId;
            if (event.contextId && !currentContextId) currentContextId = event.contextId;
          } catch { /* ignore */ }
        }
      }
    }
  } catch (err: any) {
    onError(err.message || 'Connection failed — is the buyer agent running at localhost:9090?');
  } finally {
    onDone();
  }
}
