import React from 'react';
import { CheckCircle, Clock, Activity, ShoppingCart, FileText, Percent, DollarSign, Truck, BadgeCheck } from 'lucide-react';
import { AgentAction, AgentMessage, Transaction } from '@/lib/agents';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TransactionFlowProps {
  actions: AgentAction[];
  messages: AgentMessage[];
  transaction?: Transaction;
  onPlay?: () => void;
  onNext?: () => void;
  onReset?: () => void;
}

const StepIcon = ({ id, status }: { id: string; status: 'completed' | 'active' | 'pending' }) => {
  const size = 18;
  const base = 'w-9 h-9 flex items-center justify-center rounded-full shadow-md';

  const variants: Record<string, { cls: string; icon: React.ReactNode }> = {
    verified: { cls: 'bg-emerald-600 text-white', icon: <CheckCircle size={size} /> },
    po_initiated: { cls: 'bg-cyan-600 text-white', icon: <ShoppingCart size={size} /> },
    po_accepted: { cls: 'bg-teal-600 text-white', icon: <Activity size={size} /> },
    discount: { cls: 'bg-amber-600 text-white', icon: <Percent size={size} /> },
    invoice_received: { cls: 'bg-purple-600 text-white', icon: <FileText size={size} /> },
    invoice_paid: { cls: 'bg-orange-600 text-white', icon: <DollarSign size={size} /> },
    receipt: { cls: 'bg-indigo-600 text-white', icon: <Truck size={size} /> },
    complete: { cls: 'bg-green-600 text-white', icon: <BadgeCheck size={size} /> },
  };

  const v = variants[id] || { cls: 'bg-border/30 text-muted-foreground', icon: <Activity size={size} /> };

  const statusGlow = status === 'active' ? 'ring-2 ring-yellow-500 animate-pulse shadow-lg' : status === 'completed' ? 'ring-2 ring-green-500/50' : 'opacity-40';

  return <div className={cn(base, v.cls, statusGlow)}>{v.icon}</div>;
};

const Step = ({ id, title, subtitle, status, showArrow = true }: { id: string; title: string; subtitle?: string; status: 'completed' | 'active' | 'pending'; showArrow?: boolean }) => {
  // Arrow colors matching each step
  const arrowColors: Record<string, string> = {
    verified: 'text-emerald-500',
    po_initiated: 'text-cyan-500',
    po_accepted: 'text-teal-500',
    discount: 'text-amber-500',
    invoice_received: 'text-purple-500',
    invoice_paid: 'text-orange-500',
    receipt: 'text-indigo-500',
    complete: 'text-green-500',
  };

  const arrowColor = arrowColors[id] || 'text-muted-foreground';

  return (
    <div className="relative">
      <div className="flex items-start gap-4 p-4 rounded-lg border border-border/50 bg-card/50">
        <div className="flex flex-col items-center">
          <StepIcon id={id} status={status} />
        </div>

        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <p className={cn('text-sm font-medium', status === 'completed' ? 'text-foreground' : status === 'active' ? 'text-foreground font-semibold' : 'text-muted-foreground')}>{title}</p>
              {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            </div>
          </div>
        </div>
      </div>
      
      {showArrow && (
        <div className="flex justify-center my-3">
          <svg className={cn('w-6 h-6', arrowColor)} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      )}
    </div>
  );
};

export function TransactionFlow({ actions, messages, transaction, onPlay, onNext, onReset }: TransactionFlowProps) {
  const events = transaction?.events ?? [];
  const latestMsg = messages[0];

  const stepMeta: { id: string; title: string; subtitle?: string; eventIndexes: number[] }[] = [
    { id: 'verified', title: 'Agents Verified', subtitle: 'All participating agents authenticated and authorized', eventIndexes: [0] },
    { id: 'po_initiated', title: 'PO Initiated', subtitle: 'Purchase Order created for transaction', eventIndexes: [1] },
    { id: 'po_accepted', title: 'PO Accepted', subtitle: 'Seller confirmed order and offered terms', eventIndexes: [2] },
    { id: 'discount', title: 'Discount Evaluation', subtitle: 'Treasury to evaluate discount (APR vs Cost of Capital)', eventIndexes: [3,4,5] },
    { id: 'invoice_received', title: 'Invoice Received', subtitle: 'Invoice received by Buyer and recorded', eventIndexes: [6] },
    { id: 'invoice_paid', title: 'Invoice Paid', subtitle: 'Treasury authorized and executed payment', eventIndexes: [7] },
    { id: 'receipt', title: 'Receipt / POD', subtitle: 'Proof of delivery confirmed and recorded', eventIndexes: [8] },
    { id: 'complete', title: 'Complete', subtitle: 'Transaction finalized with full audit trail', eventIndexes: [9] },
  ];

  const visibleSteps = stepMeta.map(s => {
    const eventIds = s.eventIndexes.map(i => events[i]?.id).filter(Boolean) as string[];
    const visible = eventIds.length > 0 && eventIds.some(eid => messages.some(m => m.eventId === eid));
    const active = visible && eventIds.some(eid => latestMsg?.eventId === eid);
    const status = active ? 'active' : visible ? 'completed' : 'pending';
    return { ...s, status, visible };
  }).filter(s => s.visible);


  const poId = transaction?.poId;
  const original = transaction?.originalAmount;
  const discountPercent = transaction?.discountPercent;
  const final = transaction?.finalAmount;

  // Show amounts only after a success/authorized message appears or when transaction is complete
  const hasSuccessMessage = messages.some(m => (
    m.badge === 'Treasury Authorized' ||
    m.highlight === true ||
    /approved|authorized|payment|approve|\u2713/i.test(m.message || '')
  )) || transaction?.status === 'complete';

  // Small delayed reveal so the amounts panel appears after the success message is visible
  const [showAmounts, setShowAmounts] = React.useState(false);
  React.useEffect(() => {
    if (hasSuccessMessage) {
      const t = setTimeout(() => setShowAmounts(true), 300);
      return () => clearTimeout(t);
    } else {
      setShowAmounts(false);
    }
  }, [hasSuccessMessage]);

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-medium flex items-center gap-3"> <Activity size={16} /> Transaction Flow</h4>
          {poId && <p className="text-xs text-muted-foreground mt-1">{poId} · Event-driven · Sequential</p>}
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onPlay}>Play</Button>
          <Button variant="ghost" size="sm" onClick={onNext}>Next</Button>
          <Button variant="ghost" size="sm" onClick={onReset}>Reset</Button>
        </div>
      </div>

      <div className="relative">
        <div className="space-y-2">
          {visibleSteps.map((s, index) => (
            <div key={s.id} className="animate-slide-up">
              <Step id={s.id} title={s.title} subtitle={s.subtitle} status={s.status as any} showArrow={index < visibleSteps.length - 1} />

              {s.id === 'discount' && discountPercent && (
                <div className="mt-3 ml-16">
                  <span className="inline-flex items-center text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded"> <BadgeCheck size={12} className="mr-2" /> Treasury Authorized</span>
                </div>
              )}

              {s.id === 'invoice_paid' && transaction?.status === 'complete' && (
                <div className="mt-3 ml-16">
                  <span className="inline-flex items-center text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded"> <BadgeCheck size={12} className="mr-2" /> Treasury Authorized</span>
                </div>
              )}
            </div>
          ))}

      </div>
      </div>

      {poId && hasSuccessMessage && showAmounts && (
        <div className="mt-6 p-3 border border-border/50 rounded bg-background/40 animate-slide-up">
          <div className="flex items-center justify-between text-xs">
            <div>Original Amount</div>
            <div className="font-mono">${original?.toLocaleString()}</div>
          </div>
          {transaction?.status === 'complete' && (
            <div className="flex items-center justify-between text-xs mt-2">
              <div>Discount Applied</div>
              <div className="font-mono text-emerald-400">-${((original || 0) - (final || 0)).toLocaleString()}</div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs mt-2">
            <div>Final Amount</div>
            <div className="font-mono">${final?.toLocaleString()}</div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <CheckCircle className="text-success" size={14} /> <span>Verified & Auditable</span>
        </div>
      </div>
    </div>
  );
}
