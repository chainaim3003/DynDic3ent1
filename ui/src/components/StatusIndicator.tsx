import { cn } from '@/lib/utils';
import { AgentType, AgentStatus } from '@/lib/agents';

interface StatusIndicatorProps {
  status: AgentStatus;
  agent?: AgentType;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function StatusIndicator({ 
  status, 
  agent = 'buyer', 
  size = 'md',
  showLabel = false,
}: StatusIndicatorProps) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const pulseClass = status === 'active' ? 'status-pulse' : '';
  const agentPulseClass = status === 'active' ? `status-pulse-${agent}` : '';
  
  const colorClass = {
    buyer: 'bg-agent-buyer',
    seller: 'bg-agent-seller',
    treasury: 'bg-agent-treasury',
  }[agent];

  const statusText = {
    idle: 'Idle',
    active: 'Active',
    thinking: 'Processing',
    paused: 'Paused',
  }[status];

  return (
    <div className="flex items-center gap-2">
      <div className={cn('relative', pulseClass, agentPulseClass)}>
        <div 
          className={cn(
            'rounded-full',
            sizeClasses[size],
            colorClass,
            status === 'idle' && 'opacity-50',
            status === 'paused' && 'opacity-30',
          )}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground font-medium">
          {statusText}
        </span>
      )}
    </div>
  );
}
