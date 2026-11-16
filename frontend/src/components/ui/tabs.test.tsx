import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tabs } from './tabs';

const tabs = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
];

function TabsHarness() {
  const [activeTab, setActiveTab] = useState('one');

  return (
    <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} ariaLabel="Test sections" />
  );
}

describe('Tabs', () => {
  it('exposes the selected tab through ARIA state and roving tabindex', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    const first = screen.getByRole('tab', { name: 'One' });
    const second = screen.getByRole('tab', { name: 'Two' });

    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(second).toHaveAttribute('aria-selected', 'false');
    expect(second).toHaveAttribute('tabindex', '-1');

    await user.click(second);

    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveAttribute('aria-selected', 'false');
  });

  it('supports arrow-key navigation and Home/End activation', async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);

    const first = screen.getByRole('tab', { name: 'One' });
    const second = screen.getByRole('tab', { name: 'Two' });
    const third = screen.getByRole('tab', { name: 'Three' });

    first.focus();
    await user.keyboard('{ArrowRight}');
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    expect(third).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-selected', 'true');
  });
});
