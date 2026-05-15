import { useCountUp, formatCurrency, formatNumber, formatPercent } from '@/hooks/useCountUp';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: number;
  format?: 'currency' | 'number' | 'percent';
  decimals?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({
  value,
  format = 'number',
  decimals = 0,
  duration = 1000,
  className,
  prefix = '',
  suffix = '',
}: AnimatedNumberProps) {
  const animatedValue = useCountUp({
    end: value,
    duration,
    decimals: format === 'percent' ? 1 : decimals,
  });

  let displayValue: string;
  switch (format) {
    case 'currency':
      displayValue = formatCurrency(animatedValue);
      break;
    case 'percent':
      displayValue = formatPercent(animatedValue, decimals);
      break;
    default:
      displayValue = formatNumber(animatedValue);
  }

  return (
    <span className={cn('number-display tabular-nums', className)}>
      {prefix}{displayValue}{suffix}
    </span>
  );
}
