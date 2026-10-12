import React from 'react';

export const Navbar: React.FC = () => {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <span className="text-xl font-bold text-blue-600">DockSlot</span>
      </div>
      <div className="flex items-center space-x-4">
        {/* User profile / actions placeholder */}
      </div>
    </header>
  );
};

export default Navbar;
