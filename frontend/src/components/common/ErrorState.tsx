import React from 'react';

export interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'An unexpected error occurred.',
  onRetry,
}) => {
  return (
    <div role="alert" className="flex flex-col items-center justify-center p-8 text-center text-red-600">
      <p className="text-sm font-medium mb-3">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded hover:bg-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          Try Again
        </button>
      )}
    </div>
  );
};

export default ErrorState;
