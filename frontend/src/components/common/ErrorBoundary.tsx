import React from 'react';
import { RefreshCw } from 'lucide-react';
import { ErrorState } from './ErrorState';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Optional custom fallback. The default fallback offers retry and reload. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches unhandled errors thrown while rendering the React tree and shows a
 * recoverable fallback instead of leaving the user with a blank screen.
 *
 * Note: error boundaries do not catch event-handler, async, or effect errors.
 * Those continue to be handled by the calling code (banners / toasts).
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Unhandled UI error:', error, errorInfo);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-[#D9D9D9] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-8 text-center shadow-lg">
            <h1 className="text-lg font-bold text-[#2F4F4F]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              DockSlot hit an unexpected error while rendering this page.
            </p>

            <ErrorState
              message={
                import.meta.env.DEV && this.state.error?.message
                  ? this.state.error.message
                  : undefined
              }
              onRetry={this.handleRetry}
            />

            <button
              type="button"
              onClick={this.handleReload}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-xs font-semibold text-[#2F4F4F] transition-colors hover:bg-gray-50"
            >
              <RefreshCw className="h-4 w-4" />
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
