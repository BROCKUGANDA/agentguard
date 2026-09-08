import clsx from 'clsx';

interface SkeletonProps {
  variant?: 'line' | 'block' | 'circle';
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({
  variant = 'line',
  width,
  height,
  className,
}: SkeletonProps): JSX.Element {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };
  return (
    <div
      role="status"
      aria-label="loading"
      className={clsx(
        'ag-shimmer bg-surface rounded-sm',
        variant === 'circle' && 'rounded-full',
        variant === 'block' && 'rounded-md',
        variant === 'line' && 'rounded-sm h-3',
        className,
      )}
      style={style}
    />
  );
}

export default Skeleton;