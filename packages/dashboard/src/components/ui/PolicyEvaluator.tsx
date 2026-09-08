import clsx from 'clsx';

interface PolicyEvaluatorProps {
  policyName: string;
  /** 0..1 — fraction of policies evaluated successfully. */
  value: number;
  /** 0..1 — fraction of deny decisions. */
  denyRatio?: number;
  size?: number;
  thickness?: number;
  className?: string;
  /** Display additional metric below the ring. */
  detail?: string;
}

export function PolicyEvaluator({
  policyName,
  value,
  denyRatio = 0,
  size = 96,
  thickness = 8,
  className,
  detail,
}: PolicyEvaluatorProps): JSX.Element {
  const clamped = Math.max(0, Math.min(1, value));
  const denyClamped = Math.max(0, Math.min(1, denyRatio));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  // Color the ring based on deny ratio — green when low, red when high.
  const ringColor =
    denyClamped > 0.4
      ? 'var(--color-blocked)'
      : denyClamped > 0.2
        ? 'var(--color-pending)'
        : 'var(--color-secure)';

  return (
    <div className={clsx('inline-flex flex-col items-center gap-2', className)}>
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={thickness}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 600ms ease-out, stroke 300ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-mono text-sm font-semibold text-text"
            aria-label="Evaluation rate"
          >
            {Math.round(clamped * 100)}%
          </span>
          <span className="text-[10px] uppercase tracking-wider text-text-muted">
            evaluated
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold text-text truncate max-w-[160px]" title={policyName}>
          {policyName}
        </div>
        {detail && (
          <div className="text-xs text-text-muted font-mono mt-0.5">{detail}</div>
        )}
      </div>
    </div>
  );
}

export default PolicyEvaluator;