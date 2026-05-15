import { useEffect, useState } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { AgentCard } from '@/components/AgentCard';
import { cn } from '@/lib/utils';
import { AlertTriangle, TrendingUp, FileText, DollarSign, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface ActusContract {
  invoiceId: string; negotiationId: string;
  invoiceDate: string; dueDate: string; settlementDate: string;
  notionalAmount: number; discountedAmount: number; savingAmount: number;
  appliedRate: number; maxDiscountRate: number;
  sofrRate: number; hurdleRate: number; actusSuccess: boolean;
  events: { type: string; time: string; payoff: number; nominalValue: number }[];
  createdAt: string;
}

interface TreasuryHealth {
  status: string; company: string;
  currentBalance: number; availableLiquidity: number; safetyThreshold: number;
}

const STORAGE_KEY = 'actus_dd_contracts_history';

interface DashboardProps {
  simulation: ReturnType<typeof useSimulation>;
}

export function Dashboard({ simulation }: DashboardProps) {
  const navigate = useNavigate();
  const { agents } = simulation.state;

  const [contracts, setContracts] = useState<ActusContract[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
  });
  const [health, setHealth] = useState<TreasuryHealth | null>(null);
  const [fetching, setFetching] = useState(false);

  const fetchData = async () => {
    setFetching(true);
    try {
      const [hRes, cRes] = await Promise.all([
        fetch('http://localhost:7070/health'),
        fetch('http://localhost:7070/actus-contracts'),
      ]);
      if (hRes.ok) setHealth(await hRes.json());
      if (cRes.ok) {
        const fresh: ActusContract[] = await cRes.json();
        setContracts(prev => {
          const ids = new Set(prev.map(c => c.invoiceId));
          const merged = [...prev, ...fresh.filter(c => !ids.has(c.invoiceId))];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      }
    } catch { /* treasury offline */ }
    finally { setFetching(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const totalNotional = contracts.reduce((s, c) => s + c.notionalAmount, 0);
  const totalSaving   = contracts.reduce((s, c) => s + c.savingAmount, 0);
  const pamCount      = contracts.length;
  const approved      = contracts.filter(c => c.actusSuccess).length;
  const failed        = contracts.filter(c => !c.actusSuccess).length;

  // Real agent objects with live metrics
  const buyerAgent = {
    ...agents.buyer,
    objective: contracts.length > 0 ? `${contracts.length} negotiation(s) completed` : agents.buyer.objective,
    metrics: {
      poCreated:       contracts.length,
      discountsTaken:  contracts.filter(c => c.actusSuccess).length,
      savingsRealized: Math.round(totalSaving),
    },
  };

  const sellerAgent = {
    ...agents.seller,
    objective: contracts.length > 0 ? `${contracts.length} invoice(s) generated` : agents.seller.objective,
    metrics: {
      invoicesGenerated: contracts.length,
      discountsOffered:  contracts.length,
      collectionRate:    contracts.length > 0 ? Math.round((approved / contracts.length) * 100) : 0,
    },
  };

  const treasuryAgent = {
    ...agents.sellerTreasury,
    objective: health ? `Liquidity ₹${health.availableLiquidity.toLocaleString()} · Hurdle 12%` : agents.sellerTreasury.objective,
    metrics: {
      cashPosition:    health?.currentBalance ?? 0,
      liquidityAlerts: failed,
      optimizations:   approved,
    },
  };

  // Cashflow: build a proper step timeline showing balance dip and recovery
  // Start from treasury current balance, apply each event in date order
  const startBalance = health?.currentBalance ?? 0;
  const dateMap = new Map<string, { inflow: number; outflow: number }>();
  for (const c of contracts) {
    for (const e of c.events) {
      const date = e.time?.split('T')[0] ?? '';
      if (!date) continue;
      const entry = dateMap.get(date) ?? { inflow: 0, outflow: 0 };
      if (e.payoff >= 0) entry.inflow += e.payoff;
      else entry.outflow += Math.abs(e.payoff);
      dateMap.set(date, entry);
    }
  }
  let running = startBalance;
  const rawPoints = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, { inflow, outflow }]) => {
      const points = [];
      if (outflow > 0) {
        running -= outflow;
        points.push({ date, inflow: 0, outflow, balance: running });
      }
      if (inflow > 0) {
        running += inflow;
        points.push({ date: date + ' ', inflow, outflow: 0, balance: running });
      }
      return points;
    });
  // Prepend starting balance point
  const firstDate = rawPoints[0]?.date ?? '';
  const cashflowData = startBalance > 0 && firstDate
    ? [{ date: firstDate.replace(' ', '') + ' (start)', inflow: 0, outflow: 0, balance: startBalance }, ...rawPoints]
    : rawPoints;

  const alerts: { type: string; message: string }[] = [];
  if (failed > 0) alerts.push({ type: 'risk', message: `${failed} ACTUS simulation${failed > 1 ? 's' : ''} failed` });
  if (health && health.availableLiquidity < health.safetyThreshold)
    alerts.push({ type: 'cash', message: `Liquidity ₹${health.availableLiquidity.toLocaleString()} below safety threshold` });

  const recentActivity = [...contracts]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <AgentCard agent={buyerAgent}    onClick={() => navigate('/agents')} />
        <AgentCard agent={sellerAgent}   onClick={() => navigate('/agents')} />
        <AgentCard agent={treasuryAgent} onClick={() => navigate('/agents')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">Net Cash Flow</h3>
              <p className="text-sm text-muted-foreground">
                {cashflowData.length > 1 ? 'Real ACTUS PAM cashflow events' : 'No data yet — run a negotiation with DD'}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><ArrowUpRight size={14} style={{ color: '#34d399' }} />Inflows (AR)</div>
              <div className="flex items-center gap-1.5"><ArrowDownRight size={14} style={{ color: '#f87171' }} />Outflows (AP)</div>
              <button onClick={fetchData} disabled={fetching} className="ml-2 hover:text-foreground">
                <RefreshCw size={13} className={fetching ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          {cashflowData.length > 1 ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={cashflowData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <defs>
                  <linearGradient id="dIn"  x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6ee7b7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="dBal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#93c5fd" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#93c5fd" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
                <Area type="stepAfter" dataKey="inflow"  stroke="#6ee7b7" fill="url(#dIn)"  name="Inflows (AR)" />
                <Area type="stepAfter" dataKey="outflow" stroke="#fca5a5" fill="none" strokeDasharray="4 2" name="Outflows (AP)" />
                <Area type="stepAfter" dataKey="balance" stroke="#93c5fd" fill="url(#dBal)" name="Cumulative Balance" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
              Complete a negotiation with DD to see real cashflow data
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText size={18} className="text-primary" />
              <h3 className="font-semibold">Contract Summary</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">PAM Contracts</span>
                <span className="font-mono font-semibold text-blue-400">{pamCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">ANN Contracts</span>
                <span className="font-mono font-semibold text-indigo-400">0</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">ACTUS Success</span>
                <span className="font-mono font-semibold text-emerald-400">{approved} / {contracts.length}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-border">
                <span className="text-muted-foreground text-sm">Total Notional</span>
                <span className="font-mono font-bold text-sm">₹{totalNotional.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Total Savings</span>
                <span className="font-mono font-semibold text-emerald-400 text-sm">₹{totalSaving.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-amber-400" />
              <h3 className="font-semibold">Risk Alerts</h3>
            </div>
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className={cn('flex items-center gap-2 p-3 rounded-lg text-sm font-medium',
                    a.type === 'risk' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                  )}>
                    <AlertTriangle size={14} />{a.message}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-3">
                <TrendingUp size={22} className="text-emerald-400 mx-auto mb-1" />
                <p className="text-sm text-muted-foreground">All systems nominal</p>
              </div>
            )}
          </div>

          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <DollarSign size={18} className="text-emerald-400" />
                <h3 className="font-semibold">Cash Position</h3>
              </div>
              {health && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{health.company}</span>}
            </div>
            <div className="text-center py-2">
              <p className="font-mono font-bold text-3xl text-emerald-400">
                {health ? `₹${health.currentBalance.toLocaleString()}` : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Current Balance</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-border">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Available Liquidity</p>
                <p className="font-mono font-semibold text-sm">{health ? `₹${health.availableLiquidity.toLocaleString()}` : '—'}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Safety Threshold</p>
                <p className={cn('font-mono font-semibold text-sm',
                  health && health.availableLiquidity < health.safetyThreshold ? 'text-rose-400' : ''
                )}>{health ? `₹${health.safetyThreshold.toLocaleString()}` : '—'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg">Recent Activity</h3>
          <button onClick={() => navigate('/contracts')} className="text-sm text-primary hover:underline">View All →</button>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No transactions yet — start a negotiation to see activity</p>
        ) : (
          <div className="space-y-2">
            {recentActivity.map(c => (
              <div key={c.invoiceId} className="flex items-center gap-4 p-3 rounded-lg bg-muted/20 text-sm">
                <div className={cn('w-2 h-2 rounded-full flex-shrink-0', c.actusSuccess ? 'bg-emerald-400' : 'bg-rose-400')} />
                <span className="font-mono text-xs text-muted-foreground w-32 truncate">{c.invoiceId}</span>
                <span className="flex-1 text-xs text-muted-foreground truncate">{c.negotiationId}</span>
                <span className="font-mono text-xs">₹{c.notionalAmount.toLocaleString()}</span>
                <span className="font-mono text-xs text-emerald-400">save ₹{c.savingAmount.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground">{c.settlementDate}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

