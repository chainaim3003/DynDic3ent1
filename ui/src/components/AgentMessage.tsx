import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { AgentMessage as AgentMessageType, formatTimestamp, getAgentEmoji } from '@/lib/agents';
import { AgentAvatar } from './AgentAvatar';
import { ArrowRight } from 'lucide-react';

interface AgentMessageProps {
  message: AgentMessageType;
  className?: string;
}

export function AgentMessage({ message, className }: AgentMessageProps) {
  const [isNew, setIsNew] = useState(true);

  useEffect(() => {
    setIsNew(true);
    const t = setTimeout(() => setIsNew(false), 700);
    return () => clearTimeout(t);
  }, [message.id]);

  const fromColor = {
    buyer: 'text-agent-buyer',
    seller: 'text-agent-seller',
    treasury: 'text-agent-treasury',
  }[message.from];

  const toColor = {
    buyer: 'text-agent-buyer',
    seller: 'text-agent-seller',
    treasury: 'text-agent-treasury',
  }[message.to];

  const bgColor = {
    buyer: 'bg-agent-buyer/5 border-agent-buyer/30',
    seller: 'bg-agent-seller/5 border-agent-seller/30',
    treasury: 'bg-agent-treasury/5 border-agent-treasury/30',
  }[message.from];

  const highlightClass = message.highlight ? 'border-l-4 border-yellow-500 bg-yellow-900/10 shadow-[0_8px_30px_rgba(234,179,8,0.08)]' : '';

  const agentNames = {
    buyer: 'Buyer',
    seller: 'Seller',
    treasury: 'Treasury',
  };

  return (
    <div className={cn(isNew ? 'animate-slide-up' : '', className)}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex-shrink-0 mt-1">
          <AgentAvatar agent={message.from} size="sm" />
        </div>

        <div className="flex-1">
          <div className="flex items-start">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className={cn('text-sm font-medium', fromColor)}>{getAgentEmoji(message.from)} {agentNames[message.from]}</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className={cn('text-sm font-medium', toColor)}>{getAgentEmoji(message.to)} {agentNames[message.to]}</span>
                <span className="font-mono ml-auto text-xs text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
              </div>

              <div className={cn('rounded-lg border p-3', bgColor, highlightClass)}>
                <p className="text-sm leading-relaxed">{message.message}</p>
                {message.badge && (
                  <div className="mt-2 inline-flex items-center text-xs bg-yellow-900 text-yellow-300 px-2 py-1 rounded">
                    {message.badge}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
