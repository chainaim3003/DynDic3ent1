import { calculatePDScore } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from './AnimatedNumber';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface CounterpartyRisk {
  name: string;
  daysOverdue: number;
  paymentVariance: number;
  invoiceCount: number;
}

interface PDScoreCardProps {
  counterparties: CounterpartyRisk[];
  className?: string;
}

export function PDScoreCard({ counterparties, className }: PDScoreCardProps) {
  const data = counterparties.map(cp => {
    const result = calculatePDScore(cp.daysOverdue, cp.paymentVariance, cp.invoiceCount);
    return {
      name: cp.name.split(' ')[0], // Short name for chart
      fullName: cp.name,
      pd: result.riskScore,
      riskClass: result.riskClass,
      z: result.z,
      formula: result.formula,
    };
  });

  const getColor = (riskClass: string) => {
    switch (riskClass) {
      case 'Low':
        return 'hsl(var(--success))';
      case 'Medium':
        return 'hsl(var(--warning))';
      case 'High':
        return 'hsl(var(--destructive))';
      default:
        return 'hsl(var(--muted))';
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="glass-card p-3 shadow-xl border border-border">
          <p className="font-semibold text-sm mb-2">{item.fullName}</p>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">PD Score:</span>
              <span className={cn('font-mono font-semibold', {
                'text-success': item.riskClass === 'Low',
                'text-warning': item.riskClass === 'Medium',
                'text-destructive': item.riskClass === 'High',
              })}>
                {item.pd}%
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Risk Class:</span>
              <span className="font-medium">{item.riskClass}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">z-score:</span>
              <span className="font-mono">{item.z}</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border text-xs">
            <p className="text-muted-foreground font-mono text-[10px]">
              PD = 1 / (1 + e^(-z))
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn('', className)}>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
            <XAxis 
              type="number" 
              domain={[0, 100]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickFormatter={(val) => `${val}%`}
            />
            <YAxis 
              type="category" 
              dataKey="name" 
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              width={60}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
            <Bar dataKey="pd" radius={[0, 4, 4, 0]} animationDuration={1000}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getColor(entry.riskClass)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      
      <div className="flex items-center justify-center gap-6 mt-2 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-success" />
          <span className="text-muted-foreground">Low (&lt;20%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-warning" />
          <span className="text-muted-foreground">Medium (20-50%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-destructive" />
          <span className="text-muted-foreground">High (&gt;50%)</span>
        </div>
      </div>
    </div>
  );
}
