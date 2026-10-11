// Feature: web-player-stats-screen, Property 28: Every non-rich section survives every rich condition
// Validates: Requirements 11.7

import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import { PLAYER_STATS_ROUTE, playerStatsPath } from '../../squads';
import {
  BIB_APPEARANCES_SELECTOR,
  BIB_APPEARANCES_VALUE_SELECTOR,
  BibAppearances,
} from '../components/BibAppearances';
import {
  PAIRWISE_EMPTY_SELECTOR,
  PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE,
  PAIRWISE_ENTRY_SELECTOR,
  PAIRWISE_SECTION_SELECTOR,
  PAIRWISE_SECTION_VARIANT_ATTRIBUTE,
  PairwiseSection,
  type PairwiseVariant,
} from '../components/PairwiseSection';
import { PlayerIdentityHeader } from '../components/PlayerIdentityHeader';
import {
  PROGRESSION_CHART_SELECTOR,
  PROGRESSION_POINT_SELECTOR,
  ProgressionChart,
} from '../components/ProgressionChart';
import {
  PROGRESSION_ROW_SELECTOR,
  PROGRESSION_TABLE_SELECTOR,
  ProgressionTable,
} from '../components/ProgressionTable';
import {
  RATING_PANEL_CONDITION_ATTRIBUTE,
  RATING_PANEL_SELECTOR,
  RatingPanel,
} from '../components/RatingPanel';
import {
  RECORD_FIGURE_SELECTOR,
  RECORD_PANEL_SELECTOR,
  RecordPanel,
} from '../components/RecordPanel';
import { RESULT_BREAKDOWN_ITEM_SELECTOR } from '../components/ResultBreakdown';
import {
  RICH_STATS_CONDITION_ATTRIBUTE,
  RICH_STATS_PANEL_SELECTOR,
  RichStatsPanel,
} from '../components/RichStatsPanel';
import { STAT_SECTION_SELECTOR, StatSection } from '../components/StatSection';
import {
  STREAK_PANEL_SELECTOR,
  STREAK_VALUE_SELECTOR,
  StreakPanel,
} from '../components/StreakPanel';
import {
  BEST_PARTNERSHIPS_HEADING,
  BOGEY_OPPONENTS_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  MOST_PLAYED_WITH_HEADING,
  NO_RATING_HISTORY,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type {
  PlayerProfile,
  RichStats,
} from '../lib/parse/playerProfile';
import { toProgressionSeries } from '../lib/progression';
import { resolveRatingCondition } from '../lib/ratingCondition';
import { resolveRichCondition, type RichCondition } from '../lib/richStats';
import {
  allAbsentRichStatsFixtureArb,
  anyProfileFixtureArb,
  fullyPopulatedRichStatsFixtureArb,
  partialRichStatsFixtureArb,
} from '../testing/playerProfileFixtures';

/**
 * Property test for **graceful degradation**: turning live match tracking off
 * takes the live-tracking figures away and takes nothing else with them.
 *
 * The claim (Requirement 11.7): *for any parsed profile and for any of the three
 * rich conditions, the record, rating, progression, streak, bib, and all four
 * pairwise sections are rendered.*
 *
 * ## Why this property exists at all
 *
 * Live match tracking is a per-squad opt-in, and the great majority of squads
 * that use PitchMate for team balancing alone will never switch it on. For those
 * squads the `rich` block is simply absent, and the risk is not that the goals
 * figure goes missing — it is *meant* to — but that a section downstream of it
 * quietly goes with it: a guard written as "render the stats once we have the
 * block", a layout that collapses, a crash on a null read that takes the whole
 * screen's body out. Requirement 11.7 is the promise that the screen those
 * squads see is the full screen minus exactly one section, and this property is
 * what holds the promise to a shape rather than to a reviewer's attention.
 *
 * ## The harness, and why there is one
 *
 * `screens/PlayerStatsScreen.tsx` does **not exist yet** — it is task 11.1, which
 * runs after this one — so the property composes the sections itself in
 * {@link SectionStack} below. **The harness mirrors the screen's section set**:
 * the ten `StatSection`s named in `StatSection.tsx`'s own module note, in the
 * reading order task 11.1 fixes, over the identity header that carries the `h1`.
 * Task 11.1 assembles the real screen from these same components, so what is
 * asserted here is asserted of the parts the screen is made of; the heading-
 * outline and accessibility properties (Properties 33 to 35, task 14) then make
 * the same claims about the assembled screen.
 *
 * Two consequences of the harness being a harness:
 *
 *  - The five non-pairwise section headings are declared locally (see
 *    {@link RECORD_SECTION_HEADING}). `lib/messages.ts` carries the four
 *    Pairwise_Section headings and no others, because the screen's own section
 *    headings land with the screen in task 11.1; the four that do exist are read
 *    from there rather than restated.
 *  - `PairwiseSection` renders its **own** `StatSection` wrapper, heading
 *    included, so the harness renders it directly and never wraps it again —
 *    exactly as the screen must. Wrapping it would nest two regions and two
 *    level-two headings.
 *
 * ## How the three conditions are quantified over
 *
 * Each run generates one profile and **three** `rich` members for it — absent, a
 * block whose every member is absent, and a block with at least one value — so
 * the three conditions are exercised against *the same* profile. That pairing is
 * what lets the second block below make the stronger claim the requirement's
 * "removes only the rich statistics" actually asks for: the non-rich markup is
 * **byte-identical** across the three conditions, so no section merely survives
 * in a degraded form.
 *
 * The conditions are reached through `resolveRichCondition`, as the screen will
 * reach them, rather than by handing the panel a condition directly — a guard
 * added between the block and the condition would then be caught here too.
 *
 * ## Deliberately not claimed here
 *
 *  - That the two tracking conditions are never presented as one another
 *    (Property 26, `lib/richStats.property.test.ts`).
 *  - That an absent rich member renders a statement and never a numeral
 *    (Property 27, `components/richStatsPanel.property.test.tsx`).
 *  - That the heading outline holds, that every control is reachable, and that
 *    the screen is axe-clean in each condition (Properties 33 to 35, task 14).
 *
 * Restating any of them would hide a regression behind a duplicate.
 */

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The squad the screen is standing in — the route's own squad identity. */
const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/**
 * The record section's heading.
 *
 * Declared here rather than read from `lib/messages.ts`, which carries the four
 * Pairwise_Section headings and no others: the screen's own section headings
 * arrive with the screen in task 11.1. The words are the harness's, and nothing
 * below asserts them as copy — they are used only to name the ten sections so
 * the structural self-check can count them.
 */
const RECORD_SECTION_HEADING = 'Record';

/** The rating section's heading. See {@link RECORD_SECTION_HEADING}. */
const RATING_SECTION_HEADING = 'Rating';

/** The progression section's heading. See {@link RECORD_SECTION_HEADING}. */
const PROGRESSION_SECTION_HEADING = 'Rating progression';

/** The streaks section's heading. See {@link RECORD_SECTION_HEADING}. */
const STREAKS_SECTION_HEADING = 'Streaks';

/** The bib section's heading. See {@link RECORD_SECTION_HEADING}. */
const BIBS_SECTION_HEADING = 'Bibs';

/** The rich-stats section's heading. See {@link RECORD_SECTION_HEADING}. */
const RICH_SECTION_HEADING = 'Live match detail';

/**
 * The four Pairwise_Section headings, in the reading order the screen renders
 * them — read from `lib/messages.ts`, which is where the four this feature
 * already owns are declared.
 */
const PAIRWISE_SECTION_HEADINGS: readonly string[] = [
  MOST_PLAYED_WITH_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  BEST_PARTNERSHIPS_HEADING,
  BOGEY_OPPONENTS_HEADING,
];

/** Every section heading the harness renders, in reading order. */
const EVERY_SECTION_HEADING: readonly string[] = [
  RECORD_SECTION_HEADING,
  RATING_SECTION_HEADING,
  PROGRESSION_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
  BIBS_SECTION_HEADING,
  ...PAIRWISE_SECTION_HEADINGS,
  RICH_SECTION_HEADING,
];

/** The selector of the harness's non-rich region. */
const NON_RICH_SELECTOR = "[data-harness-non-rich='true']";

/** The selector of the harness's rich-stats region. */
const RICH_SELECTOR = "[data-harness-rich='true']";

/**
 * The harness's own stack of sections, mirroring the screen's section set.
 *
 * The non-rich sections are grouped under one element and the rich section under
 * another, which is the harness's single departure from the screen's flat
 * reading order: it is what lets the markup of everything that must survive be
 * read as one string and compared across the three conditions. The order within
 * each group is the screen's.
 */
function SectionStack({ profile }: { readonly profile: PlayerProfile }) {
  const series = toProgressionSeries(profile.progression);
  const ratingCondition = resolveRatingCondition(
    profile.rating,
    profile.record.appearances,
  );
  // Resolved from the block, as the screen resolves it — so a guard added
  // between a block and its condition is caught here too.
  const richCondition: RichCondition = resolveRichCondition(profile.rich);

  return (
    <div>
      <div data-harness-non-rich="true">
        <PlayerIdentityHeader
          displayName={profile.displayName}
          state={profile.state}
          isGuest={profile.isGuest}
        />

        <StatSection heading={RECORD_SECTION_HEADING}>
          <RecordPanel
            record={profile.record}
            winPercentage={profile.winPercentage}
          />
        </StatSection>

        <StatSection heading={RATING_SECTION_HEADING}>
          <RatingPanel
            playerName={profile.displayName}
            condition={ratingCondition}
          />
        </StatSection>

        <StatSection heading={PROGRESSION_SECTION_HEADING}>
          <ProgressionChart series={series} />
          <ProgressionTable series={series} />
        </StatSection>

        <StatSection heading={STREAKS_SECTION_HEADING}>
          <StreakPanel
            winStreak={profile.winStreak}
            unbeatenStreak={profile.unbeatenStreak}
          />
        </StatSection>

        <StatSection heading={BIBS_SECTION_HEADING}>
          <BibAppearances bibAppearances={profile.bibAppearances} />
        </StatSection>

        {/* Each of these renders its own `StatSection`, heading included, so it
            is never wrapped in a second one. */}
        <PairwiseSection
          heading={MOST_PLAYED_WITH_HEADING}
          squadId={SQUAD_ID}
          variant="co-appearance"
          entries={profile.mostPlayedWith}
        />
        <PairwiseSection
          heading={MOST_PLAYED_AGAINST_HEADING}
          squadId={SQUAD_ID}
          variant="co-appearance"
          entries={profile.mostPlayedAgainst}
        />
        <PairwiseSection
          heading={BEST_PARTNERSHIPS_HEADING}
          squadId={SQUAD_ID}
          variant="paired-stat"
          entries={profile.bestPartnerships}
        />
        <PairwiseSection
          heading={BOGEY_OPPONENTS_HEADING}
          squadId={SQUAD_ID}
          variant="paired-stat"
          entries={profile.bogeyOpponents}
        />
      </div>

      <div data-harness-rich="true">
        <StatSection heading={RICH_SECTION_HEADING}>
          <RichStatsPanel condition={richCondition} />
        </StatSection>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/** One of the three rich conditions, as the `rich` member that produces it. */
interface RichCase {
  /** The condition this case stands for, for a failure message. */
  readonly label: RichCondition['kind'];

  /** The profile's `rich` member. */
  readonly rich: RichStats | null;
}

/**
 * A rich block that resolves to `present`: at least one member carries a value.
 *
 * Both a fully populated block and a partially populated one, because each
 * member degrades independently and a section that survived only the complete
 * block would be a defect. The filter is what keeps the partial generator honest
 * — a partial block can draw every member absent, which is the *other*
 * condition.
 */
const presentRichStatsArb: fc.Arbitrary<RichStats> = fc
  .oneof(
    { weight: 2, arbitrary: fullyPopulatedRichStatsFixtureArb },
    { weight: 3, arbitrary: partialRichStatsFixtureArb },
  )
  .map((fixture) => fixture.parsed)
  .filter((stats) => resolveRichCondition(stats).kind === 'present');

/** A rich block whose every member is absent: tracking on, nothing recorded. */
const emptyRichStatsArb: fc.Arbitrary<RichStats> =
  allAbsentRichStatsFixtureArb.map((fixture) => fixture.parsed);

/**
 * The three conditions, generated together so one profile meets all three.
 *
 * The tuple is in a fixed order — disabled, empty, present — because the
 * assertions below name the condition each case stands for, and a failure should
 * say which.
 */
const richCasesArb: fc.Arbitrary<readonly [RichCase, RichCase, RichCase]> = fc
  .tuple(emptyRichStatsArb, presentRichStatsArb)
  .map(
    ([empty, present]) =>
      [
        // 11.1: the squad's live-match-tracking flag is off.
        { label: 'disabled', rich: null },
        // 11.2: it is on, and no event data exists.
        { label: 'empty', rich: empty },
        // 11.3: there is live detail to render.
        { label: 'present', rich: present },
      ] as const,
  );

/** A parsed profile of any shape the fixtures produce. */
const profileArb: fc.Arbitrary<PlayerProfile> = anyProfileFixtureArb.map(
  (fixture) => fixture.parsed,
);

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** What one Pairwise_Section rendered. */
interface RenderedPairwise {
  /** The section's heading, so the four are identifiable by subject. */
  readonly heading: string;

  /** The variant the section recorded rendering. */
  readonly variant: string;

  /** Each rendered entry's membership identity, in document order. */
  readonly membershipIds: readonly (string | null)[];

  /** Whether the nothing-to-show-yet statement stood in for the entries. */
  readonly empty: boolean;
}

/** Everything one render says about the sections that must survive. */
interface RenderedStack {
  /** How many `StatSection`s rendered. */
  readonly sectionCount: number;

  /** Every section heading, in document order. */
  readonly headings: readonly string[];

  /** The record panel's whole text, or `null` where it did not render. */
  readonly recordText: string | null;

  /** How many labelled figures the record panel rendered. */
  readonly recordFigureCount: number;

  /** Each result outcome's text, in document order. */
  readonly resultTexts: readonly string[];

  /** The Rating_Condition the rating panel recorded, or `null` if absent. */
  readonly ratingCondition: string | null;

  /** Whether the progression table rendered. */
  readonly progressionTablePresent: boolean;

  /** How many rows it rendered. */
  readonly progressionRowCount: number;

  /** Whether the chart rendered, and how many marks it drew. */
  readonly progressionChartPresent: boolean;
  readonly progressionPointCount: number;

  /** The whole progression section's text, for the no-history statement. */
  readonly progressionText: string;

  /** Each streak value's text, keyed by the streak it reports. */
  readonly streakTexts: Readonly<Record<string, string>>;

  /** Whether the streak panel rendered. */
  readonly streakPanelPresent: boolean;

  /** Whether the bib figure rendered. */
  readonly bibPanelPresent: boolean;

  /** The bib figure's text, or `null` where it did not render. */
  readonly bibText: string | null;

  /** The four Pairwise_Sections, in document order. */
  readonly pairwise: readonly RenderedPairwise[];

  /** The rich condition the panel recorded, or `null` where it did not render. */
  readonly richCondition: string | null;

  /** The non-rich region's markup, normalised. */
  readonly nonRichMarkup: string;

  /** The rich region's markup, normalised. */
  readonly richMarkup: string;
}

/**
 * Generated identifiers, which React allocates per tree position and which
 * therefore carry no information about the sections themselves.
 *
 * Stripped before the markup of two renders is compared: `StatSection` names its
 * region with `aria-labelledby` pointing at a `useId` value, and an id that
 * differed between two otherwise identical trees would make the comparison
 * report a difference that is not one.
 */
const GENERATED_ID_ATTRIBUTES = /(id|aria-labelledby|for)="[^"]*"/gu;

/** `markup` with every generated identifier replaced by a fixed placeholder. */
function withoutGeneratedIds(markup: string): string {
  return markup.replace(GENERATED_ID_ATTRIBUTES, '$1="·"');
}

/** The element matching `selector`, or a failure naming what was missing. */
function requireElement(
  container: HTMLElement,
  selector: string,
): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);

  if (element === null) {
    throw new Error(`the harness rendered nothing matching ${selector}`);
  }

  return element;
}

/**
 * Render the section stack for one profile and read the sections off it.
 *
 * A real client-side router, because `PairwiseSection` navigates with
 * `useNavigate` and every Pairwise_Link's destination is the very route the
 * stack is mounted at. Unmounted before returning: a property runs hundreds of
 * times within one test and Testing Library's automatic cleanup only fires
 * between tests, so without this the second render of a case would be read out
 * of a document still holding the first.
 */
function renderStack(profile: PlayerProfile): RenderedStack {
  const routes: RouteObject[] = [
    { path: PLAYER_STATS_ROUTE, element: <SectionStack profile={profile} /> },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [playerStatsPath(SQUAD_ID, profile.membershipId)],
  });

  try {
    const { container } = render(<RouterProvider router={router} />);

    const nonRich = requireElement(container, NON_RICH_SELECTOR);
    const rich = requireElement(container, RICH_SELECTOR);

    const sections = Array.from(
      container.querySelectorAll<HTMLElement>(STAT_SECTION_SELECTOR),
    );
    const headings = sections.map(
      (section) => section.querySelector('h2')?.textContent ?? '',
    );

    const recordPanel = container.querySelector<HTMLElement>(
      RECORD_PANEL_SELECTOR,
    );
    // Found by its heading rather than by its contents: an empty series renders
    // neither the chart nor the table, and the section is still there — which is
    // the whole of Requirement 8.6 and half of what this property claims.
    const progressionSection =
      sections[headings.indexOf(PROGRESSION_SECTION_HEADING)] ?? null;
    const streakPanel = container.querySelector<HTMLElement>(
      STREAK_PANEL_SELECTOR,
    );
    const bibValue = container.querySelector<HTMLElement>(
      BIB_APPEARANCES_VALUE_SELECTOR,
    );

    const streakTexts: Record<string, string> = {};

    for (const value of container.querySelectorAll<HTMLElement>(
      STREAK_VALUE_SELECTOR,
    )) {
      streakTexts[value.getAttribute('data-player-stats-streak') ?? ''] =
        value.textContent ?? '';
    }

    return {
      sectionCount: sections.length,
      headings,

      recordText: recordPanel?.textContent ?? null,
      recordFigureCount:
        recordPanel?.querySelectorAll(RECORD_FIGURE_SELECTOR).length ?? 0,
      resultTexts: Array.from(
        container.querySelectorAll<HTMLElement>(RESULT_BREAKDOWN_ITEM_SELECTOR),
      ).map((item) => item.textContent ?? ''),

      ratingCondition:
        container
          .querySelector(RATING_PANEL_SELECTOR)
          ?.getAttribute(RATING_PANEL_CONDITION_ATTRIBUTE) ?? null,

      progressionTablePresent:
        container.querySelector(PROGRESSION_TABLE_SELECTOR) !== null,
      progressionRowCount:
        container.querySelectorAll(PROGRESSION_ROW_SELECTOR).length,
      progressionChartPresent:
        container.querySelector(PROGRESSION_CHART_SELECTOR) !== null,
      progressionPointCount:
        container.querySelectorAll(PROGRESSION_POINT_SELECTOR).length,
      progressionText: progressionSection?.textContent ?? '',

      streakTexts,
      streakPanelPresent: streakPanel !== null,

      bibPanelPresent:
        container.querySelector(BIB_APPEARANCES_SELECTOR) !== null,
      bibText: bibValue?.textContent ?? null,

      pairwise: Array.from(
        container.querySelectorAll<HTMLElement>(PAIRWISE_SECTION_SELECTOR),
      ).map((section) => ({
        heading:
          section.closest(STAT_SECTION_SELECTOR)?.querySelector('h2')
            ?.textContent ?? '',
        variant: section.getAttribute(PAIRWISE_SECTION_VARIANT_ATTRIBUTE) ?? '',
        membershipIds: Array.from(
          section.querySelectorAll<HTMLElement>(PAIRWISE_ENTRY_SELECTOR),
        ).map((entry) =>
          entry.getAttribute(PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE),
        ),
        empty: section.querySelector(PAIRWISE_EMPTY_SELECTOR) !== null,
      })),

      richCondition:
        container
          .querySelector(RICH_STATS_PANEL_SELECTOR)
          ?.getAttribute(RICH_STATS_CONDITION_ATTRIBUTE) ?? null,

      nonRichMarkup: withoutGeneratedIds(nonRich.innerHTML),
      richMarkup: withoutGeneratedIds(rich.innerHTML),
    };
  } finally {
    cleanup();
  }
}

/* -------------------------------------------------------------------------- */
/* The sections that must survive                                             */
/* -------------------------------------------------------------------------- */

/**
 * Assert that every section Requirements 6 to 10 ask for rendered, with the
 * contents the profile carries.
 *
 * Presence alone would be a weak claim — an empty `section` element satisfies
 * "rendered" and tells a reader nothing — so each section is checked against a
 * figure only that profile could have produced: the record's own counts, the
 * Rating_Condition resolved from its own rating block, one table row per plotted
 * point, both streak figures, the bib count, and one entry per parsed entry of
 * each of the four collections.
 */
function expectEverySectionSurvives(
  profile: PlayerProfile,
  rendered: RenderedStack,
): void {
  // The ten sections of the screen's section set, each with its own heading.
  expect(rendered.sectionCount).toBe(EVERY_SECTION_HEADING.length);
  expect(rendered.headings).toEqual(EVERY_SECTION_HEADING);

  // Requirement 6: the record, its four counts, and its win percentage.
  expect(rendered.recordText).not.toBeNull();
  expect(rendered.recordFigureCount).toBe(2);
  expect(rendered.recordText).toContain(formatCount(profile.record.appearances));
  expect(rendered.resultTexts).toHaveLength(3);
  expect(rendered.resultTexts[0]).toContain(formatCount(profile.record.wins));
  expect(rendered.resultTexts[1]).toContain(formatCount(profile.record.draws));
  expect(rendered.resultTexts[2]).toContain(formatCount(profile.record.losses));

  // Requirement 7: the rating, under the one condition its own figures resolve
  // to — so the section is not merely present but presenting this profile.
  expect(rendered.ratingCondition).toBe(
    resolveRatingCondition(profile.rating, profile.record.appearances).kind,
  );

  // Requirement 8: the progression, as the table that carries every plotted
  // figure in text — or, for an empty series, as the statement that stands in
  // for it (8.6), which is a rendered section and not an omitted one.
  const series = toProgressionSeries(profile.progression);

  expect(rendered.progressionTablePresent).toBe(series.length > 0);
  expect(rendered.progressionRowCount).toBe(series.length);
  expect(rendered.progressionChartPresent).toBe(series.length > 0);
  expect(rendered.progressionPointCount).toBe(series.length);

  if (series.length === 0) {
    expect(rendered.progressionText).toContain(NO_RATING_HISTORY);
  }

  // Requirement 9: both streaks, separately labelled, and the bib count.
  expect(rendered.streakPanelPresent).toBe(true);
  expect(rendered.streakTexts.win).toContain(formatCount(profile.winStreak));
  expect(rendered.streakTexts.unbeaten).toContain(
    formatCount(profile.unbeatenStreak),
  );
  expect(rendered.bibPanelPresent).toBe(true);
  expect(rendered.bibText).toBe(formatCount(profile.bibAppearances));

  // Requirement 10: all four Pairwise_Sections, each with one entry per parsed
  // entry in the order the profile carries them — or its heading plus the
  // nothing-to-show-yet statement (10.7).
  expect(rendered.pairwise).toEqual(
    expectedPairwiseOf(profile).map(({ heading, variant, entries }) => ({
      heading,
      variant,
      membershipIds: entries.map((entry) => entry.membershipId),
      empty: entries.length === 0,
    })),
  );
}

/**
 * What each of the four Pairwise_Sections must render for this profile: its
 * heading, its variant, and the collection the profile carries for it.
 *
 * Declared as one table so the four are paired with their collections in a
 * single place — a section matched against the wrong collection is the defect a
 * per-index loop invites.
 */
function expectedPairwiseOf(profile: PlayerProfile): readonly {
  readonly heading: string;
  readonly variant: PairwiseVariant;
  readonly entries: readonly { readonly membershipId: string }[];
}[] {
  return [
    {
      heading: MOST_PLAYED_WITH_HEADING,
      variant: 'co-appearance',
      entries: profile.mostPlayedWith,
    },
    {
      heading: MOST_PLAYED_AGAINST_HEADING,
      variant: 'co-appearance',
      entries: profile.mostPlayedAgainst,
    },
    {
      heading: BEST_PARTNERSHIPS_HEADING,
      variant: 'paired-stat',
      entries: profile.bestPartnerships,
    },
    {
      heading: BOGEY_OPPONENTS_HEADING,
      variant: 'paired-stat',
      entries: profile.bogeyOpponents,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* The harness is the screen's section set                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 28: Every non-rich section survives every rich condition
// Validates: Requirements 11.7
describe('the section set this harness mirrors', () => {
  it('names ten sections, every heading distinct', () => {
    // The ten `StatSection`s of `StatSection.tsx`'s own module note: record,
    // rating, progression, streaks, bibs, the four pairwise sections, and rich
    // stats. Task 11.1 assembles the screen from the same components.
    expect(EVERY_SECTION_HEADING).toHaveLength(10);
    expect(new Set(EVERY_SECTION_HEADING).size).toBe(10);
  });

  it('generates three distinct rich conditions for one profile', () => {
    const samples = fc.sample(richCasesArb, { numRuns: 50, seed: 28 });

    for (const cases of samples) {
      const kinds = cases.map(({ rich }) => resolveRichCondition(rich).kind);

      // Each case really is the condition it is labelled with, so the property
      // below quantifies over all three rather than over one of them thrice.
      expect(kinds).toEqual(cases.map(({ label }) => label));
      expect(new Set(kinds).size).toBe(3);
    }
  });

  it('generates profiles that reach both sides of every no-data branch', () => {
    const profiles = fc.sample(profileArb, { numRuns: 300, seed: 28 });

    const hasEmptyPairwise = profiles.some(
      (profile) => profile.mostPlayedWith.length === 0,
    );
    const hasPopulatedPairwise = profiles.some(
      (profile) => profile.mostPlayedWith.length > 0,
    );
    const hasEmptyProgression = profiles.some(
      (profile) => profile.progression.length === 0,
    );
    const hasPopulatedProgression = profiles.some(
      (profile) => profile.progression.length > 0,
    );
    const ratingConditions = new Set(
      profiles.map(
        (profile) =>
          resolveRatingCondition(profile.rating, profile.record.appearances)
            .kind,
      ),
    );

    // Were the generator to produce only populated profiles, "every section is
    // rendered" would never be tested against the no-data presentations the
    // requirement is mostly about.
    expect(hasEmptyPairwise).toBe(true);
    expect(hasPopulatedPairwise).toBe(true);
    expect(hasEmptyProgression).toBe(true);
    expect(hasPopulatedProgression).toBe(true);
    expect(ratingConditions.size).toBeGreaterThan(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The property proper                                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 28: Every non-rich section survives every rich condition
// Validates: Requirements 11.7
describe('every non-rich section survives every rich condition (Req 11.7)', () => {
  it('renders the record, rating, progression, streak, bib, and four pairwise sections in all three conditions', () => {
    fc.assert(
      fc.property(profileArb, richCasesArb, (profile, cases) => {
        for (const { label, rich } of cases) {
          const rendered = renderStack({ ...profile, rich });

          // The condition really did change, so the assertions that follow are
          // made about three different screens.
          expect(rendered.richCondition).toBe(label);

          expectEverySectionSurvives(profile, rendered);
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);

  it('renders a squad with live tracking off exactly as one with it on, minus the rich statistics', () => {
    fc.assert(
      fc.property(profileArb, richCasesArb, (profile, cases) => {
        const [disabledCase, emptyCase, presentCase] = cases;

        const disabled = renderStack({ ...profile, rich: disabledCase.rich });
        const empty = renderStack({ ...profile, rich: emptyCase.rich });
        const present = renderStack({ ...profile, rich: presentCase.rich });

        // The stronger reading of "removes only the rich statistics": not that
        // each section survives in some form, but that the markup of everything
        // outside the rich section is identical under all three conditions. A
        // layout that collapsed, a figure that degraded, or a control that went
        // missing would all differ here.
        expect(empty.nonRichMarkup).toBe(disabled.nonRichMarkup);
        expect(present.nonRichMarkup).toBe(disabled.nonRichMarkup);

        // And the comparison is not vacuous: the rich section itself does
        // differ in all three, which is the only thing that may.
        expect(empty.richMarkup).not.toBe(disabled.richMarkup);
        expect(present.richMarkup).not.toBe(disabled.richMarkup);
        expect(present.richMarkup).not.toBe(empty.richMarkup);
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});
