/**
 * Worked examples for the membership labels (task 11.3).
 *
 * The generated claims arrive with `PlayerRow.property.test.tsx` (Property 16).
 * This file pins the concrete facts a reader wants stated rather than inferred
 * from a generator: the exact word each named role and state renders as, that the
 * guest label takes the role slot rather than joining it, that a guest states its
 * flag exactly once however the two fields arrive, and that an inactive row leads
 * with a dash glyph the screen reader does not announce.
 *
 * Requirements: 7.5, 7.6, 7.7, 7.8, 19.3
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  INACTIVE_GLYPH_SELECTOR,
  MEMBERSHIP_LABEL_KIND_ATTRIBUTE,
  MEMBERSHIP_LABEL_SELECTOR,
  MembershipLabels,
  type MembershipLabelsProps,
} from './MembershipLabels';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  FORMER_PLAYER_LABEL,
  GUEST_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';

/** A registered, active membership with every field carried. */
const propsOf = (
  overrides: Partial<MembershipLabelsProps> = {},
): MembershipLabelsProps => ({
  role: 'Member',
  state: 'Active',
  isGuest: false,
  isFormerPlayer: false,
  ...overrides,
});

/** The labels of a given kind, read structurally rather than by their wording. */
function labelsOfKind(container: HTMLElement, kind: string): readonly string[] {
  return [
    ...container.querySelectorAll(
      `[${MEMBERSHIP_LABEL_KIND_ATTRIBUTE}="${kind}"]`,
    ),
  ].map((label) => label.textContent ?? '');
}

describe('MembershipLabels', () => {
  // Requirements: 7.5, 19.3
  it('names each Member_Role in text', () => {
    const cases: readonly (readonly [SquadRole, string])[] = [
      ['Owner', OWNER_ROLE_LABEL],
      ['Admin', ADMIN_ROLE_LABEL],
      ['Member', MEMBER_ROLE_LABEL],
    ];

    for (const [role, label] of cases) {
      const { unmount } = render(<MembershipLabels {...propsOf({ role })} />);

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  // Requirements: 7.5, 19.3
  it('names each Membership_State in text', () => {
    const cases: readonly (readonly [MembershipState, string])[] = [
      ['Active', ACTIVE_STATE_LABEL],
      ['Inactive', INACTIVE_STATE_LABEL],
    ];

    for (const [state, label] of cases) {
      const { unmount } = render(<MembershipLabels {...propsOf({ state })} />);

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  // Requirements: 7.6
  it('renders the guest label in place of a role label for a guest carrying no role', () => {
    const { container } = render(
      <MembershipLabels {...propsOf({ role: null, isGuest: true })} />,
    );

    expect(screen.getByText(GUEST_LABEL)).toBeInTheDocument();
    // The guest label took the role slot, so no label names owner, admin, member,
    // or the recorded absence of a role.
    expect(labelsOfKind(container, 'role')).toEqual([]);
    expect(screen.queryByText(OWNER_ROLE_LABEL)).toBeNull();
    expect(screen.queryByText(ADMIN_ROLE_LABEL)).toBeNull();
    expect(screen.queryByText(MEMBER_ROLE_LABEL)).toBeNull();
    expect(screen.queryByText(NO_ROLE_RECORDED_LABEL)).toBeNull();
    // The state is still named.
    expect(screen.getByText(ACTIVE_STATE_LABEL)).toBeInTheDocument();
  });

  // Requirements: 7.5
  it('states the Guest_Flag exactly once when a guest also carries a role', () => {
    const { container } = render(
      <MembershipLabels {...propsOf({ role: 'Member', isGuest: true })} />,
    );

    expect(labelsOfKind(container, 'guest')).toEqual([GUEST_LABEL]);
    expect(labelsOfKind(container, 'role')).toEqual([MEMBER_ROLE_LABEL]);
  });

  // Requirements: 7.5
  it('states an absent role on a membership that is not a guest', () => {
    const { container } = render(
      <MembershipLabels {...propsOf({ role: null })} />,
    );

    expect(labelsOfKind(container, 'role')).toEqual([NO_ROLE_RECORDED_LABEL]);
    expect(labelsOfKind(container, 'guest')).toEqual([]);
  });

  // Requirements: 7.7, 19.3
  it('leads an inactive membership with a dash glyph beside the Inactive word', () => {
    const { container } = render(
      <MembershipLabels {...propsOf({ state: 'Inactive' })} />,
    );

    const glyph = container.querySelector(INACTIVE_GLYPH_SELECTOR);

    expect(glyph).not.toBeNull();
    expect(glyph?.textContent).toBe('\u2013');
    // The word carries the fact, so the glyph adds nothing for a screen reader.
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText(INACTIVE_STATE_LABEL)).toBeInTheDocument();
  });

  // Requirements: 7.7
  it('renders no glyph for an active membership', () => {
    const { container } = render(<MembershipLabels {...propsOf()} />);

    expect(container.querySelector(INACTIVE_GLYPH_SELECTOR)).toBeNull();
  });

  // Requirements: 7.8, 19.3
  it('names a Former_Player entry, and only where the row is one', () => {
    const { container, unmount } = render(
      <MembershipLabels {...propsOf({ isFormerPlayer: true })} />,
    );

    expect(labelsOfKind(container, 'former-player')).toEqual([
      FORMER_PLAYER_LABEL,
    ]);
    unmount();

    const plain = render(<MembershipLabels {...propsOf()} />);

    expect(labelsOfKind(plain.container, 'former-player')).toEqual([]);
  });

  // Requirements: 19.3
  it('states every fact in text, so nothing is carried by colour alone', () => {
    const { container } = render(
      <MembershipLabels
        {...propsOf({ role: null, state: 'Inactive', isGuest: true, isFormerPlayer: true })}
      />,
    );

    const texts = [...container.querySelectorAll(MEMBERSHIP_LABEL_SELECTOR)].map(
      (label) => label.textContent,
    );

    expect(texts).toEqual([GUEST_LABEL, INACTIVE_STATE_LABEL, FORMER_PLAYER_LABEL]);
    expect(texts.every((text) => (text ?? '').trim().length > 0)).toBe(true);
  });
});
