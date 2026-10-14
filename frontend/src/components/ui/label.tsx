import React from 'react';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export const Label: React.FC<LabelProps> = ({
  className = '',
  required = false,
  children,
  ...props
}) => (
  <label
    className={`block text-xs font-semibold uppercase tracking-wider text-gray-700 mb-1.5 ${className}`}
    {...props}
  >
    {children}
    {required && <span className="text-red-500 ml-1">*</span>}
  </label>
);

export default Label;
