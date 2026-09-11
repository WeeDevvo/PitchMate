/**
 * Integration tests through the assembled application router (task 15.4).
 *
 * The properties beside this file each hold one invariant of the assembled table:
 * Property 37 that every registered path appears exactly once and reaches its own
 * screen, Property 38 that an unmatched address outside `/app` reaches the
 * application not-found surface. What is left is the handful of concrete
 * behaviours that do not vary with input, and that only appear once the landing
 * route, the Auth_Feature table, and the App_Shell subtree are mounted **together**
 * — the arrangement that, before task 15.1, did not exist at all:
 *
 *   - **Every auth address resolves to its Auth_Feature screen** (Requirement
 *     15.6). This is the regression the requirement was written for: `/login` used
 *     to resolve to no registered route. Each of the five paths is entered
 *     directly, as a link in an email delivers a visitor, with no session — the
 *     state a first-time visitor arrives in.
 *   - **An authenticated visitor entering `/login` still gets the Log_In_Screen.**
 *     The two subtrees observe one session model, so this pins down that the
 *     Route_Guard's admission of `/app` does not extend to claiming an auth path,
 *     and that nothing bounces an already-signed-in visitor between the two
 *     subtrees.
 *   - **Direct-address entry to each Destination renders the Shell_Frame with that
 *     Destination's content and exactly one level-one heading** (Requirement 3.6),
 *     with no prior in-app navigation — which is what `initialEntries` models.
 *   - **An unauthenticated visitor entering a Destination address reaches the real
 *     `/login` route with the path they asked for recoverable from it.** The
 *     Route_Guard's own behaviour is Property 2's; what is integration-only is that
 *     the route it navigates to is a *registered* one in this table, and that the
 *     Log_In_Screen actually renders there.
 *   - **In-app navigation performs no full-document reload** (Requirements 3.4,
 *     3.6, 15.9) — for the brand control, every Primary_Navigation control, the
 *     `/app` not-found control, and the application not-found control.
 *
 * ### How "no full-document reload" is asserted
 *
 * Three independent signals, because no single one is conclusive in jsdom:
 *
 * 1. **The activation's default action was prevented.** `fireEvent.click` returns
 *    `false` when a handler called `preventDefault`, which is precisely what a
 *    router `Link` does to stop the browser following its `href`. An anchor that
 *    reached the browser — the way a full-document reload starts — would leave the
 *    default action intact and return `true`.
 * 2. **The Shell_Header keeps its DOM node.** A reload would rebuild the document,
 *    so the same element instance surviving the navigation shows the frame was
 *    never re-created (Requirement 1.3).
 * 3. **The document element is the same instance**, which no reload could preserve.
 *
 * ### The injected seams
 *
 * The router is the production `createAppRoutes`, assembled through
 * `appRouterTestHarness` with only the outside world replaced: the session model,
 * the Api_Client, the auth backend facade, and the Destination_Content the
 * application injects from outside the shell. The harness's viewport stub reports a
 * wide width so the Primary_Navigation renders its controls directly rather than
 * behind the Compact_Layout disclosure (Requirement 1.7); the collapse behaviour at
 * compact widths is the shell's own tests' subject, not this file's.
 *
 * Feature: app-shell
 * Requirements: 3.6, 15.6, 15.9
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';

import {
  LOG_IN_HEADING,
  LOG_IN_ROUTE,
  REDIRECT_PARAM_NAME,
  RESET_CONFIRM_HEADING,
  RESET_CONFIRM_ROUTE,
  RESET_REQUEST_HEADING,
  RESET_REQUEST_ROUTE,
  SIGN_UP_HEADING,
  SIGN_UP_ROUTE,
  VERIFY_EMAIL_HEADING,
  VERIFY_EMAIL_ROUTE,
} from '../features/auth';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  type DestinationDefinition,
} from '../features/app-shell';
import { landingContent } from '../features/landing/content/landingContent';
import {
  APP_NOT_FOUND_CONTROL_LABEL,
  APP_NOT_FOUND_HEADING,
} from './AppNotFound';
import { LANDING_ROUTE } from './appRoutePaths';
import {
  assembleRoutes,
  flush,
  HOME_CONTENT_HEADING,
  installViewport,
  PROFILE_CONTENT_HEADING,
  renderAt,
  resetThemeAttribute,
  restoreViewport,
  unauthenticatedSessionManager,
} from './appRouterTestHarness';

// --- What each screen heads itself with --------------------------------------

/** An Auth_Feature route path and the level-one heading its screen carries. */
const AUTH_SCREENS: readonly { readonly path: string; readonly heading: string }[] =
  [
    { path: SIGN_UP_ROUTE, heading: SIGN_UP_HEADING },
    { path: LOG_IN_ROUTE, heading: LOG_IN_HEADING },
    { path: RESET_REQUEST_ROUTE, heading: RESET_REQUEST_HEADING },
    { path: RESET_CONFIRM_ROUTE, heading: RESET_CONFIRM_HEADING },
    { path: VERIFY_EMAIL_ROUTE, heading: VERIFY_EMAIL_HEADING },
  ];

/**
 * The level-one heading a Destination's content renders.
 *
 * Home and Profile take their bodies from outside the shell, so their headings are
 * the injected ones. Notifications and Settings are supplied by the shell and head
 * themselves with the Destination's registered label (Requirements 3.8, 3.9), read
 * from the registry rather than restated here.
 */
function destinationHeading(destination: DestinationDefinition): string {
  switch (destination.id) {
    case 'home':
      return HOME_CONTENT_HEADING;
    case 'profile':
      return PROFILE_CONTENT_HEADING;
    default:
      return destination.label;
  }
}

// --- Reading the rendered surface --------------------------------------------

/** The level-one headings currently rendered, in document order. */
function levelOneHeadings(): string[] {
  return screen
    .getAllByRole('heading', { level: 1 })
    .map((heading) => heading.textContent?.trim() ?? '');
}

/** The Primary_Navigation control marked as the current page, if any. */
function currentNavigationControl(): HTMLElement | null {
  return within(screen.getByRole('navigation')).queryByRole('link', {
    current: 'page',
  });
}

/**
 * The Shell_Header's brand control.
 *
 * Found by what Requirement 1.4 makes it — the header's own control to the
 * Home_Destination — rather than by its visible name, which is a shell-internal
 * message this application wiring does not import. The navigation landmark's own
 * Home control shares the destination, so it is excluded by containment.
 */
function brandControl(): HTMLElement {
  const navigation = screen.getByRole('navigation');
  const [brand] = within(screen.getByRole('banner'))
    .getAllByRole('link')
    .filter(
      (link) =>
        link.getAttribute('href') === HOME_ROUTE && !navigation.contains(link),
    );

  expect(brand).toBeDefined();
  return brand;
}

/**
 * Activate a control and report whether the browser's own navigation was
 * prevented — `false` from `fireEvent` means a handler called `preventDefault`,
 * which is what a router `Link` does instead of letting the document reload.
 */
async function activate(control: HTMLElement): Promise<boolean> {
  const notPrevented = fireEvent.click(control);
  await flush();
  return !notPrevented;
}

/** Assert the Shell_Frame's three landmarks are rendered. */
function expectShellFrame(): HTMLElement {
  expect(document.querySelector('.shell-frame')).not.toBeNull();
  expect(screen.getByRole('navigation')).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  return screen.getByRole('banner');
}

/** Assert no part of the Shell_Frame reached the DOM. */
function expectNoShellFrame(): void {
  expect(document.querySelector('.shell-frame')).toBeNull();
  expect(screen.queryByRole('banner')).toBeNull();
  expect(screen.queryByText(HOME_CONTENT_HEADING)).toBeNull();
  expect(screen.queryByText(PROFILE_CONTENT_HEADING)).toBeNull();
}

beforeEach(() => {
  // The Wide_Layout, so every Primary_Navigation control is directly reachable
  // rather than collapsed behind the Compact_Layout disclosure (Requirement 1.7).
  installViewport(1024);
});

afterEach(() => {
  restoreViewport();
  // Both Theme_Providers apply the resolved Theme to the document element, which
  // outlives an unmount.
  resetThemeAttribute();
});

// --- Auth route paths (Requirement 15.6) -------------------------------------

describe('an auth address entered directly', () => {
  it.each(AUTH_SCREENS)(
    'renders the Auth_Feature screen registered at $path',
    async ({ path, heading }) => {
      const router = await renderAt(
        assembleRoutes({ sessionManager: unauthenticatedSessionManager() }),
        path,
      );

      // 15.6: the path resolves to its own screen, not to no registered route and
      // not to the application not-found surface.
      expect(levelOneHeadings()).toEqual([heading]);
      expect(document.querySelector('.auth-layout')).not.toBeNull();
      expect(router.state.location.pathname).toBe(path);
      expectNoShellFrame();
    },
  );

  it('still renders the Log_In_Screen while the Auth_State is authenticated', async () => {
    // The two subtrees observe one session model, so an authenticated visitor
    // asking for `/login` must reach the auth screen rather than being claimed by
    // the shell subtree or bounced to a Destination.
    const router = await renderAt(assembleRoutes(), LOG_IN_ROUTE);

    expect(levelOneHeadings()).toEqual([LOG_IN_HEADING]);
    expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
    expectNoShellFrame();
  });
});

// --- Direct-address entry to each Destination (Requirement 3.6) --------------

describe('a Destination address entered directly while authenticated', () => {
  it.each(SHELL_DESTINATIONS.map((destination) => [destination.label, destination] as const))(
    'renders the Shell_Frame with the %s Destination content',
    async (_label, destination) => {
      const router = await renderAt(assembleRoutes(), destination.path);

      // 3.6: the frame, that Destination's content, and no prior navigation.
      expectShellFrame();
      expect(levelOneHeadings()).toEqual([destinationHeading(destination)]);
      expect(currentNavigationControl()).toHaveTextContent(destination.label);
      expect(router.state.location.pathname).toBe(destination.path);
    },
  );

  it('renders the shell not-found indication inside the frame for a path under /app', async () => {
    await renderAt(assembleRoutes(), '/app/nowhere');

    // 3.10: still the frame, one heading, a control to Home, and no Destination
    // marked current.
    const main = within(screen.getByRole('main'));
    expectShellFrame();
    expect(levelOneHeadings()).toHaveLength(1);
    expect(main.getByRole('link')).toHaveAttribute('href', HOME_ROUTE);
    expect(currentNavigationControl()).toBeNull();

    // The application catch-all did not claim this path. Neither the heading nor
    // the body wording tells the two surfaces apart — they say the same thing,
    // deliberately — so the discriminators are structural: this one renders inside
    // the frame (asserted above) and its control goes to the Home_Destination
    // (asserted above), whereas the application surface renders no frame at all
    // and offers the marketing landing route (Requirements 3.10, 15.9).
    expect(
      screen.queryByRole('link', { name: APP_NOT_FOUND_CONTROL_LABEL }),
    ).toBeNull();
    expect(
      document.querySelectorAll(`a[href="${LANDING_ROUTE}"]`),
    ).toHaveLength(0);
  });
});

// --- The same addresses with no session --------------------------------------

describe('a Destination address entered directly while unauthenticated', () => {
  it.each(SHELL_DESTINATIONS.map((destination) => destination.path))(
    'reaches the registered Log_In_Route from %s with the requested path recoverable',
    async (path) => {
      const router = await renderAt(
        assembleRoutes({ sessionManager: unauthenticatedSessionManager() }),
        path,
      );

      // The Route_Guard's target is a route this table actually registers, so the
      // Log_In_Screen renders rather than the application not-found surface.
      expect(router.state.location.pathname).toBe(LOG_IN_ROUTE);
      expect(levelOneHeadings()).toEqual([LOG_IN_HEADING]);

      // 2.5: the address asked for comes back character-for-character.
      const captured = new URLSearchParams(router.state.location.search).get(
        REDIRECT_PARAM_NAME,
      );
      expect(captured).not.toBeNull();
      expect(decodeURIComponent(captured ?? '')).toBe(path);

      expectNoShellFrame();
    },
  );
});

// --- In-app navigation reloads no document ----------------------------------

describe('in-app navigation', () => {
  it('follows every Primary_Navigation control without reloading the document', async () => {
    const router = await renderAt(assembleRoutes(), HOME_ROUTE);

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    for (const destination of SHELL_DESTINATIONS) {
      const control = within(screen.getByRole('navigation')).getByRole('link', {
        name: destination.label,
      });

      expect(await activate(control)).toBe(true);

      expect(router.state.location.pathname).toBe(destination.path);
      expect(levelOneHeadings()).toEqual([destinationHeading(destination)]);
      // 1.3: the header was never re-created, so nothing reloaded.
      expect(screen.getByRole('banner')).toBe(banner);
      expect(document.documentElement).toBe(documentElement);
    }
  });

  it('follows the brand control to the Home_Destination without reloading the document', async () => {
    const settings = SHELL_DESTINATIONS.find(
      (destination) => destination.id === 'settings',
    );
    expect(settings).toBeDefined();

    const router = await renderAt(assembleRoutes(), settings?.path ?? HOME_ROUTE);

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    expect(await activate(brandControl())).toBe(true);

    expect(router.state.location.pathname).toBe(HOME_ROUTE);
    expect(levelOneHeadings()).toEqual([HOME_CONTENT_HEADING]);
    expect(screen.getByRole('banner')).toBe(banner);
    expect(document.documentElement).toBe(documentElement);
  });

  it('follows the /app not-found control to the Home_Destination without reloading the document', async () => {
    const router = await renderAt(assembleRoutes(), '/app/nowhere');

    const documentElement = document.documentElement;
    const banner = expectShellFrame();

    const control = within(screen.getByRole('main')).getByRole('link');
    expect(await activate(control)).toBe(true);

    expect(router.state.location.pathname).toBe(HOME_ROUTE);
    expect(levelOneHeadings()).toEqual([HOME_CONTENT_HEADING]);
    expect(screen.getByRole('banner')).toBe(banner);
    expect(document.documentElement).toBe(documentElement);
  });

  it('follows the application not-found control to the landing route without reloading the document', async () => {
    const router = await renderAt(assembleRoutes(), '/nowhere-at-all');

    const documentElement = document.documentElement;
    expect(levelOneHeadings()).toEqual([APP_NOT_FOUND_HEADING]);

    const control = screen.getByRole('link', {
      name: APP_NOT_FOUND_CONTROL_LABEL,
    });
    expect(await activate(control)).toBe(true);

    // 15.9: the control offers the marketing landing route, client-side.
    expect(router.state.location.pathname).toBe(LANDING_ROUTE);
    expect(levelOneHeadings()).toEqual([landingContent.hero.headline]);
    expect(document.documentElement).toBe(documentElement);
  });
});
