/**
 * Unit tests for the Not_Found_Treatment.
 *
 * Requirement 6.5 asks for one treatment whose rendered content is identical
 * whatever the cause, and Requirement 6.4 for no squad name, no reason, and a
 * control to the Squads_Home. The identical-content clause is asserted as a shape
 * claim: the component takes no props, so its whole subtree is exactly its three
 * fixed strings and there is nothing a call site could vary. The two call sites
 * that render it — a `GetSquad` not-found result and a malformed `squadId` with no
 * call issued at all — therefore cannot differ, which is what the screen's own
 * tests then rely on.
 *
 * The control is checked against the App_Shell's exported `HOME_ROUTE` rather than
 * a path literal, and is exercised through a real client-side router so the
 * "navigates without a reload" clause is observed rather than assumed.
 *
 * Feature: web-squads-screens
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
import { HOME_ROUTE } from '../../app-shell';
import { squadPath } from '../lib/routePaths';
import {
  GENERIC_SQUADS_FAILURE,
  NOT_FOUND_TREATMENT_BODY,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_HOME_LABEL,
} from '../lib/messages';

/** Text only the Squads_Home stand-in renders, so arrival there is observable. */
const HOME_HEADING = 'Your squads';

/** A test id on the element wrapping the routed content, to prove node identity. */
const LAYOUT_TEST_ID = 'squads-layout-stand-in';

/** A well-formed identity the caller cannot reach — the `GetSquad` not-found case. */
const UNREACHABLE_SQUAD_PATH = squadPath('0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01');

/** A malformed identifier — the case that short-circuits with no call issued (6.6). */
const MALFORMED_SQUAD_PATH = squadPath('not-a-squad-identity');

/** Mount the treatment at a Squad_Route path behind a real client-side router. */
function renderTreatment(path: string = UNREACHABLE_SQUAD_PATH) {
  const routes: RouteObject[] = [
    { path: HOME_ROUTE, element: <h1>{HOME_HEADING}</h1> },
    { path: '/app/squads/:squadId', element: <NotFoundTreatment /> },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [path],
  });

  const rendered = render(
    <div data-testid={LAYOUT_TEST_ID}>
      <RouterProvider router={router} />
    </div>,
  );

  return { router, ...rendered };
}

describe('NotFoundTreatment heading and wording (Reqs 6.4, 6.5)', () => {
  it('renders exactly one level-one heading', () => {
    renderTreatment();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('states the outcome without naming a cause', () => {
    renderTreatment();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      NOT_FOUND_TREATMENT_HEADING,
    );
    expect(screen.getByText(NOT_FOUND_TREATMENT_BODY)).toBeVisible();
  });

  it('renders no squad identity and no squad name', () => {
    const { container } = renderTreatment();

    const treatment = container.querySelector(NOT_FOUND_TREATMENT_SELECTOR);

    expect(treatment).not.toBeNull();
    expect(treatment?.textContent).not.toContain('0198e2a7');
  });
});

describe('NotFoundTreatment content does not vary with cause (Req 6.5)', () => {
  it('renders exactly its three fixed strings, so no call site can vary it', () => {
    const { container } = renderTreatment();

    expect(container.querySelector(NOT_FOUND_TREATMENT_SELECTOR)?.textContent).toBe(
      `${NOT_FOUND_TREATMENT_HEADING}${NOT_FOUND_TREATMENT_BODY}${NOT_FOUND_TREATMENT_HOME_LABEL}`,
    );
  });

  it('renders identically for a well-formed unreachable identity and a malformed one', () => {
    const unreachable = renderTreatment(UNREACHABLE_SQUAD_PATH);
    const unreachableMarkup = unreachable.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.innerHTML;
    unreachable.unmount();

    const malformed = renderTreatment(MALFORMED_SQUAD_PATH);
    const malformedMarkup = malformed.container.querySelector(
      NOT_FOUND_TREATMENT_SELECTOR,
    )?.innerHTML;

    expect(unreachableMarkup).toBeDefined();
    expect(malformedMarkup).toBe(unreachableMarkup);
  });
});

describe('NotFoundTreatment control to the Squads_Home (Req 6.4)', () => {
  it('targets the App_Shell route the Squads_Home is registered at', () => {
    renderTreatment();

    const control = screen.getByRole('link', {
      name: NOT_FOUND_TREATMENT_HOME_LABEL,
    });

    expect(control).toHaveAttribute('href', HOME_ROUTE);
  });

  it('navigates to the Squads_Home client-side, without a reload', async () => {
    const user = userEvent.setup();
    const { router } = renderTreatment();

    const layoutBefore = screen.getByTestId(LAYOUT_TEST_ID);

    await user.click(
      screen.getByRole('link', { name: NOT_FOUND_TREATMENT_HOME_LABEL }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOME_ROUTE);
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HOME_HEADING);
    expect(screen.getByTestId(LAYOUT_TEST_ID)).toBe(layoutBefore);
  });

  it('presents exactly one control, so nothing competes with the way onward', () => {
    renderTreatment();

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('NotFoundTreatment is an outcome, not a failure (Reqs 6.7, 17.1)', () => {
  it('renders no alert, status, or live region', () => {
    const { container } = renderTreatment();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('renders no generic failure message and no retry control', () => {
    renderTreatment();

    expect(screen.queryByText(GENERIC_SQUADS_FAILURE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
