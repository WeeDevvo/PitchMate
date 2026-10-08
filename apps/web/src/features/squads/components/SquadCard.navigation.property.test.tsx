/**
 * Property test for Squad_Card activation (task 10.3).
 *
 * **Property 3: Activating a Squad_Card navigates to that squad and nowhere
 * else.** *For any* rendered Squad_Card and any of pointer activation, Enter, and
 * Space while that card holds focus, the resulting navigation target is the
 * Squad_Route path built from that card's squad identity, exactly one history
 * entry is added, and no full-document reload occurs.
 *
 * | Clause of Requirement 1.8 | Where it is asserted |
 * | --- | --- |
 * | navigates to the Squad_Route for *that card's* squad identity | {@link expectArrivedAtSquad} |
 * | within 500 milliseconds of the activation | asserted with no timer advance and no polling — see below |
 * | adds **exactly one** history entry | {@link expectExactlyOnePush} and the back-navigation property |
 * | performs no full-document reload | {@link expectNoReload} |
 *
 * ### The card is exercised through a real router, not through a spy
 *
 * `SquadCard` takes an `onOpen` callback, and the Squads_Home supplies
 * `(squadId) => navigate(squadPath(squadId))`. A test that asserted on a mocked
 * `useNavigate` would pin the *argument* the card produces and say nothing about
 * the history entry or the reload, which are the two clauses of Requirement 1.8
 * that are actually easy to get wrong. So the card is mounted inside a real
 * `createMemoryRouter` behind the same `onOpen` the screen will pass, following
 * `app-shell/RouteGuard.property.test.tsx` (which reads `historyAction` and steps
 * back through the router) and the sibling `NotFoundTreatment.test.tsx` (which
 * observes client-side navigation rather than assuming it).
 *
 * The route table holds a catch-all `*` route rendering an "elsewhere" stand-in,
 * so "navigates nowhere else" is an *observation* rather than the absence of a
 * match: a navigation to a path no route claims would render that stand-in and
 * fail the assertion instead of silently rendering nothing.
 *
 * ### What is quantified over, and why each dimension exists
 *
 * 1. **The activation.** Pointer, Enter, and Space — the three Requirement 1.8
 *    names. Because the card is a native `<button>` these share one code path
 *    today, which is exactly the claim worth locking down: a later change to a
 *    `div` with an `onClick` would keep pointer passing and break both keys.
 * 2. **Which card of the listing is activated.** Two to five cards render, and the
 *    activated one is chosen by index, so "that card's squad identity" has other
 *    identities it could plausibly have reached. A card that navigated to, say,
 *    the first summary of the collection would pass a single-card test.
 * 3. **The squad identity.** Generated GUID v7 identities in mixed hex case — the
 *    shape `parseSquadSummary` accepts (`readUuid`) — so the target path is
 *    compared against `squadPath` over many identities rather than one literal.
 * 4. **The rendered name.** Names that collide and names differing only in case,
 *    which is why every card is located through its
 *    `SQUAD_CARD_ID_ATTRIBUTE` rather than by accessible name: two cards may read
 *    identically, and the navigation must still be the activated one's.
 * 5. **Role and state, present and `null`.** Both absences render a label in place
 *    of the value (1.6, 1.7), which changes the control's contents and therefore
 *    the node the pointer and the keyboard reach.
 *
 * ### "Within 500 milliseconds"
 *
 * No fake timers are installed and no polling helper is used. Each activation is
 * followed by a single act flush, and the destination is asserted synchronously
 * after it — so the navigation is complete within one flush of the activation,
 * which is strictly stronger than the 500 millisecond bound and cannot be
 * satisfied by a delayed navigation the way a `waitFor` could.
 *
 * ### "Exactly one history entry"
 *
 * Two independent measurements, because either alone is weak:
 *
 * - **From the inside:** the router is subscribed to for the whole run, so every
 *   location it moves through is recorded. The recorded sequence must be exactly
 *   one step, and its `historyAction` must be `PUSH` — not `REPLACE` (which adds
 *   no entry) and not two pushes.
 * - **From the outside:** the history is seeded as `['/', HOME_ROUTE]`, so a
 *   single back step after the activation must land on the listing again. Had the
 *   card replaced the entry, back would reach `/`; had it pushed twice, back would
 *   reach an intermediate path. This is the same corroboration the Route_Guard's
 *   property uses, inverted — that one replaces, this one pushes.
 *
 * ### "No full-document reload"
 *
 * Four probes, since jsdom cannot actually reload:
 *
 * - A sentinel element rendered *outside* the `RouterProvider` must be the same
 *   node before and after, as `NotFoundTreatment.test.tsx` checks — a reload
 *   replaces the document and with it that node.
 * - jsdom's own error channel is recorded, and no report may mention navigation.
 *   jsdom implements no document navigation and reports every attempt there, so an
 *   `href` assignment or a form submission surfaces rather than passing unnoticed.
 *   That the recorder genuinely sees such an attempt is itself asserted, by a
 *   harness control that performs one — the first draft of this probe listened on
 *   `console.error`, which the report reaches *without* passing through a spy, and
 *   the control is what caught it.
 * - The activated control carries no `href` and is `type="button"`, so neither a
 *   link default nor an implicit form submission exists to be prevented.
 * - `fetch` and `XMLHttpRequest.prototype.open` are recorded for the whole file
 *   and asserted untouched, as `PlaceholderSection.property.test.tsx` does, so
 *   nothing reached the network by any other route either.
 *
 * Feature: web-squads-screens, Property 3: Activating a Squad_Card navigates to that squad and nowhere else
 * Validates: Requirements 1.8
 */
import { type ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import {
  createMemoryRouter,
  RouterProvider,
  useNavigate,
  useParams,
  type RouteObject,
} from 'react-router-dom';

import { SQUAD_CARD_ID_ATTRIBUTE, SquadCard } from './SquadCard';
import { HOME_ROUTE } from '../../app-shell';
import { SQUAD_ROUTE, squadPath } from '../lib/routePaths';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import type { SquadSummary } from '../lib/parse/squadSummary';

// --- Landmarks the stand-ins render ------------------------------------------

/** The listing's heading, so a return to it is observable. */
const LISTING_HEADING = 'Your squads';

/** Text only the entry *beneath* the listing renders. */
const BENEATH_TEXT = 'Before the listing';

/** Carries the `squadId` the Squad_Route resolved with. */
const ARRIVED_TEST_ID = 'squad-route-stand-in';

/** Rendered by the catch-all route, so "nowhere else" is observable. */
const ELSEWHERE_TEST_ID = 'elsewhere-stand-in';

/** A node outside the router, whose identity a full-document reload would break. */
const SENTINEL_TEST_ID = 'outside-the-router';

// --- Generators ---------------------------------------------------------------

/** Hex digits in both cases: an identity's case must not change its path. */
const HEX_DIGITS = '0123456789abcdefABCDEF'.split('');

/** A hex run of exactly `length` characters. */
const hexRun = (length: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom(...HEX_DIGITS), { minLength: length, maxLength: length })
    .map((digits) => digits.join(''));

/**
 * A GUID v7 identity in the 36-character hyphenated form `readUuid` accepts, so
 * every generated summary is one `parseSquadSummary` could have produced.
 */
const squadIdArb: fc.Arbitrary<string> = fc
  .tuple(
    hexRun(8),
    hexRun(4),
    hexRun(3),
    fc.constantFrom('8', '9', 'a', 'b', 'A', 'B'),
    hexRun(3),
    hexRun(12),
  )
  .map(
    ([timeHigh, timeMid, rand, variant, variantRest, node]) =>
      `${timeHigh}-${timeMid}-7${rand}-${variant}${variantRest}-${node}`,
  );

/**
 * Names that collide and names differing only in case — the reason a card is
 * located by its squad identity attribute and never by its accessible name.
 */
const nameArb: fc.Arbitrary<string> = fc.constantFrom(
  'Thursday Ballers',
  'thursday ballers',
  'THURSDAY BALLERS',
  'Sunday League',
  'Ålesund FC',
);

const roleArb: fc.Arbitrary<SquadRole | null> = fc.constantFrom<
  SquadRole | null
>('Owner', 'Admin', 'Member', null);

const stateArb: fc.Arbitrary<MembershipState | null> = fc.constantFrom<
  MembershipState | null
>('Active', 'Inactive', null);

const summaryArb: fc.Arbitrary<SquadSummary> = fc.record({
  squadId: squadIdArb,
  name: nameArb,
  role: roleArb,
  state: stateArb,
});

/**
 * A listing of two to five distinct squads: the activated card always has
 * somewhere else it could have gone.
 */
const listingArb: fc.Arbitrary<readonly SquadSummary[]> = fc.uniqueArray(
  summaryArb,
  { minLength: 2, maxLength: 5, selector: (summary) => summary.squadId },
);

/** The three activations Requirement 1.8 names. */
type ActivationKind = 'pointer' | 'enter' | 'space';

const activationArb: fc.Arbitrary<ActivationKind> = fc.constantFrom<ActivationKind>(
  'pointer',
  'enter',
  'space',
);

// --- The harness --------------------------------------------------------------

/**
 * The Squads_Home stand-in: the cards, opened exactly the way the screen opens
 * them — `(squadId) => navigate(squadPath(squadId))`. The path is built by the
 * production function, so a card and the registered route cannot disagree here in
 * a way they would not disagree in the application.
 */
function Listing({
  summaries,
}: {
  readonly summaries: readonly SquadSummary[];
}): ReactElement {
  const navigate = useNavigate();

  return (
    <div>
      <h1>{LISTING_HEADING}</h1>
      {summaries.map((summary) => (
        <SquadCard
          key={summary.squadId}
          summary={summary}
          onOpen={(squadId) => navigate(squadPath(squadId))}
        />
      ))}
    </div>
  );
}

/** The Squad_Route stand-in, reporting the identity the route resolved with. */
function SquadStandIn(): ReactElement {
  const { squadId } = useParams();

  return <p data-testid={ARRIVED_TEST_ID}>{squadId ?? ''}</p>;
}

/** One location the router moved through. */
interface Step {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly action: string;
}

interface Harness {
  readonly router: ReturnType<typeof createMemoryRouter>;
  /** The node outside the router whose identity a reload would break. */
  readonly sentinel: HTMLElement;
  /** Every location the router moved through since the mount. */
  readonly steps: () => readonly Step[];
  readonly dispose: () => void;
}

/**
 * Mount the listing at the Squads_Home route, with `/` seeded beneath it so a
 * back step has somewhere distinct to land.
 */
function renderListing(summaries: readonly SquadSummary[]): Harness {
  const routes: RouteObject[] = [
    { path: '/', element: <p>{BENEATH_TEXT}</p> },
    { path: HOME_ROUTE, element: <Listing summaries={summaries} /> },
    { path: SQUAD_ROUTE, element: <SquadStandIn /> },
    { path: '*', element: <p data-testid={ELSEWHERE_TEST_ID}>Elsewhere</p> },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: ['/', HOME_ROUTE],
    initialIndex: 1,
  });

  const steps: Step[] = [];
  const unsubscribe = router.subscribe((state) => {
    const previous = steps.at(-1);
    const { pathname, search, hash } = state.location;

    // Only movements are recorded: a state update that leaves the location where
    // it was is not a history entry.
    if (
      previous !== undefined &&
      previous.pathname === pathname &&
      previous.search === search &&
      previous.hash === hash
    ) {
      return;
    }

    steps.push({ pathname, search, hash, action: state.historyAction });
  });

  render(
    <div>
      <span data-testid={SENTINEL_TEST_ID}>outside</span>
      <RouterProvider router={router} />
    </div>,
  );

  return {
    router,
    sentinel: screen.getByTestId(SENTINEL_TEST_ID),
    steps: () => steps,
    dispose: unsubscribe,
  };
}

/** The card of a given squad identity — never located by its readable name. */
function cardFor(squadId: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[${SQUAD_CARD_ID_ATTRIBUTE}="${squadId}"]`,
  );

  expect(card, `no card rendered for ${squadId}`).not.toBeNull();

  return card as HTMLElement;
}

/** Activate a card by pointer, by Enter, or by Space while it holds focus. */
async function activateCard(
  user: UserEvent,
  card: HTMLElement,
  kind: ActivationKind,
): Promise<void> {
  if (kind === 'pointer') {
    await user.click(card);
  } else {
    card.focus();
    expect(card).toHaveFocus();
    await user.keyboard(kind === 'enter' ? '{Enter}' : ' ');
  }

  // One flush, no timer advance and no polling: the navigation must be complete
  // by the next assertion, which is well inside Requirement 1.8's 500 ms.
  await act(async () => {});
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 1.8: the target is the Squad_Route path built from *that* card's
 * squad identity, and no other squad and no other route was reached.
 */
function expectArrivedAtSquad(harness: Harness, summary: SquadSummary): void {
  const { pathname, search, hash } = harness.router.state.location;

  expect(pathname).toBe(squadPath(summary.squadId));
  // Nothing was appended to the target: the path is exactly what `squadPath`
  // builds.
  expect(search).toBe('');
  expect(hash).toBe('');

  // The route resolved with that identity, so the destination is the squad's own
  // screen rather than a path that merely looks right.
  expect(screen.getByTestId(ARRIVED_TEST_ID)).toHaveTextContent(summary.squadId);

  // "Nowhere else": the catch-all did not render, and the listing was left.
  expect(screen.queryByTestId(ELSEWHERE_TEST_ID)).toBeNull();
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  expect(screen.queryByText(BENEATH_TEXT)).toBeNull();
}

/**
 * Requirement 1.8: exactly one history entry is added — one movement, and that
 * movement pushed rather than replaced.
 */
function expectExactlyOnePush(harness: Harness, summary: SquadSummary): void {
  expect(harness.steps()).toEqual([
    {
      pathname: squadPath(summary.squadId),
      search: '',
      hash: '',
      action: 'PUSH',
    },
  ]);
  expect(harness.router.state.historyAction).toBe('PUSH');
}

/** Requirement 1.8: the activation performed no full-document reload. */
function expectNoReload(harness: Harness, card: HTMLElement): void {
  // The tree outside the router survived, node identity included.
  expect(screen.getByTestId(SENTINEL_TEST_ID)).toBe(harness.sentinel);
  expect(document.body.contains(harness.sentinel)).toBe(true);

  // No document navigation was attempted: jsdom implements none, and reports
  // every attempt on its own error channel, which is recorded for this file.
  expect(recordedNavigationAttempts()).toEqual([]);

  // And there was nothing to reload with: no link default, no implicit submit.
  expect(card.tagName).toBe('BUTTON');
  expect(card.getAttribute('type')).toBe('button');
  expect(card.hasAttribute('href')).toBe(false);
  expect(card.closest('form')).toBeNull();
}

// --- The property -------------------------------------------------------------

describe('SquadCard — Property 3 (activating a card navigates to that squad and nowhere else)', () => {
  // Feature: web-squads-screens, Property 3: Activating a Squad_Card navigates to that squad and nowhere else
  // Validates: Requirements 1.8
  it('reaches squadPath(squadId) with exactly one pushed entry and no reload, for pointer, Enter, and Space', async () => {
    await fc.assert(
      fc.asyncProperty(
        listingArb,
        fc.nat(),
        activationArb,
        async (summaries, offset, activation) => {
          const target = summaries[offset % summaries.length];
          const harness = renderListing(summaries);

          try {
            const card = cardFor(target.squadId);

            await activateCard(userEvent.setup(), card, activation);

            expectArrivedAtSquad(harness, target);
            expectExactlyOnePush(harness, target);
            expectNoReload(harness, card);
            expectNoCallIssued();
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 3: Activating a Squad_Card navigates to that squad and nowhere else
  // Validates: Requirements 1.8
  it('leaves the browser back control on the listing, so exactly one entry was added', async () => {
    await fc.assert(
      fc.asyncProperty(
        listingArb,
        fc.nat(),
        activationArb,
        async (summaries, offset, activation) => {
          const target = summaries[offset % summaries.length];
          const harness = renderListing(summaries);

          try {
            await activateCard(
              userEvent.setup(),
              cardFor(target.squadId),
              activation,
            );
            expectArrivedAtSquad(harness, target);

            await act(async () => {
              await harness.router.navigate(-1);
            });

            // One entry was added, so one step back reaches the listing. Had the
            // card replaced the entry, back would reach `/`; had it pushed twice,
            // back would reach an intermediate path.
            expect(harness.router.state.location.pathname).toBe(HOME_ROUTE);
            expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
              LISTING_HEADING,
            );
            expect(screen.queryByText(BENEATH_TEXT)).toBeNull();
            // Every card is back, so the return is the listing itself and not a
            // partially restored view of it.
            for (const summary of summaries) {
              expect(cardFor(summary.squadId)).toBeInTheDocument();
            }
            expect(screen.getByTestId(SENTINEL_TEST_ID)).toBe(harness.sentinel);
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

/**
 * Harness control, not a property: the assertions above are only meaningful if
 * this harness *could* have observed a different destination. So the router is
 * driven to a squad the activated card does not name and to a path no route
 * claims, and both are visible.
 */
describe('SquadCard navigation property harness', () => {
  const summaries: readonly SquadSummary[] = [
    {
      squadId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01',
      name: 'Thursday Ballers',
      role: 'Owner',
      state: 'Active',
    },
    {
      squadId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02',
      name: 'Thursday Ballers',
      role: null,
      state: null,
    },
  ];

  it('harnessSeesAnotherSquadAsADifferentDestination', async () => {
    const harness = renderListing(summaries);

    try {
      await act(async () => {
        await harness.router.navigate(squadPath(summaries[1].squadId));
      });

      expect(screen.getByTestId(ARRIVED_TEST_ID)).toHaveTextContent(
        summaries[1].squadId,
      );
      // The first squad's assertion would have failed here, which is what makes
      // "that card's squad identity" a real claim.
      expect(screen.getByTestId(ARRIVED_TEST_ID)).not.toHaveTextContent(
        summaries[0].squadId,
      );
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('harnessSeesAnUnclaimedPathAsElsewhere', async () => {
    const harness = renderListing(summaries);

    try {
      await act(async () => {
        await harness.router.navigate('/app/squads');
      });

      expect(screen.getByTestId(ELSEWHERE_TEST_ID)).toBeInTheDocument();
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('harnessRecordsAnAttemptedDocumentNavigation', () => {
    // Control for the reload probe: a genuine document navigation must be visible
    // to the recorder, or `expectNoReload`'s navigation assertion would hold just
    // as happily for a card that did reload. jsdom performs no navigation — it
    // reports the attempt and leaves the document alone.
    window.location.href = 'https://pitch-mate.co.uk/elsewhere';

    expect(recordedNavigationAttempts()).not.toEqual([]);
  });

  it('harnessDistinguishesAReplacementFromAPush', async () => {
    const harness = renderListing(summaries);

    try {
      await act(async () => {
        await harness.router.navigate(squadPath(summaries[0].squadId), {
          replace: true,
        });
      });

      // The measurement the first property relies on: a replacement is visible as
      // `REPLACE`, and stepping back reaches what preceded the listing.
      expect(harness.steps().map((step) => step.action)).toEqual(['REPLACE']);

      await act(async () => {
        await harness.router.navigate(-1);
      });

      expect(harness.router.state.location.pathname).toBe('/');
      expect(screen.getByText(BENEATH_TEXT)).toBeInTheDocument();
    } finally {
      harness.dispose();
      cleanup();
    }
  });
});

// --- Recorders ----------------------------------------------------------------

/**
 * jsdom implements no document navigation: it reports every attempt on its own
 * error channel and leaves the document alone. That channel is what this file
 * listens to — deliberately *not* `console.error`, which the channel's output
 * reaches without passing through a spy, so a spy there would record nothing and
 * the reload assertion would pass for a card that reloaded. The harness control
 * `harnessRecordsAnAttemptedDocumentNavigation` performs a real navigation and
 * fails if this recorder ever stops seeing it.
 */
interface VirtualConsoleHost {
  readonly _virtualConsole?: {
    on(event: 'jsdomError', listener: (error: unknown) => void): void;
  };
}

let recordedJsdomErrors: string[] = [];

(window as unknown as VirtualConsoleHost)._virtualConsole?.on(
  'jsdomError',
  (error) => {
    const message = (error as { message?: unknown } | null)?.message;
    recordedJsdomErrors.push(String(message ?? error));
  },
);

/** Every attempted document navigation recorded since the current test began. */
function recordedNavigationAttempts(): readonly string[] {
  return recordedJsdomErrors.filter((message) =>
    message.toLowerCase().includes('navigation'),
  );
}

beforeEach(() => {
  recordedJsdomErrors = [];
  recordedCalls = [];
});

// --- No call is issued anywhere in this file ----------------------------------

const originalFetch = globalThis.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;

let recordedCalls: string[] = [];

globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  recordedCalls.push(`fetch ${String(args[0])}`);
  return Promise.reject(new Error('No call is expected from a Squad_Card.'));
}) as typeof fetch;

XMLHttpRequest.prototype.open = function open(
  this: XMLHttpRequest,
  ...args: Parameters<XMLHttpRequest['open']>
): void {
  recordedCalls.push(`xhr ${String(args[0])} ${String(args[1])}`);
  return originalXhrOpen.apply(this, args as never);
};

/** Opening a squad is a navigation, not a request. */
function expectNoCallIssued(): void {
  expect(recordedCalls).toEqual([]);
}

afterAll(() => {
  globalThis.fetch = originalFetch;
  XMLHttpRequest.prototype.open = originalXhrOpen;
});
