import clsx from 'clsx';
import type { AgentState } from '../../lib/types';

interface AgentStatusDotProps {
  state: AgentState;
  size?: number;
  className?: string;
  label?: boolean;
}

const STATE_COLOR: Record<AgentState, string> = {
  idle: 'var(--color-text-muted)',
  thinking: 'var(--color-info)',
  acting: 'var(--color-warning)',
  blocked: 'var(--color-blocked)',
};

const STATE_LABEL: Record<AgentState, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  acting: 'Acting',
  blocked: 'Blocked',
};

export function AgentStatusDot({
  state,
  size = 12,
  className,
  label = false,
}: AgentStatusDotProps): JSX.Element {
  const color = STATE_COLOR[state];
  return (
    <span className={clsx('inline-flex items-center gap-1.5', className)}>
      <span
        className={clsx(
          'relative inline-flex items-center justify-center rounded-full',
          state === 'thinking' && 'ag-agent-think',
          state === 'acting' && 'ag-agent-think',
          state === 'blocked' && 'ag-agent-shake',
        )}
        style={{ width: size, height: size }}
        aria-label={`Agent state: ${STATE_LABEL[state]}`}
        role="img"
      >
        <span
          className="rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            boxShadow:
              state === 'blocked'
                ? `0 0 0 3px ${color}33`
                : `0 0 0 2px ${color}22`,
          }}
        />
        {(state === 'thinking' || state === 'acting') && (
          <span
            className="absolute inset-0 rounded-full"
            style={{
              border: `1.5px solid ${color}`,
              animation:
                state === 'thinking'
                  ? 'agent-think 1.5s ease-in-out infinite'
                  : 'agent-think 0.8s ease-in-out infinite',
              opacity: 0.5,
            }}
          />
        )}
      </span>
      {label && (
        <span className="text-xs font-medium" style={{ color }}>
          {STATE_LABEL[state]}
        </span>
      )}
    </span>
  );
}

export default AgentStatusDot;