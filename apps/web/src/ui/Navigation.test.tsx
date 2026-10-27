/**
 * The routed tab bar and the row actions menu.
 *
 * TabNav: every tab is the caller's own link inside one navigation landmark, and
 * exactly the active one is marked `aria-current="page"` and underlined.
 *
 * ActionsMenu: a disclosure named by its label, closed until activated; its panel
 * holds the caller's controls in the Tab order; Escape and an outside press close
 * it, Escape returning focus to the trigger — but an Escape something inside the
 * panel handled first (an open confirmation) leaves it open.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KeyboardEvent } from 'react';
import { describe, expect, it } from 'vitest';

import { ActionsMenu, TabNav } from '.';

describe('TabNav', () => {
  it('renders each tab as the caller link, marking only the active one current', () => {
    render(
      <TabNav
        label="Squad sections"
        active="matches"
        tabs={[
          { id: 'players', label: 'Players', count: 11 },
          { id: 'matches', label: 'Matches' },
          { id: 'admin', label: 'Admin', icon: 'shield' },
        ]}
        renderLink={({ tab, className, current, children }) => (
          <a href={`/${tab.id}`} className={className} aria-current={current}>
            {children}
          </a>
        )}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Squad sections' });
    const links = Array.from(nav.querySelectorAll('a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/players', '/matches', '/admin']);
    expect(screen.getByRole('link', { name: 'Players 11' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Matches' })).toHaveClass('pm-tab', 'is-active');
    expect(screen.getByRole('link', { name: 'Admin' })).not.toHaveClass('is-active');
  });
});

describe('ActionsMenu', () => {
  it('opens on activation, showing the controls, and closes on Escape with focus back on the trigger', async () => {
    const user = userEvent.setup();
    render(
      <ActionsMenu label="Actions for Player 1">
        <button type="button">Make admin</button>
        <button type="button">Remove from squad</button>
      </ActionsMenu>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Player 1' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Make admin' })).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Actions for Player 1' })).toContainElement(
      screen.getByRole('button', { name: 'Remove from squad' }),
    );

    await user.tab();
    expect(screen.getByRole('button', { name: 'Make admin' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes on a press outside, and stays open for an Escape handled inside', async () => {
    const user = userEvent.setup();
    const stopEscape = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    render(
      <>
        <ActionsMenu label="Actions for Player 2">
          <div onKeyDown={stopEscape}>
            <button type="button">Cancel the confirmation</button>
          </div>
        </ActionsMenu>
        <p>Elsewhere</p>
      </>,
    );

    const trigger = screen.getByRole('button', { name: 'Actions for Player 2' });
    await user.click(trigger);
    screen.getByRole('button', { name: 'Cancel the confirmation' }).focus();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.pointerDown(screen.getByText('Elsewhere'));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
