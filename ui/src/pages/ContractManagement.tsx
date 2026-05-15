import { useState, useEffect } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { Contract, PAMContract, ANNContract, getContractValue, calculatePAMSchedule, calculateANNSchedule } from '@/lib/calculations';
import { ContractTable } from '@/components/ContractTable';
import { ScheduleCalculator } from '@/components/ScheduleCalculator';
import { DiscountCalculator } from '@/components/DiscountCalculator';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Plus, FileText, Download, X, RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ActusContractRecord {
  invoiceId: string;
  negotiationId: string;
  invoiceDate: string;
  dueDate: string;
  settlementDate: string;
  notionalAmount: number;
  maxDiscountRate: number;
  appliedRate: number;
  discountedAmount: number;
  savingAmount: number;
  sofrRate: number;
  hurdleRate: number;
  actusSuccess: boolean;
  events: { type: string; time: string; payoff: number; nominalValue: number }[];
  createdAt: string;
}

interface ContractManagementProps {
  simulation: ReturnType<typeof useSimulation>;
}

export function ContractManagement({ simulation }: ContractManagementProps) {
  const { contracts } = simulation.state;
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // ACTUS DD contracts from treasury agent — persisted in localStorage as history
  const STORAGE_KEY = 'actus_dd_contracts_history';

  const loadHistory = (): ActusContractRecord[] => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
  };

  const [actusContracts, setActusContracts] = useState<ActusContractRecord[]>(loadHistory);
  const [selectedActus, setSelectedActus] = useState<ActusContractRecord | null>(null);
  const [actusFetching, setActusFetching] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);

  const fetchActusContracts = async () => {
    setActusFetching(true);
    try {
      const res = await fetch('http://localhost:7070/actus-contracts');
      if (res.ok) {
        const fresh: ActusContractRecord[] = await res.json();
        setActusContracts(prev => {
          const existingIds = new Set(prev.map(c => c.invoiceId));
          const merged = [...prev, ...fresh.filter(c => !existingIds.has(c.invoiceId))];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      }
    } catch { /* treasury not running — show stored history */ }
    finally { setActusFetching(false); }
  };

  useEffect(() => { fetchActusContracts(); }, []);
  
  // New contract form state
  const [newContract, setNewContract] = useState({
    type: 'PAM' as 'PAM' | 'ANN',
    counterparty: '',
    amount: 50000,
    rate: 6,
    maturity: '2026-01-01',
    periods: 12,
    frequency: 'monthly' as 'monthly' | 'quarterly',
    direction: 'receivable' as 'receivable' | 'payable',
  });

  const handleDownloadAllContracts = () => {
    if (actusContracts.length === 0) return;
    const jsonString = JSON.stringify(actusContracts, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `actus_dd_contracts_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportScheduleCSV = () => {
    if (!selectedContract) return;
    
    let schedule: any[] = [];
    if (selectedContract.type === 'PAM') {
      schedule = calculatePAMSchedule(selectedContract as PAMContract);
    } else {
      schedule = calculateANNSchedule(selectedContract as ANNContract);
    }
    
    // Create CSV content
    const headers = ['Period', 'Date', 'Principal', 'Interest', 'Payment', 'Balance'];
    const csvRows = [headers.join(',')];
    
    schedule.forEach((row, index) => {
      const csvRow = [
        index + 1,
        row.date,
        row.principal.toFixed(2),
        row.interest.toFixed(2),
        row.payment.toFixed(2),
        row.balance.toFixed(2)
      ];
      csvRows.push(csvRow.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedContract.id}_schedule_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportContractJSON = () => {
    if (!selectedContract) return;
    
    // Prepare contract data in JSON format with invoice-compatible fields
    const contractValue = getContractValue(selectedContract);
    
    // Adjust cost of capital based on risk score
    // Higher risk = higher cost of capital
    const baseRate = selectedContract.rate;
    const riskAdjustedRate = baseRate + (selectedContract.riskScore / 10); // Add risk premium
    
    const contractData = {
      // Contract details
      contract: {
        id: selectedContract.id,
        type: selectedContract.type,
        counterparty: selectedContract.counterparty,
        direction: selectedContract.direction,
        riskScore: selectedContract.riskScore,
        startDate: selectedContract.startDate,
        rate: selectedContract.rate,
        ...(selectedContract.type === 'PAM' ? {
          principal: (selectedContract as PAMContract).principal,
          maturity: (selectedContract as PAMContract).maturity,
        } : {
          loanAmount: (selectedContract as ANNContract).loanAmount,
          periods: (selectedContract as ANNContract).periods,
          frequency: (selectedContract as ANNContract).frequency,
        })
      },
      // Invoice-compatible fields for Discount Optimizer
      invoice: {
        invoiceAmount: contractValue,
        discountPercent: 2,
        daysEarly: 20,
        costOfCapital: Math.round(riskAdjustedRate * 10) / 10 // Round to 1 decimal
      }
    };

    // Create JSON file
    const jsonString = JSON.stringify(contractData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedContract.id}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCreateContract = () => {
    const id = `C${String(contracts.length + 1).padStart(3, '0')}`;
    const startDate = new Date().toISOString().split('T')[0];
    const riskScore = 0; // Real risk score comes from ACTUS simulation via treasury agent

    let contract: Contract;
    if (newContract.type === 'PAM') {
      contract = {
        id,
        type: 'PAM',
        counterparty: newContract.counterparty,
        principal: newContract.amount,
        rate: newContract.rate,
        maturity: newContract.maturity,
        startDate,
        direction: newContract.direction,
        riskScore,
      } as PAMContract;
    } else {
      contract = {
        id,
        type: 'ANN',
        counterparty: newContract.counterparty,
        loanAmount: newContract.amount,
        rate: newContract.rate,
        periods: newContract.periods,
        frequency: newContract.frequency,
        startDate,
        direction: newContract.direction,
        riskScore,
      } as ANNContract;
    }

    simulation.addContract(contract);
    setDialogOpen(false);
    setSelectedContract(contract);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Treasury Management</h1>
          <p className="text-muted-foreground">ACTUS contract modeling with real-time calculations</p>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleDownloadAllContracts} disabled={actusContracts.length === 0}>
            <Download size={16} />
            Download All Contracts
          </Button>
        </div>
      </div>

      {/* ACTUS DD Cashflow Contracts — from live treasury agent */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              setActusContracts([]);
              setSelectedActus(null);
            }}>
              <X size={14} />
              Clear History
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={fetchActusContracts} disabled={actusFetching}>
              <RefreshCw size={14} className={actusFetching ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {actusContracts.length === 0 ? (
          <div className="glass-card p-8 text-center text-muted-foreground">
            <p className="text-sm">No ACTUS contracts yet — complete a negotiation with DD to generate one</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contract list */}
            <div className="glass-card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">All Contracts</h3>
                <span className="text-xs text-muted-foreground">{actusContracts.length} total</span>
              </div>
              <div className="space-y-2">
                {actusContracts.slice(0, visibleCount).map((c) => (
                  <div
                    key={c.invoiceId}
                    onClick={() => setSelectedActus(c)}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg cursor-pointer border transition-colors',
                      selectedActus?.invoiceId === c.invoiceId
                        ? 'border-agent-treasury/60 bg-agent-treasury/10'
                        : 'border-border/50 hover:border-agent-treasury/30 hover:bg-agent-treasury/5'
                    )}
                  >
                    <div className="w-8 h-8 rounded bg-agent-treasury/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-agent-treasury text-xs font-bold">PAM</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-agent-treasury truncate">{c.invoiceId}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full', c.actusSuccess ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400')}>
                          {c.actusSuccess ? '✓ SUCCESS' : '✗ FAILED'}
                        </span>
                      </div>
                      <div className="flex gap-3 mt-0.5 text-[10px] text-muted-foreground font-mono">
                        <span>₹{c.notionalAmount.toLocaleString()}</span>
                        <span>{c.settlementDate}</span>
                        <span className="text-emerald-400">save ₹{c.savingAmount.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {actusContracts.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(v => v + 5)}
                  className="mt-3 w-full text-xs text-agent-treasury hover:text-agent-treasury/80 py-2 border border-agent-treasury/20 rounded-lg hover:bg-agent-treasury/5 transition-colors"
                >
                  View More ({actusContracts.length - visibleCount} remaining)
                </button>
              )}
              {visibleCount > 5 && (
                <button
                  onClick={() => setVisibleCount(5)}
                  className="mt-1 w-full text-xs text-muted-foreground hover:text-foreground py-1 transition-colors"
                >
                  Show Less
                </button>
              )}
            </div>

            {/* Contract detail */}
            <div className="space-y-4">
              {selectedActus ? (
                <>
                  <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-agent-treasury/20 flex items-center justify-center">
                          <FileText size={18} className="text-agent-treasury" />
                        </div>
                        <div>
                          <h3 className="font-bold text-sm font-mono">{selectedActus.invoiceId}</h3>
                          <p className="text-xs text-muted-foreground">{selectedActus.negotiationId}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => setSelectedActus(null)}><X size={14} /></Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div><p className="text-muted-foreground">Type</p><p className="font-medium">PAM</p></div>
                      <div><p className="text-muted-foreground">Direction</p><p className="font-medium">Receivable (RPA)</p></div>
                      <div><p className="text-muted-foreground">Principal</p><p className="font-mono font-bold text-base">₹{selectedActus.notionalAmount.toLocaleString()}</p></div>
                      <div><p className="text-muted-foreground">Max Discount Rate</p><p className="font-mono font-bold text-base">{(selectedActus.maxDiscountRate * 100).toFixed(3)}%</p></div>
                      <div><p className="text-muted-foreground">Invoice Date</p><p className="font-mono">{selectedActus.invoiceDate}</p></div>
                      <div><p className="text-muted-foreground">Maturity</p><p className="font-mono">{selectedActus.dueDate}</p></div>
                      <div><p className="text-muted-foreground">Settlement</p><p className="font-mono text-amber-400">{selectedActus.settlementDate}</p></div>
                      <div><p className="text-muted-foreground">SOFR</p><p className="font-mono">{(selectedActus.sofrRate * 100).toFixed(2)}%</p></div>
                      <div><p className="text-muted-foreground">Hurdle Rate</p><p className="font-mono">{(selectedActus.hurdleRate * 100).toFixed(2)}%</p></div>
                      <div><p className="text-muted-foreground">Applied Rate</p><p className="font-mono text-emerald-400">{(selectedActus.appliedRate * 100).toFixed(3)}%</p></div>
                    </div>
                    <div className="mt-3 p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg grid grid-cols-2 gap-2 text-xs font-mono">
                      <div><span className="text-muted-foreground">Discounted </span><span className="text-green-400 font-bold">₹{selectedActus.discountedAmount.toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground">Saving </span><span className="text-emerald-400 font-bold">₹{selectedActus.savingAmount.toLocaleString()}</span></div>
                    </div>
                  </div>

                  {/* Cashflow Schedule */}
                  <div className="glass-card p-4">
                    <h4 className="font-semibold text-sm mb-1">Amortization Schedule</h4>
                    <p className="text-xs text-muted-foreground mb-3">ACTUS PAM cashflow events — Seller = RPA (Receivable)</p>
                    {selectedActus.events.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No cashflow events available</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="border-b border-border/50 text-muted-foreground">
                              <th className="text-left py-2 pr-3">#</th>
                              <th className="text-left py-2 pr-3">Date</th>
                              <th className="text-left py-2 pr-3">Type</th>
                              <th className="text-right py-2 pr-3">Payoff</th>
                              <th className="text-right py-2">Nominal Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedActus.events.map((e, i) => (
                              <tr key={i} className="border-b border-border/20">
                                <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                                <td className="py-2 pr-3">{e.time?.split('T')[0]}</td>
                                <td className="py-2 pr-3">
                                  <span className={cn('px-1.5 py-0.5 rounded text-[10px]',
                                    e.type === 'IED' ? 'bg-red-900/30 text-red-400' :
                                    e.type === 'MD'  ? 'bg-green-900/30 text-green-400' :
                                    'bg-blue-900/30 text-blue-400'
                                  )}>{e.type}</span>
                                </td>
                                <td className={cn('py-2 pr-3 text-right font-bold', e.payoff >= 0 ? 'text-green-400' : 'text-red-400')}>
                                  {e.type === 'MD'
                                    ? `+₹${selectedActus.discountedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                    : `${e.payoff >= 0 ? '+' : ''}₹${Math.abs(e.payoff).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                  }
                                </td>
                                <td className="py-2 text-right text-muted-foreground">
                                  ₹{e.nominalValue?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="glass-card p-8 text-center">
                  <FileText size={40} className="text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Select a contract</p>
                  <p className="text-xs text-muted-foreground mt-1">Click a contract to view its ACTUS cashflow schedule</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
