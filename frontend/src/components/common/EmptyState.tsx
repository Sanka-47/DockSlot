import React from 'react';

export interface EmptyStateProps {
  title?: string;
  description?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No data available',
  description = 'There are no items to display at this time.',
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
      <h3 className="text-base font-semibold text-gray-700">{title}</h3>
      <p className="text-sm mt-1">{description}</p>
    </div>
  );
};

export default EmptyState;
