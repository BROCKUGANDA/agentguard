import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '../ui/Card';

interface KPICardProps {
  label: string;
  value: string | number;
  delta?: number;
  deltaLabel?: string;
  tone?: 'success' | 'warning' | 'error' | 'info' | 'primary' | 'neutral';
  icon?: JSX.Element;
  loading?: boolean;
}

const TONE: Record<NonNullable<KPICardProps['tone']>, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  primary: 'text-primary',
  neutral: 'text-text',
};

export function KPICard({
  label,
  value,
  delta,
  deltaLabel,
  tone = 'neutral',
  icon,
  loading = false,
}: KPICardProps): JSX.Element {
  const positive = delta != null && delta >= 0;
  return (
    <Card className="flex items-start justify-between gap-md">
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-text-muted font-medium">
          {label}
        </div>
        {loading ? (
          <div className="mt-2 h-7 w-24 rounded-sm ag-shimmer" />
        ) : (
          <div className={clsx('mt-1 text-3xl font-semibold font-mono', TONE[tone])}>
            {value}
          </div>
        )}
        {delta != null && (
          <div className="mt-1 flex items-center gap-1 text-xs">
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 font-medium',
                positive ? 'text-success' : 'text-error',
              )}
            >
              {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {Math.abs(delta)}%
            </span>
            {deltaLabel && <span className="text-text-muted">{deltaLabel}</span>}
          </div>
        )}
      </div>
      {icon && (
        <div
          className={clsx(
            'shrink-0 rounded-md p-2 bg-border/40',
            TONE[tone],
          )}
        >
          {icon}
        </div>
      )}
    </Card>
  );
}

export default KPICard;