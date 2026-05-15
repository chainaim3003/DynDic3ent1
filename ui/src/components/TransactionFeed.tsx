import { cn } from '@/lib/utils';
import { AgentAction, formatTimestamp, getAgentEmoji, getAgentColorClass } from '@/lib/agents';
import { CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-react';

interface TransactionFeedProps {
  actions: AgentAction[];
  maxItems?: number;
  className?: string;
}

export function TransactionFeed({ actions, maxItems = 10, className }: TransactionFeedProps) {
  // Reverse the actions to show oldest first (top to bottom chronologically)
  const displayActions = actions.slice(0, maxItems).reverse();

  const statusIcon = (status: AgentAction['status']) => {
    switch (status) {
      case 'success':
        return <CheckCircle size={14} className="text-success" />;
      case 'pending':
        return <Clock size={14} className="text-warning" />;
      case 'warning':
        return <AlertTriangle size={14} className="text-warning" />;
      case 'error':
        return <XCircle size={14} className="text-destructive" />;
    }
  };

  return (
    <div className={cn('space-y-2 overflow-y-auto scrollbar-thin', className)}>
      {displayActions.map((action, index) => (
        <div 
          key={action.id}
          className={cn(
            'flex items-start gap-3 p-3 rounded-lg bg-card/50 border border-border/50',
            'animate-fade-in',
          )}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
            {formatTimestamp(action.timestamp)}
          </span>
          <span className="text-lg" title={action.agent}>
            {getAgentEmoji(action.agent)}
          </span>
          <div className="flex-1 min-w-0">
            <p className={cn('text-sm font-medium', getAgentColorClass(action.agent))}>
              {action.action}
            </p>
            {action.details && (
              <p className="text-xs text-muted-foreground mt-0.5">{action.details}</p>
            )}
            {action.calculation && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5 bg-background/50 px-2 py-1 rounded inline-block">
                {action.calculation}
              </p>
            )}
          </div>
          {statusIcon(action.status)}
        </div>
      ))}
      {displayActions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <p className="text-sm">No transactions yet</p>
          <p className="text-xs mt-1">Start the simulation to see agent activity</p>
        </div>
      )}
    </div>
  );
}
