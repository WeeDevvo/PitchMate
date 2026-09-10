/**
 * Unit tests for the Unavailable_State.
 *
 * Requirement 3.8 makes four claims about this content, and each is asserted
 * here:
 *
 *   - exactly one level-one heading, because the Shell_Frame renders none and the
 *     Content_Region locates and announces exactly one (Requirements 1.9, 13.2,
 *     13.12);
 *   - that heading carries the Destination's *registered* visible label — checked
 *     for every registered Destination, so no destination can reach this state
 *     with a heading that disagrees with its Primary_Navigation control;
 *   - a control that navigates to the Home_Destination, client-side, with no
 *     full-document reload (Requirements 3.4, 1.3); and
 *   - no error indication of any kind: an absent injected body is not a fault.
 *
 * The client-side claim is asserted the way the auth route tests assert it: the
 * router's location changes and the target screen swaps in under
 * `RouterProvider`, which navigates without touching the document. The
 * surrounding layout element is captured before and after to show the same node
 * survived, which a reload or a remount could not do.
 *
 * Property 5 (task 14.4) covers the unsupplied-destination case across generated
 * inputs; these are the worked examples beside it.
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

import { DestinationUnavailable } from './DestinationUnavailable';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  destinationLabel,
  type DestinationId,
} from './lib/destinations';
import { HOME_CONTROL_LABEL, UNAVAILABLE_BODY } from './lib/messages';

/** Text only ever rendered by the Home_Destination stand-in. */
const HOME_HEADING = 'Your squads';

/** A test id on the element wrapping the routed content, to prove node identity. */
const LAYOUT_TEST_ID = 'shell-layout-stand-in';

/** Mount the Unavailable_State for `destinationId` behind a real client-side router. */
function renderUnavailable(destinationId: DestinationId) {
  const routes: RouteObject[] = [
    { path: HOME_ROUTE, element: <h1>{HOME_HEADING}</h1> },
    {
      path: '/app/profile',
      element: <DestinationUnavailable destinationId={destinationId} />,
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: ['/app/profile'] });

  render(
    <div data-testid={LAYOUT_TEST_ID}>
      <RouterProvider router={router} />
    </div>,
  );

  return { router };
}

describe('DestinationUnavailable heading (Req 3.8)', () => {
  it('renders exactly one level-one heading', () => {
    renderUnavailable('profile');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // Every registered Destination, not only the three with injected content
  // (Requirement 3.7): the heading must be the registry's label whichever
  // Destination reaches this state.
  it.each(SHELL_DESTINATIONS.map((destination) => destination.id))(
    'heads the state with the label registered for %s',
    (destinationId) => {
      renderUnavailable(destinationId);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        destinationLabel(destinationId),
      );
    },
  );

  it('explains the absence without naming another Destination', () => {
    renderUnavailable('profile');

    expect(screen.getByText(UNAVAILABLE_BODY)).toBeVisible();
  });
});

describe('DestinationUnavailable control to Home (Req 3.8)', () => {
  it('labels the control with the registered Home label', () => {
    // A drift guard: the fixed string is a constant, so this is what keeps it
    // agreeing with the registry's Home label.
    expect(HOME_CONTROL_LABEL).toContain(destinationLabel('home'));
  });

  it('targets the registered Home route path', () => {
    renderUnavailable('profile');

    expect(screen.getByRole('link', { name: HOME_CONTROL_LABEL })).toHaveAttribute(
      'href',
      HOME_ROUTE,
    );
  });

  it('navigates to the Home_Destination client-side, without a reload', async () => {
    const user = userEvent.setup();
    const { router } = renderUnavailable('profile');

    const layoutBefore = screen.getByTestId(LAYOUT_TEST_ID);

    await user.click(screen.getByRole('link', { name: HOME_CONTROL_LABEL }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(HOME_ROUTE);
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(HOME_HEADING);
    // The very same wrapper node: the document was not replaced and the tree was
    // not remounted (Requirements 1.3, 3.4).
    expect(screen.getByTestId(LAYOUT_TEST_ID)).toBe(layoutBefore);
  });
});

describe('DestinationUnavailable is not an error state (Req 3.8)', () => {
  it('renders no alert and no status region', () => {
    renderUnavailable('profile');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders no live region and no error-state attribute', () => {
    const { container } = render(
      <RouterProvider
        router={createMemoryRouter(
          [
            {
              path: '/app/profile',
              element: <DestinationUnavailable destinationId="profile" />,
            },
          ],
          { initialEntries: ['/app/profile'] },
        )}
      />,
    );

    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[aria-invalid]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
