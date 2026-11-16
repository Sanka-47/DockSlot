import React from 'react';
import { LoadingState } from './LoadingState';

export const PageLoadingFallback: React.FC = () => (
  <div className="min-h-screen bg-[#D9D9D9] flex items-center justify-center">
    <LoadingState message="Loading DockSlot..." />
  </div>
);

export default PageLoadingFallback;
