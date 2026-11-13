import React from 'react';

export interface LoadingStateProps {
  message?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading...' }) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex flex-col items-center justify-center p-8 text-gray-500"
    >
      <div
        aria-hidden="true"
        className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"
      />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
};

export default LoadingState;
