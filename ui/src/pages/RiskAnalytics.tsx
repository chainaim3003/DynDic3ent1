import { useEffect, useState, useRef } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid, Legend,
} from 'recharts';
import { AlertTriangle, TrendingUp, TrendingDown, RefreshCw, CheckCircle, XCircle, Upload } from 'lucide-react';

interface ActusContract {
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

interface RiskAnalyticsProps {
  simulation: ReturnType<typeof useSimulation>;
}

const STORAGE_KEY = 'actus_dd_contracts_history';

export function RiskAnalytics({ simulation: _simulation }: RiskAnalyticsProps) {
  const [contracts, setContracts] = useState<ActusContract[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
  });
  const [fetching, setFetching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchContracts = async () => {
    setFetching(true);
    try {
      const res = await fetch('http://localhost:7070/actus-contracts');
      if (res.ok) {
        const fresh: ActusContract[] = await res.json();
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

  const mergeUploaded = (data: unknown) => {
    const arr: ActusContract[] = Array.isArray(data) ? data : [data as ActusContract];
    const valid = arr.filter(c => c.invoiceId && c.notionalAmount !== undefined);
    if (!valid.length) { setUploadMsg('❌ No valid ACTUS contracts found'); setTimeout(() => setUploadMsg(''), 3000); return; }
    setContracts(prev => {
      const ids = new Set(prev.map(c => c.invoiceId));
      const merged = [...prev, ...valid.filter(c => !ids.has(c.invoiceId))];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return merged;
    });
    setUploadMsg(`✅ Imported ${valid.length} contract(s)`);
    setTimeout(() => setUploadMsg(''), 3000);
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith('.json')) { setUploadMsg('❌ Please upload a JSON file'); setTimeout(() => setUploadMsg(''), 3000); return; }
    const reader = new FileReader();
    reader.onload = e => { try { mergeUploaded(JSON.parse(e.target?.result as string)); } catch { setUploadMsg('❌ Invalid JSON'); setTimeout(() => setUploadMsg(''), 3000); } };
    reader.readAsText(file);
  };

  useEffect(() => { fetchContracts(); }, []);

  const totalNotional   = contracts.reduce((s, c) => s + c.notionalAmount, 0);
  const totalSaving     = contracts.reduce((s, c) => s + c.savingAmount, 0);
  const approved        = contracts.filter(c => c.actusSuccess).length;
  const failed          = contracts.filter(c => !c.actusSuccess).length;
  const avgSOFR         = contracts.length ? contracts.reduce((s, c) => s + c.sofrRate, 0) / contracts.length : 0;
  const avgHurdle       = contracts.length ? contracts.reduce((s, c) => s + c.hurdleRate, 0) / contracts.length : 0;
  const avgApplied      = contracts.length ? contracts.reduce((s, c) => s + c.appliedRate, 0) / contracts.length : 0;

  // Liquidity: flatten all ACTUS cashflow events
  const liquidityData = contracts
    .flatMap(c => c.events.map(e => ({ date: e.time?.split('T')[0] ?? '', payoff: e.payoff })))
    .sort((a, b) => a.date.localeCompare(b.date))
    .reduce<{ date: string; inflow: number; outflow: number; balance: number }[]>((acc, e) => {
      const prev = acc[acc.length - 1];
      const balance = (prev?.balance ?? 0) + e.payoff;
      const ex = acc.find(x => x.date === e.date);
      if (ex) {
        if (e.payoff >= 0) ex.inflow += e.payoff; else ex.outflow += Math.abs(e.payoff);
        ex.balance = balance; return acc;
      }
      return [...acc, { date: e.date, inflow: e.payoff >= 0 ? e.payoff : 0, outflow: e.payoff < 0 ? Math.abs(e.payoff) : 0, balance }];
    }, []);

  // PD scoring — aggregate into 3 buckets, not per-invoice
  const pdData = contracts.map(c => {
    const gap = c.hurdleRate - c.appliedRate;
    return Math.max(5, Math.min(95, Math.round(100 - (gap / 0.05) * 80)));
  });
  const avgPD   = pdData.length ? Math.round(pdData.reduce((a, b) => a + b, 0) / pdData.length) : 0;
  const lowRisk  = pdData.filter(d => d < 20).length;
  const medRisk  = pdData.filter(d => d >= 20 && d < 50).length;
  const highRisk = pdData.filter(d => d >= 50).length;

  // Discount rate — aggregate averages, not per-invoice
  const avgMaxRate     = contracts.length ? contracts.reduce((s, c) => s + c.maxDiscountRate, 0) / contracts.length : 0;
  const avgAppliedRate = contracts.length ? contracts.reduce((s, c) => s + c.appliedRate, 0) / contracts.length : 0;
  const avgHurdleRate  = contracts.length ? contracts.reduce((s, c) => s + c.hurdleRate, 0) / contracts.length : 0;
  const rateData = [
    { name: 'Max DD Rate',    value: parseFloat((avgMaxRate * 100).toFixed(3)),     fill: '#fcd34d' },
    { name: 'Applied Rate',   value: parseFloat((avgAppliedRate * 100).toFixed(3)), fill: '#6ee7b7' },
    { name: 'Hurdle Rate',    value: parseFloat((avgHurdleRate * 100).toFixed(2)),  fill: '#a5b4fc' },
  ];

  const dso = contracts.length ? Math.round(contracts.reduce((s, c) => {
    return s + (new Date(c.settlementDate).getTime() - new Date(c.invoiceDate).getTime()) / 86400000;
  }, 0) / contracts.length) : 0;

  const dpo = contracts.length ? Math.round(contracts.reduce((s, c) => {
    return s + (new Date(c.dueDate).getTime() - new Date(c.invoiceDate).getTime()) / 86400000;
  }, 0) / contracts.length) : 0;

  const ccc = dso - dpo;

  if (contracts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Risk & Analytics</h1>
            <p className="text-muted-foreground">Real-time data from Jupiter Treasury ACTUS engine</p>
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchContracts} disabled={fetching}>
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />
        <div
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'glass-card p-16 text-center cursor-pointer border-2 border-dashed transition-all',
            isDragging ? 'border-indigo-400 bg-agent-treasury/10' : 'border-muted-foreground/30 hover:border-indigo-400/50'
          )}
        >
          <Upload size={48} className={cn('mx-auto mb-4', isDragging ? 'text-indigo-400' : 'text-muted-foreground opacity-40')} />
          <p className="font-semibold mb-1">Upload ACTUS Contract JSON</p>
          <p className="text-sm text-muted-foreground mb-4">Drag & drop or click to browse — use the exported file from Treasury Management</p>
          <Button variant="outline" size="sm" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>Choose File</Button>
          {uploadMsg && <p className="mt-4 text-sm font-medium">{uploadMsg}</p>}
          <p className="text-xs text-muted-foreground mt-4">Or complete a negotiation with DD — data auto-populates via treasury agent at :7070</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = ''; }} />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Risk & Analytics</h1>
          <p className="text-muted-foreground">Real-time · Jupiter Treasury ACTUS engine · {contracts.length} contracts</p>
        </div>
        <div className="flex items-center gap-2">
          {uploadMsg && <span className="text-xs font-medium">{uploadMsg}</span>}
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer text-xs transition-all',
              isDragging ? 'border-indigo-400 bg-agent-treasury/10 text-indigo-400' : 'border-muted-foreground/30 text-muted-foreground hover:border-indigo-400/50 hover:text-foreground'
            )}
          >
            <Upload size={13} />
            Drop contract JSON
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={fetchContracts} disabled={fetching}>
            <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Notional', value: `₹${totalNotional.toLocaleString()}`, sub: `${contracts.length} invoices` },
          { label: 'Total Savings', value: `₹${totalSaving.toLocaleString()}`, sub: 'Early payment benefit' },
          { label: 'Avg SOFR', value: `${(avgSOFR * 100).toFixed(2)}%`, sub: `Hurdle ${(avgHurdle * 100).toFixed(2)}%` },
          { label: 'ACTUS Status', value: `${approved} ✓  ${failed} ✗`, sub: 'Simulations run', color: approved > 0 ? 'text-green-400' : 'text-red-400' },
        ].map(k => (
          <div key={k.label} className="glass-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={cn('text-lg font-bold font-mono mt-1', k.color)}>{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PD Scoring — aggregated summary */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">Probability of Default Scoring</h3>
              <p className="text-xs text-muted-foreground">Aggregated across {contracts.length} invoices · hurdle vs applied gap</p>
            </div>
            <AlertTriangle size={20} className="text-amber-500" />
          </div>
          {/* Average PD gauge */}
          <div className="flex items-center justify-center mb-6">
            <div className="text-center">
              <p className={cn('text-5xl font-bold font-mono', avgPD < 20 ? 'text-emerald-400' : avgPD < 50 ? 'text-amber-400' : 'text-rose-400')}>{avgPD}%</p>
              <p className="text-xs text-muted-foreground mt-1">Average PD Score</p>
              <p className={cn('text-sm font-semibold mt-1', avgPD < 20 ? 'text-emerald-400' : avgPD < 50 ? 'text-amber-400' : 'text-rose-400')}>
                {avgPD < 20 ? 'Low Risk' : avgPD < 50 ? 'Medium Risk' : 'High Risk'}
              </p>
            </div>
          </div>
          {/* Risk distribution */}
          <div className="space-y-3">
            {[
              { label: 'Low Risk', count: lowRisk,  color: 'bg-emerald-400', text: 'text-emerald-400' },
              { label: 'Medium Risk', count: medRisk,  color: 'bg-amber-400',   text: 'text-amber-400'   },
              { label: 'High Risk',   count: highRisk, color: 'bg-rose-400',    text: 'text-rose-400'    },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20">{r.label}</span>
                <div className="flex-1 h-4 bg-muted/30 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all duration-700', r.color)}
                    style={{ width: contracts.length ? `${(r.count / contracts.length) * 100}%` : '0%' }} />
                </div>
                <span className={cn('text-xs font-mono font-bold w-6 text-right', r.text)}>{r.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-6 text-xs">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-400" /><span className="text-muted-foreground">Low (&lt;20%)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-400" /><span className="text-muted-foreground">Medium (20-50%)</span></div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-rose-400" /><span className="text-muted-foreground">High (&gt;50%)</span></div>
          </div>
        </div>

        {/* Liquidity Analysis */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">Liquidity Analysis</h3>
              <p className="text-xs text-muted-foreground">ACTUS PAM cashflow events — real settlement data</p>
            </div>
            {liquidityData.length > 0 && liquidityData[liquidityData.length - 1]?.balance > 0
              ? <div className="flex items-center gap-1 text-emerald-500 text-sm"><TrendingUp size={16} />Positive</div>
              : <div className="flex items-center gap-1 text-rose-400 text-sm"><TrendingDown size={16} />Negative</div>}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={liquidityData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <defs>
                <linearGradient id="gInflow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6ee7b7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6ee7b7" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a5b4fc" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a5b4fc" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `₹${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
              <Area type="monotone" dataKey="inflow" stroke="#6ee7b7" fill="url(#gInflow)" name="Inflow (AR)" />
              <Area type="monotone" dataKey="outflow" stroke="#fca5a5" fill="none" strokeDasharray="4 2" name="Outflow (AP)" />
              <Area type="monotone" dataKey="balance" stroke="#a5b4fc" fill="url(#gBalance)" name="Cumulative Balance" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Discount Rate Analysis — averaged */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">Discount Rate Analysis</h3>
              <p className="text-xs text-muted-foreground">Average rates across {contracts.length} invoices</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={rateData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={(v: number) => `${v}%`} />
              <Bar dataKey="value" radius={[6,6,0,0]}>
                {rateData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center text-xs">
            {rateData.map(d => (
              <div key={d.name} className="bg-muted/20 rounded-lg p-2">
                <p className="text-muted-foreground">{d.name}</p>
                <p className="font-mono font-bold mt-0.5" style={{ color: d.fill }}>{d.value}%</p>
              </div>
            ))}
          </div>
        </div>

        {/* Working Capital */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-lg">Working Capital Metrics</h3>
              <p className="text-xs text-muted-foreground">Derived from real settlement & due dates</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Days Sales Outstanding', value: dso, unit: 'days', sub: 'Invoice → Settlement', color: 'text-blue-400' },
              { label: 'Days Payables Outstanding', value: dpo, unit: 'days', sub: 'Invoice → Due date', color: 'text-green-400' },
              { label: 'Avg Applied Rate', value: (avgApplied * 100).toFixed(3), unit: '%', sub: 'Effective DD discount', color: 'text-emerald-400' },
              { label: 'Cash Conversion Cycle', value: Math.abs(ccc), unit: 'days', sub: ccc <= 0 ? 'Early settlement benefit' : 'Standard cycle', color: ccc <= 0 ? 'text-green-400' : 'text-orange-400' },
            ].map(m => (
              <div key={m.label} className="bg-muted/20 rounded-xl p-4">
                <p className="text-xs text-muted-foreground mb-1">{m.label}</p>
                <p className={cn('text-2xl font-bold font-mono', m.color)}>{m.value}<span className="text-sm ml-1">{m.unit}</span></p>
                <p className="text-xs text-muted-foreground mt-1">{m.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Contract Portfolio — PAM(AR) / PAM(AP) */}
        <div className="glass-card p-6 md:col-span-1">
          <h3 className="font-semibold mb-1">Contract Portfolio</h3>
          <p className="text-xs text-muted-foreground mb-3">PAM — Receivable (AR) vs Payable (AP)</p>
          {(() => {
            const pamAR = contracts.length; // all DD contracts = PAM Receivable
            const pamAP = 0;
            const segments = [
              { name: 'PAM (AR) — Receivable', value: pamAR, fill: '#93c5fd' },
              { name: 'PAM (AP) — Payable',    value: pamAP, fill: '#c4b5fd' },
            ].filter(s => s.value > 0);
            return (
              <>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={segments} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                        {segments.map((s, i) => <Cell key={i} fill={s.fill} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, name: string) => [v, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col items-center gap-1.5 mt-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#93c5fd' }} />
                    <span>PAM (AR) — Receivable: {pamAR}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#c4b5fd' }} />
                    <span className="text-muted-foreground">PAM (AP) — Payable: {pamAP}</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>

        <div className="glass-card p-6">
          <h3 className="font-semibold mb-4">Risk Summary</h3>
          <div className="space-y-4">
            {[
              { label: 'Low Risk',    count: lowRisk,  color: 'bg-emerald-300/70',     text: 'text-emerald-500' },
              { label: 'Medium Risk', count: medRisk,  color: 'bg-amber-300/70',     text: 'text-amber-500' },
              { label: 'High Risk',   count: highRisk, color: 'bg-rose-300/70', text: 'text-rose-400' },
            ].map(r => (
              <div key={r.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">{r.label}</span>
                  <span className={cn('font-mono font-semibold text-sm', r.text)}>{r.count}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full transition-all duration-700', r.color)}
                    style={{ width: contracts.length ? `${(r.count / contracts.length) * 100}%` : '0%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


