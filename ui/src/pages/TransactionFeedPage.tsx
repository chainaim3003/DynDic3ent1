import { useState, useMemo } from 'react';
import { useSimulation } from '@/hooks/useSimulation';
import { TransactionFeed } from '@/components/TransactionFeed';
import { AgentType, getAgentEmoji } from '@/lib/agents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search, Filter, RefreshCw } from 'lucide-react';

interface TransactionFeedPageProps {
  simulation: ReturnType<typeof useSimulation>;
}

export function TransactionFeedPage({ simulation }: TransactionFeedPageProps) {
  const { actions } = simulation.state;
  const [search, setSearch] = useState('');
  const [filterAgent, setFilterAgent] = useState<AgentType | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredActions = useMemo(() => {
    return actions.filter(action => {
      const matchesSearch = search === '' || 
        action.action.toLowerCase().includes(search.toLowerCase());
      const matchesAgent = filterAgent === 'all' || action.agent === filterAgent;
      const matchesStatus = filterStatus === 'all' || action.status === filterStatus;
      return matchesSearch && matchesAgent && matchesStatus;
    });
  }, [actions, search, filterAgent, filterStatus]);

  const agentFilters: { value: AgentType | 'all'; label: string; emoji?: string }[] = [
    { value: 'all', label: 'All Agents' },
    { value: 'buyer', label: 'Buyer', emoji: '🛒' },
    { value: 'seller', label: 'Seller', emoji: '📦' },
    { value: 'treasury', label: 'Treasury', emoji: '💼' },
  ];

  const statusFilters = [
    { value: 'all', label: 'All Status' },
    { value: 'success', label: '✓ Success' },
    { value: 'pending', label: '⏳ Pending' },
    { value: 'warning', label: '⚠️ Warning' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Transaction Feed</h1>
          <p className="text-muted-foreground">Real-time agent activity and system events</p>
        </div>
        <Button 
          variant="secondary" 
          size="sm" 
          className="gap-2"
          onClick={() => simulation.triggerAgentAction()}
        >
          <RefreshCw size={14} />
          Trigger Action
        </Button>
      </div>

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search transactions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background/50"
            />
          </div>

          {/* Agent Filter */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
            {agentFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setFilterAgent(filter.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded transition-all',
                  filterAgent === filter.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.emoji && <span className="mr-1">{filter.emoji}</span>}
                {filter.label}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-1">
            {statusFilters.map((filter) => (
              <button
                key={filter.value}
                onClick={() => setFilterStatus(filter.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded transition-all',
                  filterStatus === filter.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold font-mono">{actions.length}</p>
          <p className="text-xs text-muted-foreground">Total Events</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold font-mono text-agent-buyer">
            {actions.filter(a => a.agent === 'buyer').length}
          </p>
          <p className="text-xs text-muted-foreground">Buyer Actions</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold font-mono text-agent-seller">
            {actions.filter(a => a.agent === 'seller').length}
          </p>
          <p className="text-xs text-muted-foreground">Seller Actions</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-2xl font-bold font-mono text-agent-treasury">
            {actions.filter(a => a.agent === 'treasury').length}
          </p>
          <p className="text-xs text-muted-foreground">Treasury Actions</p>
        </div>
      </div>

      {/* Feed */}
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">
            {filteredActions.length === actions.length 
              ? 'All Transactions' 
              : `Filtered: ${filteredActions.length} of ${actions.length}`}
          </h3>
          {simulation.state.isRunning && (
            <div className="flex items-center gap-2 text-sm text-success">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Live
            </div>
          )}
        </div>
        
        <TransactionFeed 
          actions={filteredActions} 
          maxItems={50} 
          className="max-h-[500px]"
        />
      </div>
    </div>
  );
}
