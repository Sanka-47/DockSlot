import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let bodyLockCount = 0;
let originalBodyOverflow = '';
const dialogStack: HTMLElement[] = [];

function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (bodyLockCount === 0) {
    originalBodyOverflow = document.body.style.overflow;
  }
  bodyLockCount += 1;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = originalBodyOverflow;
  }
}

function isVisible(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  return element.getClientRects().length > 0;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && isVisible(element)
  );
}

export interface UseDialogA11yOptions {
  /** Whether the dialog is currently mounted/open. */
  isOpen: boolean;
  /** Called when Escape is pressed, unless `closeOnEscape` is false. */
  onClose?: () => void;
  /** Disable Escape handling for destructive/busy states. */
  closeOnEscape?: boolean;
}

/**
 * Shared modal/dialog accessibility behavior:
 * - moves focus into the dialog when it opens,
 * - traps Tab/Shift+Tab inside it,
 * - closes on Escape,
 * - restores focus to the trigger on close,
 * - locks background scrolling while one or more dialogs are open.
 *
 * Attach the returned ref and `tabIndex={-1}` to the dialog element. Mark the
 * preferred initial control with `data-autofocus`.
 */
export function useDialogA11y<T extends HTMLElement = HTMLDivElement>({
  isOpen,
  onClose,
  closeOnEscape = true,
}: UseDialogA11yOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeOnEscapeRef = useRef(closeOnEscape);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnEscape]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const preferred = dialog.querySelector<HTMLElement>('[data-autofocus]');
      const target =
        (preferred && isVisible(preferred) ? preferred : getFocusableElements(dialog)[0]) ?? dialog;
      target.focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only the topmost open dialog handles keyboard interaction. This keeps
      // nested dialogs (for example a confirm prompt inside a settings modal)
      // from closing their parent when Escape is pressed.
      if (dialogStack[dialogStack.length - 1] !== dialog) return;

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    dialogStack.push(dialog);
    lockBodyScroll();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = dialogStack.lastIndexOf(dialog);
      if (stackIndex !== -1) dialogStack.splice(stackIndex, 1);
      unlockBodyScroll();

      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  return dialogRef;
}

export default useDialogA11y;
