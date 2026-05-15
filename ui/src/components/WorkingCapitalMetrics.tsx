import { calculateWorkingCapitalMetrics } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from './AnimatedNumber';
import { TrendingUp, TrendingDown, Clock, ArrowRightLeft } from 'lucide-react';

interface WorkingCapitalMetricsProps {
  data: {
    accountsReceivable: number;
    accountsPayable: number;
    inventory: number;
    annualRevenue: number;
    annualCOGS: number;
  };
  className?: string;
}

export function WorkingCapitalMetrics({ data, className }: WorkingCapitalMetricsProps) {
  const metrics = calculateWorkingCapitalMetrics(
    data.accountsReceivable,
    data.accountsPayable,
    data.inventory,
    data.annualRevenue,
    data.annualCOGS,
  );

  const cards = [
    {
      label: 'DSO',
      fullLabel: 'Days Sales Outstanding',
      value: metrics.dso,
      icon: TrendingUp,
      color: 'text-chart-receivable',
      bgColor: 'bg-chart-receivable/10',
      formula: `(AR / Revenue) × 365 = (${(data.accountsReceivable/1000).toFixed(0)}K / ${(data.annualRevenue/1000).toFixed(0)}K) × 365`,
      description: 'Average days to collect receivables',
    },
    {
      label: 'DPO',
      fullLabel: 'Days Payables Outstanding',
      value: metrics.dpo,
      icon: TrendingDown,
      color: 'text-chart-payable',
      bgColor: 'bg-chart-payable/10',
      formula: `(AP / COGS) × 365 = (${(data.accountsPayable/1000).toFixed(0)}K / ${(data.annualCOGS/1000).toFixed(0)}K) × 365`,
      description: 'Average days to pay suppliers',
    },
    {
      label: 'DIO',
      fullLabel: 'Days Inventory Outstanding',
      value: metrics.dio,
      icon: Clock,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      formula: `(Inventory / COGS) × 365 = (${(data.inventory/1000).toFixed(0)}K / ${(data.annualCOGS/1000).toFixed(0)}K) × 365`,
      description: 'Average days to sell inventory',
    },
    {
      label: 'CCC',
      fullLabel: 'Cash Conversion Cycle',
      value: metrics.ccc,
      icon: ArrowRightLeft,
      color: metrics.ccc > 0 ? 'text-destructive' : 'text-success',
      bgColor: metrics.ccc > 0 ? 'bg-destructive/10' : 'bg-success/10',
      formula: `DSO + DIO - DPO = ${metrics.dso.toFixed(1)} + ${metrics.dio.toFixed(1)} - ${metrics.dpo.toFixed(1)}`,
      description: 'Days to convert inventory to cash',
    },
  ];

  return (
    <div className={cn('grid grid-cols-2 gap-4', className)}>
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div 
            key={card.label}
            className={cn(
              'glass-card p-4 animate-fade-in group cursor-pointer',
              'hover:scale-[1.02] transition-transform',
            )}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={cn('p-2 rounded-lg', card.bgColor)}>
                <Icon size={18} className={card.color} />
              </div>
              <span className="text-xs text-muted-foreground">{card.fullLabel}</span>
            </div>
            
            <div className="mb-2">
              <span className={cn('font-mono font-bold text-2xl', card.color)}>
                <AnimatedNumber value={card.value} decimals={1} />
              </span>
              <span className="text-muted-foreground ml-1 text-sm">days</span>
            </div>
            
            <p className="text-xs text-muted-foreground">{card.description}</p>
            
            {/* Tooltip on hover */}
            <div className="hidden group-hover:block absolute z-10 left-0 right-0 bottom-full mb-2 p-3 glass-card border border-border shadow-xl text-xs">
              <p className="text-muted-foreground font-mono">{card.formula}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
