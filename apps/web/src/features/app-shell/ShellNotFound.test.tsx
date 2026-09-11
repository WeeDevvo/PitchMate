/**
 * Unit tests for the `/app` not-found indication.
 *
 * Requirement 3.10 asks for exactly one level-one heading, a control that
 * navigates to the Home_Destination, no Primary_Navigation control marked as the
 * current page, and no registered Destination's content. Three of those four
 * belong to this component and are asserted here; "no control marked current" is
 * a property of {@link resolveDestination} and {@link PrimaryNavigation} — this
 * component renders no navigation at all, which is asserted as the absence of a
 * navigation landmark and of any `aria-current` node.
 *
 * A wrong address is not a fault, so there is also no alert, no status region,
 * and no live region here: the Content_Region announces the heading on the
 * content change (Requirement 13.12).
 *
 * Feature: app-shell
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import { ShellNotFound } from './ShellNotFound';
import { HOME_ROUTE, destinationLabel } from './lib/destinations';
import {
  HOME_CONTROL_LABEL,
  SHELL_NOT_FOUND_BODY,
  SHELL_NOT_FOUND_HEADING,
} from './lib/messages';

/** Text only ever rendered by the Home_Destination stand-in. */
const HOME_HEADING = 'Your squads';

/** A test id on the element wrapping the routed content, to prove node identity. */
const LAYOUT_TEST_ID = 'shell-layout-stand-in';

/** An unregistered path under `/app` — the case Requirement 3.10 governs. */
const UNREGISTERED_PATH = '/app/leaderboards';

/** Mount the not-found indication behind a real client-side router. */
function renderNotFound() {
  const routes: RouteObject[] = [
    { path: HOME_ROUTE, element: <h1>{HOME_HEADING}</h1> },
    { path: '/app/*', element: <ShellNotFound /> },
  ];

  const router = createMemoryRouter(routes, { initialEntries: [UNREGISTERED_PATH] });

  const rendered = render(
    <div data-testid={LAYOUT_TEST_ID}>
      <RouterProvider router={router} />
    </div>,
  );

  return { router, ...rendered };
}

describe('ShellNotFound heading (Req 3.10)', () => {
  it('renders exactly one level-one heading', () => {
    renderNotFound();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('states the outcome in that heading', () => {
    renderNotFound();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      SHELL_NOT_FOUND_HEADING,
    );
    expect(screen.getByText(SHELL_NOT_FOUND_BODY)).toBeVisible();
  });
});

describe('ShellNotFound control to Home (Req 3.10)', () => {
  it('targets the registered Home route path with the registered Home label', () => {
    renderNotFound();

    const control = screen.getByRole('link', { name: HOME_CONTROL_LABEL });

    expect(control).toHaveAttribute('href', HOME_ROUTE);
    expect(control).toHaveTextContent(destinationLabel('home'));
  });

  it('navigates to the Home_Destination client-side, without a reload', async () => {
    const user = userEvent.setup();
    const { router } = renderNotFound();

    const layoutBefore = screen.getByTestId(LAYOUT_TEST_ID);

    await user.click(screen.getByRole('link', { name: HOME_CONTROL_LABEL }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOME_ROUTE);
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HOME_HEADING);
    expect(screen.getByTestId(LAYOUT_TEST_ID)).toBe(layoutBefore);
  });

  it('presents exactly one control, so nothing competes with the way onward', () => {
    renderNotFound();

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ShellNotFound marks nothing current and reports no error (Req 3.10)', () => {
  it('renders no navigation landmark and no current-page marking', () => {
    const { container } = renderNotFound();

    expect(screen.queryByRole('navigation')).toBeNull();
    expect(container.querySelector('[aria-current]')).toBeNull();
  });

  it('renders no alert, status, or live region', () => {
    const { container } = renderNotFound();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });
});
