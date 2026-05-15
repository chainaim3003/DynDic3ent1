import { Contract, getContractValue } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { Zap, TrendingUp, TrendingDown, Trash } from 'lucide-react';
import { AnimatedNumber } from './AnimatedNumber';

interface ContractTableProps {
  contracts: Contract[];
  selectedId?: string;
  onSelect: (contract: Contract) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

export function ContractTable({ contracts, selectedId, onSelect, onDelete, className }: ContractTableProps) {
  const getRiskBadge = (score: number) => {
    if (score < 20) return { label: '🟢', class: 'text-success' };
    if (score < 50) return { label: '🟡', class: 'text-warning' };
    return { label: '🔴', class: 'text-destructive' };
  };

  // Random discount opportunities
  const hasDiscount = (id: string) => ['C001', 'C003'].includes(id);

  return (
    <div className={cn('overflow-x-auto scrollbar-thin', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">ID</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Type</th>
            <th className="text-left py-3 px-4 text-muted-foreground font-medium">Counterparty</th>
            <th className="text-right py-3 px-4 text-muted-foreground font-medium">Amount</th>
            <th className="text-center py-3 px-4 text-muted-foreground font-medium">Risk</th>
            <th className="text-center py-3 px-4 text-muted-foreground font-medium">Direction</th>
            <th className="text-center py-3 px-4 text-muted-foreground font-medium">⚡</th>
            <th className="text-center py-3 px-4 text-muted-foreground font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract, index) => {
            const risk = getRiskBadge(contract.riskScore);
            const value = getContractValue(contract);
            const isSelected = selectedId === contract.id;
            
            return (
              <tr 
                key={contract.id}
                onClick={() => onSelect(contract)}
                className={cn(
                  'border-b border-border/50 cursor-pointer transition-colors',
                  'hover:bg-muted/30',
                  isSelected && 'bg-primary/10 border-primary/30',
                  'animate-fade-in',
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <td className="py-3 px-4 font-mono text-primary">{contract.id}</td>
                <td className="py-3 px-4">
                  <span className={cn(
                    'px-2 py-1 rounded text-xs font-medium',
                    contract.type === 'PAM' 
                      ? 'bg-agent-buyer/20 text-agent-buyer'
                      : 'bg-agent-treasury/20 text-agent-treasury'
                  )}>
                    {contract.type}
                  </span>
                </td>
                <td className="py-3 px-4">{contract.counterparty}</td>
                <td className="py-3 px-4 text-right font-mono">
                  <AnimatedNumber value={value} format="currency" duration={500} />
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={risk.class} title={`Risk Score: ${contract.riskScore}%`}>
                    {risk.label}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  {contract.direction === 'receivable' ? (
                    <TrendingUp size={16} className="text-success inline" />
                  ) : (
                    <TrendingDown size={16} className="text-chart-payable inline" />
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  {hasDiscount(contract.id) && (
                    <Zap size={16} className="text-warning inline animate-pulse" />
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete?.(contract.id); }}
                    className="inline-flex items-center justify-center p-2 rounded hover:bg-muted/30"
                    title="Delete contract"
                  >
                    <Trash size={16} className="text-destructive" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
