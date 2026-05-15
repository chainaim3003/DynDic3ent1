import { cn } from '@/lib/utils';
import { AgentType, getAgentEmoji } from '@/lib/agents';
import { ShoppingCart, Package, Briefcase } from 'lucide-react';

interface AgentAvatarProps {
  agent: AgentType;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showGlow?: boolean;
  className?: string;
}

export function AgentAvatar({ 
  agent, 
  size = 'md', 
  showGlow = false,
  className,
}: AgentAvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
    xl: 'w-20 h-20',
  };

  const iconSizes = {
    sm: 16,
    md: 24,
    lg: 32,
    xl: 40,
  };

  const gradientClass = {
    buyer: 'bg-gradient-to-br from-agent-buyer to-agent-buyer-glow',
    seller: 'bg-gradient-to-br from-agent-seller to-agent-seller-glow',
    treasury: 'bg-gradient-to-br from-agent-treasury to-agent-treasury-glow',
  }[agent];

  const glowClass = showGlow ? {
    buyer: 'glow-buyer',
    seller: 'glow-seller',
    treasury: 'glow-treasury',
  }[agent] : '';

  const Icon = {
    buyer: ShoppingCart,
    seller: Package,
    treasury: Briefcase,
  }[agent];

  return (
    <div 
      className={cn(
        'rounded-xl flex items-center justify-center',
        sizeClasses[size],
        gradientClass,
        glowClass,
        className,
      )}
    >
      <Icon size={iconSizes[size]} className="text-background" />
    </div>
  );
}
