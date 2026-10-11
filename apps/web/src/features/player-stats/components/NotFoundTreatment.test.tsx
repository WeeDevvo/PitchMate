/**
 * Unit tests for the Not_Found_Treatment.
 *
 * `GetPlayerProfile` conceals six situations behind one code-free `404` — a
 * non-existent squad, a non-existent membership, a membership in another squad, a
 * caller who is not an active member, a missing or expired token, and (locally,
 * with no call issued at all) a malformed path. Requirements 3.1, 3.2, and 3.3
 * ask that no rendered difference distinguish any of them, so the central claim
 * here is a shape claim: the component's only input is the route's squad
 * identity, which reaches the way-out control's target and nothing else, and its
 * whole visible text is three fixed strings from `lib/messages.ts`. Two routes
 * therefore render identical text, and nothing a caller holds can vary it.
 *
 * The rest follows the requirements one by one: exactly one level-one heading
 * naming no identity (3.6, 16.1), the statement in a live region (4.6), the
 * control built by the squads barrel's own `squadPath` and navigating client-side
 * (1.6, 1.7, 3.5), and no failure treatment anywhere near it (4.3).
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import {
  NOT_FOUND_TREATMENT_SELECTOR,
  NotFoundTreatment,
} from './NotFoundTreatment';
import {
  PLAYER_STATS_ROUTE,
  SQUAD_ROUTE,
  playerStatsPath,
  squadPath,
} from '../../squads';
import {
  BACK_TO_SQUAD_LABEL,
  GENERIC_PROFILE_FAILURE,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_STATEMENT,
  RETRY_LABEL,
} from '../lib/messages';

/** A well-formed squad identity the caller cannot reach — the concealed case. */
const UNREACHABLE_SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/** A second well-formed identity, so "the text does not vary" is observable. */
const OTHER_SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02';

/** A malformed identity — the case that issues no call at all (Requirement 3.3). */
const MALFORMED_SQUAD_ID = 'not-a-squad-identity';

/** A membership identity, present only in the route this screen sits at. */
const MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f99';

/** Text only the Squad_Screen stand-in renders, so arrival there is observable. */
const SQUAD_HEADING = 'The squad stand-in';

/** A test id on the element wrapping the routed content, to prove node identity. */
const LAYOUT_TEST_ID = 'player-stats-layout-stand-in';

/**
 * Mount the treatment at a Player_Stats_Route path behind a real client-side
 * router.
 *
 * `pathSquadId` defaults to `squadId`, which is the ordinary case — the screen
 * hands the treatment the squad segment it was itself routed with. It is a
 * separate parameter only so the empty-identity case can be exercised: an empty
 * segment matches no dynamic-segment pattern, so the harness has to be routed
 * somewhere real while still handing the component the empty value a screen
 * would pass for an absent parameter.
 */
function renderTreatment(
  squadId: string = UNREACHABLE_SQUAD_ID,
  pathSquadId: string = squadId === '' ? UNREACHABLE_SQUAD_ID : squadId,
) {
  const routes: RouteObject[] = [
    { path: SQUAD_ROUTE, element: <h1>{SQUAD_HEADING}</h1> },
    {
      path: PLAYER_STATS_ROUTE,
      element: <NotFoundTreatment squadId={squadId} />,
    },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [playerStatsPath(pathSquadId, MEMBERSHIP_ID)],
  });

  const rendered = render(
    <div data-testid={LAYOUT_TEST_ID}>
      <RouterProvider router={router} />
    </div>,
  );

  return { router, ...rendered };
}

describe('NotFoundTreatment heading (Reqs 3.6, 16.1)', () => {
  it('renders exactly one level-one heading', () => {
    renderTreatment();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('names neither the squad, the player, nor any identity in that heading', () => {
    renderTreatment();

    const heading = screen.getByRole('heading', { level: 1 });

    expect(heading).toHaveTextContent(NOT_FOUND_TREATMENT_HEADING);
    expect(heading.textContent).not.toContain(UNREACHABLE_SQUAD_ID);
    expect(heading.textContent).not.toContain(MEMBERSHIP_ID);
  });

  it('renders no heading of any other level, so the outline skips nothing', () => {
    renderTreatment();

    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });
});

describe('NotFoundTreatment non-disclosure (Reqs 3.1, 3.2, 3.5, 3.7)', () => {
  it('states the outcome without stating a reason', () => {
    renderTreatment();

    expect(screen.getByText(NOT_FOUND_TREATMENT_STATEMENT)).toBeVisible();
  });

  it('renders exactly its three fixed strings, so no call site can vary the text', () => {
    const { container } = renderTreatment();

    expect(container.querySelector(NOT_FOUND_TREATMENT_SELECTOR)?.textContent).toBe(
      `${NOT_FOUND_TREATMENT_HEADING}${NOT_FOUND_TREATMENT_STATEMENT}${BACK_TO_SQUAD_LABEL}`,
    );
  });

  it('renders no squad identity and no membership identity as text', () => {
    const { container } = renderTreatment();

    const text =
      container.querySelector(NOT_FOUND_TREATMENT_SELECTOR)?.textContent ?? '';

    expect(text).not.toContain(UNREACHABLE_SQUAD_ID);
    expect(text).not.toContain(MEMBERSHIP_ID);
  });

  it('renders no identity in any accessible name', () => {
    renderTreatment();

    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      NOT_FOUND_TREATMENT_HEADING,
    );
    expect(screen.getByRole('link')).toHaveAccessibleName(BACK_TO_SQUAD_LABEL);
  });

  it('renders identical text for a well-formed unreachable identity and a malformed one', () => {
    const unreachable = renderTreatment(UNREACHABLE_SQUAD_ID);
    const unreachableText = unreachable.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.textContent;
    unreachable.unmount();

    const malformed = renderTreatment(MALFORMED_SQUAD_ID);
    const malformedText = malformed.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.textContent;

    expect(unreachableText).toBeDefined();
    expect(malformedText).toBe(unreachableText);
  });

  it('renders identical text for two different squads', () => {
    const first = renderTreatment(UNREACHABLE_SQUAD_ID);
    const firstText = first.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.textContent;
    first.unmount();

    const second = renderTreatment(OTHER_SQUAD_ID);
    const secondText = second.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.textContent;

    expect(firstText).toBeDefined();
    expect(secondText).toBe(firstText);
  });
});

describe('NotFoundTreatment announcement (Req 4.6)', () => {
  it('places the statement in a polite, atomic live region', () => {
    renderTreatment();

    const region = screen.getByRole('status');

    expect(region).toHaveTextContent(NOT_FOUND_TREATMENT_STATEMENT);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('announces without interrupting, so it is a status and never an alert', () => {
    renderTreatment();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves keyboard focus where it was', () => {
    renderTreatment();

    expect(document.activeElement).toBe(document.body);
  });
});

describe('NotFoundTreatment control back to the squad (Reqs 1.6, 1.7, 3.5)', () => {
  it('targets the path the squads barrel builds for the route squad', () => {
    renderTreatment();

    expect(screen.getByRole('link', { name: BACK_TO_SQUAD_LABEL })).toHaveAttribute(
      'href',
      squadPath(UNREACHABLE_SQUAD_ID),
    );
  });

  it('targets the squad of the route it was rendered for, not a fixed one', () => {
    renderTreatment(OTHER_SQUAD_ID);

    expect(screen.getByRole('link', { name: BACK_TO_SQUAD_LABEL })).toHaveAttribute(
      'href',
      squadPath(OTHER_SQUAD_ID),
    );
  });

  it('builds a path that resolves nowhere for an absent squad segment', () => {
    renderTreatment('');

    expect(screen.getByRole('link', { name: BACK_TO_SQUAD_LABEL })).toHaveAttribute(
      'href',
      squadPath(''),
    );
  });

  it('navigates to the squad client-side, adding exactly one history entry', async () => {
    const user = userEvent.setup();
    const { router } = renderTreatment();

    const layoutBefore = screen.getByTestId(LAYOUT_TEST_ID);
    const entriesBefore = router.state.location.key;

    await user.click(screen.getByRole('link', { name: BACK_TO_SQUAD_LABEL }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(squadPath(UNREACHABLE_SQUAD_ID));
    });
    expect(router.state.location.key).not.toBe(entriesBefore);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      SQUAD_HEADING,
    );
    // The wrapping node survived, so nothing performed a full-document reload.
    expect(screen.getByTestId(LAYOUT_TEST_ID)).toBe(layoutBefore);
  });

  it('is reachable and operable by keyboard', async () => {
    const user = userEvent.setup();
    const { router } = renderTreatment();

    await user.tab();
    expect(screen.getByRole('link', { name: BACK_TO_SQUAD_LABEL })).toHaveFocus();

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(squadPath(UNREACHABLE_SQUAD_ID));
    });
  });

  it('presents exactly one control, so nothing competes with the way out', () => {
    renderTreatment();

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('NotFoundTreatment is never the failure notice (Req 4.3)', () => {
  it('renders neither the generic failure statement nor a retry control', () => {
    renderTreatment();

    expect(screen.queryByText(GENERIC_PROFILE_FAILURE)).toBeNull();
    expect(screen.queryByRole('button', { name: RETRY_LABEL })).toBeNull();
  });

  it('renders no busy state, because nothing is awaiting a response', () => {
    const { container } = renderTreatment();

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
