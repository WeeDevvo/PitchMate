/**
 * Property test for the Unavailable_State of a Destination with no content
 * supplied (task 14.4).
 *
 * **Property 5: An unsupplied destination renders its own unavailable state and
 * nothing else.** *For any* subset of the injectable destination content slots
 * that is supplied, each destination whose content is absent renders the
 * unavailable state carrying exactly one level-one heading with that
 * destination's visible label, keeps the header and primary navigation rendered
 * with that destination's control marked as the current page, presents a control
 * navigating to the home destination, and renders neither another destination's
 * content nor any error indication.
 *
 * That is the whole of Requirement 3.8 — "IF a registered Destination has no
 * Destination_Content supplied, THEN … exactly one level-one heading carrying
 * that Destination's visible label, … keep the Shell_Header and the
 * Primary_Navigation rendered with that Destination's control marked as the
 * current page, … present a control that navigates to the Home_Destination, and
 * … render neither the Destination_Content of another Destination nor any error
 * indication" — quantified over Requirement 3.7's injectable slots:
 *
 * | Clause of 3.8 | Where it is asserted |
 * | --- | --- |
 * | exactly one `h1`, carrying the registered label | {@link expectHeadingIsTheRegisteredLabel} |
 * | header and navigation still rendered | {@link expectFrameSurvives} |
 * | that Destination's control marked current, and no other | {@link expectOnlyThisDestinationIsCurrent} |
 * | a control navigating to Home | {@link expectControlToHome} |
 * | no other Destination's content | {@link expectNoOtherDestinationContent} |
 * | no error indication | {@link expectNoErrorIndication} |
 * | 3.7: a *supplied* slot renders its content instead | {@link expectSuppliedContract} |
 *
 * ### What is generated
 *
 * 1. **Which slots are supplied.** Every subset of the three injectable slots —
 *    Home, Settings, and Profile (Requirement 3.7). Notifications is always
 *    supplied because the shell supplies it itself (Requirement 3.9), so it is
 *    added to every generated subset rather than generated over.
 * 2. **Which Destination is being viewed.** All four, so the supplied branch and
 *    the unsupplied branch of the same generated subset are both exercised.
 * 3. **The requested path.** That Destination's registered path, upper-cased,
 *    trailing-slashed, or with further whole segments beneath a nested
 *    Destination — the spellings Requirements 3.11 and 3.13 make equivalent, so
 *    "its control is marked current" is checked against every way of arriving.
 * 4. **The layout.** In the Wide_Layout the destination controls are rendered
 *    directly; in the Compact_Layout the same list sits behind the header's
 *    disclosure, which the harness expands first — a collapsed surface renders no
 *    control to mark, so the criterion is about the expanded list
 *    (Requirements 1.6, 1.7).
 *
 * ### The route table is not involved
 *
 * `shellRoutes.tsx` lands under task 14.5, so the harness composes the frame and
 * decides the Content_Region's content itself, exactly as the route table will:
 * a supplied slot renders that slot's component, an unsupplied one renders
 * {@link DestinationUnavailable}. That keeps this property about the
 * Unavailable_State inside a real frame rather than about the wiring.
 *
 * ### Synthetic supplied content, and why
 *
 * A supplied slot is content the shell never sees the source of
 * (Requirement 3.7), so the harness supplies its own: a heading deliberately
 * *unlike* the registered label, plus a marker string and a test id unique to
 * that Destination. The distinct heading is what makes the unsupplied assertion
 * bite — the heading equalling `destinationLabel(id)` can only have come from the
 * Unavailable_State — and the markers are how "the Destination_Content of another
 * Destination" is detected: not one of them may appear on a rendering of any other
 * Destination.
 *
 * ### The notification and account slots
 *
 * Filled with plain `<button>` stand-ins rather than the real
 * {@link NotificationPanel} and {@link AccountMenu}. Both real surfaces can carry
 * the Generic_Notification_Failure message and a `role="status"` region of their
 * own, which is a *notification* failure and nothing to do with the
 * Unavailable_State — mounting them would put text into the rendering that
 * {@link expectNoErrorIndication} is specifically looking for, and would need the
 * notification provider and a sign-out seam besides. The stand-ins contribute no
 * landmark, no heading, no live region, and no error wording, so what this file
 * measures is the frame plus the content and nothing else. Those two surfaces have
 * their own tests, and the accessibility audits in task 14.6 cover them in place.
 *
 * Worked examples for a single Destination live in `DestinationUnavailable.test.tsx`;
 * this file is the generator-driven property at the 100-iteration floor
 * Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 5: An unsupplied destination renders its own unavailable state and nothing else
 * Validates: Requirements 3.7, 3.8
 */
import { type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fc from 'fast-check';

import { DestinationUnavailable } from './DestinationUnavailable';
import { ShellFrame } from './ShellFrame';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import {
  HOME_ROUTE,
  SHELL_DESTINATIONS,
  destinationLabel,
  type DestinationId,
} from './lib/destinations';
import {
  ACCOUNT_MENU_LABEL,
  HOME_CONTROL_LABEL,
  PRIMARY_NAVIGATION_TOGGLE,
  UNAVAILABLE_BODY,
} from './lib/messages';
import { WIDE_LAYOUT_QUERY, type ShellLayout } from './state/useViewportLayout';

// --- The Destinations and their content slots --------------------------------

/**
 * The Destination_Content slots Requirement 3.7 makes injectable — the ones that
 * can be absent, and so the ones this property quantifies over.
 */
const INJECTABLE_IDS: readonly DestinationId[] = ['home', 'settings', 'profile'];

/**
 * The Notifications_Destination's content is supplied by the shell itself
 * (Requirement 3.9), so it is never absent and never generated over.
 */
const ALWAYS_SUPPLIED_ID: DestinationId = 'notifications';

const ALL_IDS: readonly DestinationId[] = SHELL_DESTINATIONS.map(
  (destination) => destination.id,
);

/**
 * The level-one heading of each synthetic supplied content.
 *
 * Deliberately *not* the registered label: an `h1` reading `destinationLabel(id)`
 * can then only have come from the Unavailable_State, which is what makes the
 * heading assertion a real one rather than a tautology.
 */
const SUPPLIED_HEADING: Record<DestinationId, string> = {
  home: 'Supplied home body',
  notifications: 'Supplied notifications body',
  settings: 'Supplied settings body',
  profile: 'Supplied profile body',
};

/** A string only ever rendered by one Destination's supplied content. */
const SUPPLIED_MARKER: Record<DestinationId, string> = {
  home: 'marker:home-content',
  notifications: 'marker:notifications-content',
  settings: 'marker:settings-content',
  profile: 'marker:profile-content',
};

/** Stand-in Destination_Content for a supplied slot (Requirement 3.7). */
function SuppliedContent({
  destinationId,
}: {
  readonly destinationId: DestinationId;
}): ReactElement {
  return (
    <div data-testid={`supplied-${destinationId}`}>
      <h1>{SUPPLIED_HEADING[destinationId]}</h1>
      <p>{SUPPLIED_MARKER[destinationId]}</p>
      <button type="button">Inside content</button>
    </div>
  );
}

// --- The layout stub ---------------------------------------------------------

const originalMatchMedia = window.matchMedia;

/**
 * Report the generated layout to {@link useViewportLayout}.
 *
 * jsdom answers every query non-matching, which would pin the frame to the
 * Compact_Layout; the Wide_Layout is where the destination controls are rendered
 * directly, so both need to be reachable.
 */
function installLayout(layout: ShellLayout): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: layout === 'wide' && query === WIDE_LAYOUT_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

// --- The rendered harness ----------------------------------------------------

const NOTIFICATIONS_STAND_IN = 'Notifications alerts';

/**
 * Render one shell route: the real frame, the real Primary_Navigation, stand-in
 * header surfaces, and — as the route table will (task 14.5) — either the
 * Destination's supplied content or the Unavailable_State.
 */
function renderDestination({
  destinationId,
  requestedPath,
  supplied,
  layout,
}: {
  readonly destinationId: DestinationId;
  readonly requestedPath: string;
  readonly supplied: ReadonlySet<DestinationId>;
  readonly layout: ShellLayout;
}): HTMLElement {
  installLayout(layout);

  const { container } = render(
    <MemoryRouter initialEntries={[requestedPath]}>
      <ShellFrame
        navigation={(props) => <PrimaryNavigation {...props} />}
        notifications={() => (
          <button type="button">{NOTIFICATIONS_STAND_IN}</button>
        )}
        account={() => <button type="button">{ACCOUNT_MENU_LABEL}</button>}
      >
        {supplied.has(destinationId) ? (
          <SuppliedContent destinationId={destinationId} />
        ) : (
          <DestinationUnavailable destinationId={destinationId} />
        )}
      </ShellFrame>
    </MemoryRouter>,
  );

  if (layout === 'compact') {
    // 1.6: the destination controls live behind the disclosure at compact widths,
    // so expand it — a collapsed surface renders no control to mark current.
    fireEvent.click(screen.getByRole('button', { name: PRIMARY_NAVIGATION_TOGGLE }));
  }

  return container;
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 3.8: exactly one level-one heading, carrying that Destination's
 * *registered* visible label.
 */
function expectHeadingIsTheRegisteredLabel(destinationId: DestinationId): void {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(
    new RegExp(`^${destinationLabel(destinationId)}$`),
  );
  // The one heading belongs to the content, not to the frame (Requirements 1.9, 13.2).
  expect(screen.getByRole('main')).toContainElement(headings[0]);
}

/**
 * Requirement 3.8: the Shell_Header and the Primary_Navigation stay rendered —
 * an absent body changes nothing about the frame.
 */
function expectFrameSurvives(): void {
  const banner = screen.getByRole('banner');
  const navigation = screen.getByRole('navigation');

  expect(banner).toContainElement(navigation);
  // The header's other surfaces are still there too, so "the header stays
  // rendered" is more than the landmark element surviving.
  expect(
    within(banner).getByRole('button', { name: NOTIFICATIONS_STAND_IN }),
  ).toBeInTheDocument();
  expect(
    within(banner).getByRole('button', { name: ACCOUNT_MENU_LABEL }),
  ).toBeInTheDocument();

  // 3.3: one control per registered Destination, each carrying its label.
  const controls = within(navigation).getAllByRole('link');
  expect(controls.map((control) => control.textContent)).toEqual(
    SHELL_DESTINATIONS.map((destination) => destination.label),
  );
}

/**
 * Requirement 3.8: that Destination's control is marked as the current page, and
 * no other control is.
 */
function expectOnlyThisDestinationIsCurrent(destinationId: DestinationId): void {
  const marked = Array.from(
    document.querySelectorAll<HTMLElement>('[aria-current]'),
    (element) => ({
      destination: element.getAttribute('data-destination'),
      value: element.getAttribute('aria-current'),
    }),
  );

  expect(marked).toEqual([{ destination: destinationId, value: 'page' }]);
}

/**
 * Requirement 3.8: a control that navigates to the Home_Destination, inside the
 * content rather than only in the navigation — the navigation's Home control is
 * there whatever the content is, so it cannot be what satisfies this.
 */
function expectControlToHome(): void {
  const main = screen.getByRole('main');
  const control = within(main).getByRole('link', { name: HOME_CONTROL_LABEL });

  expect(control).toHaveAttribute('href', HOME_ROUTE);
}

/**
 * Requirement 3.8: no other Destination's Destination_Content is rendered.
 *
 * Checked against the markers *and* the test ids of all four supplied contents,
 * including the viewed Destination's own — an unsupplied slot renders no content
 * at all, so none of them may be present.
 */
function expectNoOtherDestinationContent(): void {
  for (const id of ALL_IDS) {
    expect(screen.queryByTestId(`supplied-${id}`)).toBeNull();
    expect(screen.queryByText(SUPPLIED_MARKER[id])).toBeNull();
    expect(screen.queryByText(SUPPLIED_HEADING[id])).toBeNull();
  }
}

/** Words that would frame an absent injected body as something going wrong. */
const ERROR_VOCABULARY =
  /\b(error|errors|failed|failure|fail|wrong|sorry|problem|unable|invalid|broken|oops|unavailable)\b/i;

/**
 * Requirement 3.8: no error indication.
 *
 * Three things at once: no assertive announcement anywhere, no live region or
 * error attribute contributed by the content itself, and no error wording in the
 * Content_Region's text. The frame's own announcer is a `role="status"` region
 * that is always mounted (Requirement 13.12) and carries the heading text, so it
 * is identified and excluded by node rather than by role.
 */
function expectNoErrorIndication(): void {
  const main = screen.getByRole('main');
  const announcer = main.querySelector('[data-testid="auth-live-region"]');

  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.querySelector('[aria-invalid]')).toBeNull();

  const liveRegions = Array.from(
    main.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
  );
  // Only the frame's announcer, and it is not an alert.
  expect(liveRegions).toEqual(announcer === null ? [] : [announcer]);

  const spoken = main.textContent ?? '';
  expect(spoken).not.toMatch(ERROR_VOCABULARY);
}

/** The whole of Requirement 3.8 for a Destination whose content is absent. */
function expectUnavailableContract(destinationId: DestinationId): void {
  expect(screen.getByText(UNAVAILABLE_BODY)).toBeInTheDocument();

  expectHeadingIsTheRegisteredLabel(destinationId);
  expectFrameSurvives();
  expectOnlyThisDestinationIsCurrent(destinationId);
  expectControlToHome();
  expectNoOtherDestinationContent();
  expectNoErrorIndication();
}

/**
 * Requirement 3.7: a supplied slot renders *its* content, and no
 * Unavailable_State — the other half of the property's quantifier, and what makes
 * the assertion above specific to absence.
 */
function expectSuppliedContract(destinationId: DestinationId): void {
  expect(screen.getByTestId(`supplied-${destinationId}`)).toBeInTheDocument();
  expect(screen.getByText(SUPPLIED_MARKER[destinationId])).toBeInTheDocument();
  expect(screen.queryByText(UNAVAILABLE_BODY)).toBeNull();

  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(SUPPLIED_HEADING[destinationId]);

  // No other Destination's content came along with it.
  for (const other of ALL_IDS.filter((id) => id !== destinationId)) {
    expect(screen.queryByTestId(`supplied-${other}`)).toBeNull();
    expect(screen.queryByText(SUPPLIED_MARKER[other])).toBeNull();
  }

  expectFrameSurvives();
  expectOnlyThisDestinationIsCurrent(destinationId);
}

// --- Generators --------------------------------------------------------------

/**
 * Any subset of the injectable slots, plus the Notifications_Destination the
 * shell always supplies (Requirements 3.7, 3.9).
 */
const suppliedSlotsArb: fc.Arbitrary<ReadonlySet<DestinationId>> = fc
  .subarray([...INJECTABLE_IDS])
  .map((subset) => new Set<DestinationId>([...subset, ALWAYS_SUPPLIED_ID]));

/** A further whole segment beneath a nested Destination's path. */
const nestedSegmentArb: fc.Arbitrary<string> = fc.constantFrom(
  'abc',
  'a-b',
  '42',
  'deep/er',
);

/**
 * A requested path that resolves to `destinationId` — its registered path, in any
 * of the spellings Requirements 3.11 and 3.13 make equivalent.
 */
function requestedPathArb(destinationId: DestinationId): fc.Arbitrary<string> {
  const registered = SHELL_DESTINATIONS.find(
    (destination) => destination.id === destinationId,
  )?.path;
  // The registry is the source of paths, so an id with none is a defect here.
  if (registered === undefined) {
    throw new Error(`No Destination is registered with the id "${destinationId}".`);
  }

  const exact = fc.constantFrom(
    registered,
    registered.toUpperCase(),
    `${registered}/`,
  );

  // 3.11: only a nested Destination admits further segments; a path beneath
  // `/app` is not Home's.
  return registered === HOME_ROUTE
    ? exact
    : fc.oneof(
        exact,
        nestedSegmentArb.map((segment) => `${registered}/${segment}`),
      );
}

const layoutArb: fc.Arbitrary<ShellLayout> = fc.constantFrom('compact', 'wide');

/** One generated rendering: which slots exist, which Destination, how addressed. */
interface RenderCase {
  readonly supplied: ReadonlySet<DestinationId>;
  readonly destinationId: DestinationId;
  readonly requestedPath: string;
  readonly layout: ShellLayout;
}

const renderCaseArb: fc.Arbitrary<RenderCase> = fc
  .tuple(suppliedSlotsArb, fc.constantFrom(...ALL_IDS), layoutArb)
  .chain(([supplied, destinationId, layout]) =>
    requestedPathArb(destinationId).map((requestedPath) => ({
      supplied,
      destinationId,
      requestedPath,
      layout,
    })),
  );

// --- The property ------------------------------------------------------------

describe('Property 5 — an unsupplied destination renders its own unavailable state and nothing else', () => {
  // Feature: app-shell, Property 5: An unsupplied destination renders its own unavailable state and nothing else
  // Validates: Requirements 3.7, 3.8
  it('renders the unavailable state for an absent slot and the content for a supplied one', () => {
    fc.assert(
      fc.property(renderCaseArb, (renderCase) => {
        renderDestination(renderCase);
        try {
          if (renderCase.supplied.has(renderCase.destinationId)) {
            expectSuppliedContract(renderCase.destinationId);
          } else {
            expectUnavailableContract(renderCase.destinationId);
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: app-shell, Property 5: An unsupplied destination renders its own unavailable state and nothing else
  // Validates: Requirements 3.7, 3.8
  it('shows the unavailable state at exactly the destinations whose content is absent', () => {
    fc.assert(
      fc.property(suppliedSlotsArb, layoutArb, (supplied, layout) => {
        // The whole registry in one go, so the property's "each destination whose
        // content is absent" is checked as a set equality rather than one
        // Destination at a time: no absent slot is missed, and no supplied slot
        // shows the state.
        const unavailableAt = ALL_IDS.filter((destinationId) => {
          const registered = SHELL_DESTINATIONS.find(
            (destination) => destination.id === destinationId,
          );
          renderDestination({
            destinationId,
            requestedPath: registered?.path ?? HOME_ROUTE,
            supplied,
            layout,
          });
          try {
            return screen.queryByText(UNAVAILABLE_BODY) !== null;
          } finally {
            cleanup();
          }
        });

        expect(unavailableAt).toEqual(
          ALL_IDS.filter((destinationId) => !supplied.has(destinationId)),
        );
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});
