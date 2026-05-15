import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  AgentState, 
  AgentAction, 
  AgentMessage, 
  createInitialAgentState,
  AgentType,
  Transaction,
} from '@/lib/agents';
import { Contract, calculateNetCashFlow, CashFlowEntry } from '@/lib/calculations';

export interface SimulationState {
  isRunning: boolean;
  speed: number; // 1, 5, or 10
  projectionWeeks: number;
  agents: AgentState;
  contracts: Contract[];
  actions: AgentAction[];
  messages: AgentMessage[];
  transactions?: Transaction[];
  cashFlows: CashFlowEntry[];
}

export function useSimulation() {
  const [state, setState] = useState<SimulationState>(() => ({
    isRunning: false,
    speed: 1,
    projectionWeeks: 24,
    agents: createInitialAgentState(),
    contracts: [],           // no fake contracts — real ones come from treasury agent
    actions: [],
    messages: [],
    transactions: [],        // no fake demo transaction
    cashFlows: calculateNetCashFlow([], 24),
  }));

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef<SimulationState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);


  const triggerTransactionEvent = useCallback(() => {
    setState(prev => {
      const txs = prev.transactions || [];
      const tx = txs.find(t => t.status === 'open');
      if (!tx) return prev;

      const idx = tx.currentEventIndex;
      if (idx >= tx.events.length) return prev;

      const event = tx.events[idx];
      const newActions = [...prev.actions];
      const newMessages = [...prev.messages];
      const newAgents = { ...prev.agents };

      // If there's an action associated
      if (event.action) {
        const action: AgentAction = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          agent: (event.actor || 'buyer') as AgentType,
          action: event.action,
          status: 'success',
          details: undefined,
        };
        newActions.unshift(action);

        // Also create a corresponding AgentMessage so the communication panel shows PO created/accepted messages
        // Map recipient based on actor
        let to: AgentType = 'seller';
        if (event.actor === 'seller') to = 'buyer';
        if (event.actor === 'treasury') to = 'buyer';

        const actionMsg: AgentMessage = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          from: (event.actor || 'buyer') as AgentType,
          to,
          message: event.action,
          type: 'notification',
          eventId: event.id,
          highlight: event.highlight,
          badge: event.badge,
        }; 

        newMessages.unshift(actionMsg);

        // update agent
        if (event.actor) {
          if (event.actor === 'treasury') {
            // Update both treasury agents
            newAgents.buyerTreasury = {
              ...newAgents.buyerTreasury,
              status: 'active',
              lastAction: action,
              totalActions: newAgents.buyerTreasury.totalActions + 1,
              objective: `Processing: ${action.action.slice(0, 30)}...`,
            };
            newAgents.sellerTreasury = {
              ...newAgents.sellerTreasury,
              status: 'active',
              lastAction: action,
              totalActions: newAgents.sellerTreasury.totalActions + 1,
              objective: `Processing: ${action.action.slice(0, 30)}...`,
            };
          } else {
            newAgents[event.actor] = {
              ...newAgents[event.actor],
              status: 'active',
              lastAction: action,
              totalActions: newAgents[event.actor].totalActions + 1,
              objective: `Processing: ${action.action.slice(0, 30)}...`,
            };
          }
        }
      }

      // If there's a message associated
      if (event.message) {
        // determine recipient
        let to: AgentType = 'seller';
        if (event.actor === 'buyer') to = 'treasury';
        if (event.actor === 'treasury') to = 'buyer';
        if (event.actor === 'seller') to = 'buyer';

        const msg: AgentMessage = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          from: (event.actor || 'buyer') as AgentType,
          to,
          message: event.message,
          type: 'notification',
          eventId: event.id,
          highlight: event.highlight,
          badge: event.badge,
        }; 
        newMessages.unshift(msg);

        // Mirror message into action history so it appears in per-agent feeds
        const messageAction: AgentAction = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          agent: (event.actor || 'buyer') as AgentType,
          action: event.message,
          status: event.highlight ? 'warning' : 'success',
          details: event.badge ? event.badge : undefined,
        };
        newActions.unshift(messageAction);

        // update actor status
        if (event.actor) {
          if (event.actor === 'treasury') {
            // Update both treasury agents
            newAgents.buyerTreasury = {
              ...newAgents.buyerTreasury,
              status: 'active',
              lastAction: messageAction,
              totalActions: newAgents.buyerTreasury.totalActions + 1,
              objective: msg.message.slice(0, 30),
            };
            newAgents.sellerTreasury = {
              ...newAgents.sellerTreasury,
              status: 'active',
              lastAction: messageAction,
              totalActions: newAgents.sellerTreasury.totalActions + 1,
              objective: msg.message.slice(0, 30),
            };
          } else {
            newAgents[event.actor] = {
              ...newAgents[event.actor],
              status: 'active',
              lastAction: messageAction,
              totalActions: newAgents[event.actor].totalActions + 1,
              objective: msg.message.slice(0, 30),
            };
          }
        }
      }

      // Advance transaction index
      const newTxs = txs.map(t => {
        if (t.id !== tx.id) return t;
        const nextIdx = t.currentEventIndex + 1;
        const completed = nextIdx >= t.events.length;
        return { ...t, currentEventIndex: nextIdx, status: (completed ? 'complete' : 'open') as 'complete' | 'open' };
      });

      // Check if transaction just completed - if so, stop simulation and add completion message
      const justCompleted = newTxs.find(t => t.id === tx.id && t.status === 'complete');
      const shouldStop = justCompleted !== undefined;

      // Add completion message when PO is complete
      if (shouldStop && justCompleted) {
        const completionMsg: AgentMessage = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          from: 'treasury',
          to: 'buyer',
          message: `✅ Purchase Order ${justCompleted.poId} completed successfully! All steps finished.`,
          type: 'notification',
          highlight: false,
        };
        newMessages.unshift(completionMsg);

        const completionAction: AgentAction = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          agent: 'treasury',
          action: `PO ${justCompleted.poId} completed successfully`,
          status: 'success',
          details: 'Transaction complete',
        };
        newActions.unshift(completionAction);
      }

      return {
        ...prev,
        agents: newAgents,
        actions: newActions.slice(0, 100),
        messages: newMessages.slice(0, 50),
        transactions: newTxs,
        isRunning: shouldStop ? false : prev.isRunning, // Stop simulation when PO completes
      };
    });
  }, []);


  const startSimulation = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: true }));
  }, []);

  const pauseSimulation = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  const toggleSimulation = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState(prev => ({ ...prev, speed }));
  }, []);

  const addContract = useCallback((contract: Contract) => {
    setState(prev => {
      const newContracts = [...prev.contracts, contract];
      return {
        ...prev,
        contracts: newContracts,
        cashFlows: calculateNetCashFlow(newContracts, prev.projectionWeeks, '2025-01-01'),
      };
    });
  }, []);

  const removeContract = useCallback((contractId: string) => {
    setState(prev => {
      const newContracts = prev.contracts.filter(c => c.id !== contractId);
      return {
        ...prev,
        contracts: newContracts,
        cashFlows: calculateNetCashFlow(newContracts, prev.projectionWeeks, '2025-01-01'),
      };
    });
  }, []);


  const updateAgentStatus = useCallback((agent: AgentType | 'buyerTreasury' | 'sellerTreasury', status: 'idle' | 'active' | 'paused') => {
    setState(prev => ({
      ...prev,
      agents: {
        ...prev.agents,
        [agent]: { ...prev.agents[agent], status },
      },
    }));
  }, []);

  const setProjectionWeeks = useCallback((weeks: number) => {
    setState(prev => ({
      ...prev,
      projectionWeeks: weeks,
      cashFlows: calculateNetCashFlow(prev.contracts, weeks, '2025-01-01'),
    }));
  }, []);

  const resetSimulation = useCallback(() => {
    setState({
      isRunning: false,
      speed: 1,
      projectionWeeks: 24,
      agents: createInitialAgentState(),
      contracts: [],
      actions: [],
      messages: [],
      transactions: [],
      cashFlows: calculateNetCashFlow([], 24),
    });
  }, []);

  // Simulation loop — only runs if manually started, no auto-fake actions
  useEffect(() => {
    if (!state.isRunning) return;
    const interval = 3000 / state.speed;
    intervalRef.current = setInterval(() => {
      const hasOpenTransaction = (stateRef.current?.transactions || []).some(t => t.status === 'open');
      if (hasOpenTransaction) {
        triggerTransactionEvent();
      }
      // No random fake agent actions — real events come from SSE streams
    }, interval);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [state.isRunning, state.speed, triggerTransactionEvent]);

  return {
    state,
    startSimulation,
    pauseSimulation,
    toggleSimulation,
    setSpeed,
    addContract,
    removeContract,
    updateAgentStatus,
    resetSimulation,
    triggerTransactionEvent,
    setProjectionWeeks,
  };
}
