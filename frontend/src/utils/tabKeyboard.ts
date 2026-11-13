import type React from 'react';

/**
 * Keyboard support for ARIA tab lists that use roving tabindex.
 * Arrow keys move between tabs, Home/End jump to the first/last tab, and the
 * newly focused tab is activated by clicking it.
 */
export function handleTabListKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
  const tabElements = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  );
  const currentIndex = tabElements.indexOf(event.target as HTMLButtonElement);
  if (currentIndex === -1) return;

  let nextIndex: number | null = null;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      nextIndex = (currentIndex + 1) % tabElements.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = tabElements.length - 1;
      break;
    default:
      return;
  }

  if (nextIndex === null || !tabElements[nextIndex]) return;
  event.preventDefault();
  tabElements[nextIndex].focus();
  tabElements[nextIndex].click();
}

export default handleTabListKeyDown;
