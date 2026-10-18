import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../components/ui/confirm-dialog';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
}

/**
 * Promise-based replacement for `window.confirm`.
 *
 * Usage:
 *   const { confirm, dialog } = useConfirm();
 *   ...
 *   const ok = await confirm({ title: 'Delete?', message: '...', variant: 'danger' });
 *   if (!ok) return;
 *   ...
 *   return (<div>...{dialog}</div>);
 *
 * Render `dialog` once anywhere in the component's tree.
 */
export const useConfirm = () => {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    setOptions(null);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const dialog = options ? (
    <ConfirmDialog
      isOpen
      title={options.title}
      message={options.message}
      confirmLabel={options.confirmLabel}
      cancelLabel={options.cancelLabel}
      variant={options.variant}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, dialog };
};

export default useConfirm;
