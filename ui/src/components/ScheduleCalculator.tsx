import { useState, useEffect } from 'react';
import { 
  Contract, 
  PAMContract, 
  ANNContract, 
  ScheduleEntry,
  calculatePAMSchedule, 
  calculateANNSchedule,
  getTotalInterest,
  getTotalPayments,
} from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from './AnimatedNumber';
import { CheckCircle, Loader2 } from 'lucide-react';

interface ScheduleCalculatorProps {
  contract: Contract;
  className?: string;
}

interface CalculationStep {
  label: string;
  value: string;
  done: boolean;
}

export function ScheduleCalculator({ contract, className }: ScheduleCalculatorProps) {
  const [steps, setSteps] = useState<CalculationStep[]>([]);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    calculateSchedule();
  }, [contract]);

  const calculateSchedule = async () => {
    setCalculating(true);
    setProgress(0);
    setSchedule([]);
    
    const newSteps: CalculationStep[] = [];
    
    // Step 1: Parse parameters
    if (contract.type === 'PAM') {
      const pam = contract as PAMContract;
      newSteps.push({ label: 'Principal', value: `$${pam.principal.toLocaleString()}`, done: false });
      newSteps.push({ label: 'Rate', value: `${pam.rate}% annual`, done: false });
      newSteps.push({ label: 'Maturity', value: pam.maturity, done: false });
    } else {
      const ann = contract as ANNContract;
      newSteps.push({ label: 'Loan Amount', value: `$${ann.loanAmount.toLocaleString()}`, done: false });
      newSteps.push({ label: 'Rate', value: `${ann.rate}% annual`, done: false });
      newSteps.push({ label: 'Periods', value: `${ann.periods} ${ann.frequency}`, done: false });
    }
    
    setSteps([...newSteps]);
    
    // Animate steps
    for (let i = 0; i < newSteps.length; i++) {
      await new Promise(r => setTimeout(r, 200));
      newSteps[i].done = true;
      setSteps([...newSteps]);
      setProgress((i + 1) / (newSteps.length + 2) * 100);
    }
    
    // Calculate schedule
    await new Promise(r => setTimeout(r, 300));
    
    let result: ScheduleEntry[];
    if (contract.type === 'PAM') {
      result = calculatePAMSchedule(contract as PAMContract);
    } else {
      result = calculateANNSchedule(contract as ANNContract);
    }
    
    // Add calculation result step
    const totalInterest = getTotalInterest(contract);
    const totalPayments = getTotalPayments(contract);
    
    newSteps.push({ label: 'Interest', value: `$${totalInterest.toLocaleString()}`, done: false });
    setSteps([...newSteps]);
    
    await new Promise(r => setTimeout(r, 200));
    newSteps[newSteps.length - 1].done = true;
    setProgress(90);
    setSteps([...newSteps]);
    
    newSteps.push({ label: 'Schedule', value: `${result.length} payments`, done: false });
    setSteps([...newSteps]);
    
    await new Promise(r => setTimeout(r, 200));
    newSteps[newSteps.length - 1].done = true;
    setProgress(100);
    setSteps([...newSteps]);
    
    setSchedule(result);
    setCalculating(false);
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Calculation Progress */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-sm">
            Calculating {contract.type} Schedule...
          </h4>
          <span className="text-xs text-muted-foreground font-mono">
            {progress.toFixed(0)}%
          </span>
        </div>
        
        <div className="h-1 bg-muted rounded-full overflow-hidden mb-4">
          <div 
            className="h-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        <div className="space-y-2">
          {steps.map((step, i) => (
            <div 
              key={i}
              className={cn(
                'flex items-center justify-between text-sm',
                'animate-fade-in',
              )}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="flex items-center gap-2">
                {step.done ? (
                  <CheckCircle size={14} className="text-success" />
                ) : (
                  <Loader2 size={14} className="text-muted-foreground animate-spin" />
                )}
                <span className="text-muted-foreground">{step.label}:</span>
              </div>
              <span className="font-mono text-foreground">{step.value}</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Schedule Table */}
      {schedule.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h4 className="font-medium text-sm">Amortization Schedule</h4>
            <p className="text-xs text-muted-foreground mt-1">
              {contract.type === 'PAM' 
                ? 'Quarterly interest payments with bullet principal'
                : 'Equal installments with amortizing principal'}
            </p>
          </div>
          <div className="max-h-[300px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 sticky top-0">
                <tr>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">#</th>
                  <th className="text-left py-2 px-4 text-muted-foreground font-medium">Date</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Principal</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Interest</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Payment</th>
                  <th className="text-right py-2 px-4 text-muted-foreground font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((entry, i) => (
                  <tr 
                    key={i}
                    className={cn(
                      'border-b border-border/30 animate-fade-in',
                      entry.balance === 0 && 'bg-success/10',
                    )}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <td className="py-2 px-4 text-muted-foreground">{entry.period}</td>
                    <td className="py-2 px-4 font-mono text-xs">{entry.date}</td>
                    <td className="py-2 px-4 text-right font-mono">
                      ${entry.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 px-4 text-right font-mono text-chart-payable">
                      ${entry.interest.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 px-4 text-right font-mono font-semibold">
                      ${entry.payment.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="py-2 px-4 text-right font-mono">
                      ${entry.balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
