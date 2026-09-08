import { type HTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';
import type { Decision, Severity } from '../../lib/types';

export type BadgeTone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'primary'
  | 'secure'
  | 'blocked'
  | 'pending'
  | 'critical';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  outline?: boolean;
}

const TONE: Record<BadgeTone, { solid: string; outline: string }> = {
  neutral: {
    solid: 'bg-border text-text',
    outline: 'border border-border text-text-muted',
  },
  success: {
    solid: 'bg-success/15 text-success',
    outline: 'border border-success/40 text-success',
  },
  warning: {
    solid: 'bg-warning/15 text-warning',
    outline: 'border border-warning/40 text-warning',
  },
  error: {
    solid: 'bg-error/15 text-error',
    outline: 'border border-error/40 text-error',
  },
  info: {
    solid: 'bg-secondary/15 text-secondary',
    outline: 'border border-secondary/40 text-secondary',
  },
  primary: {
    solid: 'bg-primary/15 text-primary',
    outline: 'border border-primary/40 text-primary',
  },
  secure: {
    solid: 'bg-secure/15 text-secure',
    outline: 'border border-secure/40 text-secure',
  },
  blocked: {
    solid: 'bg-blocked/15 text-blocked',
    outline: 'border border-blocked/40 text-blocked',
  },
  pending: {
    solid: 'bg-pending/15 text-pending',
    outline: 'border border-pending/40 text-pending',
  },
  critical: {
    solid: 'bg-primary/20 text-primary',
    outline: 'border border-primary/50 text-primary',
  },
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'sm', outline, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'h-5 px-2 text-xs' : 'h-6 px-2.5 text-xs',
        outline ? TONE[tone].outline : TONE[tone].solid,
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
});

export function decisionToTone(d: Decision): BadgeTone {
  switch (d) {
    case 'allow':
      return 'success';
    case 'deny':
      return 'error';
    case 'pending':
      return 'warning';
    case 'error':
      return 'blocked';
    default:
      return 'neutral';
  }
}

export function severityToTone(s: Severity): BadgeTone {
  switch (s) {
    case 'critical':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

export default Badge;