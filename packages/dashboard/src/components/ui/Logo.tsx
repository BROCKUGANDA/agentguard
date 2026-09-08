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
          <linearGradient id="lg-s" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4757" />
            <stop offset="50%" stopColor="#E63946" />
            <stop offset="100%" stopColor="#c1121f" />
          </linearGradient>
          <radialGradient id="lg-lava" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fff3b0" />
            <stop offset="40%" stopColor="#ffb74d" />
            <stop offset="100%" stopColor="#ff6b35" />
          </radialGradient>
        </defs>
        <path d="M16 2L4 7v9c0 7.18 4.94 13.9 12 14.5 7.06-.6 12-7.32 12-14.5V7L16 2z" fill="url(#lg-s)" />
        <path d="M16 2L4 7v9c0 7.18 4.94 13.9 12 14.5 7.06-.6 12-7.32 12-14.5V7L16 2z" fill="none" stroke="#fff" strokeWidth="0.3" strokeOpacity="0.25" />
        <path d="M16 7.5l-3.8 7.2h2l-2.8 5.4h3.6l-2.2 4.4h6.4l-2.2-4.4h3.6l-2.8-5.4h2L16 7.5z" fill="#fff" />
        <circle cx="12.5" cy="23" r="1" fill="url(#lg-lava)" />
        <circle cx="19.5" cy="23" r="1" fill="url(#lg-lava)" />
        <circle cx="16" cy="25" r="1.1" fill="url(#lg-lava)" />
        <circle cx="16" cy="25" r="0.4" fill="#fff3b0" opacity="0.9" />
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
