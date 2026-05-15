import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { CashFlowEntry } from '@/lib/calculations';
import { cn } from '@/lib/utils';

interface CashFlowChartProps {
  data: CashFlowEntry[];
  className?: string;
}

export function CashFlowChart({ data, className }: CashFlowChartProps) {
  const minCumulative = Math.min(...data.map(d => d.cumulative));
  const hasGap = minCumulative < 50000;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0].payload as CashFlowEntry;
      return (
        <div className="glass-card p-3 shadow-xl border border-border">
          <p className="text-sm font-semibold mb-2">{entry.date}</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-chart-receivable">Inflows:</span>
              <span className="font-mono">${entry.inflows.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-chart-payable">Outflows:</span>
              <span className="font-mono">${entry.outflows.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-1 mt-1">
              <span className={entry.net >= 0 ? 'text-success' : 'text-destructive'}>Net:</span>
              <span className="font-mono">${entry.net.toLocaleString()}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Cumulative:</span>
              <span className={cn(
                'font-mono font-semibold',
                entry.cumulative < 50000 ? 'text-destructive' : 'text-success'
              )}>
                ${entry.cumulative.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs">
            
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn('w-full h-[300px]', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 60 }}>
          <defs>
            <linearGradient id="inflowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-receivable))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--chart-receivable))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="outflowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-payable))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--chart-payable))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cumulativeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-net))" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(var(--chart-net))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis 
            dataKey="date" 
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            interval={0}
            tickFormatter={(value: string) => {
              // Keep ISO date format YYYY-MM-DD for clarity
              try {
                const d = new Date(value);
                return d.toISOString().slice(0, 10);
              } catch (e) {
                return value;
              }
            }}
            angle={-90}
            textAnchor="end"
            dy={10}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine 
            y={50000} 
            stroke="hsl(var(--destructive))" 
            strokeDasharray="5 5" 
            label={{ 
              value: 'Min Threshold', 
              position: 'right',
              fill: 'hsl(var(--destructive))',
              fontSize: 10,
            }} 
          />
          <Area
            type="monotone"
            dataKey="inflows"
            stroke="hsl(var(--chart-receivable))"
            fill="url(#inflowGradient)"
            strokeWidth={2}
            animationDuration={1000}
          />
          <Area
            type="monotone"
            dataKey="outflows"
            stroke="hsl(var(--chart-payable))"
            fill="url(#outflowGradient)"
            strokeWidth={2}
            animationDuration={1200}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="hsl(var(--chart-net))"
            fill="url(#cumulativeGradient)"
            strokeWidth={3}
            animationDuration={1500}
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-6 mt-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-chart-receivable" />
          <span className="text-muted-foreground">Inflows (AR)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-chart-payable" />
          <span className="text-muted-foreground">Outflows (AP)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-chart-net" />
          <span className="text-muted-foreground">Cumulative Balance</span>
        </div>
      </div>
    </div>
  );
}
