/**
 * Unit tests for the identity header.
 *
 * The header answers "whose stats am I looking at, what kind of membership is
 * this, and what do these figures count", so these tests pin each clause of
 * Requirement 5 that is observable in this component:
 *
 *   - exactly one level-one heading, carrying the Player_Display_Name byte for
 *     byte as parsed (5.1),
 *   - a text label naming the Membership_State (5.2), or stating that none is
 *     recorded while naming neither state (5.3),
 *   - a guest label where the Guest_Flag is set, and no change to anything else
 *     (5.4),
 *   - the Former_Player label where the name is the Anonymised_Placeholder, with
 *     the name still rendered as parsed (5.5),
 *   - the squad-scope statement in every condition (5.6),
 *   - and **no control at all**, for every profile (5.5).
 *
 * The state cases are driven over the pinned `MEMBERSHIP_STATE_NAMES` rather
 * than over two hand-written cases, so a member added to the backend enum shows
 * up here as a failure rather than as a silently unrendered label.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  PLAYER_IDENTITY_HEADER_SELECTOR,
  PLAYER_IDENTITY_LABEL_SELECTOR,
  PlayerIdentityHeader,
} from './PlayerIdentityHeader';
import { ANONYMISED_PLACEHOLDER } from '../lib/anonymisedName';
import {
  ACTIVE_STATE_LABEL,
  FORMER_PLAYER_LABEL,
  GUEST_LABEL,
  INACTIVE_STATE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  SQUAD_SCOPE_STATEMENT,
} from '../lib/messages';
import { MEMBERSHIP_STATE_NAMES, type MembershipState } from '../lib/wireEnums';

/** An ordinary squad display name. */
const ORDINARY_NAME = 'BigDave';

/** The label of each Membership_State, as the header is expected to render it. */
const EXPECTED_STATE_LABELS: Record<MembershipState, string> = {
  Active: ACTIVE_STATE_LABEL,
  Inactive: INACTIVE_STATE_LABEL,
};

/** Every label text the header can render, for exhaustive absence assertions. */
const EVERY_LABEL = [
  ACTIVE_STATE_LABEL,
  INACTIVE_STATE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  GUEST_LABEL,
  FORMER_PLAYER_LABEL,
] as const;

/** One profile shape, as the header is given it. */
interface IdentityCase {
  readonly what: string;
  readonly displayName: string;
  readonly state: MembershipState | null;
  readonly isGuest: boolean;
}

/** The kinds of the rendered labels, in document order. */
function renderedLabelKinds(container: HTMLElement): readonly string[] {
  return Array.from(
    container.querySelectorAll(PLAYER_IDENTITY_LABEL_SELECTOR),
  ).map((label) => label.getAttribute('data-player-stats-identity-label') ?? '');
}

/** Anything a person could activate, so "renders no control" is checkable. */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [role="button"], [role="link"],' +
  ' [role="menuitem"], [contenteditable], [tabindex]';

describe('PlayerIdentityHeader heading (Req 5.1)', () => {
  it('renders exactly one heading, at level one', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state="Active"
        isGuest={false}
      />,
    );

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  });

  it('names the player in that heading', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state="Active"
        isGuest={false}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      ORDINARY_NAME,
    );
  });

  it.each([
    { what: 'padded with spaces', displayName: '  Dave  ' },
    { what: 'mixed case', displayName: 'dAvE' },
    {
      what: 'a long unbroken name',
      displayName: 'Davidtheabsolutelyenormousgoalkeeperofthesquad',
    },
    { what: 'punctuation and marks', displayName: "D'Arcy-Smith (the younger) #7" },
    { what: 'non-Latin script', displayName: 'Даве' },
    { what: 'an emoji name', displayName: 'Dave 🧤' },
    { what: 'whitespace only', displayName: '   ' },
  ])('renders a name $what exactly as parsed', ({ displayName }) => {
    render(
      <PlayerIdentityHeader
        displayName={displayName}
        state="Active"
        isGuest={false}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(displayName);
  });
});

describe('PlayerIdentityHeader membership state (Req 5.2)', () => {
  it.each(MEMBERSHIP_STATE_NAMES)('renders a text label naming %s', (state) => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state={state}
        isGuest={false}
      />,
    );

    expect(screen.getByText(EXPECTED_STATE_LABELS[state])).toBeVisible();
  });

  it.each(MEMBERSHIP_STATE_NAMES)(
    'renders no other identity label alongside %s',
    (state) => {
      render(
        <PlayerIdentityHeader
          displayName={ORDINARY_NAME}
          state={state}
          isGuest={false}
        />,
      );

      const unexpected = EVERY_LABEL.filter(
        (label) => label !== EXPECTED_STATE_LABELS[state],
      );

      for (const label of unexpected) {
        expect(screen.queryByText(label)).toBeNull();
      }
    },
  );

  it('conveys the state in text rather than by a colour or a shape alone', () => {
    const { container } = render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state="Inactive"
        isGuest={false}
      />,
    );

    const [label] = container.querySelectorAll(PLAYER_IDENTITY_LABEL_SELECTOR);

    expect(label?.textContent).toBe(INACTIVE_STATE_LABEL);
  });
});

describe('PlayerIdentityHeader with no membership state (Req 5.3)', () => {
  it('states that no membership state is recorded', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state={null}
        isGuest={false}
      />,
    );

    expect(screen.getByText(NO_MEMBERSHIP_STATE_RECORDED_LABEL)).toBeVisible();
  });

  it('names neither active nor inactive', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state={null}
        isGuest={false}
      />,
    );

    expect(screen.queryByText(ACTIVE_STATE_LABEL)).toBeNull();
    expect(screen.queryByText(INACTIVE_STATE_LABEL)).toBeNull();
  });

  it('still renders the heading and the squad-scope statement', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state={null}
        isGuest={false}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      ORDINARY_NAME,
    );
    expect(screen.getByText(SQUAD_SCOPE_STATEMENT)).toBeVisible();
  });
});

describe('PlayerIdentityHeader guest label (Req 5.4)', () => {
  it('identifies a guest membership in text', () => {
    render(
      <PlayerIdentityHeader displayName={ORDINARY_NAME} state="Active" isGuest />,
    );

    expect(screen.getByText(GUEST_LABEL)).toBeVisible();
  });

  it('renders no guest label for a registered membership', () => {
    render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state="Active"
        isGuest={false}
      />,
    );

    expect(screen.queryByText(GUEST_LABEL)).toBeNull();
  });

  it('renders the guest header as it renders a registered one, but for the label', () => {
    const { container: registered } = render(
      <PlayerIdentityHeader
        displayName={ORDINARY_NAME}
        state="Active"
        isGuest={false}
      />,
    );
    const registeredKinds = renderedLabelKinds(registered);

    const { container: guest } = render(
      <PlayerIdentityHeader displayName={ORDINARY_NAME} state="Active" isGuest />,
    );

    expect(renderedLabelKinds(guest)).toEqual([...registeredKinds, 'guest']);
    expect(
      guest.querySelector(PLAYER_IDENTITY_HEADER_SELECTOR)?.textContent,
    ).toContain(SQUAD_SCOPE_STATEMENT);
  });
});

describe('PlayerIdentityHeader former player (Req 5.5)', () => {
  it.each([
    { what: 'the placeholder itself', displayName: ANONYMISED_PLACEHOLDER },
    {
      what: 'the placeholder with surrounding whitespace',
      displayName: `  ${ANONYMISED_PLACEHOLDER} `,
    },
  ])('presents the subject as a former player for $what', ({ displayName }) => {
    render(
      <PlayerIdentityHeader
        displayName={displayName}
        state="Inactive"
        isGuest={false}
      />,
    );

    expect(screen.getByText(FORMER_PLAYER_LABEL)).toBeVisible();
  });

  it('still renders the placeholder name as parsed in the heading', () => {
    render(
      <PlayerIdentityHeader
        displayName={ANONYMISED_PLACEHOLDER}
        state="Inactive"
        isGuest={false}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      ANONYMISED_PLACEHOLDER,
    );
  });

  it.each([
    { what: 'an ordinary name', displayName: ORDINARY_NAME },
    { what: 'a near miss in another case', displayName: 'former player' },
    { what: 'a near miss with interior whitespace', displayName: 'Former  player' },
    { what: 'a name that merely begins with it', displayName: 'Former player of note' },
  ])('renders no former-player label for $what', ({ displayName }) => {
    render(
      <PlayerIdentityHeader
        displayName={displayName}
        state="Active"
        isGuest={false}
      />,
    );

    expect(screen.queryByText(FORMER_PLAYER_LABEL)).toBeNull();
  });

  it('labels an erased guest as both a guest and a former player, in that order', () => {
    const { container } = render(
      <PlayerIdentityHeader
        displayName={ANONYMISED_PLACEHOLDER}
        state={null}
        isGuest
      />,
    );

    expect(renderedLabelKinds(container)).toEqual([
      'membership-state',
      'guest',
      'former-player',
    ]);
  });
});

/** Every shape of profile the header can be handed. */
const IDENTITY_CASES: readonly IdentityCase[] = [
  {
    what: 'an active registered player',
    displayName: ORDINARY_NAME,
    state: 'Active',
    isGuest: false,
  },
  {
    what: 'an inactive registered player',
    displayName: ORDINARY_NAME,
    state: 'Inactive',
    isGuest: false,
  },
  {
    what: 'a membership with no state recorded',
    displayName: ORDINARY_NAME,
    state: null,
    isGuest: false,
  },
  {
    what: 'a guest',
    displayName: ORDINARY_NAME,
    state: 'Active',
    isGuest: true,
  },
  {
    what: 'a former player',
    displayName: ANONYMISED_PLACEHOLDER,
    state: 'Inactive',
    isGuest: false,
  },
  {
    what: 'an erased guest',
    displayName: ANONYMISED_PLACEHOLDER,
    state: null,
    isGuest: true,
  },
];

describe('PlayerIdentityHeader squad scope (Req 5.6)', () => {
  it.each(IDENTITY_CASES)(
    'states the squad scope for $what',
    ({ displayName, state, isGuest }) => {
      render(
        <PlayerIdentityHeader
          displayName={displayName}
          state={state}
          isGuest={isGuest}
        />,
      );

      expect(screen.getByText(SQUAD_SCOPE_STATEMENT)).toBeVisible();
    },
  );
});

describe('PlayerIdentityHeader renders no control (Req 5.5)', () => {
  it.each(IDENTITY_CASES)(
    'renders nothing activatable for $what',
    ({ displayName, state, isGuest }) => {
      const { container } = render(
        <PlayerIdentityHeader
          displayName={displayName}
          state={state}
          isGuest={isGuest}
        />,
      );

      const header = container.querySelector(PLAYER_IDENTITY_HEADER_SELECTOR);

      expect(header).not.toBeNull();
      expect(header?.querySelectorAll(INTERACTIVE_SELECTOR)).toHaveLength(0);
    },
  );

  it('offers no control role at all for an erased guest', () => {
    render(
      <PlayerIdentityHeader
        displayName={ANONYMISED_PLACEHOLDER}
        state={null}
        isGuest
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
