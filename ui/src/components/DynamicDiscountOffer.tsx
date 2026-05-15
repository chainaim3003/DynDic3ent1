import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CheckCircle, XCircle, Zap, Loader2 } from 'lucide-react';
import { sendToBuyerAgent } from '@/lib/a2aService';

export interface DDOfferData {
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

interface DynamicDiscountOfferProps {
  finalPrice: number;
  totalValue: number;
  ddOffer?: DDOfferData | null;
  flowStep?: string;
  className?: string;
}

type DDStatus = 'pending' | 'sending' | 'accepted' | 'rejected';

export function DynamicDiscountOffer({ finalPrice, totalValue, ddOffer, flowStep, className }: DynamicDiscountOfferProps) {
  const [status, setStatus] = useState<DDStatus>('pending');
  const [customDate, setCustomDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (ddOffer) { setStatus('pending'); setCustomDate(''); }
  }, [ddOffer?.invoiceId]);

  const send = (cmd: string) => {
    setStatus('sending');
    setError('');
    sendToBuyerAgent(cmd, (err) => { setError(err); setStatus('pending'); }, () => {
      setStatus(cmd.startsWith('dd accept') ? 'accepted' : 'rejected');
    });
  };

  if (!ddOffer) return (
    <div className={cn('glass-card p-3 border border-yellow-500/20 bg-yellow-900/5 rounded-xl', className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Zap size={12} className="text-yellow-400 animate-pulse" />
        <span>Waiting for Dynamic Discount Offer...</span>
      </div>
    </div>
  );

  const propPct = (ddOffer.discountAtProposedDate.appliedRate * 100).toFixed(2);
  const { discountedAmount, savingAmount, daysEarly } = ddOffer.discountAtProposedDate;

  if (status === 'accepted') return (
    <div className={cn('glass-card p-3 border-2 border-green-500/40 bg-green-900/10 rounded-xl space-y-1', className)}>
      <div className="flex items-center gap-2 text-xs">
        <CheckCircle size={14} className="text-green-400" />
        <span className="text-green-400 font-medium">DD Accepted</span>
        <span className="ml-auto font-mono text-green-400">Save ₹{savingAmount.toLocaleString()} ({propPct}%)</span>
      </div>
      {flowStep !== 'dd_invoice' ? (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Loader2 size={10} className="animate-spin" />
          <span>Awaiting discounted invoice from seller...</span>
        </div>
      ) : (
        <div className="text-[10px] text-emerald-400">✅ Discounted invoice received — see chat above</div>
      )}
    </div>
  );

  if (status === 'rejected') return (
    <div className={cn('glass-card p-3 border border-muted/40 rounded-xl', className)}>
      <div className="flex items-center gap-2 text-xs">
        <XCircle size={14} className="text-muted-foreground" />
        <span className="text-muted-foreground">DD declined — full ₹{ddOffer.originalTotal.toLocaleString()} on {ddOffer.dueDate}</span>
      </div>
    </div>
  );

  return (
    <div className={cn('glass-card p-3 border border-yellow-500/40 bg-yellow-900/10 rounded-xl space-y-3', className)}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Zap size={13} className="text-yellow-400" />
        <span className="text-xs font-semibold text-yellow-400">Dynamic Discount Offer</span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{ddOffer.invoiceId}</span>
      </div>

      {/* Key numbers in one row */}
      <div className="grid grid-cols-3 gap-2 text-[10px] font-mono bg-background/30 rounded p-2">
        <div><p className="text-muted-foreground">Full amount</p><p>₹{ddOffer.originalTotal.toLocaleString()}</p></div>
        <div><p className="text-muted-foreground">Pay by</p><p>{ddOffer.proposedSettlementDate} ({daysEarly}d early)</p></div>
        <div><p className="text-muted-foreground">You save</p><p className="text-green-400">₹{savingAmount.toLocaleString()} ({propPct}%)</p></div>
      </div>

      {/* Discounted amount highlight */}
      <div className="flex items-center justify-between text-xs bg-green-900/20 border border-green-500/30 rounded px-2 py-1.5 font-mono">
        <span className="text-muted-foreground">You pay</span>
        <span className="text-green-400 font-bold text-sm">₹{discountedAmount.toLocaleString()}</span>
      </div>

      {/* Custom date input */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder={`Custom date (${ddOffer.invoiceDate} – ${ddOffer.dueDate})`}
          value={customDate}
          onChange={e => setCustomDate(e.target.value)}
          className="h-7 text-xs font-mono bg-background/50 flex-1"
        />
      </div>

      {error && <p className="text-[10px] text-destructive">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 h-7 text-xs bg-green-700 hover:bg-green-600 text-white"
          disabled={status === 'sending'}
          onClick={() => send(customDate ? `dd accept ${customDate}` : `dd accept ${ddOffer.proposedSettlementDate}`)}>
          {status === 'sending' ? <Loader2 size={12} className="mr-1 animate-spin" /> : <CheckCircle size={12} className="mr-1" />}
          {customDate ? `Accept ${customDate}` : 'DD Accept'}
        </Button>
        <Button size="sm" variant="outline" className="flex-1 h-7 text-xs"
          disabled={status === 'sending'}
          onClick={() => send('dd reject')}>
          <XCircle size={12} className="mr-1" />
          DD Reject
        </Button>
      </div>
    </div>
  );
}
