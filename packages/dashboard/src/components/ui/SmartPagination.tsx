import { useState, useMemo } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface SmartPaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Window size around current page when collapsed. */
  windowSize?: number;
  className?: string;
}

function buildRange(current: number, total: number, windowSize: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: Array<number | 'ellipsis'> = [];
  const left = Math.max(2, current - windowSize);
  const right = Math.min(total - 1, current + windowSize);

  items.push(1);
  if (left > 2) items.push('ellipsis');
  for (let i = left; i <= right; i++) items.push(i);
  if (right < total - 1) items.push('ellipsis');
  items.push(total);
  return items;
}

export function SmartPagination({
  page,
  totalPages,
  onPageChange,
  windowSize = 1,
  className,
}: SmartPaginationProps): JSX.Element {
  const [jumpTo, setJumpTo] = useState<string>('');
  const safeTotal = Math.max(1, totalPages);
  const safePage = Math.min(safeTotal, Math.max(1, page));
  const range = useMemo(
    () => buildRange(safePage, safeTotal, windowSize),
    [safePage, safeTotal, windowSize],
  );

  const goto = (n: number): void => {
    const next = Math.min(safeTotal, Math.max(1, n));
    onPageChange(next);
  };

  const submitJump = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const n = Number(jumpTo);
    if (Number.isFinite(n) && n > 0) goto(n);
    setJumpTo('');
  };

  const buttonClass = (active: boolean): string =>
    clsx(
      'h-8 min-w-[2rem] px-2 rounded-md text-sm font-medium transition-colors',
      active
        ? 'bg-primary text-white'
        : 'bg-surface text-text border border-border hover:bg-border/50',
    );

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={clsx('flex flex-wrap items-center gap-2', className)}
    >
      <button
        type="button"
        onClick={() => goto(1)}
        disabled={safePage <= 1}
        className={buttonClass(false) + ' flex items-center justify-center'}
        aria-label="First page"
      >
        <ChevronsLeft size={14} />
      </button>
      <button
        type="button"
        onClick={() => goto(safePage - 1)}
        disabled={safePage <= 1}
        className={buttonClass(false) + ' flex items-center justify-center'}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      <ul className="flex items-center gap-1">
        {range.map((it, idx) =>
          it === 'ellipsis' ? (
            <li key={`e-${idx}`} className="px-1 text-text-muted text-sm">
              …
            </li>
          ) : (
            <li key={it}>
              <button
                type="button"
                onClick={() => goto(it)}
                aria-current={it === safePage ? 'page' : undefined}
                className={buttonClass(it === safePage)}
              >
                {it}
              </button>
            </li>
          ),
        )}
      </ul>
      <button
        type="button"
        onClick={() => goto(safePage + 1)}
        disabled={safePage >= safeTotal}
        className={buttonClass(false) + ' flex items-center justify-center'}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
      <button
        type="button"
        onClick={() => goto(safeTotal)}
        disabled={safePage >= safeTotal}
        className={buttonClass(false) + ' flex items-center justify-center'}
        aria-label="Last page"
      >
        <ChevronsRight size={14} />
      </button>
      <form onSubmit={submitJump} className="flex items-center gap-1 ml-sm">
        <label htmlFor="jump-to" className="text-xs text-text-muted">
          Jump to
        </label>
        <input
          id="jump-to"
          type="number"
          min={1}
          max={safeTotal}
          value={jumpTo}
          onChange={(e) => setJumpTo(e.target.value)}
          className="h-8 w-16 rounded-md border border-border bg-surface text-text text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder={`${safePage}`}
        />
        <button
          type="submit"
          className="h-8 px-2 rounded-md bg-surface text-text border border-border hover:bg-border/50 text-sm"
        >
          Go
        </button>
      </form>
      <span className="text-xs text-text-muted">
        Page {safePage} of {safeTotal}
      </span>
    </nav>
  );
}

export default SmartPagination;