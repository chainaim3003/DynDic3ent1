import { cn } from '@/lib/utils';
import { Agent, AgentType, formatTimestamp } from '@/lib/agents';
import { AgentAvatar } from './AgentAvatar';
import { StatusIndicator } from './StatusIndicator';
import { TypingIndicator } from './TypingIndicator';
import { AnimatedNumber } from './AnimatedNumber';

interface AgentCardProps {
  agent: Agent;
  onClick?: () => void;
  compact?: boolean;
}

export function AgentCard({ agent, onClick, compact = false }: AgentCardProps) {
  const cardClass = {
    buyer: 'agent-card-buyer',
    seller: 'agent-card-seller',
    treasury: 'agent-card-treasury',
  }[agent.type];

  const textClass = {
    buyer: 'text-agent-buyer',
    seller: 'text-agent-seller',
    treasury: 'text-agent-treasury',
  }[agent.type];

  return (
    <div 
      className={cn(
        'rounded-xl p-4 backdrop-blur-xl cursor-pointer transition-all duration-300 hover:scale-[1.02]',
        cardClass,
        compact ? 'p-3' : 'p-5',
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <AgentAvatar 
            agent={agent.type} 
            size={compact ? 'sm' : 'md'} 
            showGlow={agent.status === 'active'} 
          />
          <div>
            <h3 className={cn('font-semibold', compact ? 'text-sm' : 'text-base', textClass)}>
              {agent.name}
            </h3>
            <StatusIndicator status={agent.status} agent={agent.type} showLabel size="sm" />
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Success Rate</div>
          <div className={cn('font-mono font-semibold', textClass)}>
            <AnimatedNumber value={agent.successRate} suffix="%" />
          </div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="mb-4">
            <div className="text-xs text-muted-foreground mb-1">Current Objective</div>
            <div className="flex items-center gap-2">
              {agent.status === 'active' && <TypingIndicator agent={agent.type} />}
              <p className="text-sm text-foreground/80 truncate">
                {agent.objective}
              </p>
            </div>
          </div>

          {agent.lastAction && (
            <div className="bg-background/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">Last Action</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {formatTimestamp(agent.lastAction.timestamp)}
                </span>
              </div>
              <p className="text-sm text-foreground/90 truncate">
                {agent.lastAction.action}
              </p>
              {agent.lastAction.calculation && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {agent.lastAction.calculation}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border/30">
            {Object.entries(agent.metrics).slice(0, 3).map(([key, value]) => (
              <div key={key} className="text-center">
                <div className="text-xs text-muted-foreground capitalize">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </div>
                <div className="font-mono font-semibold text-sm">
                  {typeof value === 'number' && value > 1000 
                    ? `$${(value / 1000).toFixed(1)}K`
                    : value}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {compact && agent.lastAction && (
        <p className="text-xs text-foreground/70 truncate mt-2">
          {agent.lastAction.action}
        </p>
      )}
    </div>
  );
}
