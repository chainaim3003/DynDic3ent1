import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Play, Pause, FastForward, SkipForward } from 'lucide-react';

interface SimulationControlsProps {
  isRunning: boolean;
  speed: number;
  onToggle: () => void;
  onSpeedChange: (speed: number) => void;
  className?: string;
}

export function SimulationControls({
  isRunning,
  speed,
  onToggle,
  onSpeedChange,
  className,
}: SimulationControlsProps) {
  const speeds = [1, 5, 10];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        onClick={onToggle}
        variant={isRunning ? 'secondary' : 'default'}
        size="sm"
        className={cn(
          'gap-2 transition-all',
          isRunning && 'bg-chart-payable/20 text-chart-payable hover:bg-chart-payable/30',
        )}
      >
        {isRunning ? (
          <>
            <Pause size={16} />
            Pause
          </>
        ) : (
          <>
            <Play size={16} />
            Start Simulation
          </>
        )}
      </Button>

      <div className="flex items-center bg-muted rounded-lg p-1">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => onSpeedChange(s)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded transition-all',
              speed === s
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s}x
          </button>
        ))}
      </div>
    </div>
  );
}
