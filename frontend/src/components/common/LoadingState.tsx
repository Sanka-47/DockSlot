import React from 'react';

export interface LoadingStateProps {
  message?: string;
  className?: string;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  className = '',
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`flex flex-col items-center justify-center p-8 text-[#2F4F4F] ${className}`}
    >
      <div
        aria-hidden="true"
        className="w-8 h-8 border-4 border-[#2F4F4F] border-t-transparent rounded-full animate-spin mb-3"
      />
      <p className="text-sm font-medium">{message}</p>
    </div>
  );
};

export default LoadingState;
