/**
 * Property test for the Content_Region's focus and announcement on a content
 * change (task 10.9).
 *
 * **Property 36: A content-region change is focused and announced.** *For any*
 * in-app navigation that changes the active destination or changes the content
 * region to the unavailable state or the not-found indication, keyboard focus
 * moves to the level-one heading of the newly rendered route, the text of that
 * heading is conveyed through a live region, and no full-document reload occurs.
 *
 * | Criterion | What it asks | Where it is asserted |
 * | --- | --- | --- |
 * | 13.12 | on a change of the active Destination or of the content kind: focus to that route's `h1`, its text through a live region, no full-document reload | {@link expectChangeWasFocusedAndAnnounced} |
 * | 13.7 | the message reaches assistive technology through a live region rather than by moving focus to it | {@link liveRegion} — the announcer is a `role="status"` region and focus lands on the heading, never on the region |
 *
 * ### The two halves of the property
 *
 * Requirement 13.12 fires on a *change*, so the property is only half stated by
 * the positive case. The negative case is what stops the frame from satisfying it
 * by focusing the heading on every render — which would yank focus out from under
 * anyone using a screen, and would announce a screen they never left. So this file
 * asserts both directions over the same generated sequence:
 *
 * - **A change** — the active Destination changed, or the content kind changed
 *   between a Destination and the not-found indication — focuses and announces.
 * - **Not a change** — the same content re-rendering, and a navigation to a
 *   *nested* path within the Destination already active (`/app/settings` →
 *   `/app/settings/x`, which Requirement 3.11 resolves to the same Destination) —
 *   moves no focus and alters no announcement.
 * - **The first render** is not a change either: arriving at a shell route is not
 *   an in-app navigation, so focus stays where the document put it.
 *
 * Two paths that both resolve to nothing (`/app/one` → `/app/two`) are likewise
 * *not* a change: Requirement 3.10 makes every non-resolving path under `/app` the
 * one not-found indication, however many addresses reach it.
 *
 * ### What is generated
 *
 * 1. **A navigation sequence**, one to six steps, each either a navigation to a
 *    generated path or a re-render of the content already rendered. The paths come
 *    from three families — every registered Destination path, paths nested beneath
 *    a nested Destination, and paths under `/app` that resolve to nothing — so
 *    consecutive steps land on changes and non-changes in every combination
 *    without the test choosing which.
 * 2. **The content kind at each Destination.** The synthetic injected content a
 *    later feature supplies (Requirement 3.7), the real {@link SettingsDestination},
 *    the real {@link DestinationUnavailable}, and the real
 *    {@link SessionEndedNotice} — so the heading that gets focused and announced is
 *    a real component's on most runs rather than always the harness's.
 *
 * The `/app` not-found indication is the real {@link ShellNotFound}, reached by the
 * route table's `*` child exactly as it will be in production.
 *
 * ### How a change is predicted
 *
 * From {@link resolveDestination} — the shell's one pure resolver, the same
 * function {@link ShellFrame} derives its `contentKey` from and
 * {@link PrimaryNavigation} marks the active control from. The expectation is
 * therefore computed from production logic rather than from a second copy of the
 * matching rules written here, and a path family that the resolver treats
 * differently to what this file assumes cannot silently produce a vacuous run: the
 * negative assertions would start failing.
 *
 * ### Where focus is parked before each step
 *
 * On the Shell_Header's brand control, which survives every navigation
 * (Requirement 1.3). That makes "moved no focus" an assertion about a specific
 * surviving element rather than about `<body>`, which is also where focus would
 * land if the frame had moved focus to something that then unmounted.
 *
 * ### Why no full-document reload is asserted by node identity
 *
 * jsdom performs no navigation, so a reload cannot be observed directly. What can
 * be observed is that the Shell_Header's and the Content_Region's DOM nodes are the
 * *same* nodes after every step: a full-document reload, or a remount of the frame,
 * would replace both. That is the same proxy `ShellFrame.test.tsx` uses for
 * Requirement 1.3.
 *
 * Worked examples for the Content_Region live in `components/ContentRegion.test.tsx`
 * and `ShellFrame.test.tsx`; this file is the generator-driven property at the
 * 100-iteration floor Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 36: A content-region change is focused and announced
 * Validates: Requirements 13.7, 13.12
 */
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import fc from 'fast-check';

import { DestinationUnavailable } from './DestinationUnavailable';
import { SessionEndedNotice } from './SessionEndedNotice';
import { SettingsDestination } from './SettingsDestination';
import { ShellFrame } from './ShellFrame';
import { ShellNotFound } from './ShellNotFound';
import { BRAND_NAME } from './components/BrandControl';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { ShellThemeProvider } from './components/ShellThemeProvider';
import {
  HOME_ROUTE,
  NOTIFICATIONS_ROUTE,
  PROFILE_ROUTE,
  SETTINGS_ROUTE,
  SHELL_DESTINATIONS,
  destinationLabel,
  type DestinationId,
} from './lib/destinations';
import {
  SESSION_ENDED_HEADING,
  SHELL_NOT_FOUND_HEADING,
} from './lib/messages';
import { resolveDestination } from './lib/routeResolution';
import { createInMemoryAppearanceStorage } from '../../theme';

// --- The content kinds the region can carry ----------------------------------

/**
 * What the Content_Region holds at a Destination.
 *
 * `supplied` stands for the Destination_Content a later feature injects, which the
 * shell never sees the source of (Requirement 3.7). The other three are the real
 * components the shell ships.
 */
type ContentKind = 'supplied' | 'unavailable' | 'settings' | 'session-ended';

/** Which content kind each Destination renders, fixed for one generated run. */
type ContentPlan = Readonly<Record<DestinationId, ContentKind>>;

/**
 * The level-one heading of each synthetic injected content.
 *
 * Deliberately unlike every registered label and every shipped boundary heading,
 * so an announcement carrying one of these strings can only have come from that
 * Destination's injected content.
 */
const SUPPLIED_HEADING: Record<DestinationId, string> = {
  home: 'Supplied home body',
  notifications: 'Supplied notifications body',
  settings: 'Supplied settings body',
  profile: 'Supplied profile body',
};

/**
 * The content kinds each Destination may render.
 *
 * Home and Profile are injectable and may be absent, so both can show the
 * Unavailable_State (Requirements 3.7, 3.8). The Notifications_Destination's
 * content is supplied by the shell itself (Requirement 3.9), so it is never
 * unavailable. Settings can show the real {@link SettingsDestination} or stand for
 * a screen a later feature replaces it with.
 *
 * {@link SessionEndedNotice} is offered at every Destination because the expiry
 * handover swaps the region's content wherever a person happens to be
 * (Requirement 9.7) — this property is about the region *changing*, not about which
 * route produced the content.
 */
const CONTENT_KINDS: Readonly<Record<DestinationId, readonly ContentKind[]>> = {
  home: ['supplied', 'unavailable', 'session-ended'],
  notifications: ['supplied', 'session-ended'],
  settings: ['settings', 'supplied', 'session-ended'],
  profile: ['unavailable', 'supplied', 'session-ended'],
};

/** The level-one heading the planned content renders at a Destination. */
function headingForDestination(destinationId: DestinationId, plan: ContentPlan): string {
  switch (plan[destinationId]) {
    case 'supplied':
      return SUPPLIED_HEADING[destinationId];
    case 'unavailable':
      return destinationLabel(destinationId);
    case 'settings':
      return destinationLabel('settings');
    case 'session-ended':
      return SESSION_ENDED_HEADING;
  }
}

// --- What the shell is expected to do with a path ----------------------------

/**
 * Name the content a requested path puts in the region — the value
 * {@link ShellFrame} derives from {@link resolveDestination}, computed here from
 * that same resolver rather than from a restatement of the matching rules.
 *
 * A change of this value is what Requirement 13.12 calls a change of the
 * Content_Region.
 */
function expectedContentKey(path: string): string {
  const resolution = resolveDestination(path);
  return resolution.kind === 'destination' ? `destination:${resolution.id}` : 'not-found';
}

/** The level-one heading the route at `path` renders under `plan`. */
function expectedHeading(path: string, plan: ContentPlan): string {
  const resolution = resolveDestination(path);
  return resolution.kind === 'destination'
    ? headingForDestination(resolution.id, plan)
    : SHELL_NOT_FOUND_HEADING;
}

// --- The rendered harness ----------------------------------------------------

/**
 * Drives the generated navigations. Captured from inside the router because
 * `useNavigate` is the in-app navigation seam — nothing here touches
 * `window.location`, so a step cannot accidentally perform the full-document
 * reload the property forbids.
 */
let navigateTo: ((path: string) => void) | null = null;

/** Re-renders the mounted content without changing which content it is. */
let reviseContent: (() => void) | null = null;

function NavigationProbe(): null {
  const navigate = useNavigate();
  useEffect(() => {
    navigateTo = (path) => {
      navigate(path);
    };
    return () => {
      navigateTo = null;
    };
  }, [navigate]);
  return null;
}

/**
 * Wraps the route's content with a revision counter, so a step can re-render the
 * same content with different text.
 *
 * That is the case Requirement 13.12 must *not* fire for: `contentKey` is
 * unchanged, so however much of the body changes, focus must stay where the person
 * put it. The wrapper contributes no heading of its own, so the route's single `h1`
 * still belongs to the content (Requirements 1.9, 13.2).
 */
function ContentSlot({ children }: { readonly children: ReactNode }): ReactElement {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    reviseContent = () => {
      setRevision((value) => value + 1);
    };
    return () => {
      reviseContent = null;
    };
  }, []);

  return (
    <div data-revision={revision}>
      {children}
      <p>{`Revision ${revision}`}</p>
      <button type="button">Inside content</button>
    </div>
  );
}

/** Stand-in Destination_Content for an injected slot (Requirement 3.7). */
function SuppliedContent({
  destinationId,
}: {
  readonly destinationId: DestinationId;
}): ReactElement {
  return (
    <div data-testid={`supplied-${destinationId}`}>
      <h1>{SUPPLIED_HEADING[destinationId]}</h1>
      <p>Body of the injected content.</p>
    </div>
  );
}

/** Render the planned content for a Destination. */
function ContentFor({
  destinationId,
  plan,
}: {
  readonly destinationId: DestinationId;
  readonly plan: ContentPlan;
}): ReactElement {
  switch (plan[destinationId]) {
    case 'supplied':
      return <SuppliedContent destinationId={destinationId} />;
    case 'unavailable':
      return <DestinationUnavailable destinationId={destinationId} />;
    case 'settings':
      return <SettingsDestination />;
    case 'session-ended':
      return <SessionEndedNotice />;
  }
}

/**
 * Mount the shell as the route table composes it: the frame as the `/app` layout
 * route, one child per Destination, and the `*` child for a path under `/app` that
 * resolves to nothing (Requirement 3.10).
 *
 * The three nested Destinations take splat child paths so a path *beneath* them
 * matches the same route the Destination itself does — which is what makes
 * `/app/settings` → `/app/settings/x` a re-render of one screen rather than a
 * navigation between two, as Requirement 3.11 resolves it.
 */
function renderShell(initialPath: string, plan: ContentPlan): void {
  render(
    <ShellThemeProvider storage={createInMemoryAppearanceStorage()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <NavigationProbe />
        <Routes>
          <Route
            path={HOME_ROUTE}
            element={<ShellFrame navigation={(props) => <PrimaryNavigation {...props} />} />}
          >
            <Route
              index
              element={
                <ContentSlot>
                  <ContentFor destinationId="home" plan={plan} />
                </ContentSlot>
              }
            />
            <Route
              path={`${NOTIFICATIONS_ROUTE.slice(HOME_ROUTE.length + 1)}/*`}
              element={
                <ContentSlot>
                  <ContentFor destinationId="notifications" plan={plan} />
                </ContentSlot>
              }
            />
            <Route
              path={`${SETTINGS_ROUTE.slice(HOME_ROUTE.length + 1)}/*`}
              element={
                <ContentSlot>
                  <ContentFor destinationId="settings" plan={plan} />
                </ContentSlot>
              }
            />
            <Route
              path={`${PROFILE_ROUTE.slice(HOME_ROUTE.length + 1)}/*`}
              element={
                <ContentSlot>
                  <ContentFor destinationId="profile" plan={plan} />
                </ContentSlot>
              }
            />
            <Route
              path="*"
              element={
                <ContentSlot>
                  <ShellNotFound />
                </ContentSlot>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </ShellThemeProvider>,
  );
}

// --- Reading the rendering ---------------------------------------------------

function contentRegion(): HTMLElement {
  return screen.getByRole('main');
}

/**
 * The Content_Region's announcer.
 *
 * Requirement 13.7 asks for the message to reach assistive technology *through a
 * live region*, which is what this element is — a `role="status"` region inside the
 * landmark, present before there is anything to say.
 */
function liveRegion(): HTMLElement {
  const region = contentRegion().querySelector<HTMLElement>('[role="status"]');
  expect(region).not.toBeNull();
  return region as HTMLElement;
}

function announcedText(): string {
  return liveRegion().textContent?.trim() ?? '';
}

/** The route's single level-one heading, which belongs to the content. */
function levelOneHeading(): HTMLElement {
  return within(contentRegion()).getByRole('heading', { level: 1 });
}

/** The Shell_Header control focus is parked on between steps. */
function focusAnchor(): HTMLElement {
  return screen.getByRole('link', { name: BRAND_NAME });
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirements 13.7 and 13.12 for a step that changed the Content_Region.
 *
 * Four claims: the heading rendered is the new route's, it is programmatically
 * focusable, it holds keyboard focus, and its text — not the previous screen's, and
 * not some other string — is what the live region carries. Focus is on the heading
 * and not on the live region, which is 13.7's "without moving keyboard focus".
 */
function expectChangeWasFocusedAndAnnounced(expectedHeadingText: string): void {
  const heading = levelOneHeading();

  expect(heading.textContent?.trim()).toBe(expectedHeadingText);
  // 13.12: an `h1` is not focusable by default, so the region makes it so.
  expect(heading).toHaveAttribute('tabindex');
  expect(heading).toHaveFocus();
  expect(announcedText()).toBe(expectedHeadingText);
  expect(liveRegion()).not.toHaveFocus();
}

/**
 * Requirement 13.12 for a step that did *not* change the Content_Region: focus is
 * exactly where it was, and the announcement is exactly what it was.
 */
function expectNothingWasFocusedOrAnnounced(
  anchor: HTMLElement,
  announcementBefore: string,
): void {
  expect(anchor).toHaveFocus();
  expect(levelOneHeading()).not.toHaveFocus();
  expect(announcedText()).toBe(announcementBefore);
}

/**
 * The first render is not an in-app navigation, so focus stays where the document
 * put it and there is nothing to announce yet.
 */
function expectFirstRenderWasSilent(): void {
  expect(document.body).toHaveFocus();
  const heading = levelOneHeading();
  expect(heading).not.toHaveFocus();
  // The region has not touched the content's heading at all.
  expect(heading).not.toHaveAttribute('tabindex');
  expect(announcedText()).toBe('');
}

// --- Generators --------------------------------------------------------------

/**
 * Segments that are not registered Destination segments, so a path built from them
 * directly under `/app` resolves to nothing (Requirement 3.10). Held apart from the
 * registry deliberately: a segment slipping in here that later became a Destination
 * would quietly turn the non-resolving family into a resolving one.
 */
const UNREGISTERED_SEGMENTS: readonly string[] = [
  'squads',
  'matches',
  'teams',
  'not-a-destination',
  'settingsx',
  'x',
  '2024',
];

const ALL_IDS: readonly DestinationId[] = SHELL_DESTINATIONS.map(
  (destination) => destination.id,
);

/** The Destinations that admit nested paths — everything but Home, which is exact. */
const NESTABLE_PATHS: readonly string[] = SHELL_DESTINATIONS.map(
  (destination) => destination.path,
).filter((path) => path !== HOME_ROUTE);

const unregisteredSegmentArb = fc.constantFrom(...UNREGISTERED_SEGMENTS);

/** A path that resolves to a registered Destination, exactly. */
const registeredPathArb: fc.Arbitrary<string> = fc.constantFrom(
  ...SHELL_DESTINATIONS.map((destination) => destination.path),
);

/** A path nested beneath a nested Destination, which resolves to that Destination. */
const nestedPathArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...NESTABLE_PATHS),
    fc.array(unregisteredSegmentArb, { minLength: 1, maxLength: 2 }),
  )
  .map(([base, segments]) => `${base}/${segments.join('/')}`);

/** A path under `/app` that resolves to no registered Destination. */
const nonResolvingPathArb: fc.Arbitrary<string> = fc
  .array(unregisteredSegmentArb, { minLength: 1, maxLength: 2 })
  .map((segments) => `${HOME_ROUTE}/${segments.join('/')}`);

const shellPathArb: fc.Arbitrary<string> = fc.oneof(
  registeredPathArb,
  nestedPathArb,
  nonResolvingPathArb,
);

/** One driven step of a generated session. */
type Step =
  | { readonly kind: 'navigate'; readonly path: string }
  | { readonly kind: 'revise' };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: shellPathArb.map((path) => ({ kind: 'navigate' as const, path })) },
  { weight: 1, arbitrary: fc.constant({ kind: 'revise' as const }) },
);

const contentPlanArb: fc.Arbitrary<ContentPlan> = fc
  .tuple(
    ...ALL_IDS.map((destinationId) => fc.constantFrom(...CONTENT_KINDS[destinationId])),
  )
  .map((kinds) =>
    Object.fromEntries(
      ALL_IDS.map((destinationId, index) => [destinationId, kinds[index]]),
    ) as ContentPlan,
  );

// --- Driving a session -------------------------------------------------------

/** Perform one step against the mounted shell, and return the path now requested. */
function performStep(step: Step, currentPath: string): string {
  if (step.kind === 'revise') {
    const revise = reviseContent;
    expect(revise).not.toBeNull();
    act(() => {
      (revise as () => void)();
    });
    return currentPath;
  }

  const navigate = navigateTo;
  expect(navigate).not.toBeNull();
  act(() => {
    (navigate as (path: string) => void)(step.path);
  });
  return step.path;
}

afterEach(() => {
  // `ShellThemeProvider` applies the resolved Theme to the document element, which
  // outlives an unmount.
  document.documentElement.removeAttribute('data-theme');
  navigateTo = null;
  reviseContent = null;
});

// --- The property ------------------------------------------------------------

describe('ShellFrame — Property 36 (a content-region change is focused and announced)', () => {
  // Feature: app-shell, Property 36: A content-region change is focused and announced
  // Validates: Requirements 13.7, 13.12
  it('focuses and announces on every content change, and on nothing else', () => {
    // Both branches of the property are conditional on what the generator produced,
    // so each is counted and the counts are asserted afterwards. A generated
    // sequence that happened to contain only changes — or only non-changes — would
    // pass every assertion below while proving half of Requirement 13.12.
    let changes = 0;
    let nonChanges = 0;

    fc.assert(
      fc.property(
        shellPathArb,
        fc.array(stepArb, { minLength: 1, maxLength: 6 }),
        contentPlanArb,
        (initialPath, steps, plan) => {
          renderShell(initialPath, plan);
          try {
            expectFirstRenderWasSilent();

            // A full-document reload, or a remount of the frame, would replace both.
            const headerNode = screen.getByRole('banner');
            const regionNode = contentRegion();

            let currentPath = initialPath;
            let currentKey = expectedContentKey(initialPath);

            for (const step of steps) {
              // Park focus on a control that survives every navigation, so
              // "moved no focus" names a specific element rather than `<body>`.
              const anchor = focusAnchor();
              anchor.focus();
              const announcementBefore = announcedText();

              const nextPath = performStep(step, currentPath);
              const nextKey = expectedContentKey(nextPath);

              if (nextKey === currentKey) {
                nonChanges += 1;
                expectNothingWasFocusedOrAnnounced(anchor, announcementBefore);
              } else {
                changes += 1;
                expectChangeWasFocusedAndAnnounced(expectedHeading(nextPath, plan));
              }

              // 13.12: no full-document reload, however many steps have run.
              expect(screen.getByRole('banner')).toBe(headerNode);
              expect(contentRegion()).toBe(regionNode);

              currentPath = nextPath;
              currentKey = nextKey;
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );

    expect(changes).toBeGreaterThan(0);
    expect(nonChanges).toBeGreaterThan(0);
  }, 120_000);

  // Feature: app-shell, Property 36: A content-region change is focused and announced
  // Validates: Requirements 13.7, 13.12
  it('announces nothing for a same-content re-render or a nested path within the active destination', () => {
    // The sequence property above reaches these cases by chance; this one reaches
    // them on every run, so the negative half of Requirement 13.12 cannot go
    // unexercised however the generator shrinks or reseeds.
    fc.assert(
      fc.property(
        fc.constantFrom(...NESTABLE_PATHS),
        fc.array(unregisteredSegmentArb, { minLength: 1, maxLength: 2 }),
        contentPlanArb,
        (destinationPath, segments, plan) => {
          renderShell(destinationPath, plan);
          try {
            expectFirstRenderWasSilent();

            // A re-render of the same content.
            const anchor = focusAnchor();
            anchor.focus();
            performStep({ kind: 'revise' }, destinationPath);
            expectNothingWasFocusedOrAnnounced(anchor, '');

            // A navigation to a nested path, which Requirement 3.11 resolves to the
            // Destination already active.
            const nestedPath = `${destinationPath}/${segments.join('/')}`;
            expect(expectedContentKey(nestedPath)).toBe(expectedContentKey(destinationPath));
            anchor.focus();
            performStep({ kind: 'navigate', path: nestedPath }, destinationPath);
            expectNothingWasFocusedOrAnnounced(anchor, '');

            // The same content is still rendered, so the negative assertions above
            // were not passing because the route stopped resolving.
            expect(levelOneHeading().textContent?.trim()).toBe(
              expectedHeading(destinationPath, plan),
            );
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
