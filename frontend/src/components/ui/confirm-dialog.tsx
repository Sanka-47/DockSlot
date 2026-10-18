import React, { useEffect } from 'react';
import { AlertTriangle, HelpCircle, X } from 'lucide-react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A small accessible confirmation modal used as a styled replacement for
 * `window.confirm`. Closes on backdrop click or Escape unless it is busy.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  isLoading = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLoading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={() => {
        if (!isLoading) onCancel();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 bg-[#2F4F4F] text-white flex items-center justify-between">
          <h3 id="confirm-dialog-title" className="text-sm font-bold flex items-center space-x-2">
            {isDanger ? (
              <AlertTriangle className="w-4 h-4 text-red-400" />
            ) : (
              <HelpCircle className="w-4 h-4 text-emerald-400" />
            )}
            <span>{title}</span>
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="text-gray-300 hover:text-white disabled:opacity-50"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 text-xs text-gray-700 leading-relaxed">{message}</div>

        <div className="px-6 pb-6 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${
              isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#2F4F4F] hover:bg-[#1E3333]'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
