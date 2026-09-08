import clsx from 'clsx';

interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}

/**
 * AgentGuard logo — a shield with a stylized volcano motif inside.
 * Brand red (#E63946) with white negative space.
 */
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
        <path
          d="M16 2L4 7v9c0 7.18 4.94 13.9 12 14.5 7.06-.6 12-7.32 12-14.5V7L16 2z"
          fill="#E63946"
        />
        {/* Volcano triangle */}
        <path
          d="M16 8.5l-3.2 6.4h1.6l-2.4 4.8h3.2l-2 4h5.6l-2-4h3.2l-2.4-4.8h1.6L16 8.5z"
          fill="#fff"
        />
        {/* Lava dots */}
        <circle cx="13" cy="22.5" fill="#fff" r="0.9" />
        <circle cx="19" cy="22.5" fill="#fff" r="0.9" />
        <circle cx="16" cy="24" fill="#fff" r="0.9" />
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