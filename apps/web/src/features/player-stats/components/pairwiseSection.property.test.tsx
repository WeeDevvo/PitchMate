// Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
// Validates: Requirements 1.7, 10.5, 10.6

/**
 * Property test for Pairwise_Link navigation (task 10.9).
 *
 * **Property 37: Every pairwise entry opens that entry's own profile in the same
 * squad.** *For any* parsed Player_Profile and *any* entry of *any* of the four
 * Pairwise_Sections, that entry renders exactly one keyboard-operable control
 * whose accessible name carries that entry's own Player_Display_Name, whose
 * navigation target is the path `playerStatsPath` builds from the **route's**
 * squad identity and **that entry's** membership identity, and whose activation
 * — by pointer, by Enter, and by Space — adds exactly one history entry and
 * performs no full-document reload.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | exactly one control per entry, and none for a section with no entry (10.5) | {@link expectExactlyOneControl} |
 * | operable by keyboard (10.5) | {@link expectExactlyOneControl}, and the Enter and Space activations |
 * | the accessible name carries that entry's display name (10.5) | {@link expectNamedByItsOwnEntry} |
 * | the target is `playerStatsPath(routeSquadId, entryMembershipId)` (1.7, 10.6) | {@link expectTargetsItsOwnProfile} |
 * | arriving there, and nowhere else (10.6) | {@link expectArrivedAtEntry} |
 * | exactly one history entry (10.6) | {@link expectExactlyOnePush} and the back-navigation property |
 * | no full-document reload (10.6) | {@link expectNoReload} |
 *
 * ## Quantified over a real router, not over a spy
 *
 * `PairwiseSection` navigates with `useNavigate`. A test that mocked the hook
 * would pin the *argument* each control passes and say nothing about the history
 * entry or the reload, which are the two clauses of Requirement 10.6 that are
 * actually easy to get wrong. So every run mounts the four sections inside a real
 * `createMemoryRouter` at {@link PLAYER_STATS_ROUTE} — the same pattern the links
 * target, which is the whole point of the subject-keyed load machine — and
 * arrival is read from the **router's own location**, following
 * `SquadCard.navigation.property.test.tsx` and the sibling
 * `PairwiseSection.test.tsx`.
 *
 * The squad identity the sections are given is the one `useParams` resolves from
 * that route, so "the route's current squad identity" is the route's and not a
 * constant the test and the component happen to share. The route table carries a
 * catch-all `*`, so "nowhere else" is an *observation*: a navigation to a path no
 * route claims renders the elsewhere stand-in and fails an assertion rather than
 * silently rendering nothing.
 *
 * ## What is quantified over, and why each dimension exists
 *
 * 1. **The profile.** Whole parsed profiles from the shared fixtures, so the
 *    entries carry the display names the backend really sends — empty,
 *    whitespace-padded, graphemic — and the collection sizes reach 0, 1, and the
 *    design's 200.
 * 2. **Which of the four collections, and which entry of it.** Both are chosen by
 *    the generator, so "that entry's own profile" has other entries it could
 *    plausibly have reached. Two of the four sections render the co-appearance
 *    variant and two the paired-stat variant, and all four are mounted at once,
 *    so a control that reached the wrong *section's* entry is visible too.
 * 3. **The activation.** Pointer, Enter, and Space — the three the task names.
 *    These share one code path today because the control is a native `<button>`,
 *    which is exactly the claim worth locking down: a later change to a `div`
 *    with an `onClick`, or to an anchor, would keep pointer passing and break
 *    Space.
 * 4. **The two entries the task singles out.** An entry whose membership identity
 *    is the **subject's own** — where the target path equals the path already
 *    rendered, so a same-path push is exercised rather than avoided — and an
 *    entry whose name is the **Anonymised_Placeholder**, which keeps its control
 *    (Requirement 10.8). Both are injected into all four collections by the
 *    generator, and each also has its own property below.
 * 5. **The squad identity.** Generated in mixed hex case from the fixtures' own
 *    identity arbitrary, so the target is compared against `playerStatsPath` over
 *    many identities rather than one literal.
 *
 * ## "Exactly one history entry"
 *
 * Two independent measurements, because either alone is weak:
 *
 * - **From the inside:** the router is subscribed to for the whole run and every
 *   location it moves through is recorded. The recorded sequence must be exactly
 *   one step whose `historyAction` is `PUSH` — not `REPLACE`, which adds no
 *   entry, and not two pushes. Movements are told apart by the location **key**
 *   rather than by its path, because the subject's own entry targets the path
 *   already rendered and a push there is still a new entry.
 * - **From the outside:** the history is seeded as `['/', <the subject's path>]`,
 *   so one back step after the activation must return to the subject's own
 *   location, key included. Had the control replaced the entry, back would reach
 *   `/`; had it pushed twice, back would reach an intermediate entry with another
 *   key.
 *
 * ## "No full-document reload"
 *
 * Three probes, since jsdom cannot actually reload: a sentinel node rendered
 * *outside* the `RouterProvider` must be the same node afterwards; jsdom's own
 * error channel — where it reports every attempted document navigation, having
 * implemented none — must mention none; and the activated control must be a
 * `type="button"` carrying no `href` and standing in no form, so neither a link
 * default nor an implicit submission exists to be prevented. The harness controls
 * at the foot of the file assert that each probe can still see what it is looking
 * for.
 *
 * ## The accessible name is read as the browser computes it
 *
 * Through jest-dom's `toHaveAccessibleName`, which runs the accessible-name
 * computation rather than reading markup. That computation trims and flattens
 * whitespace, so the claim is **containment** of the display name's flattened
 * form: a name parsed as `'  Dave  '` is announced as `'Dave'`, and the control
 * must still be that entry's. The name as parsed is asserted separately and
 * exactly, on the control's own text, so nothing reformats a name on the way in.
 *
 * Deliberately **not** claimed here: the order, the figures, the empty treatment,
 * and the Former_Player label itself, all of which `PairwiseSection.test.tsx`
 * states plainly beside this file. Restating them would hide a regression behind
 * a duplicate.
 */
import { type ReactElement } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import {
  createMemoryRouter,
  RouterProvider,
  useParams,
  type RouteObject,
} from 'react-router-dom';

import {
  PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE,
  PAIRWISE_ENTRY_SELECTOR,
  PAIRWISE_FORMER_PLAYER_SELECTOR,
  PAIRWISE_LINK_PATH_ATTRIBUTE,
  PAIRWISE_LINK_SELECTOR,
  PAIRWISE_SECTION_SELECTOR,
  PAIRWISE_SECTION_VARIANT_ATTRIBUTE,
  PairwiseSection,
} from './PairwiseSection';
import { PLAYER_STATS_ROUTE, playerStatsPath } from '../../squads';
import { ANONYMISED_PLACEHOLDER } from '../lib/anonymisedName';
import {
  BEST_PARTNERSHIPS_HEADING,
  BOGEY_OPPONENTS_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  MOST_PLAYED_WITH_HEADING,
} from '../lib/messages';
import type {
  CoAppearanceEntry,
  PairedStatEntry,
  PlayerProfile,
} from '../lib/parse/playerProfile';
import {
  emptyCollectionsProfileFixtureArb,
  playerProfileFixtureArb,
  profileFixtureArb,
  singletonCollectionsProfileFixtureArb,
  wireIdentityArb,
} from '../testing/playerProfileFixtures';

/* -------------------------------------------------------------------------- */
/* The four collections                                                       */
/* -------------------------------------------------------------------------- */

/** The four Pairwise_Sections, named as the parsed profile names them. */
const COLLECTION_KEYS = [
  'mostPlayedWith',
  'mostPlayedAgainst',
  'bestPartnerships',
  'bogeyOpponents',
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** The heading each section is given, so the four are told apart on screen. */
const SECTION_HEADING: Readonly<Record<CollectionKey, string>> = {
  mostPlayedWith: MOST_PLAYED_WITH_HEADING,
  mostPlayedAgainst: MOST_PLAYED_AGAINST_HEADING,
  bestPartnerships: BEST_PARTNERSHIPS_HEADING,
  bogeyOpponents: BOGEY_OPPONENTS_HEADING,
};

/**
 * What this property needs of an entry, whichever variant carries it: who it is,
 * and what it is called. The figures are the sibling unit tests' business.
 */
interface PairwiseTarget {
  readonly membershipId: string;
  readonly displayName: string;
}

/** One section's variant and its entries, kept together so neither can drift. */
type SectionData =
  | {
      readonly variant: 'co-appearance';
      readonly entries: readonly CoAppearanceEntry[];
    }
  | {
      readonly variant: 'paired-stat';
      readonly entries: readonly PairedStatEntry[];
    };

/** One rendered section: which collection it is, and what it holds. */
interface SectionCase {
  readonly key: CollectionKey;
  readonly heading: string;
  readonly data: SectionData;
  /** The same entries, reduced to what this property asserts over. */
  readonly targets: readonly PairwiseTarget[];
}

/** One run's whole situation: the route it stands at, and the four sections. */
interface Scenario {
  /** The squad identity in the mounted path — the one the route resolves. */
  readonly squadId: string;
  /** The subject whose screen the sections are rendered on. */
  readonly subjectMembershipId: string;
  readonly sections: readonly SectionCase[];
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which of the two entries the task singles out are injected into every
 * collection: the one naming the **subject's own** membership, and the one whose
 * name is the Anonymised_Placeholder.
 */
const INJECTIONS = ['none', 'self', 'placeholder', 'both'] as const;

type Injection = (typeof INJECTIONS)[number];

const injectionArb: fc.Arbitrary<Injection> = fc.constantFrom(...INJECTIONS);

/** The identity the injected Former_Player entry carries. */
const ERASED_MEMBERSHIP_ID = '018f3a2b-4c5d-7e6f-8a9b-ffffffffff01';

/** Whether the subject's own entry is injected. */
const injectsSelf = (injection: Injection): boolean =>
  injection === 'self' || injection === 'both';

/** Whether the Former_Player entry is injected. */
const injectsPlaceholder = (injection: Injection): boolean =>
  injection === 'placeholder' || injection === 'both';

/**
 * A co-appearance collection with the singled-out entries appended.
 *
 * The subject's own entry carries the subject's own parsed name, so a profile
 * whose own name is the placeholder exercises both corners at once. The counts
 * are fixed: this property asserts nothing about a figure.
 */
function coAppearanceEntries(
  profile: PlayerProfile,
  entries: readonly CoAppearanceEntry[],
  injection: Injection,
): readonly CoAppearanceEntry[] {
  const appended: CoAppearanceEntry[] = [];

  if (injectsSelf(injection)) {
    appended.push({
      membershipId: profile.membershipId,
      displayName: profile.displayName,
      count: 3,
    });
  }

  if (injectsPlaceholder(injection)) {
    appended.push({
      membershipId: ERASED_MEMBERSHIP_ID,
      displayName: ANONYMISED_PLACEHOLDER,
      count: 5,
    });
  }

  return [...entries, ...appended];
}

/** A paired-stat collection with the same two entries appended. */
function pairedStatEntries(
  profile: PlayerProfile,
  entries: readonly PairedStatEntry[],
  injection: Injection,
): readonly PairedStatEntry[] {
  const appended: PairedStatEntry[] = [];

  if (injectsSelf(injection)) {
    appended.push({
      membershipId: profile.membershipId,
      displayName: profile.displayName,
      value: 50,
      qualifyingMatches: 4,
    });
  }

  if (injectsPlaceholder(injection)) {
    appended.push({
      membershipId: ERASED_MEMBERSHIP_ID,
      displayName: ANONYMISED_PLACEHOLDER,
      value: 25,
      qualifyingMatches: 8,
    });
  }

  return [...entries, ...appended];
}

/** The entries of a section, reduced to the identity and the name. */
function targetsOf(
  entries: readonly PairwiseTarget[],
): readonly PairwiseTarget[] {
  return entries.map(({ membershipId, displayName }) => ({
    membershipId,
    displayName,
  }));
}

/** One run's four sections, built from a parsed profile. */
function scenarioOf(
  profile: PlayerProfile,
  squadId: string,
  injection: Injection,
): Scenario {
  const coAppearance = (
    key: 'mostPlayedWith' | 'mostPlayedAgainst',
    entries: readonly CoAppearanceEntry[],
  ): SectionCase => {
    const injected = coAppearanceEntries(profile, entries, injection);

    return {
      key,
      heading: SECTION_HEADING[key],
      data: { variant: 'co-appearance', entries: injected },
      targets: targetsOf(injected),
    };
  };

  const pairedStat = (
    key: 'bestPartnerships' | 'bogeyOpponents',
    entries: readonly PairedStatEntry[],
  ): SectionCase => {
    const injected = pairedStatEntries(profile, entries, injection);

    return {
      key,
      heading: SECTION_HEADING[key],
      data: { variant: 'paired-stat', entries: injected },
      targets: targetsOf(injected),
    };
  };

  return {
    squadId,
    subjectMembershipId: profile.membershipId,
    sections: [
      coAppearance('mostPlayedWith', profile.mostPlayedWith),
      coAppearance('mostPlayedAgainst', profile.mostPlayedAgainst),
      pairedStat('bestPartnerships', profile.bestPartnerships),
      pairedStat('bogeyOpponents', profile.bogeyOpponents),
    ],
  };
}

/**
 * A parsed profile at the collection sizes that matter: ordinary, empty,
 * singleton, and the design's 200 entries per section.
 *
 * The 200-entry shape carries no progression, because this file renders no
 * chart and no table of points — generating 500 of them would cost every run
 * and prove nothing here.
 */
const parsedProfileArb: fc.Arbitrary<PlayerProfile> = fc
  .oneof(
    { weight: 6, arbitrary: profileFixtureArb },
    { weight: 2, arbitrary: emptyCollectionsProfileFixtureArb },
    { weight: 2, arbitrary: singletonCollectionsProfileFixtureArb },
    {
      weight: 1,
      arbitrary: playerProfileFixtureArb({
        pairwise: { minLength: 200, maxLength: 200 },
        progression: { minLength: 0, maxLength: 0 },
      }),
    },
  )
  .map((fixture) => fixture.parsed);

/** A parsed profile with ordinary-sized collections, for the heavier runs. */
const smallParsedProfileArb: fc.Arbitrary<PlayerProfile> = fc
  .oneof(
    { weight: 6, arbitrary: profileFixtureArb },
    { weight: 2, arbitrary: emptyCollectionsProfileFixtureArb },
    { weight: 2, arbitrary: singletonCollectionsProfileFixtureArb },
  )
  .map((fixture) => fixture.parsed);

/** A scenario over the given profiles and the given injection. */
function scenarioArbOver(
  profiles: fc.Arbitrary<PlayerProfile>,
  injections: fc.Arbitrary<Injection>,
): fc.Arbitrary<Scenario> {
  return fc
    .tuple(profiles, wireIdentityArb, injections)
    .map(([profile, squadId, injection]) =>
      scenarioOf(profile, squadId, injection),
    );
}

/** The three activations the task names. */
const ACTIVATIONS = ['pointer', 'enter', 'space'] as const;

type ActivationKind = (typeof ACTIVATIONS)[number];

const activationArb: fc.Arbitrary<ActivationKind> = fc.constantFrom(
  ...ACTIVATIONS,
);

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** Reports the membership identity the Player_Stats_Route resolved with. */
const SUBJECT_TEST_ID = 'player-stats-subject-stand-in';

/** Reports the squad identity the Player_Stats_Route resolved with. */
const ROUTE_SQUAD_TEST_ID = 'player-stats-squad-stand-in';

/** Wraps one section, so an entry is read from the section it belongs to. */
const SECTION_WRAPPER_PREFIX = 'pairwise-section-';

/** A node outside the router, whose identity a full-document reload would break. */
const SENTINEL_TEST_ID = 'outside-the-router';

/** Rendered by the catch-all route, so "nowhere else" is observable. */
const ELSEWHERE_TEST_ID = 'elsewhere-stand-in';

/** Text only the entry *beneath* the subject's own path renders. */
const BENEATH_TEXT = 'Before the player stats';

/**
 * The Player_Stats_Screen stand-in: the four sections, each given the squad
 * identity **the route resolved** rather than one passed in by the test, which
 * is what Requirement 10.6's "the route's current squad identity" means.
 */
function SectionStack({
  sections,
}: {
  readonly sections: readonly SectionCase[];
}): ReactElement {
  const { squadId, membershipId } = useParams();

  return (
    <div>
      <p data-testid={ROUTE_SQUAD_TEST_ID}>{squadId ?? ''}</p>
      <p data-testid={SUBJECT_TEST_ID}>{membershipId ?? ''}</p>
      {sections.map((section) => (
        <div
          key={section.key}
          data-testid={`${SECTION_WRAPPER_PREFIX}${section.key}`}
        >
          {section.data.variant === 'co-appearance' ? (
            <PairwiseSection
              heading={section.heading}
              squadId={squadId ?? ''}
              variant="co-appearance"
              entries={section.data.entries}
            />
          ) : (
            <PairwiseSection
              heading={section.heading}
              squadId={squadId ?? ''}
              variant="paired-stat"
              entries={section.data.entries}
            />
          )}
        </div>
      ))}
    </div>
  );
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
  /** The path the sections were mounted at: the subject's own. */
  readonly subjectPath: string;
  /** The subject's own history entry, so a return to it is recognisable. */
  readonly subjectKey: string;
  /** The node outside the router whose identity a reload would break. */
  readonly sentinel: HTMLElement;
  /** Every location the router moved through since the mount. */
  readonly steps: () => readonly Step[];
  readonly dispose: () => void;
}

/**
 * Mount the four sections at the subject's own Player_Stats_Route path, with `/`
 * seeded beneath it so a back step has somewhere distinct to land.
 */
function renderStack(scenario: Scenario): Harness {
  const subjectPath = playerStatsPath(
    scenario.squadId,
    scenario.subjectMembershipId,
  );

  const routes: RouteObject[] = [
    { path: '/', element: <p>{BENEATH_TEXT}</p> },
    {
      path: PLAYER_STATS_ROUTE,
      element: <SectionStack sections={scenario.sections} />,
    },
    { path: '*', element: <p data-testid={ELSEWHERE_TEST_ID}>Elsewhere</p> },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: ['/', subjectPath],
    initialIndex: 1,
  });

  const subjectKey = router.state.location.key;
  const steps: Step[] = [];
  let lastKey = subjectKey;

  const unsubscribe = router.subscribe((state) => {
    const { key, pathname, search, hash } = state.location;

    // Movements are told apart by the history **key**, not by the path: the
    // subject's own entry targets the path already rendered, and a push there is
    // still a new history entry. A state update that stays on one entry — which
    // the router also publishes — is not a movement.
    if (key === lastKey) {
      return;
    }

    lastKey = key;
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
    subjectPath,
    subjectKey,
    sentinel: screen.getByTestId(SENTINEL_TEST_ID),
    steps: () => steps,
    dispose: unsubscribe,
  };
}

/** The rendered entries of one section, in document order. */
function rowsOf(key: CollectionKey): readonly HTMLElement[] {
  const wrapper = screen.getByTestId(`${SECTION_WRAPPER_PREFIX}${key}`);

  return Array.from(
    wrapper.querySelectorAll<HTMLElement>(PAIRWISE_ENTRY_SELECTOR),
  );
}

/** Every Pairwise_Link of one section, in document order. */
function linksOf(key: CollectionKey): readonly HTMLElement[] {
  const wrapper = screen.getByTestId(`${SECTION_WRAPPER_PREFIX}${key}`);

  return Array.from(
    wrapper.querySelectorAll<HTMLElement>(PAIRWISE_LINK_SELECTOR),
  );
}

/**
 * The accessible-name computation's own flattening: trimmed, with runs of two or
 * more whitespace characters collapsed to one space.
 *
 * A name is announced in this form, so containment of *this* is what "the
 * accessible name includes that entry's display name" can mean for a name the
 * backend sent padded.
 */
function flattenedName(displayName: string): string {
  return displayName.trim().replace(/\s\s+/gu, ' ');
}

/** Activate a control by pointer, by Enter, or by Space while it holds focus. */
async function activateControl(
  user: UserEvent,
  control: HTMLElement,
  kind: ActivationKind,
): Promise<void> {
  if (kind === 'pointer') {
    await user.click(control);
  } else {
    control.focus();
    expect(control).toHaveFocus();
    await user.keyboard(kind === 'enter' ? '{Enter}' : ' ');
  }

  // One flush, no timer advance and no polling: the navigation must be complete
  // by the next assertion.
  await act(async () => {});
}

/* -------------------------------------------------------------------------- */
/* The assertions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Requirement 10.5: each entry renders exactly one keyboard-operable control,
 * and a section renders one per entry and no other.
 */
function expectExactlyOneControl(section: SectionCase): void {
  const rows = rowsOf(section.key);
  const links = linksOf(section.key);

  expect(rows).toHaveLength(section.targets.length);
  expect(links).toHaveLength(section.targets.length);

  rows.forEach((row, index) => {
    // One control in this row, and it is the only control in it — so no entry
    // offers two ways to the same place, and none offers a second destination.
    expect(
      row.querySelectorAll(PAIRWISE_LINK_SELECTOR),
    ).toHaveLength(1);
    expect(row.querySelectorAll('a, button, [role="link"], [role="button"]'))
      .toHaveLength(1);

    const control = links[index];

    // Operable by keyboard, which for a native button means: it takes focus, it
    // is not removed from the sequential order, and it is not disabled.
    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('type')).toBe('button');
    expect(control.hasAttribute('disabled')).toBe(false);
    expect(control.getAttribute('tabindex')).not.toBe('-1');
    expect(control.getAttribute('aria-hidden')).not.toBe('true');

    control.focus();
    expect(control).toHaveFocus();
  });
}

/**
 * Requirement 10.5: the control's accessible name carries **that entry's own**
 * display name, and the name reaches the control exactly as parsed.
 */
function expectNamedByItsOwnEntry(
  control: HTMLElement,
  target: PairwiseTarget,
): void {
  // As parsed: nothing trimmed, nothing re-cased, nothing appended. The
  // Former_Player label is a sibling of the control, so it cannot be what the
  // control is called.
  expect(control.textContent).toBe(target.displayName);

  // As announced: the computation trims and flattens, so containment of the
  // flattened name is the claim. An entry the backend sent with no name at all
  // has nothing to announce, and the control's existence is all 10.5 can ask.
  const announced = flattenedName(target.displayName);

  if (announced !== '') {
    expect(control).toHaveAccessibleName(expect.stringContaining(announced));
  }
}

/**
 * Requirements 1.7 and 10.6: the stated target is the path the squads barrel
 * builds from the route's squad identity and this entry's membership identity.
 */
function expectTargetsItsOwnProfile(
  control: HTMLElement,
  scenario: Scenario,
  target: PairwiseTarget,
): void {
  expect(control.getAttribute(PAIRWISE_LINK_PATH_ATTRIBUTE)).toBe(
    playerStatsPath(scenario.squadId, target.membershipId),
  );

  // The route the control stands in is the squad it builds inside, read back
  // from the router rather than assumed.
  expect(screen.getByTestId(ROUTE_SQUAD_TEST_ID).textContent).toBe(
    scenario.squadId,
  );
}

/**
 * Requirement 10.6: the activation arrived at that entry's own profile in the
 * same squad, and nowhere else.
 */
function expectArrivedAtEntry(
  harness: Harness,
  scenario: Scenario,
  target: PairwiseTarget,
): void {
  const { pathname, search, hash } = harness.router.state.location;

  expect(pathname).toBe(playerStatsPath(scenario.squadId, target.membershipId));
  // Nothing was appended to the target: the path is exactly what the builder
  // builds.
  expect(search).toBe('');
  expect(hash).toBe('');

  // The route resolved with that entry's identity inside the same squad, so the
  // destination is that player's own screen and not a path that merely looks
  // right.
  expect(screen.getByTestId(SUBJECT_TEST_ID).textContent).toBe(
    target.membershipId,
  );
  expect(screen.getByTestId(ROUTE_SQUAD_TEST_ID).textContent).toBe(
    scenario.squadId,
  );

  // "Nowhere else": no unclaimed path was reached, and the entry beneath the
  // subject's own was not revisited.
  expect(screen.queryByTestId(ELSEWHERE_TEST_ID)).toBeNull();
  expect(screen.queryByText(BENEATH_TEXT)).toBeNull();
}

/**
 * Requirement 10.6: exactly one history entry was added — one movement, and that
 * movement pushed rather than replaced.
 */
function expectExactlyOnePush(
  harness: Harness,
  scenario: Scenario,
  target: PairwiseTarget,
): void {
  expect(harness.steps()).toEqual([
    {
      pathname: playerStatsPath(scenario.squadId, target.membershipId),
      search: '',
      hash: '',
      action: 'PUSH',
    },
  ]);
  expect(harness.router.state.historyAction).toBe('PUSH');
}

/** Requirement 10.6: the activation performed no full-document reload. */
function expectNoReload(harness: Harness, control: HTMLElement): void {
  // The tree outside the router survived, node identity included.
  expect(screen.getByTestId(SENTINEL_TEST_ID)).toBe(harness.sentinel);
  expect(document.body.contains(harness.sentinel)).toBe(true);

  // No document navigation was attempted: jsdom implements none and reports
  // every attempt on its own error channel, which is recorded for this file.
  expect(recordedNavigationAttempts()).toEqual([]);

  // And there was nothing to reload with: no link default, no implicit submit.
  expect(control.hasAttribute('href')).toBe(false);
  expect(control.closest('form')).toBeNull();
}

/* -------------------------------------------------------------------------- */
/* The property                                                               */
/* -------------------------------------------------------------------------- */

describe('PairwiseSection — Property 37 (every entry opens that entry’s own profile in the same squad)', () => {
  // Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
  // Validates: Requirements 1.7, 10.5, 10.6
  it('gives every entry of all four collections exactly one keyboard-operable control, named by that entry and targeting its own profile', () => {
    fc.assert(
      fc.property(
        scenarioArbOver(parsedProfileArb, injectionArb),
        (scenario) => {
          const harness = renderStack(scenario);

          try {
            for (const section of scenario.sections) {
              // The section rendered, and rendered the variant it was given —
              // so the entries below are the ones this collection carries.
              const body = screen
                .getByTestId(`${SECTION_WRAPPER_PREFIX}${section.key}`)
                .querySelector(PAIRWISE_SECTION_SELECTOR);

              expect(
                body?.getAttribute(PAIRWISE_SECTION_VARIANT_ATTRIBUTE),
              ).toBe(section.data.variant);

              // 10.5: one control per entry, none for a section with no entry.
              expectExactlyOneControl(section);

              const rows = rowsOf(section.key);
              const links = linksOf(section.key);

              section.targets.forEach((target, index) => {
                // The row is this entry's: the rendered order is the arrival
                // order, so index is identity here.
                expect(
                  rows[index].getAttribute(
                    PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE,
                  ),
                ).toBe(target.membershipId);

                expectNamedByItsOwnEntry(links[index], target);
                expectTargetsItsOwnProfile(links[index], scenario, target);
              });
            }
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 120 },
    );
  }, 180_000);

  // Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
  // Validates: Requirements 1.7, 10.5, 10.6
  it('reaches that entry’s own profile with exactly one pushed entry and no reload, for pointer, Enter, and Space', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArbOver(smallParsedProfileArb, injectionArb),
        fc.constantFrom(...COLLECTION_KEYS),
        fc.nat(),
        activationArb,
        async (scenario, key, offset, activation) => {
          const section = scenario.sections.find((candidate) => candidate.key === key);

          expect(section).toBeDefined();

          const harness = renderStack(scenario);

          try {
            if (section === undefined || section.targets.length === 0) {
              // A collection with no entry offers no control to activate —
              // which is the whole of 10.6 for it, and is asserted rather than
              // assumed so the run is not silently skipped.
              expect(linksOf(key)).toHaveLength(0);
              return;
            }

            const index = offset % section.targets.length;
            const target = section.targets[index];
            const control = linksOf(key)[index];

            await activateControl(userEvent.setup(), control, activation);

            expectArrivedAtEntry(harness, scenario, target);
            expectExactlyOnePush(harness, scenario, target);
            expectNoReload(harness, control);
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 180 },
    );
  }, 180_000);

  // Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
  // Validates: Requirements 1.7, 10.5, 10.6
  it('leaves the browser back control on the subject’s own entry, so exactly one entry was added', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArbOver(smallParsedProfileArb, injectionArb),
        fc.constantFrom(...COLLECTION_KEYS),
        fc.nat(),
        activationArb,
        async (scenario, key, offset, activation) => {
          const section = scenario.sections.find((candidate) => candidate.key === key);
          const harness = renderStack(scenario);

          try {
            if (section === undefined || section.targets.length === 0) {
              expect(linksOf(key)).toHaveLength(0);
              return;
            }

            const index = offset % section.targets.length;
            const target = section.targets[index];

            await activateControl(
              userEvent.setup(),
              linksOf(key)[index],
              activation,
            );
            expectArrivedAtEntry(harness, scenario, target);

            await act(async () => {
              await harness.router.navigate(-1);
            });

            // One entry was added, so one step back returns to the subject's
            // own location — the same history entry, key included. Had the
            // control replaced the entry, back would reach `/`; had it pushed
            // twice, back would reach an intermediate entry with another key.
            expect(harness.router.state.location.pathname).toBe(
              harness.subjectPath,
            );
            expect(harness.router.state.location.key).toBe(harness.subjectKey);
            expect(screen.getByTestId(SUBJECT_TEST_ID).textContent).toBe(
              scenario.subjectMembershipId,
            );
            expect(screen.queryByText(BENEATH_TEXT)).toBeNull();
            expect(screen.getByTestId(SENTINEL_TEST_ID)).toBe(harness.sentinel);
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* The two entries the task singles out                                      */
/* -------------------------------------------------------------------------- */

describe('PairwiseSection — Property 37 at the two entries that look like exceptions', () => {
  // Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
  // Validates: Requirements 1.7, 10.5, 10.6
  it('opens the subject’s own profile again for an entry naming the subject’s own membership', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArbOver(smallParsedProfileArb, fc.constant<Injection>('self')),
        fc.constantFrom(...COLLECTION_KEYS),
        activationArb,
        async (scenario, key, activation) => {
          const section = scenario.sections.find((candidate) => candidate.key === key);
          const harness = renderStack(scenario);

          try {
            expect(section).toBeDefined();

            if (section === undefined) {
              return;
            }

            // The injected entry is the last of the collection.
            const index = section.targets.length - 1;
            const target = section.targets[index];

            expect(target.membershipId).toBe(scenario.subjectMembershipId);

            const control = linksOf(key)[index];

            expectTargetsItsOwnProfile(control, scenario, target);
            // The target is the path already rendered, which is the corner this
            // case exists for: a push to the same path is still one entry.
            expect(control.getAttribute(PAIRWISE_LINK_PATH_ATTRIBUTE)).toBe(
              harness.subjectPath,
            );

            await activateControl(userEvent.setup(), control, activation);

            expectArrivedAtEntry(harness, scenario, target);
            expectExactlyOnePush(harness, scenario, target);
            expectNoReload(harness, control);
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);

  // Feature: web-player-stats-screen, Property 37: Every pairwise entry opens that entry's own profile in the same squad
  // Validates: Requirements 1.7, 10.5, 10.6
  it('keeps the control of a Former_Player entry and opens that membership’s own profile', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArbOver(
          smallParsedProfileArb,
          fc.constant<Injection>('placeholder'),
        ),
        fc.constantFrom(...COLLECTION_KEYS),
        activationArb,
        async (scenario, key, activation) => {
          const section = scenario.sections.find((candidate) => candidate.key === key);
          const harness = renderStack(scenario);

          try {
            expect(section).toBeDefined();

            if (section === undefined) {
              return;
            }

            const index = section.targets.length - 1;
            const target = section.targets[index];

            expect(target.displayName).toBe(ANONYMISED_PLACEHOLDER);

            const row = rowsOf(key)[index];
            const control = linksOf(key)[index];

            // 10.8: the entry is presented as a Former_Player, and the label is
            // beside the control rather than inside it — so the control is
            // still named by the placeholder as parsed.
            expect(
              row.querySelector(PAIRWISE_FORMER_PLAYER_SELECTOR),
            ).not.toBeNull();
            expectNamedByItsOwnEntry(control, target);
            expectTargetsItsOwnProfile(control, scenario, target);

            await activateControl(userEvent.setup(), control, activation);

            expectArrivedAtEntry(harness, scenario, target);
            expectExactlyOnePush(harness, scenario, target);
            expectNoReload(harness, control);
          } finally {
            harness.dispose();
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 180_000);
});

/* -------------------------------------------------------------------------- */
/* Harness controls                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Not properties: the assertions above are only meaningful if this harness
 * *could* have observed a different destination, an unclaimed path, a
 * replacement, and a reload. Each control drives one of those deliberately.
 */
describe('PairwiseSection navigation property harness', () => {
  const scenario: Scenario = scenarioOf(
    {
      membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02',
      displayName: 'BigDave',
      state: 'Active',
      isGuest: false,
      record: { appearances: 3, wins: 2, draws: 0, losses: 1 },
      winPercentage: 66.7,
      rating: { state: 'Established', displayRating: 1_184 },
      progression: [],
      winStreak: 1,
      unbeatenStreak: 2,
      mostPlayedWith: [
        {
          membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f11',
          displayName: 'Dave',
          count: 14,
        },
        {
          membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f12',
          displayName: 'Ömer',
          count: 9,
        },
      ],
      mostPlayedAgainst: [],
      bestPartnerships: [],
      bogeyOpponents: [],
      bibAppearances: 4,
      rich: null,
    },
    '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01',
    'none',
  );

  const firstEntry = scenario.sections[0].targets[0];
  const secondEntry = scenario.sections[0].targets[1];

  it('harnessSeesAnotherMembershipAsADifferentDestination', async () => {
    const harness = renderStack(scenario);

    try {
      await act(async () => {
        await harness.router.navigate(
          playerStatsPath(scenario.squadId, secondEntry.membershipId),
        );
      });

      expect(screen.getByTestId(SUBJECT_TEST_ID).textContent).toBe(
        secondEntry.membershipId,
      );
      // The first entry's assertion would have failed here, which is what makes
      // "that entry's own profile" a real claim.
      expect(screen.getByTestId(SUBJECT_TEST_ID).textContent).not.toBe(
        firstEntry.membershipId,
      );
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('harnessSeesAnotherSquadAsADifferentDestination', async () => {
    const harness = renderStack(scenario);

    try {
      await act(async () => {
        await harness.router.navigate(
          playerStatsPath(
            '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7fff',
            firstEntry.membershipId,
          ),
        );
      });

      // Leaving the squad is observable, so "in the same squad" is a claim the
      // harness could have caught breaking.
      expect(screen.getByTestId(ROUTE_SQUAD_TEST_ID).textContent).not.toBe(
        scenario.squadId,
      );
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('harnessSeesAnUnclaimedPathAsElsewhere', async () => {
    const harness = renderStack(scenario);

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

  it('harnessDistinguishesAReplacementFromAPush', async () => {
    const harness = renderStack(scenario);

    try {
      await act(async () => {
        await harness.router.navigate(
          playerStatsPath(scenario.squadId, firstEntry.membershipId),
          { replace: true },
        );
      });

      // The measurement the properties rely on: a replacement is visible as
      // `REPLACE`, and stepping back reaches what preceded the subject's path.
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

  it('harnessCountsASamePathPushAsAHistoryEntry', async () => {
    const harness = renderStack(scenario);

    try {
      // The subject's own entry targets the path already rendered. If the
      // recorder told movements apart by path rather than by history key, this
      // push would go unrecorded and `expectExactlyOnePush` would pass for a
      // control that navigated nowhere at all.
      await act(async () => {
        await harness.router.navigate(harness.subjectPath);
      });

      expect(harness.steps()).toEqual([
        {
          pathname: harness.subjectPath,
          search: '',
          hash: '',
          action: 'PUSH',
        },
      ]);
      expect(harness.router.state.location.key).not.toBe(harness.subjectKey);
    } finally {
      harness.dispose();
      cleanup();
    }
  });

  it('harnessRecordsAnAttemptedDocumentNavigation', () => {
    // Control for the reload probe: a genuine document navigation must be
    // visible to the recorder, or `expectNoReload`'s navigation assertion would
    // hold just as happily for a control that did reload. jsdom performs no
    // navigation — it reports the attempt and leaves the document alone.
    window.location.href = 'https://pitch-mate.co.uk/elsewhere';

    expect(recordedNavigationAttempts()).not.toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* The reload recorder                                                        */
/* -------------------------------------------------------------------------- */

/**
 * jsdom implements no document navigation: it reports every attempt on its own
 * error channel and leaves the document alone. That channel is what this file
 * listens to — deliberately *not* `console.error`, which the channel's output
 * reaches without passing through a spy, so a spy there would record nothing and
 * the reload assertion would pass for a control that reloaded. The harness
 * control `harnessRecordsAnAttemptedDocumentNavigation` performs a real
 * navigation and fails if this recorder ever stops seeing it.
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
});
