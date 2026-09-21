/**
 * Worked examples for the Squad_Card (task 10.1).
 *
 * The generated claims live in `SquadCard.property.test.tsx` (labelling) and
 * `SquadCard.navigation.property.test.tsx` (activation). This file pins the
 * concrete facts a reader wants stated rather than inferred from a generator: the
 * exact word each named role and state renders as, that an absent role or state
 * replaces its label instead of adding one, that the card is a single button whose
 * accessible name carries the squad name, and that each of pointer, Enter, and
 * Space opens exactly the card's own squad.
 *
 * Requirements: 1.5, 1.6, 1.7, 1.8, 1.14, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SQUAD_CARD_SELECTOR, SquadCard } from './SquadCard';
import type { SquadSummary } from '../lib/parse/squadSummary';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/** A parsed summary with every field carried. */
const summaryOf = (overrides: Partial<SquadSummary> = {}): SquadSummary => ({
  squadId: SQUAD_ID,
  name: 'Thursday Ballers',
  role: 'owner',
  state: 'active',
  ...overrides,
});

describe('SquadCard', () => {
  // Requirements: 1.5, 1.14
  it('renders one control whose accessible name carries the squad name', () => {
    const { container } = render(
      <SquadCard summary={summaryOf()} onOpen={vi.fn()} />,
    );

    expect(container.querySelectorAll(SQUAD_CARD_SELECTOR)).toHaveLength(1);

    const card = screen.getByRole('button');
    expect(card).toHaveAccessibleName(expect.stringContaining('Thursday Ballers'));
  });

  // Requirements: 1.5, 19.3
  it('names each Member_Role in text', () => {
    const cases: readonly (readonly [SquadSummary['role'], string])[] = [
      ['owner', OWNER_ROLE_LABEL],
      ['admin', ADMIN_ROLE_LABEL],
      ['member', MEMBER_ROLE_LABEL],
    ];

    for (const [role, label] of cases) {
      const { unmount } = render(
        <SquadCard summary={summaryOf({ role })} onOpen={vi.fn()} />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  // Requirements: 1.5, 19.3
  it('names each Membership_State in text', () => {
    const cases: readonly (readonly [SquadSummary['state'], string])[] = [
      ['active', ACTIVE_STATE_LABEL],
      ['inactive', INACTIVE_STATE_LABEL],
    ];

    for (const [state, label] of cases) {
      const { unmount } = render(
        <SquadCard summary={summaryOf({ state })} onOpen={vi.fn()} />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  // Requirements: 1.6
  it('states an absent role and names no role in its place', () => {
    render(<SquadCard summary={summaryOf({ role: null })} onOpen={vi.fn()} />);

    expect(screen.getByText(NO_ROLE_RECORDED_LABEL)).toBeInTheDocument();
    // The absence replaces the role label rather than sitting beside one, so no
    // card names owner, admin, or member for a role the read model never carried.
    expect(screen.queryByText(OWNER_ROLE_LABEL)).toBeNull();
    expect(screen.queryByText(ADMIN_ROLE_LABEL)).toBeNull();
    expect(screen.queryByText(MEMBER_ROLE_LABEL)).toBeNull();
    // The state was carried, so it is still named.
    expect(screen.getByText(ACTIVE_STATE_LABEL)).toBeInTheDocument();
  });

  // Requirements: 1.7
  it('states an absent membership state and names no state in its place', () => {
    render(<SquadCard summary={summaryOf({ state: null })} onOpen={vi.fn()} />);

    expect(
      screen.getByText(NO_MEMBERSHIP_STATE_RECORDED_LABEL),
    ).toBeInTheDocument();
    expect(screen.queryByText(ACTIVE_STATE_LABEL)).toBeNull();
    expect(screen.queryByText(INACTIVE_STATE_LABEL)).toBeNull();
    expect(screen.getByText(OWNER_ROLE_LABEL)).toBeInTheDocument();
  });

  // Requirements: 1.6, 1.7
  it('states both absences on a summary carrying neither', () => {
    render(
      <SquadCard
        summary={summaryOf({ role: null, state: null })}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole('button');
    expect(card).toHaveAccessibleName(
      expect.stringContaining(NO_ROLE_RECORDED_LABEL),
    );
    expect(card).toHaveAccessibleName(
      expect.stringContaining(NO_MEMBERSHIP_STATE_RECORDED_LABEL),
    );
  });

  // Requirements: 1.8
  it('opens its own squad on pointer activation, Enter, and Space', async () => {
    const activations: readonly {
      readonly name: string;
      readonly activate: (card: HTMLElement) => Promise<void>;
    }[] = [
      {
        name: 'pointer',
        activate: async (card) => {
          await userEvent.click(card);
        },
      },
      {
        name: 'Enter',
        activate: async (card) => {
          card.focus();
          await userEvent.keyboard('{Enter}');
        },
      },
      {
        name: 'Space',
        activate: async (card) => {
          card.focus();
          await userEvent.keyboard(' ');
        },
      },
    ];

    for (const { name, activate } of activations) {
      const onOpen = vi.fn();
      const { unmount } = render(
        <SquadCard summary={summaryOf()} onOpen={onOpen} />,
      );

      await activate(screen.getByRole('button'));

      expect(onOpen, `${name} must open the squad exactly once`).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(SQUAD_ID);
      unmount();
    }
  });

  // Requirements: 1.8
  it('carries no href, so activation cannot reload the document', () => {
    const { container } = render(
      <SquadCard summary={summaryOf()} onOpen={vi.fn()} />,
    );

    const card = container.querySelector(SQUAD_CARD_SELECTOR);
    expect(card?.tagName).toBe('BUTTON');
    expect(card?.getAttribute('type')).toBe('button');
    expect(card?.hasAttribute('href')).toBe(false);
    expect(container.querySelector('a')).toBeNull();
  });
});
