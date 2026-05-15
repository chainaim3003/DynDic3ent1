import React, { useEffect, useRef, useState } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { AgentCard } from '@/components/AgentCard';
import { AgentMessage } from '@/components/AgentMessage';
import { TransactionFeed } from '@/components/TransactionFeed';
import { TransactionFlow } from '@/components/TransactionFlow';
import { TypingIndicator } from '@/components/TypingIndicator';
import { StatusIndicator } from '@/components/StatusIndicator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Pause, Play, Settings, Send, MessageSquare, X, Radio, Circle, ShoppingBag, Factory } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sendToBuyerAgent, subscribeToNegotiationEvents, subscribeToSellerEvents, subscribeToTreasuryEvents, parseNegotiationUpdate, resetSession, NegotiationMessage, classifyMessage, parseDDOffer, ParsedDDOffer, fetchAgentCard, AgentCardData, verifyAgent } from '@/lib/a2aService';
import { DynamicDiscountOffer } from '@/components/DynamicDiscountOffer';
import { AgentType } from '@/lib/agents';

interface AgentCenterProps {
  simulation: ReturnType<typeof useSimulation>;
}

// A chat entry — either a user command or a negotiation message from an agent
type ChatEntry = {
  id: string;
  seq: number;
  text: string;
  from: 'USER' | 'BUYER' | 'SELLER';
  timestamp: Date;
  kind: 'user' | NegotiationMessage['kind'] | 'system' | 'verification' | 'fetch';
};

let _seq = 0;
const nextSeq = () => ++_seq;
// For SSE messages: use backend timestamp as primary sort key, _seq as tiebreaker
const seqFromTs = (ts: number) => ts * 1000 + (++_seq % 1000);

// ── Treasury chat bubble ──────────────────────────────────────────────────────
function TreasuryChatBubble({ text }: { text: string }) {
  const isSellerToTreasury = text.startsWith('📨 Seller → Treasury');
  const isTreasuryToSeller = text.startsWith('🏦 Treasury → Seller');
  const isApproved = text.includes('APPROVED');
  const isRejected = text.includes('REJECTED');

  const lines = text.split('\n').filter(l => l.trim());
  const header = lines[0];
  const body = lines.slice(1);

  return (
    <div className={cn('rounded-lg overflow-hidden text-xs border',
      isSellerToTreasury ? 'bg-blue-900/20 border-blue-500/30' :
      isApproved ? 'bg-green-900/20 border-green-500/30' :
      isRejected ? 'bg-red-900/20 border-red-500/30' :
      'bg-agent-treasury/10 border-agent-treasury/30'
    )}>
      <div className={cn('px-2 py-1.5 font-semibold border-b',
        isSellerToTreasury ? 'text-blue-400 border-blue-500/20' :
        isApproved ? 'text-green-400 border-green-500/20' :
        isRejected ? 'text-red-400 border-red-500/20' :
        'text-agent-treasury border-agent-treasury/20'
      )}>{header}</div>
      {body.length > 0 && (
        <div className="px-2 py-1.5 space-y-0.5 font-mono text-[10px]">
          {body.map((line, i) => {
            const isSeparator = line.startsWith('─');
            const isVerdictApproved = line.includes('APPROVED ✓');
            const isVerdictRejected = line.includes('REJECTED ✗');
            const isIED = line.includes('IED');
            const isMD  = line.includes('] MD');
            return (
              <div key={i} className={cn(
                'leading-relaxed',
                isSeparator    ? 'text-muted-foreground/30 text-[8px]' :
                isVerdictApproved ? 'text-green-400 font-bold' :
                isVerdictRejected ? 'text-red-400 font-bold' :
                isIED          ? 'text-red-300' :
                isMD           ? 'text-green-300' :
                'text-foreground/80'
              )}>{line}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Chat bubble renderer ──────────────────────────────────────────────────────
// perspective: 'buyer' → buyer msgs on right, seller on left
//              'seller' → seller msgs on right, buyer on left
function ChatBubbleEntry({ entry, perspective }: { entry: ChatEntry; perspective: 'buyer' | 'seller' }) {
  const isMine = perspective === 'buyer' ? entry.from === 'BUYER' : entry.from === 'SELLER';
  const isUser = entry.kind === 'user';
  const isSystem = entry.kind === 'system' || entry.kind === 'verification' || entry.kind === 'fetch';

  // PO card — buyer sends to seller
  if (entry.kind === 'po') {
    const mine = perspective === 'buyer';
    return (
      <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
        {!mine && <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 text-[10px] text-white font-bold">B</div>}
        <div className="max-w-[85%] min-w-0">
          <div className="flex items-center gap-1 mb-0.5 opacity-60">
            <span className="text-[10px] font-medium text-agent-buyer">Buyer</span>
            <span className="text-[10px]">to</span>
            <span className="text-[10px] font-medium text-agent-seller">Seller</span>
          </div>
          <div className="bg-cyan-900/40 border border-cyan-500/50 rounded-2xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-cyan-500/30">
              <span className="text-cyan-400 text-[10px] font-bold">Purchase Order</span>
            </div>
            <div className="px-3 py-2 font-mono text-xs text-black dark:text-foreground/85 space-y-0.5">
              {entry.text.split('\n').filter(l => l.trim() && !l.includes('PURCHASE ORDER') && !l.startsWith('PO'[0] + '📝') && !l.includes('Success report') && !l.includes('success report')).map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        </div>
        {mine && <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 text-[10px] text-white font-bold">B</div>}
      </div>
    );
  }

  // Invoice card — seller sends to buyer
  if (entry.kind === 'invoice') {
    const mine = perspective === 'seller';
    const isDDInvoice = entry.text.includes('DD Invoice') || entry.text.includes('✅ DD Invoice') || entry.text.includes('End-to-end') || entry.text.includes('DD INVOICE');

    // DD final invoice — dedicated card
    if (isDDInvoice) {
      const origMatch   = entry.text.match(/Original\s*:\s*₹([\d,]+(?:\.\d+)?)/);
      const discMatch   = entry.text.match(/Discounted\s*:\s*₹([\d,]+(?:\.\d+)?)/);
      const saveMatch   = entry.text.match(/Saving\s*:\s*₹([\d,]+(?:\.\d+)?)/);
      const rateMatch   = entry.text.match(/([\d.]+)%\s*off/);
      const settleMatch = entry.text.match(/Settle by\s*:\s*([\d-]+)/);
      const actusMatch  = entry.text.match(/ACTUS\s*:\s*(.+)/m);
      return (
        <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
          {!mine && <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 text-sm">??</div>}
          <div className="max-w-[90%] min-w-0">
            <div className="flex items-center gap-1 mb-0.5 opacity-60">
              <span className="text-[10px] font-medium text-agent-seller">Seller</span>
              <span className="text-[10px]">to</span>
              <span className="text-[10px] font-medium text-agent-buyer">Buyer</span>
            </div>
            <div className="bg-emerald-950/50 border border-emerald-500/50 rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-emerald-500/30 flex items-center gap-2">
                <span className="text-emerald-400 text-xs font-bold">✅ DD INVOICE — FINAL</span>
              </div>
              <div className="px-3 py-2 space-y-1 font-mono text-xs text-foreground">
                {origMatch   && <div className="flex justify-between"><span className="text-muted-foreground">Original</span><span>₹{origMatch[1]}</span></div>}
                {rateMatch   && <div className="flex justify-between"><span className="text-muted-foreground">Applied rate</span><span className="text-emerald-400">{rateMatch[1]}%</span></div>}
                {discMatch   && <div className="flex justify-between"><span className="text-muted-foreground">Payable</span><span className="text-green-400 font-bold">₹{discMatch[1]}</span></div>}
                {saveMatch   && <div className="flex justify-between"><span className="text-muted-foreground">You save</span><span className="text-emerald-400 font-bold">₹{saveMatch[1]}</span></div>}
                {settleMatch && <div className="flex justify-between"><span className="text-muted-foreground">Settle by</span><span className="text-amber-300">{settleMatch[1]}</span></div>}
                {actusMatch  && <div className="flex justify-between border-t border-emerald-500/20 pt-1 mt-1"><span className="text-muted-foreground">ACTUS</span><span className={actusMatch[1].includes('✓') ? 'text-green-400' : 'text-orange-400'}>{actusMatch[1].trim()}</span></div>}
              </div>
            </div>
          </div>
          {mine && <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 text-sm">??</div>}
        </div>
      );
    }
    return (
      <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
        {!mine && <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 text-sm">??</div>}
        <div className="max-w-[85%] min-w-0">
          <div className="flex items-center gap-1 mb-0.5 opacity-60">
            <span className="text-[10px] font-medium text-agent-seller">Seller</span>
            <span className="text-[10px]">to</span>
            <span className="text-[10px] font-medium text-agent-buyer">Buyer</span>
          </div>
          <div className={cn('border rounded-2xl overflow-hidden', isDDInvoice ? 'bg-emerald-900/40 border-emerald-500/50' : 'bg-purple-900/40 border-purple-500/50')}>
            <div className={cn('px-3 py-1.5 border-b', isDDInvoice ? 'border-emerald-500/30' : 'border-purple-500/30')}>
              <span className={cn('text-[10px] font-bold', isDDInvoice ? 'text-emerald-400' : 'text-purple-400')}>
                {isDDInvoice ? '✅ Discounted Invoice (ACTUS)' : '📄 Invoice'}
              </span>
            </div>
            <div className="px-3 py-2 font-mono text-xs text-black dark:text-foreground/85 space-y-0.5">
              {entry.text.split('\n').filter(l => l.trim()).map((line, i) => (
                <div key={i} className={cn(
                  (line.includes('TOTAL') || line.includes('Discounted') || line.includes('Payable')) && 'text-green-700 dark:text-green-400 font-bold',
                  line.includes('Saving') && 'text-emerald-700 dark:text-emerald-400',
                )}>{line}</div>
              ))}
            </div>
          </div>
        </div>
        {mine && <div className="w-6 h-6 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0 text-sm">??</div>}
      </div>
    );
  }

  // DD offer card — full details
  if (entry.kind === 'dd') {
    const invoiceMatch  = entry.text.match(/Invoice\s*:\s*(INV-[\w-]+)/);
    const amountMatch   = entry.text.match(/Full amount\s*:\s*₹([\d,.]+)/);
    const rateMatch     = entry.text.match(/Max DD rate\s*:\s*([\d.]+)%/);
    const payMatch      = entry.text.match(/Pay by ([\d-]+)/);
    const daysMatch     = entry.text.match(/\((\d+) days early\)/);
    const discMatch     = entry.text.match(/→\s*₹([\d,.]+)\s+\(save/);
    const saveMatch     = entry.text.match(/save ₹([\d,.]+)/);
    const rateAtMatch   = entry.text.match(/@\s*([\d.]+)%/);
    const invDateMatch  = entry.text.match(/Invoice date\s*:\s*([\d-]+)/);
    const dueDateMatch  = entry.text.match(/Due date\s*:\s*([\d-]+)/);
    return (
      <div className="flex justify-center my-2">
        <div className="bg-amber-950/40 border border-amber-500/50 rounded-xl overflow-hidden max-w-[95%] w-full">
          <div className="px-3 py-2 border-b border-amber-500/30 flex items-center gap-2">
            <span className="text-amber-400 text-xs font-bold">💰 DD OFFER RECEIVED</span>
            <span className="ml-auto text-[10px] text-amber-300/70 font-mono">{invoiceMatch?.[1]}</span>
          </div>
          <div className="px-3 py-2 space-y-1 font-mono text-xs text-foreground">
            {invDateMatch && <div className="flex justify-between"><span className="text-muted-foreground">Invoice date</span><span>{invDateMatch[1]}</span></div>}
            {dueDateMatch && <div className="flex justify-between"><span className="text-muted-foreground">Due date</span><span>{dueDateMatch[1]}</span></div>}
            <div className="flex justify-between"><span className="text-muted-foreground">Full amount</span><span className="font-semibold">₹{amountMatch?.[1]}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Max DD rate</span><span className="text-amber-400 font-semibold">{rateMatch?.[1]}%</span></div>
            <div className="border-t border-amber-500/20 pt-1 mt-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Proposed pay by</span><span className="text-amber-300">{payMatch?.[1]} {daysMatch ? `(${daysMatch[1]} days early)` : ''}</span></div>
              {rateAtMatch && <div className="flex justify-between"><span className="text-muted-foreground">Applied rate</span><span>{rateAtMatch[1]}%</span></div>}
              {discMatch && <div className="flex justify-between"><span className="text-muted-foreground">Discounted to</span><span className="text-green-400 font-bold">₹{discMatch[1]}</span></div>}
              {saveMatch && <div className="flex justify-between"><span className="text-muted-foreground">You save</span><span className="text-emerald-400 font-bold">₹{saveMatch[1]}</span></div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Deal closed card
  if (entry.kind === 'accept' && (entry.text.includes('Deal Closed') || entry.text.includes('DEAL CLOSED'))) {
    const lines = entry.text.split('\n')
      .filter(l => l.trim() && !l.includes('Success report') && !l.includes('success report'));
    return (
      <div className="flex justify-center my-1">
        <div className="bg-green-900/30 border border-green-500/40 rounded-lg px-3 py-2 max-w-[90%] w-full">
          <pre className="text-xs text-black dark:text-green-100 whitespace-pre-wrap font-mono leading-relaxed">{lines.join('\n')}</pre>
        </div>
      </div>
    );
  }

  // Round messages: offer / counter / accept
  if (entry.kind === 'offer' || entry.kind === 'counter' || entry.kind === 'accept') {
    const mine = perspective === 'buyer' ? entry.from === 'BUYER' : entry.from === 'SELLER';
    const avatarBg = entry.from === 'BUYER' ? 'bg-blue-500' : 'bg-green-500';
    const bubbleBg = mine
      ? (entry.from === 'BUYER' ? 'bg-blue-600' : 'bg-green-600')
      : 'bg-gray-600';
    const fromLabel = entry.from === 'BUYER' ? 'Buyer' : 'Seller';
    const toLabel   = entry.from === 'BUYER' ? 'Seller' : 'Buyer';
    const kindIcon  = entry.kind === 'offer' ? '📤' : entry.kind === 'counter' ? '↕' : '✅';

    return (
      <div className={cn('flex items-end gap-2', mine ? 'justify-end' : 'justify-start')}>
        {!mine && (
          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] text-white', avatarBg)}>
            {entry.from === 'BUYER' ? 'B' : 'S'}
          </div>
        )}
        <div className={cn('flex flex-col max-w-[80%]', mine ? 'items-end' : 'items-start')}>
          <div className="flex items-center gap-1 mb-0.5 opacity-60">
            <span className="text-[10px] font-medium">{fromLabel}</span>
            <span className="text-[10px]">to</span>
            <span className="text-[10px] font-medium">{toLabel}</span>
          </div>
          <div className={cn('rounded-2xl px-3 py-2 text-xs text-white whitespace-pre-wrap leading-relaxed', bubbleBg, mine ? 'rounded-tr-sm' : 'rounded-tl-sm')}>
            <span className="opacity-70 mr-1">{kindIcon}</span>{entry.text}
          </div>
        </div>
        {mine && (
          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] text-white', avatarBg)}>
            {entry.from === 'BUYER' ? 'B' : 'S'}
          </div>
        )}
      </div>
    );
  }

  // System / verification / fetch
  if (isSystem || isUser) {
    if (isUser) {
      return (
        <div className="flex justify-end items-end gap-2">
          <div className={cn('rounded-lg px-3 py-2 max-w-[85%]',
            perspective === 'buyer' ? 'bg-agent-buyer/30 border border-agent-buyer/50' : 'bg-agent-seller/30 border border-agent-seller/50'
          )}>
            <p className="text-xs text-foreground">{entry.text}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex justify-center">
        <div className={cn('rounded-lg px-3 py-2 max-w-[90%] flex items-center gap-2 text-xs',
          entry.kind === 'system' && 'bg-green-900/20 border border-green-500/40',
          entry.kind === 'verification' && 'bg-purple-900/20 border border-purple-500/40',
          entry.kind === 'fetch' && 'bg-blue-900/20 border border-blue-500/40',
        )}>
          {entry.kind === 'system' && <span>✅</span>}
          {entry.kind === 'verification' && <span>🔐</span>}
          {entry.kind === 'fetch' && <span>📥</span>}
          <p className="text-foreground/90">{entry.text}</p>
        </div>
      </div>
    );
  }

  // Info fallback
  const mine2 = perspective === 'buyer' ? entry.from === 'BUYER' : entry.from === 'SELLER';
  const avatarBg2 = entry.from === 'BUYER' ? 'bg-blue-500' : 'bg-green-500';
  const bubbleBg2 = mine2 ? (entry.from === 'BUYER' ? 'bg-blue-600' : 'bg-green-600') : 'bg-gray-600';
  return (
    <div className={cn('flex items-end gap-2', mine2 ? 'justify-end' : 'justify-start')}>
      {!mine2 && <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] text-white', avatarBg2)}>{entry.from === 'BUYER' ? 'B' : 'S'}</div>}
      <div className={cn('rounded-2xl px-3 py-2 text-xs text-white whitespace-pre-wrap leading-relaxed max-w-[80%]', bubbleBg2, mine2 ? 'rounded-tr-sm' : 'rounded-tl-sm')}>
        {entry.text}
      </div>
      {mine2 && <div className={cn('w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] text-white', avatarBg2)}>{entry.from === 'BUYER' ? 'B' : 'S'}</div>}
    </div>
  );
}

// ── GLEIF Verification Pipeline component ────────────────────────────────────
function GleifPipeline({
  verifyingTarget,
  result,
}: {
  verifyingTarget: 'buyer' | 'seller';
  result: import('@/lib/a2aService').VerificationResult | null;
}) {
  const finalOk = result?.success ?? false;
  const output  = result?.output ?? '';

  const step1ok = finalOk && (output.includes('Step 1: AIDs loaded') || output.includes('[Step 1]') || output.includes('Fetching Agent and OOR AIDs'));
  const step2ok = finalOk && (output.includes('Step 2: Delegation field') || output.includes('[Step 2]') || output.includes('Delegation field verified'));
  const step3ok = finalOk && (output.includes('Step 3: Delegation seal') || output.includes('[Step 3]') || output.includes('DELEGATION VERIFIED'));
  const step4ok = finalOk && (output.includes('Step 4: Seal digest') || output.includes('[Step 4]') || output.includes('CRYPTOGRAPHIC VERIFICATION PASSED'));
  const step5ok = finalOk && (output.includes('Step 5: Public key') || output.includes('[Step 5]') || output.includes('Public key found'));

  const nodes = [
    { icon: '🛡️', title: 'GLEIF Root → QVI',   desc: 'Root of trust for vLEI ecosystem',                                                          ok: finalOk  },
    { icon: '🏢', title: 'Legal Entity',         desc: verifyingTarget === 'seller' ? 'Jupiter Knitting Company' : 'Tommy Hilfiger Europe B.V.',    ok: step1ok  },
    { icon: '👔', title: 'OOR Holder',           desc: verifyingTarget === 'seller' ? 'Chief Sales Officer' : 'Chief Procurement Officer',          ok: step2ok  },
    { icon: '🔗', title: 'Delegation Seal',      desc: 'KEL seal anchored in OOR holder',                                                           ok: step3ok  },
    { icon: '🔐', title: 'Cryptographic Proof',  desc: 'Seal digest matches agent inception SAID',                                                  ok: step4ok  },
    { icon: '🤖', title: verifyingTarget === 'seller' ? 'Seller Agent Card' : 'Buyer Agent Card', desc: 'Public key available for signature verification', ok: step5ok },
    { icon: '✅', title: 'Verified',             desc: 'Delegation is CRYPTOGRAPHICALLY VERIFIED',                                                  ok: finalOk  },
  ];

  // Sequential reveal — one node every 400ms after result arrives
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    if (result === null) { setVisibleCount(0); return; }
    setVisibleCount(0);
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= nodes.length) clearInterval(interval);
    }, 400);
    return () => clearInterval(interval);
  }, [result]);

  return (
    <div className="flex flex-col gap-0">
      {nodes.map((node, i) => {
        const isFinal   = i === nodes.length - 1;
        const revealed  = i < visibleCount;
        const isOk      = revealed && node.ok;
        return (
          <div key={i} className="flex flex-col items-start">
            <div className={cn(
              'flex items-center gap-3 w-full rounded-lg px-3 py-2 border transition-all duration-500',
              !revealed   ? 'border-border/30 bg-muted/10 opacity-40' :
              isOk && isFinal ? 'border-green-500/60 bg-green-900/20' :
              isOk        ? 'border-green-500/40 bg-green-900/10' :
                            'border-red-500/40 bg-red-900/10 opacity-70'
            )}>
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold transition-all duration-500',
                !revealed ? 'bg-muted' : isOk ? 'bg-green-500' : 'bg-red-500'
              )}>
                {!revealed ? '?' : isOk ? '✓' : '✗'}
              </div>
              <span className="text-base">{node.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={cn('text-xs font-semibold', revealed ? 'text-foreground' : 'text-muted-foreground')}>{node.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{node.desc}</p>
              </div>
            </div>
            {!isFinal && (
              <div className={cn(
                'w-0.5 h-3 ml-5 transition-all duration-500',
                isOk ? 'bg-green-500' : 'bg-border/30'
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AgentCenter({ simulation }: AgentCenterProps) {
  const { agents, actions, messages } = simulation.state;

  const messagesRef = useRef<HTMLDivElement | null>(null);
  const buyerChatRef = useRef<HTMLDivElement | null>(null);
  const sellerChatRef = useRef<HTMLDivElement | null>(null);

  const [buyerChatInput, setBuyerChatInput] = useState('');
  const [sellerChatInput, setSellerChatInput] = useState('');
  // Both chats share the same negotiation messages — just rendered from different perspectives
  const [negotiationEntries, setNegotiationEntries] = useState<ChatEntry[]>([]);
  const [buyerSystemEntries, setBuyerSystemEntries] = useState<ChatEntry[]>([]);
  const [sellerSystemEntries, setSellerSystemEntries] = useState<ChatEntry[]>([]);
  
  // Separate state for each section's fetched agents
  const [buyerSectionFetchedAgents, setBuyerSectionFetchedAgents] = useState<{
    buyer: boolean;
    seller: boolean;
  }>({ buyer: false, seller: false });
  
  const [sellerSectionFetchedAgents, setSellerSectionFetchedAgents] = useState<{
    buyer: boolean;
    seller: boolean;
  }>({ buyer: false, seller: false });
  
  const [buyerVerificationStep, setBuyerVerificationStep] = useState(0);
  const [sellerVerificationStep, setSellerVerificationStep] = useState(0);
  const [buyerVerificationResult, setBuyerVerificationResult] = useState<import('@/lib/a2aService').VerificationResult | null>(null);
  const [sellerVerificationResult, setSellerVerificationResult] = useState<import('@/lib/a2aService').VerificationResult | null>(null);
  const [buyerPipelineVisible, setBuyerPipelineVisible] = useState(false);
  const [sellerPipelineVisible, setSellerPipelineVisible] = useState(false);
  const [expandedChat, setExpandedChat] = useState<'buyer' | 'seller' | null>(null);
  const [selectedAgentDetails, setSelectedAgentDetails] = useState<'buyer' | 'seller' | null>(null);
  const [fetchedCardData, setFetchedCardData] = useState<{ buyer?: AgentCardData; seller?: AgentCardData }>({});
  const [isBuyerAgentTyping, setIsBuyerAgentTyping] = useState(false);

  // Live negotiation tracking
  const [negotiationRounds, setNegotiationRounds] = useState<Array<{
    round: number; buyerOffer?: number; sellerOffer?: number; gap?: number;
  }>>([]);
  const [negotiationStatus, setNegotiationStatus] = useState<'idle' | 'in_progress' | 'completed' | 'escalated' | 'failed'>('idle');
  const [negotiationFinalPrice, setNegotiationFinalPrice] = useState<number | undefined>();
  const [negotiationTotal, setNegotiationTotal] = useState<number | undefined>();
  const [ddOffer, setDdOffer] = useState<ParsedDDOffer | null>(null);
  const [flowStep, setFlowStep] = useState<'none' | 'po' | 'invoice' | 'dd_offer' | 'dd_accepted' | 'dd_rejected' | 'dd_invoice'>('none');
  const [liveServerOpen, setLiveServerOpen] = useState(false);
  const [liveLog, setLiveLog] = useState<Array<{ ts: string; from: 'BUYER' | 'SELLER'; text: string }>>([]);
  const liveLogRef = useRef<HTMLDivElement>(null);

  // Treasury chat state
  const [treasuryEntries, setTreasuryEntries] = useState<ChatEntry[]>([]);
  const [expandedTreasury, setExpandedTreasury] = useState(false);
  const treasuryChatRef = useRef<HTMLDivElement | null>(null);
  const treasuryHandlerRef = useRef<(msg: NegotiationMessage) => void>(() => {});

  // Ref so the SSE callback always has the latest setState functions (avoids stale closure)
  const negotiationHandlerRef = useRef<(msg: NegotiationMessage) => void>(() => {});
  const sellerHandlerRef = useRef<(msg: NegotiationMessage) => void>(() => {});

  const agentActions = (type: 'buyer' | 'seller' | 'treasury') =>
    actions.filter(a => a.agent === type);

  // Auto-scroll
  useEffect(() => {
    if (liveLogRef.current) liveLogRef.current.scrollTo({ top: liveLogRef.current.scrollHeight, behavior: 'smooth' });
  }, [liveLog.length]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);
  useEffect(() => {
    if (buyerChatRef.current) buyerChatRef.current.scrollTo({ top: buyerChatRef.current.scrollHeight, behavior: 'smooth' });
  }, [negotiationEntries.length, buyerSystemEntries.length]);
  useEffect(() => {
    if (sellerChatRef.current) sellerChatRef.current.scrollTo({ top: sellerChatRef.current.scrollHeight, behavior: 'smooth' });
  }, [negotiationEntries.length, sellerSystemEntries.length]);

  const addBuyerSystem = (text: string, kind: ChatEntry['kind'] = 'system') => {
    setBuyerSystemEntries(prev => [...prev, { id: crypto.randomUUID(), seq: nextSeq(), text, from: 'USER', timestamp: new Date(), kind }]);
  };
  const addBuyerUserMsg = (text: string) => {
    setBuyerSystemEntries(prev => [...prev, { id: crypto.randomUUID(), seq: nextSeq(), text, from: 'USER', timestamp: new Date(), kind: 'user' }]);
  };
  const addSellerSystem = (text: string, kind: ChatEntry['kind'] = 'system') => {
    setSellerSystemEntries(prev => [...prev, { id: crypto.randomUUID(), seq: nextSeq(), text, from: 'USER', timestamp: new Date(), kind }]);
  };

  // ── Direct insertion in arrival order — no sorting, arrival order IS correct order
  const addNegotiationMsg = async (msg: NegotiationMessage) => {
    // ── IPEX injection: before any invoice (standard or DD), fetch grant+admit ──
    const isInvoice = msg.kind === 'invoice';

    if (isInvoice) {
      try {
        const r = await fetch('http://localhost:4000/api/ipex-status');
        if (r.ok) {
          const ipex: any = await r.json();
          const ts = new Date(msg.timestamp);
          const entriesToAdd: ChatEntry[] = [];

          if (ipex.grant) {
            const g = ipex.grant;
            const id = `ipex-grant-${msg.id}`;
            entriesToAdd.push({
              id,
              seq: nextSeq(),
              text: `📤 IPEX GRANT\njupiterSellerAgent → tommyBuyerAgent\nCredential : ${g.credentialSAID?.slice(0,20)}...\nGrant SAID : ${g.grantSAID?.slice(0,20)}...\nInvoice    : ${g.invoiceNumber}  ${g.amount?.toLocaleString()} ${g.currency}\nSelf-Attested: ${g.selfAttested ? '✓ YES' : 'NO'}\nSeller LEI : ${g.sellerLEI}\nBuyer LEI  : ${g.buyerLEI}`,
              from: 'SELLER' as const,
              timestamp: new Date(ts.getTime() - 2000),
              kind: 'info' as const,
            });
          }

          if (ipex.admit) {
            const a = ipex.admit;
            const id = `ipex-admit-${msg.id}`;
            entriesToAdd.push({
              id,
              seq: nextSeq(),
              text: `📥 IPEX ADMIT\ntommyBuyerAgent admitted grant\nGrant SAID : ${a.grantSAID?.slice(0,20)}...\nCredential : ${a.credentialSAID?.slice(0,20)}...\nInvoice    : ${a.invoiceNumber}  ${a.amount?.toLocaleString()} ${a.currency}\nStored in  : tommyBuyerAgent KERIA storage`,
              from: 'BUYER' as const,
              timestamp: new Date(ts.getTime() - 1000),
              kind: 'info' as const,
            });
          }

          // Insert grant + admit + invoice all at once so they appear in order
          if (entriesToAdd.length > 0) {
            setNegotiationEntries(prev => {
              if (prev.some(e => e.id === msg.id)) return prev;
              const newIds = new Set(entriesToAdd.map(e => e.id));
              const filtered = prev.filter(e => !newIds.has(e.id));
              return [...filtered, ...entriesToAdd, {
                id: msg.id,
                seq: nextSeq(),
                text: msg.text,
                from: msg.from,
                timestamp: new Date(msg.timestamp),
                kind: msg.kind,
              }];
            });
            setLiveLog(prev => [...prev, { ts: new Date(msg.timestamp).toLocaleTimeString(), from: msg.from as 'BUYER' | 'SELLER', text: msg.text }]);
            if (msg.kind === 'invoice' && !msg.text.includes('DD Invoice') && !msg.text.includes('✅ DD')) setFlowStep('invoice');
            if (msg.text.includes('✅ DD Invoice') || msg.text.includes('DD Invoice received') || msg.text.includes('🎉 End-to-end')) setFlowStep('dd_invoice');
            return; // skip the normal add below
          }
        }
      } catch { /* api-server not running — fall through to normal add */ }
    }

    setNegotiationEntries(prev => {
      if (prev.some(e => e.id === msg.id)) return prev;
      return [...prev, {
        id: msg.id,
        seq: nextSeq(),
        text: msg.text,
        from: msg.from,
        timestamp: new Date(msg.timestamp),
        kind: msg.kind,
      }];
    });
    setLiveLog(prev => [...prev, { ts: new Date(msg.timestamp).toLocaleTimeString(), from: msg.from as 'BUYER' | 'SELLER', text: msg.text }]);
    if (msg.kind === 'po') setFlowStep('po');
    if (msg.kind === 'invoice' && !msg.text.includes('DD Invoice') && !msg.text.includes('✅ DD')) setFlowStep('invoice');
    if (msg.kind === 'dd') { const dd = parseDDOffer(msg.text); if (dd) { setDdOffer(dd); setFlowStep('dd_offer'); } }
    if (msg.text.includes('DD accepted') || msg.text.includes('dd accept')) setFlowStep('dd_accepted');
    if (msg.text.includes('DD offer declined') || msg.text.includes('dd reject')) setFlowStep('dd_rejected');
    if (msg.text.includes('✅ DD Invoice') || msg.text.includes('DD Invoice received') || msg.text.includes('🎉 End-to-end')) setFlowStep('dd_invoice');
    const update = parseNegotiationUpdate(msg.text);
    if (update) {
      if (update.status === 'IN_PROGRESS' && (update.round || update.buyerOffer || update.sellerOffer)) {
        setNegotiationStatus('in_progress');
        setNegotiationRounds(prev => {
          const roundNum = update.round ?? (prev.length + 1);
          const existing = prev.find(x => x.round === roundNum);
          if (existing) return prev.map(x => x.round === roundNum ? {
            ...x,
            buyerOffer:  update.buyerOffer  ?? x.buyerOffer,
            sellerOffer: update.sellerOffer ?? x.sellerOffer,
          } : x);
          return [...prev, { round: roundNum, buyerOffer: update.buyerOffer, sellerOffer: update.sellerOffer }];
        });
      }
      if (update.status === 'COMPLETED') {
        setNegotiationStatus('completed'); setIsBuyerAgentTyping(false);
        if (update.finalPrice) setNegotiationFinalPrice(update.finalPrice);
        if (update.totalValue) setNegotiationTotal(update.totalValue);
        simulation.updateAgentStatus('buyer', 'idle');
        simulation.updateAgentStatus('seller', 'idle');
      }
      if (update.status === 'ESCALATED') { setNegotiationStatus('escalated'); setIsBuyerAgentTyping(false); }
      if (update.status === 'FAILED') { setNegotiationStatus('failed'); setIsBuyerAgentTyping(false); }
    }
  };
  // Normalise unit labels from running agents — replace /unit with /fabric unit
  const normaliseMsg = (msg: NegotiationMessage): NegotiationMessage => ({
    ...msg,
    text: msg.text
      .replace(/\/unit\b/g, '/fabric unit')
      .replace(/\b(\d[\d,]*)\s+units\b/g, '$1 fabric units'),
  });

  // Keep buyer SSE handler ref fresh
  useEffect(() => {
    negotiationHandlerRef.current = (msg: NegotiationMessage) => {
      if (msg.text.includes('Connected to buyer agent events')) return;
      addNegotiationMsg(normaliseMsg(msg));
    };
  });

  // Keep seller SSE handler ref fresh
  useEffect(() => {
    sellerHandlerRef.current = (msg: NegotiationMessage) => {
      if (msg.text.includes('Connected to seller agent events')) return;
      addNegotiationMsg(normaliseMsg(msg));
    };
  });

  // Treasury SSE handler
  useEffect(() => {
    treasuryHandlerRef.current = (msg: NegotiationMessage) => {
      if (msg.text.includes('Connected to treasury agent events')) return;
      setTreasuryEntries(prev => [...prev, {
        id: msg.id, seq: nextSeq(), text: msg.text, from: msg.from,
        timestamp: new Date(msg.timestamp), kind: msg.kind,
      }]);
    };
  });

  // Auto-scroll treasury chat
  useEffect(() => {
    if (treasuryChatRef.current) treasuryChatRef.current.scrollTo({ top: treasuryChatRef.current.scrollHeight, behavior: 'smooth' });
  }, [treasuryEntries.length]);

  // Subscribe on mount
  useEffect(() => {
    const u1 = subscribeToNegotiationEvents((msg) => negotiationHandlerRef.current(msg));
    const u2 = subscribeToSellerEvents((msg) => sellerHandlerRef.current(msg));
    const u3 = subscribeToTreasuryEvents((msg) => treasuryHandlerRef.current(msg));
    return () => { u1(); u2(); u3(); };
  }, []);

  // NLP Intent Parser - Understands natural language commands
  const parseIntent = (input: string, context: 'buyer' | 'seller') => {
    const lower = input.toLowerCase().trim();
    
    // Intent: Fetch My Agent (including explicit "fetch buyer agent" in buyer context)
    if (
      lower.includes('fetch my agent') ||
      lower.includes('show my agent') ||
      lower.includes('get my agent') ||
      lower.includes('display my agent') ||
      (context === 'buyer' && (
        lower.includes('fetch buyer') ||
        lower.includes('show buyer') ||
        lower.includes('get buyer') ||
        lower.includes('show me buyer') ||
        lower.includes('show buyer information') ||
        lower.includes('buyer details') ||
        lower.includes('my information') ||
        lower.includes('my details')
      )) ||
      (context === 'seller' && (
        lower.includes('fetch seller') ||
        lower.includes('show seller') ||
        lower.includes('get seller') ||
        lower.includes('show me seller') ||
        lower.includes('show seller information') ||
        lower.includes('seller details') ||
        lower.includes('my information') ||
        lower.includes('my details')
      ))
    ) {
      return { intent: 'fetch_my_agent', entity: context };
    }
    
    // Intent: Fetch Other Agent (Buyer fetching Seller or vice versa)
    if (context === 'buyer') {
      if (
        (lower.includes('fetch') || lower.includes('show') || lower.includes('get') || lower.includes('display')) &&
        (lower.includes('seller') || lower.includes('other'))
      ) {
        return { intent: 'fetch_other_agent', entity: 'seller' };
      }
    } else {
      if (
        (lower.includes('fetch') || lower.includes('show') || lower.includes('get') || lower.includes('display')) &&
        (lower.includes('buyer') || lower.includes('other'))
      ) {
        return { intent: 'fetch_other_agent', entity: 'buyer' };
      }
    }
    
    // Intent: Verify Agent (more flexible - just "verify" works)
    if (
      lower.includes('verify') ||
      lower.includes('authenticate') ||
      lower.includes('check') ||
      lower.includes('validation')
    ) {
      const targetAgent = context === 'buyer' ? 'seller' : 'buyer';
      return { intent: 'verify_agent', entity: targetAgent };
    }
    
    // Intent: Start Transaction/Simulation
    if (
      lower.includes('start') ||
      lower.includes('begin') ||
      lower.includes('commence') ||
      lower.includes('initiate') ||
      lower.includes('run') ||
      lower.includes('go') && (lower.includes('ahead') || lower.includes('now'))
    ) {
      return { intent: 'start_simulation', entity: null };
    }
    
    // Intent: Unknown
    return { intent: 'unknown', entity: null };
  };

  const handleBuyerCommand = (command: string) => {
    const parsed = parseIntent(command, 'buyer');
    const lower = command.toLowerCase().trim();

    // ── REAL A2A AGENT: start negotiation ────────────────────────────────────
    if (lower.startsWith('start negotiation')) {
      addBuyerUserMsg(command);

      // ── vLEI gate: seller must be verified before negotiation can start ───
      if (!buyerVerificationResult?.success) {
        addBuyerSystem(
          '🔒 Cannot start negotiation — seller vLEI not verified yet.\n' +
          '→ Step 1: "fetch seller agent" (needs A2A seller running on :8080)\n' +
          '→ Step 2: "verify agent" (needs vLEI api-server running on :4000)\n' +
          'Then retry: "start negotiation 300"',
          'system'
        );
        return;
      }

      setIsBuyerAgentTyping(true);
      setNegotiationStatus('in_progress');
      setNegotiationRounds([]);
      setNegotiationEntries([]);
      setNegotiationFinalPrice(undefined);
      setNegotiationTotal(undefined);
      setDdOffer(null);
      setFlowStep('none');
      setBuyerSystemEntries([]);
      setSellerSystemEntries([]);

      // ── Treasury agent verification in Treasury Chat ──────────────────────
      (async () => {
        // Step 1: fetch treasury agent card from :7070
        setTreasuryEntries([{
          id: crypto.randomUUID(), seq: nextSeq(),
          text: '🏦 Fetching JupiterTreasuryAgent card from :7070...',
          from: 'TREASURY', timestamp: new Date(), kind: 'info',
        }]);
        const treasuryCard = await fetchAgentCard('treasury' as any);
        if (treasuryCard) {
          const ext = (treasuryCard as any).extensions;
          const aid = ext?.keriIdentifiers?.agentAID ?? 'unknown';
          const lei = ext?.gleifIdentity?.lei ?? 'unknown';
          const parent = ext?.vLEImetadata?.parentAgentName ?? 'jupiterSellerAgent';
          setTreasuryEntries(prev => [...prev, {
            id: crypto.randomUUID(), seq: nextSeq(),
            text: `✅ JupiterTreasuryAgent card fetched\nAID: ${aid}\nLEI: ${lei}\nSub-delegated from: ${parent}`,
            from: 'TREASURY', timestamp: new Date(), kind: 'info',
          }]);
        } else {
          setTreasuryEntries(prev => [...prev, {
            id: crypto.randomUUID(), seq: nextSeq(),
            text: '⚠️ Could not fetch treasury agent card — is :7070 running?',
            from: 'TREASURY', timestamp: new Date(), kind: 'info',
          }]);
        }

        // Step 2: verify treasury via /api/status
        setTreasuryEntries(prev => [...prev, {
          id: crypto.randomUUID(), seq: nextSeq(),
          text: '🔐 Verifying JupiterTreasuryAgent delegation chain via vLEI api-server...',
          from: 'TREASURY', timestamp: new Date(), kind: 'info',
        }]);
        try {
          const statusRes = await fetch('http://localhost:4000/api/status');
          if (statusRes.ok) {
            const status = await statusRes.json() as any;
            const t = status.treasury;
            if (t?.verified) {
              setTreasuryEntries(prev => [...prev, {
                id: crypto.randomUUID(), seq: nextSeq(),
                text: `✅ JupiterTreasuryAgent VERIFIED\nAID: ${t.agentAID}\nTrust chain: GEDA → QVI → Jupiter_Chief_Sales_Officer → jupiterSellerAgent → JupiterTreasuryAgent\nScope: treasury_operations`,
                from: 'TREASURY', timestamp: new Date(), kind: 'info',
              }]);
            } else {
              setTreasuryEntries(prev => [...prev, {
                id: crypto.randomUUID(), seq: nextSeq(),
                text: '⚠️ Treasury agent not found in task-data — run 4D workflow first',
                from: 'TREASURY', timestamp: new Date(), kind: 'info',
              }]);
            }
          } else {
            throw new Error(`HTTP ${statusRes.status}`);
          }
        } catch (err: any) {
          setTreasuryEntries(prev => [...prev, {
            id: crypto.randomUUID(), seq: nextSeq(),
            text: `⚠️ vLEI api-server unreachable (:4000) — treasury verification skipped\n${err.message}`,
            from: 'TREASURY', timestamp: new Date(), kind: 'info',
          }]);
        }
      })();
      // ─────────────────────────────────────────────────────────────────────

      simulation.updateAgentStatus('buyer', 'active');
      simulation.updateAgentStatus('seller', 'active');

      sendToBuyerAgent(
        command,
        (err) => {
          addBuyerSystem(`⚠ ${err}`, 'system');
          setNegotiationStatus('idle');
          setIsBuyerAgentTyping(false);
          simulation.updateAgentStatus('buyer', 'idle');
        },
        () => { /* messages arrive via SSE */ }
      );
      return;
    }

    if (parsed.intent === 'fetch_my_agent') {
      addBuyerUserMsg(command);
      setTimeout(async () => {
        addBuyerSystem('🔵 Fetching Buyer Agent from :9090...', 'fetch');
        setBuyerSectionFetchedAgents(prev => ({ ...prev, buyer: true }));
        const card = await fetchAgentCard('buyer');
        if (card) {
          setFetchedCardData(prev => ({ ...prev, buyer: card }));
          setTimeout(() => addBuyerSystem('✅ Buyer Agent Card Fetched - Complete', 'system'), 1000);
        } else {
          addBuyerSystem('❌ Could not fetch Buyer Agent card — is the buyer agent running on :9090?', 'system');
          setBuyerSectionFetchedAgents(prev => ({ ...prev, buyer: false }));
        }
      }, 500);
    } else if (parsed.intent === 'fetch_other_agent' && parsed.entity === 'seller') {
      addBuyerUserMsg(command);
      setTimeout(async () => {
        addBuyerSystem('🟢 Fetching Seller Agent from :8080...', 'fetch');
        setBuyerSectionFetchedAgents(prev => ({ ...prev, seller: true }));
        const card = await fetchAgentCard('seller');
        if (card) {
          setFetchedCardData(prev => ({ ...prev, seller: card }));
          setTimeout(() => addBuyerSystem('✅ Seller Agent Card Fetched - Complete', 'system'), 1000);
        } else {
          addBuyerSystem('❌ Could not fetch Seller Agent card — is the seller agent running on :8080?', 'system');
          setBuyerSectionFetchedAgents(prev => ({ ...prev, seller: false }));
        }
      }, 500);
      } else if (parsed.intent === 'verify_agent' && parsed.entity === 'seller') {
        addBuyerUserMsg(command);
        const endpoint = 'http://localhost:4000/api/buyer/verify/ext/seller';
        addBuyerSystem(`🔐 Calling ${endpoint} ...`, 'verification');
        setBuyerVerificationStep(1);

        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
              addBuyerSystem('🔍 Step 1: Found ✓', 'verification');
              setBuyerVerificationStep(2);
              addBuyerSystem('📦 Step 2: Fetched ✓', 'verification');
              setBuyerVerificationStep(3);
              addBuyerSystem('🔄 Step 3: Checked ✓', 'verification');
              setBuyerVerificationStep(4);
              addBuyerSystem('✅ Step 4: Verified ✓', 'verification');
              addBuyerSystem('🎉 Seller Agent Verified by Buyer - Complete', 'system');
              addBuyerSystem('✅ Agent authentication complete! Ready for secure transactions.', 'system');
              // ── Persist verification result so the negotiation gate opens ───
              // Synthesize an `output` string from the verification.* booleans so
              // GleifPipeline (which scans output for step phrases) lights up green.
              const v = (data as any)?.verification ?? {};
              const synthesizedOutput = [
                v.step1_info_loaded          ? 'Step 1: AIDs loaded'                : '',
                v.step2_di_verified          ? 'Step 2: Delegation field verified'  : '',
                v.step3_seal_found           ? 'Step 3: Delegation seal verified'   : '',
                v.step4_digest_verified      ? 'Step 4: Seal digest verified'       : '',
                v.step5_public_key_available ? 'Step 5: Public key found'           : '',
              ].filter(Boolean).join('\n');
              setBuyerVerificationResult({ ...(data as any), output: synthesizedOutput });
              setBuyerPipelineVisible(true);
            } else {
              addBuyerSystem(`✗ Verification failed: ${data.error || `HTTP ${res.status}`}`, 'verification');
              setBuyerVerificationResult({ ...(data as any), success: false });
              setBuyerPipelineVisible(true);
            }
          })
          .catch((err) => {
            addBuyerSystem(`✗ Could not reach API server at :4000 — ${err.message}`, 'verification');
            setBuyerVerificationResult({ success: false, error: err.message } as any);
          })
          .finally(() => setBuyerVerificationStep(0));

    } else if (parsed.intent === 'start_simulation') {
      addBuyerUserMsg(command);
      setTimeout(() => {
        addBuyerSystem('🚀 Starting agent communication...', 'system');
        simulation.startSimulation();
        setTimeout(() => {
          addBuyerSystem('✅ Agent communication started successfully!', 'system');
        }, 1000);
      }, 500);
    } else {
      addBuyerUserMsg(command);
      setTimeout(() => {
        addBuyerSystem('💡 Try: "start negotiation 300" to begin a real negotiation, or "fetch my agent", "verify agent"', 'system');
      }, 500);
    }
  };

  const handleSellerCommand = (command: string) => {
    const parsed = parseIntent(command, 'seller');
    
    if (parsed.intent === 'fetch_my_agent') {
      addSellerSystem(command, 'user');
      setTimeout(async () => {
        addSellerSystem('🟢 Fetching Seller Agent...', 'fetch');
        setSellerSectionFetchedAgents(prev => ({ ...prev, seller: true }));
        const card = await fetchAgentCard('seller');
        if (card) setFetchedCardData(prev => ({ ...prev, seller: card }));
        setTimeout(() => {
          addSellerSystem('✅ Seller Agent Card Fetched - Complete', 'system');
        }, 1000);
      }, 500);
    } else if (parsed.intent === 'fetch_other_agent' && parsed.entity === 'buyer') {
      addSellerSystem(command, 'user');
      setTimeout(async () => {
        addSellerSystem('🔵 Fetching Buyer Agent...', 'fetch');
        setSellerSectionFetchedAgents(prev => ({ ...prev, buyer: true }));
        const card = await fetchAgentCard('buyer');
        if (card) setFetchedCardData(prev => ({ ...prev, buyer: card }));
        setTimeout(() => {
          addSellerSystem('✅ Buyer Agent Card Fetched - Complete', 'system');
        }, 1000);
      }, 500);
    } else if (parsed.intent === 'verify_agent' && parsed.entity === 'buyer') {
          addSellerSystem(command, 'user');
          const endpoint = 'http://localhost:4000/api/seller/verify/ext/buyer';
          addSellerSystem(`🔐 Calling ${endpoint} ...`, 'verification');
          setSellerVerificationStep(1);

          fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
            .then(async (res) => {
              const data = await res.json().catch(() => ({}));
              if (res.ok && data.success) {
                addSellerSystem('🔍 Step 1: Found ✓', 'verification');
                setSellerVerificationStep(2);
                addSellerSystem('📦 Step 2: Fetched ✓', 'verification');
                setSellerVerificationStep(3);
                addSellerSystem('🔄 Step 3: Checked ✓', 'verification');
                setSellerVerificationStep(4);
                addSellerSystem('✅ Step 4: Verified ✓', 'verification');
                addSellerSystem('🎉 Buyer Agent Verified by Seller - Complete', 'system');
                addSellerSystem('✅ Agent authentication complete! Ready for secure transactions.', 'system');
                // ── Persist verification result so the negotiation gate opens ───
                // Synthesize an `output` string from the verification.* booleans so
                // GleifPipeline (which scans output for step phrases) lights up green.
                const v = (data as any)?.verification ?? {};
                const synthesizedOutput = [
                  v.step1_info_loaded          ? 'Step 1: AIDs loaded'                : '',
                  v.step2_di_verified          ? 'Step 2: Delegation field verified'  : '',
                  v.step3_seal_found           ? 'Step 3: Delegation seal verified'   : '',
                  v.step4_digest_verified      ? 'Step 4: Seal digest verified'       : '',
                  v.step5_public_key_available ? 'Step 5: Public key found'           : '',
                ].filter(Boolean).join('\n');
                setSellerVerificationResult({ ...(data as any), output: synthesizedOutput });
                setSellerPipelineVisible(true);
              } else {
                addSellerSystem(`✗ Verification failed: ${data.error || `HTTP ${res.status}`}`, 'verification');
                setSellerVerificationResult({ ...(data as any), success: false });
                setSellerPipelineVisible(true);
              }
            })
            .catch((err) => {
              addSellerSystem(`✗ Could not reach API server at :4000 — ${err.message}`, 'verification');
              setSellerVerificationResult({ success: false, error: err.message } as any);
            })
            .finally(() => setSellerVerificationStep(0));
            
    } else if (parsed.intent === 'start_simulation') {
      addSellerSystem(command, 'user');
      setTimeout(() => {
        addSellerSystem('🚀 Starting agent communication...', 'system');
        simulation.startSimulation();
        setTimeout(() => {
          addSellerSystem('✅ Agent communication started successfully!', 'system');
        }, 1000);
      }, 500);
    } else {
      addSellerSystem(command, 'user');
      setTimeout(() => {
        addSellerSystem('💡 I can help you with: Show buyer/seller info, verify agents, or start the transaction. Try asking naturally!', 'system');
      }, 500);
    }
  };

  const handleBuyerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (buyerChatInput.trim()) {
      handleBuyerCommand(buyerChatInput);
      setBuyerChatInput('');
    }
  };

  const handleSellerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sellerChatInput.trim()) {
      handleSellerCommand(sellerChatInput);
      setSellerChatInput('');
    }
  };

  // Render full-screen chat mode
  if (expandedChat) {
    const isExpandedBuyer = expandedChat === 'buyer';
    const chatEntries = [...(isExpandedBuyer ? buyerSystemEntries : sellerSystemEntries), ...negotiationEntries].sort((a,b) => a.seq - b.seq);
    const chatInput = isExpandedBuyer ? buyerChatInput : sellerChatInput;
    const setChatInput = isExpandedBuyer ? setBuyerChatInput : setSellerChatInput;
    const handleSubmit = isExpandedBuyer ? handleBuyerSubmit : handleSellerSubmit;
    const chatRef = isExpandedBuyer ? buyerChatRef : sellerChatRef;
    // agentMessages removed - using chatEntries
    const agentName = isExpandedBuyer ? 'Buyer' : 'Seller';
    const agentColor = isExpandedBuyer ? 'text-agent-buyer' : 'text-agent-seller';
    const agentIcon = isExpandedBuyer ? '🔵' : '🟢';

    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('text-2xl', agentColor)}>{agentIcon}</div>
            <div>
              <h2 className={cn('text-xl font-bold', agentColor)}>{agentName} Chat</h2>
              <p className="text-sm text-muted-foreground">{chatEntries.length} messages</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setExpandedChat(null)}
            className="gap-2"
          >
            <span className="text-lg">⤢</span>
            Collapse
          </Button>
        </div>

        {/* Messages Area - Scrollable */}
        <div 
          ref={chatRef}
          className="flex-1 overflow-y-auto px-6 py-6"
        >
          <div className="max-w-[900px] mx-auto space-y-3">
            {chatEntries.length > 0 ? (
              chatEntries
                .sort((a, b) => a.seq - b.seq)
                .map((entry) => (
                <ChatBubbleEntry key={entry.id} entry={entry} perspective={isExpandedBuyer ? 'buyer' : 'seller'} />
              ))
            ) : (
              <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
                <div className="text-center">
                  <MessageSquare size={64} className="mx-auto mb-4 opacity-30" />
                  <p className="text-lg">Type commands to interact</p>
                  <p className="text-sm mt-2">Try: "start negotiation 300"</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Input Box */}
        <div className="sticky bottom-0 z-10 bg-card border-t border-border px-6 py-4">
          <div className="max-w-[900px] mx-auto">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <Input 
                placeholder={`Type command (e.g., fetch my agent)...`}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 h-12 text-base bg-background"
                autoFocus
              />
              <Button type="submit" size="lg" className="h-12 px-6">
                <Send size={18} />
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent Command Center</h1>
          <p className="text-muted-foreground">Monitor and control autonomous procurement agents</p>
        </div>
      </div>

      {/* Four Column Agent View - Buyer Treasury, Buyer, Separator, Seller, Seller Treasury */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_3fr_3px_3fr_1fr] gap-6">
        {/* Buyer's Treasury Agent */}
        <div className="space-y-4">
          <div className="agent-card-treasury rounded-xl p-5 backdrop-blur-xl bg-agent-treasury/10 border border-agent-treasury/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <StatusIndicator status={agents.buyerTreasury.status} agent="treasury" size="lg" />
                <div className="flex-1">
                  <h3 className="font-bold text-agent-treasury text-sm">Buyer's Treasury Agent</h3>
                  <p className="text-xs text-muted-foreground">Success Rate: {agents.buyerTreasury.successRate}%</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings size={16} />
              </Button>
            </div>
          </div>
        </div>

        {/* Buyer Organization */}
        <div className="space-y-4">
          <div className="agent-card-buyer rounded-xl p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-agent-buyer/20 border border-agent-buyer/40 flex items-center justify-center flex-shrink-0">
                  <ShoppingBag size={18} className="text-agent-buyer" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-agent-buyer text-sm">Buyer Organization</h3>
                  <p className="text-xs text-muted-foreground">Success Rate: {agents.buyer.successRate}%</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings size={16} />
              </Button>
            </div>
            
            <div className="bg-background/30 rounded-lg p-3">
              <div className="space-y-2 text-xs">
                <div>
                  <p className="font-semibold text-foreground">TOMMY HILFIGER EUROPE B.V.</p>
                </div>
                <div>
                  <p className="text-muted-foreground">LEI: <span className="text-foreground font-mono text-[10px]">54930012QJWZMYHNJW95</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">Agent AID: <span className="text-foreground font-mono text-[10px] break-all">ED_YWt1tpDFlTX-h_4ILS3QfIJbO4g5pSiH9soD1ZMg4</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">OOR Holder: <span className="text-foreground">Tommy_Chief_Procurement_Officer</span></p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 bg-agent-buyer/10 border border-agent-buyer/30">
            <div 
              className="flex items-center justify-between mb-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setExpandedChat('buyer')}
            >
              <h4 className="text-sm font-medium flex items-center gap-2">
                <MessageSquare size={16} className="text-agent-buyer" />
                Buyer Chat
                <span className="ml-auto text-xs text-muted-foreground">{negotiationEntries.length + buyerSystemEntries.length} messages</span>
              </h4>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-900/20"
                  onClick={(e) => { e.stopPropagation(); setLiveServerOpen(true); }}
                >
                  <Circle size={6} className="fill-green-400 text-green-400 animate-pulse" />
                  Live Server
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <span className="text-lg">⤢</span>
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <div 
                ref={buyerChatRef}
                className="bg-agent-buyer/5 rounded-lg p-3 h-[480px] overflow-y-auto hide-scrollbar"
              >
                {(negotiationEntries.length > 0 || buyerSystemEntries.length > 0) ? (
                  <div className="space-y-2">
                    {/* Merge and sort all entries by timestamp */}
                    {[...buyerSystemEntries, ...negotiationEntries]
                      .sort((a, b) => a.seq - b.seq)
                      .map((entry) => (
                        <ChatBubbleEntry key={entry.id} entry={entry} perspective="buyer" />
                      ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-xs">Type commands to interact</p>
                      <p className="text-xs mt-1 text-amber-400/80">1. "fetch seller agent" (A2A :8080) → 2. "verify agent" (vLEI :4000) → 3. "start negotiation"</p>
                    </div>
                  </div>
                )}
                {isBuyerAgentTyping && (
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <TypingIndicator agent="buyer" />
                    <span className="text-xs text-muted-foreground">Agent negotiating...</span>
                  </div>
                )}
              </div>
              <form onSubmit={handleBuyerSubmit} className="flex gap-2">
                <Input 
                  placeholder={buyerVerificationResult?.success ? "start negotiation 300..." : "fetch seller agent → verify agent → start negotiation"}
                  value={buyerChatInput}
                  onChange={(e) => setBuyerChatInput(e.target.value)}
                  className="flex-1 text-xs h-8 bg-background/50"
                />
                <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <Send size={14} />
                </Button>
              </form>
            </div>
          </div>

          {/* GLEIF Verification Pipeline for Buyer */}
          {buyerPipelineVisible && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-medium mb-4 flex items-center gap-2">🔐 GLEIF Verification Pipeline</h4>
              <GleifPipeline verifyingTarget="seller" result={buyerVerificationResult} />
            </div>
          )}

          {/* View Agent Cards for Buyer */}
          {(buyerSectionFetchedAgents.buyer || buyerSectionFetchedAgents.seller) && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-medium mb-3">View Agent Cards</h4>
              <div className="grid grid-cols-2 gap-3">
                {buyerSectionFetchedAgents.buyer && (
                  <div 
                    onClick={() => setSelectedAgentDetails('buyer')}
                    className="border-2 border-agent-buyer/30 bg-agent-buyer/5 rounded-lg p-3 hover:bg-agent-buyer/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-agent-buyer">👤</span>
                      <p className="text-sm font-bold text-agent-buyer">Buyer Agent</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Click to view details</p>
                  </div>
                )}
                {buyerSectionFetchedAgents.seller && (
                  <div 
                    onClick={() => setSelectedAgentDetails('seller')}
                    className="border-2 border-agent-seller/30 bg-agent-seller/5 rounded-lg p-3 hover:bg-agent-seller/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-agent-seller">🏢</span>
                      <p className="text-sm font-bold text-agent-seller">Seller Agent</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Click to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Vertical Separator Line */}
        <div className="hidden lg:block h-full">
          <div className="h-full w-full bg-gradient-to-b from-transparent via-blue-900 to-transparent rounded-full"></div>
        </div>

        {/* Seller Agent */}
        <div className="space-y-4">
          <div className="agent-card-seller rounded-xl p-5 backdrop-blur-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-agent-seller/20 border border-agent-seller/40 flex items-center justify-center flex-shrink-0">
                  <Factory size={18} className="text-agent-seller" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-agent-seller text-sm">Seller Organization</h3>
                  <p className="text-xs text-muted-foreground">Success Rate: {agents.seller.successRate}%</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings size={16} />
              </Button>
            </div>
            
            <div className="bg-background/30 rounded-lg p-3">
              <div className="space-y-2 text-xs">
                <div>
                  <p className="font-semibold text-foreground">JUPITER KNITTING COMPANY</p>
                </div>
                <div>
                  <p className="text-muted-foreground">LEI: <span className="text-foreground font-mono text-[10px]">3358004DXAMRWRUIYJ05</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">Agent AID: <span className="text-foreground font-mono text-[10px] break-all">ENR7Xj2xCtdwMUAbCbBHYSu1Iv029w2qtc_zjLyo740b</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">OOR Holder: <span className="text-foreground">Jupiter_Chief_Sales_Officer</span></p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 bg-agent-seller/10 border border-agent-seller/30">
            <div 
              className="flex items-center justify-between mb-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setExpandedChat('seller')}
            >
              <h4 className="text-sm font-medium flex items-center gap-2">
                <MessageSquare size={16} className="text-agent-seller" />
                Seller Chat
                <span className="ml-auto text-xs text-muted-foreground">{negotiationEntries.length + sellerSystemEntries.length} messages</span>
              </h4>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-900/20"
                  onClick={(e) => { e.stopPropagation(); setLiveServerOpen(true); }}
                >
                  <Circle size={6} className="fill-green-400 text-green-400 animate-pulse" />
                  Live Server
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <span className="text-lg">⤢</span>
                </Button>
              </div>
            </div>
            <div className="space-y-3">
              <div 
                ref={sellerChatRef}
                className="bg-agent-seller/5 rounded-lg p-3 h-[480px] overflow-y-auto hide-scrollbar"
              >
                {(negotiationEntries.length > 0 || sellerSystemEntries.length > 0) ? (
                  <div className="space-y-2">
                    {[...sellerSystemEntries, ...negotiationEntries]
                      .sort((a, b) => a.seq - b.seq)
                      .map((entry) => (
                        <ChatBubbleEntry key={entry.id} entry={entry} perspective="seller" />
                      ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    <div className="text-center">
                      <MessageSquare size={32} className="mx-auto mb-2 opacity-30" />
                      <p className="text-xs">Seller messages appear here</p>
                      <p className="text-xs mt-1">Start a negotiation from Buyer Chat</p>
                    </div>
                  </div>
                )}
              </div>
              <form onSubmit={handleSellerSubmit} className="flex gap-2">
                <Input 
                  placeholder="Type command (e.g., fetch my agent)..."
                  value={sellerChatInput}
                  onChange={(e) => setSellerChatInput(e.target.value)}
                  className="flex-1 text-xs h-8 bg-background/50"
                />
                <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0">
                  <Send size={14} />
                </Button>
              </form>
            </div>
          </div>

          {/* GLEIF Verification Pipeline for Seller */}
          {sellerPipelineVisible && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-medium mb-4 flex items-center gap-2">🔐 GLEIF Verification Pipeline</h4>
              <GleifPipeline verifyingTarget="buyer" result={sellerVerificationResult} />
            </div>
          )}

          {/* View Agent Cards for Seller */}
          {(sellerSectionFetchedAgents.seller || sellerSectionFetchedAgents.buyer) && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-medium mb-3">View Agent Cards</h4>
              <div className="grid grid-cols-2 gap-3">
                {sellerSectionFetchedAgents.seller && (
                  <div 
                    onClick={() => setSelectedAgentDetails('seller')}
                    className="border-2 border-agent-seller/30 bg-agent-seller/5 rounded-lg p-3 hover:bg-agent-seller/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-agent-seller">🏢</span>
                      <p className="text-sm font-bold text-agent-seller">Seller Agent</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Click to view details</p>
                  </div>
                )}
                {sellerSectionFetchedAgents.buyer && (
                  <div 
                    onClick={() => setSelectedAgentDetails('buyer')}
                    className="border-2 border-agent-buyer/30 bg-agent-buyer/5 rounded-lg p-3 hover:bg-agent-buyer/10 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-agent-buyer">👤</span>
                      <p className="text-sm font-bold text-agent-buyer">Buyer Agent</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Click to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Seller's Treasury Agent */}
        <div className="space-y-4">
          <div className="agent-card-treasury rounded-xl p-5 backdrop-blur-xl bg-agent-treasury/10 border border-agent-treasury/30">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <StatusIndicator status={agents.sellerTreasury.status} agent="treasury" size="lg" />
                <div className="flex-1">
                  <h3 className="font-bold text-agent-treasury text-sm">Seller's Treasury Agent</h3>
                  <p className="text-xs text-muted-foreground">Success Rate: {agents.sellerTreasury.successRate}%</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Settings size={16} />
              </Button>
            </div>
          </div>

          {/* Treasury Chat Panel (shared — same treasury agent) */}
          <div className="glass-card p-4 bg-agent-treasury/10 border border-agent-treasury/30">
            <div
              className="flex items-center justify-between mb-3 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setExpandedTreasury(true)}
            >
              <h4 className="text-sm font-medium flex items-center gap-2">
                <span className="text-agent-treasury">🏦</span>
                Treasury Chat
                <span className="ml-2 text-xs text-muted-foreground">{treasuryEntries.length} messages</span>
              </h4>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <span className="text-lg">⤢</span>
              </Button>
            </div>
            <div className="bg-agent-treasury/5 rounded-lg p-3 h-[200px] overflow-y-auto hide-scrollbar space-y-2">
              {treasuryEntries.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-center">
                  <div>
                    <p className="text-xs">Treasury messages appear here</p>
                    <p className="text-xs mt-1">Seller consults treasury during negotiation</p>
                  </div>
                </div>
              ) : (
                treasuryEntries.map(entry => (
                  <TreasuryChatBubble key={entry.id} text={entry.text} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Communication Panel + Transaction Flow */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card p-6 min-h-[400px] flex flex-col">
          <h3 className="font-semibold text-lg mb-4">Agent Communication</h3>
          <div ref={messagesRef} className="flex-1 overflow-y-auto hide-scrollbar space-y-4">
            {negotiationStatus === 'idle' && negotiationRounds.length === 0 && messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No agent communications yet</p>
                <p className="text-xs mt-1">Start the simulation to see agents interact</p>
              </div>
            ) : (
              <>
                {/* Live Negotiation Rounds */}
                {negotiationRounds.length > 0 && (
                  <div className="glass-card p-4 border border-agent-buyer/30">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      📊 Live Negotiation
                      <span className={cn(
                        'ml-auto text-xs px-2 py-0.5 rounded-full',
                        negotiationStatus === 'completed' && 'bg-green-900/40 text-green-400',
                        negotiationStatus === 'in_progress' && 'bg-yellow-900/40 text-yellow-400 animate-pulse',
                        negotiationStatus === 'escalated' && 'bg-orange-900/40 text-orange-400',
                        negotiationStatus === 'failed' && 'bg-red-900/40 text-red-400',
                      )}>
                        {negotiationStatus === 'completed' ? '✅ Deal Closed' :
                         negotiationStatus === 'in_progress' ? '⏳ In Progress' :
                         negotiationStatus === 'escalated' ? '⚠ Escalated' :
                         negotiationStatus === 'failed' ? '✗ Failed' : ''}
                      </span>
                    </h4>
                    <div className="space-y-2">
                      {negotiationRounds.map((r) => (
                        <div key={r.round} className="flex items-center justify-between text-xs bg-background/30 rounded px-3 py-2">
                          <span className="text-muted-foreground">Round {r.round}</span>
                          {r.buyerOffer && <span className="text-agent-buyer">Buyer ₹{r.buyerOffer}</span>}
                          {r.sellerOffer && <span className="text-agent-seller">Seller ₹{r.sellerOffer}</span>}
                          {r.gap !== undefined && <span className="text-muted-foreground">Gap ₹{r.gap}</span>}
                        </div>
                      ))}
                      {negotiationStatus === 'completed' && negotiationFinalPrice && (
                        <div className="mt-2 p-2 bg-green-900/20 border border-green-500/30 rounded text-xs">
                          <div className="flex justify-between">
                            <span>Final Price</span>
                            <span className="font-mono text-green-400">₹{negotiationFinalPrice}/unit</span>
                          </div>
                          {negotiationTotal && (
                            <div className="flex justify-between mt-1">
                              <span>Total Value</span>
                              <span className="font-mono text-green-400">₹{negotiationTotal.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Simulation messages if any */}
                {messages.length > 0 && messages.slice().reverse().map((msg) => (
                  <AgentMessage key={msg.id} message={msg} />
                ))}
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          {/* Live Negotiation Transaction Flow */}
          {(negotiationStatus !== 'idle' || negotiationRounds.length > 0) && (
            <div className="glass-card p-6 mb-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  🤝 Negotiation Flow
                </h4>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  negotiationStatus === 'completed' && 'bg-green-900/40 text-green-400',
                  negotiationStatus === 'in_progress' && 'bg-yellow-900/40 text-yellow-400 animate-pulse',
                  negotiationStatus === 'escalated' && 'bg-orange-900/40 text-orange-400',
                  negotiationStatus === 'failed' && 'bg-red-900/40 text-red-400',
                )}>
                  {negotiationStatus === 'completed' ? '✅ Deal Closed' :
                   negotiationStatus === 'in_progress' ? '⏳ Negotiating...' :
                   negotiationStatus === 'escalated' ? '⚠ Escalated' : '✗ Failed'}
                </span>
              </div>

              {/* Step: Negotiation Started */}
              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/50">
                  <div className="w-8 h-8 rounded-full bg-cyan-600 flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs">🛒</span>
                  </div>
                  <div>
                    <p className="text-xs font-medium">Negotiation Initiated</p>
                    <p className="text-xs text-muted-foreground">Buyer sent initial offer to Seller</p>
                  </div>
                </div>

                {negotiationRounds.map((r, i) => (
                  <React.Fragment key={r.round}>
                    <div className="flex justify-center">
                      <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-card/50">
                      <div className="w-8 h-8 rounded-full bg-amber-600 flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
                        {r.round}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-medium">Round {r.round}</p>
                        <div className="flex gap-4 mt-1">
                          {r.buyerOffer && <span className="text-xs text-agent-buyer">Buyer ₹{r.buyerOffer}</span>}
                          {r.sellerOffer && <span className="text-xs text-agent-seller">Seller ₹{r.sellerOffer}</span>}
                          {r.gap !== undefined && <span className="text-xs text-muted-foreground">Gap ₹{r.gap}</span>}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                ))}

                {negotiationStatus === 'completed' && negotiationFinalPrice && (
                  <>
                    <div className="flex justify-center">
                      <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-green-500/40 bg-green-900/10">
                      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs">✅</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-green-400">Deal Closed</p>
                        <p className="text-xs text-muted-foreground">₹{negotiationFinalPrice}/unit</p>
                        {negotiationTotal && (
                          <p className="text-xs text-muted-foreground">Total ₹{negotiationTotal.toLocaleString()}</p>
                        )}
                      </div>
                    </div>

                    {/* PO Step */}
                    {['po','invoice','dd_offer','dd_accepted','dd_rejected','dd_invoice'].includes(flowStep) && (
                      <>
                        <div className="flex justify-center">
                          <svg className="w-4 h-4 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border border-cyan-500/40 bg-cyan-900/10">
                          <div className="w-8 h-8 rounded-full bg-cyan-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">📋</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-cyan-400">Purchase Order Sent</p>
                            <p className="text-xs text-muted-foreground">Buyer → Seller</p>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Invoice Step */}
                    {['invoice','dd_offer','dd_accepted','dd_rejected','dd_invoice'].includes(flowStep) && (
                      <>
                        <div className="flex justify-center">
                          <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border border-purple-500/40 bg-purple-900/10">
                          <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">📄</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-purple-400">Invoice Generated</p>
                            <p className="text-xs text-muted-foreground">Seller → Buyer (with GST)</p>
                          </div>
                        </div>
                      </>
                    )}

                    {/* DD Offer Step */}
                    {['dd_offer','dd_accepted','dd_rejected','dd_invoice'].includes(flowStep) && (
                      <>
                        <div className="flex justify-center">
                          <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border border-yellow-500/40 bg-yellow-900/10">
                          <div className="w-8 h-8 rounded-full bg-yellow-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">💰</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-yellow-400">Dynamic Discount Offered</p>
                            <p className="text-xs text-muted-foreground">
                              {ddOffer ? `Max ${(ddOffer.maxDiscountRate * 100).toFixed(2)}% · Pay by ${ddOffer.proposedSettlementDate}` : 'Awaiting user decision'}
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {/* DD Accept/Reject Step */}
                    {['dd_accepted','dd_rejected','dd_invoice'].includes(flowStep) && (
                      <>
                        <div className="flex justify-center">
                          <svg className={cn('w-4 h-4', flowStep === 'dd_rejected' ? 'text-red-500' : 'text-green-500')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </div>
                        <div className={cn('flex items-start gap-3 p-3 rounded-lg border', flowStep === 'dd_rejected' ? 'border-red-500/40 bg-red-900/10' : 'border-green-500/40 bg-green-900/10')}>
                          <div className={cn('w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0', flowStep === 'dd_rejected' ? 'bg-red-600' : 'bg-green-600')}>
                            <span className="text-white text-xs">{flowStep === 'dd_rejected' ? '✗' : '✓'}</span>
                          </div>
                          <div>
                            <p className={cn('text-xs font-semibold', flowStep === 'dd_rejected' ? 'text-red-400' : 'text-green-400')}>
                              {flowStep === 'dd_rejected' ? 'DD Rejected' : 'DD Accepted'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {flowStep === 'dd_rejected' ? 'Full payment on due date' : 'Early payment discount applied'}
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {/* DD Invoice Step */}
                    {flowStep === 'dd_invoice' && (
                      <>
                        <div className="flex justify-center">
                          <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                        </div>
                        <div className="flex items-start gap-3 p-3 rounded-lg border border-emerald-500/40 bg-emerald-900/10">
                          <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs">🎉</span>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-emerald-400">Discounted Invoice (ACTUS)</p>
                            <p className="text-xs text-muted-foreground">End-to-end workflow complete</p>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}

                {negotiationStatus === 'escalated' && (
                  <>
                    <div className="flex justify-center">
                      <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg border border-orange-500/40 bg-orange-900/10">
                      <div className="w-8 h-8 rounded-full bg-orange-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs">⚠</span>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-orange-400">Escalated to Human</p>
                        <p className="text-xs text-muted-foreground">Max rounds reached, gap remains</p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
      
      {/* Treasury Expanded Modal */}
      <Dialog open={expandedTreasury} onOpenChange={setExpandedTreasury}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col glass-card">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm text-agent-treasury">
              <span>🏦</span> Treasury Chat
              <span className="ml-auto text-xs text-muted-foreground font-normal">{treasuryEntries.length} messages · :7070</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-1">
            {treasuryEntries.length === 0 ? (
              <p className="text-muted-foreground text-center py-8 text-sm">No treasury messages yet</p>
            ) : (
              treasuryEntries.map(entry => (
                <TreasuryChatBubble key={entry.id} text={entry.text} />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Live Server Modal */}
      <Dialog open={liveServerOpen} onOpenChange={setLiveServerOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col glass-card">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Radio size={14} className="text-green-400" />
              <span>Live Backend Negotiation</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400 font-normal">
                <Circle size={6} className="fill-green-400 animate-pulse" />
                SSE Stream
              </span>
            </DialogTitle>
          </DialogHeader>
          <div
            ref={liveLogRef}
            className="flex-1 overflow-y-auto font-mono text-[11px] bg-black/60 rounded-lg p-3 space-y-1 min-h-0"
          >
            {liveLog.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No messages yet — start a negotiation</p>
            ) : (
              liveLog.map((entry, i) => (
                <div key={i} className="flex gap-2 leading-relaxed border-b border-white/5 pb-1">
                  <span className="text-muted-foreground flex-shrink-0 w-16">{entry.ts}</span>
                  <span className={cn('flex-shrink-0 w-12 font-bold', entry.from === 'BUYER' ? 'text-blue-400' : 'text-green-400')}>
                    {entry.from}
                  </span>
                  <span className="text-foreground/85 whitespace-pre-wrap break-all">{entry.text}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex-shrink-0 flex justify-between items-center pt-2">
            <span className="text-[10px] text-muted-foreground">{liveLog.length} messages · Buyer :9090 · Seller :8080</span>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setLiveLog([])}>Clear</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Agent Details Dialog — real data from live agent card */}
      <Dialog open={selectedAgentDetails !== null} onOpenChange={() => setSelectedAgentDetails(null)}>
        <DialogContent className="sm:max-w-[520px] glass-card max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className={cn(
              'text-lg font-bold',
              selectedAgentDetails === 'buyer' ? 'text-agent-buyer' : 'text-agent-seller'
            )}>
              {selectedAgentDetails === 'buyer' ? 'Buyer Agent Card' : 'Seller Agent Card'}
            </DialogTitle>
          </DialogHeader>

          {(() => {
            const card = selectedAgentDetails ? fetchedCardData[selectedAgentDetails] : null;
            const colorClass = selectedAgentDetails === 'buyer' ? 'bg-agent-buyer/20' : 'bg-agent-seller/20';
            const gleif = card?.extensions?.gleifIdentity;
            const vlei = card?.extensions?.vLEImetadata;
            const keri = card?.extensions?.keriIdentifiers;

            if (!card) {
              return (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  No agent card data available. Try fetching the agent first.
                </div>
              );
            }

            return (
              <div className="space-y-4 py-2">
                <div className="flex items-center gap-3">
                  <div className={cn('w-12 h-12 rounded-lg flex items-center justify-center', colorClass)}>
                    <span className="text-2xl">🏢</span>
                  </div>
                  <div>
                    <p className="font-bold text-base">{gleif?.legalEntityName ?? card.name}</p>
                    <p className="text-xs text-muted-foreground">{card.description}</p>
                  </div>
                </div>

                {gleif && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">GLEIF Identity</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">LEI</span>
                        <span className="font-mono text-xs font-semibold">{gleif.lei}</span>
                      </div>
                      {gleif.officialRole && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Official Role</span>
                          <span className="text-xs">{gleif.officialRole}</span>
                        </div>
                      )}
                      {gleif.engagementRole && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Engagement Role</span>
                          <span className="text-xs">{gleif.engagementRole}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {vlei && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">vLEI Verification</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-muted-foreground">Status</span>
                        <span className={cn('text-xs font-semibold', vlei.status === 'verified' ? 'text-green-400' : 'text-yellow-400')}>
                          {vlei.status === 'verified' ? '✓ Verified' : vlei.status}
                        </span>
                      </div>
                      {vlei.verificationPath && (
                        <div>
                          <span className="text-xs text-muted-foreground">Trust Chain</span>
                          <div className="mt-1 space-y-0.5">
                            {vlei.verificationPath.map((step, i) => (
                              <p key={i} className="text-xs font-mono text-foreground/70">{step}</p>
                            ))}
                          </div>
                        </div>
                      )}
                      {vlei.timestamp && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Verified At</span>
                          <span className="text-xs font-mono">{new Date(vlei.timestamp).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {keri && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">KERI Identifiers</p>
                    <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                      {keri.agentAID && (
                        <div>
                          <span className="text-xs text-muted-foreground">Agent AID</span>
                          <p className="font-mono text-[10px] break-all text-foreground/80 mt-0.5">{keri.agentAID}</p>
                        </div>
                      )}
                      {keri.legalEntityAID && (
                        <div>
                          <span className="text-xs text-muted-foreground">Legal Entity AID</span>
                          <p className="font-mono text-[10px] break-all text-foreground/80 mt-0.5">{keri.legalEntityAID}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {card.skills && card.skills.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Skills</p>
                    <div className="space-y-2">
                      {card.skills.map(skill => (
                        <div key={skill.id} className="bg-muted/30 rounded-lg p-3">
                          <p className="text-xs font-semibold">{skill.name}</p>
                          {skill.description && <p className="text-xs text-muted-foreground mt-0.5">{skill.description}</p>}
                          {skill.tags && skill.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {skill.tags.map(tag => (
                                <span key={tag} className="text-[10px] bg-muted/50 rounded px-1.5 py-0.5 text-muted-foreground">{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {card.provider && (
                  <div className="bg-muted/20 rounded-lg p-3 flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Provider</span>
                    <span className="text-xs font-semibold">{card.provider.organization}</span>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex justify-end pt-2">
            <Button onClick={() => setSelectedAgentDetails(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}








