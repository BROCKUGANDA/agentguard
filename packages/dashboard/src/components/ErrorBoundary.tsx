import { useEffect } from 'react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return <DefaultFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center min-h-[280px] p-lg text-center">
      <div className="rounded-full bg-error/10 p-3 mb-md">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-error">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-text">Something went wrong</h2>
      <p className="text-sm text-text-muted mt-1 max-w-md">
        {error.message || 'An unexpected error occurred while rendering this section.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-md h-10 px-4 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
      >
        Try again
      </button>
    </div>
  );
}

interface AsyncBoundaryProps {
  query: { isError: boolean; error: unknown; refetch: () => void; isLoading: boolean };
  children: ReactNode;
}

export function AsyncBoundary({ query, children }: AsyncBoundaryProps): JSX.Element {
  useEffect(() => {
    // No-op; just ensures children re-render when query state changes.
  }, [query.isError, query.isLoading]);
  if (query.isError) {
    const err = query.error instanceof Error ? query.error : new Error(String(query.error));
    return <DefaultFallback error={err} reset={() => query.refetch()} />;
  }
  return <>{children}</>;
}

export default ErrorBoundary;