import clsx from 'clsx';

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

export function Logo({ size = 28, showWordmark = true, className }: LogoProps): JSX.Element {
  return (
    <div className={clsx('inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="AgentGuard logo"
        role="img"
      >
        <defs>
          <linearGradient id="logoShield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#991b1b" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="6" fill="#0f172a" />
        <path
          d="M16 4 L7 7 L7 15 C7 20 10 24 16 25 C22 24 25 20 25 15 L25 7 Z"
          fill="url(#logoShield)"
        />
        <path
          d="M12 13 L12 10 A4 4 0 0 1 20 10 L20 13"
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
        />
        <rect x="10" y="13" width="12" height="9" rx="1.5" fill="#fff" />
        <circle cx="16" cy="17" r="1.5" fill="#dc2626" />
      </svg>
      {showWordmark && (
        <span
          className="font-display font-semibold text-text tracking-tight"
          style={{ fontSize: size * 0.66 }}
        >
          AgentGuard
        </span>
      )}
    </div>
  );
}

export default Logo;