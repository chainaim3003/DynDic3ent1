import { cn } from '@/lib/utils';
import { AgentType } from '@/lib/agents';

interface TypingIndicatorProps {
  agent: AgentType;
  className?: string;
}

export function TypingIndicator({ agent, className }: TypingIndicatorProps) {
  const colorClass = {
    buyer: 'text-agent-buyer',
    seller: 'text-agent-seller',
    treasury: 'text-agent-treasury',
  }[agent];

  return (
    <div className={cn('typing-indicator flex items-center gap-1', colorClass, className)}>
      <span />
      <span />
      <span />
    </div>
  );
}
