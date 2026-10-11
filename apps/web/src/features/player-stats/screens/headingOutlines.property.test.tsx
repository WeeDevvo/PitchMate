/**
 * Property test for the Player_Stats_Screen's heading outline, its section
 * association, and its section reading order (task 14.2).
 *
 * **Property 33: The heading outline holds in every screen condition.** *For
 * any* condition the screen can be in — loading, not-found, failed, and loaded
 * over any parsed Player_Profile — the rendered heading sequence carries exactly
 * one level-one heading and skips no level; each section is a named landmark
 * associated with its **own** single level-two heading programmatically; and the
 * sections appear in the one reading order the design fixes.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 16.1 — exactly one level-one heading, no level skipped, in every condition | {@link expectWellFormedOutline}, over both properties |
 * | 16.2 — the rule is the pure validator's, read from the rendered levels | {@link headingLevelsOf} feeding `validateHeadingOutline`, and nothing else |
 * | 16.3 — each section associated with its own heading, in the fixed order | {@link expectSectionOutline} |
 *
 * ### The rule is asked of the validator, never restated
 *
 * `lib/headingOutline.ts` holds the whole of "exactly one level-one heading and
 * no level exceeding its predecessor by more than one" (Requirement 16.2), and
 * its adjacent property test pins that function over generated level sequences.
 * So this file does one thing with it: read the rendered heading levels **in
 * document order** and hand the sequence over. Nothing here re-implements the
 * rule, which is what stops the two drifting — a screen and the validator cannot
 * disagree about what a well-formed outline is when only one of them defines it.
 *
 * A heading is any `h1`–`h6` element or anything carrying `role="heading"`, read
 * at its `aria-level`. The second form is included because it is a heading to
 * assistive technology whether or not this feature produces one today: a
 * component that started using it would otherwise leave the outline unasserted.
 *
 * ### The rendered conditions come from the shared fixture
 *
 * `../testing/playerStatsScreenStates.tsx` mounts every condition that
 * materially changes the tree, in either Theme, through the screen's own load
 * machine and its real route — the same set the accessibility audits of task
 * 14.1 assess and the keyboard property of task 14.3 will. The first property
 * below quantifies over that set with **every** (condition, Theme) pair supplied
 * as an explicit example, so all of them run rather than most of them:
 * fast-check runs custom examples before its random values and counts them
 * toward `numRuns`, so 44 examples inside 100 runs means exhaustive coverage of
 * the set *plus* random re-sampling of it.
 *
 * ### And the loaded body is quantified over generated profiles
 *
 * The fixture's loaded conditions vary one dimension each from one base profile,
 * which is right for an audit and not enough for this claim: the outline must
 * hold for *any* parsed profile, including one whose display name is empty,
 * whose collections are empty, and whose collections carry two hundred entries
 * and five hundred progression points. The second property therefore generates
 * profiles with `playerProfileArb` from `../testing/playerProfileFixtures.ts`,
 * so the generated half speaks the same fixture vocabulary as the wire-parsing
 * suites — every generated profile is one the parser can actually produce.
 *
 * ### What "associated with its own heading" is asserted to mean
 *
 * Requirement 16.3 asks that each section be associated with its heading
 * *programmatically*, which is what makes the screen navigable by region. Four
 * facts together are that association, and all four are asserted per section
 * (not merely in aggregate, which three regions sharing one heading would
 * satisfy):
 *
 * 1. the region is a `section` element — a `div` is no landmark however it is
 *    labelled;
 * 2. it carries exactly one heading, at level two;
 * 3. its `aria-labelledby` names *that* heading's id, and the id resolves to
 *    exactly one element in the whole document, so the announced name is the
 *    visible words rather than a dangling reference;
 * 4. it holds no nested section — two regions and two level-two headings in one
 *    place is the defect a `PairwiseSection` wrapped in a second `StatSection`
 *    would produce, and it is invisible to a sighted reader.
 *
 * Feature: web-player-stats-screen, Property 33: The heading outline holds in every screen condition
 * Validates: Requirements 16.1, 16.2, 16.3
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fc from 'fast-check';

import type { Theme } from '../../../theme';
import { STAT_SECTION_SELECTOR } from '../components/StatSection';
import { validateHeadingOutline } from '../lib/headingOutline';
import {
  BEST_PARTNERSHIPS_HEADING,
  BIBS_SECTION_HEADING,
  BOGEY_OPPONENTS_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  MOST_PLAYED_WITH_HEADING,
  PROGRESSION_SECTION_HEADING,
  RATING_SECTION_HEADING,
  RECORD_SECTION_HEADING,
  RICH_STATS_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { playerProfileArb } from '../testing/playerProfileFixtures';
import {
  SCREEN_STATE_CASES,
  THEMES,
  renderLoadedState,
  resetTheme,
} from '../testing/playerStatsScreenStates';
import {
  PLAYER_STATS_SCREEN_SELECTOR,
  SCREEN_CONDITION_ATTRIBUTE,
} from './PlayerStatsScreen';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the
 * Player_Stats_Route is a child of the shell's `/app` layout route — and
 * unusable for a screen rendered on its own. The provider is deliberately not
 * part of the shell's public barrel, and reaching past that barrel would breach
 * the module boundary the shell's structural scan enforces, so the one export is
 * stubbed. Everything else of the shell stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

// --- Reading the rendered outline -------------------------------------------

/**
 * Every element that is a heading: the six elements, plus anything given the
 * heading role explicitly.
 */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

/**
 * The heading level of one element — its tag's own level, or the `aria-level` a
 * `role="heading"` element declares.
 *
 * An element carrying the role but no level is reported as `NaN`, which the
 * validator treats as neither a level-one heading nor a skip. That is
 * deliberate: "a heading with no level" is the accessibility audit's finding to
 * report (task 14.1), not this property's, and inventing a level here would let
 * the outline claim to have checked something it could not read.
 */
function headingLevelOf(heading: Element): number {
  const tag = heading.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    return Number(tag.slice(1));
  }

  return Number(heading.getAttribute('aria-level') ?? Number.NaN);
}

/** The heading levels of a subtree, in document order (Requirement 16.2). */
function headingLevelsOf(root: ParentNode): readonly number[] {
  return Array.from(root.querySelectorAll(HEADING_SELECTOR)).map(headingLevelOf);
}

/** Every heading of a subtree at one level, in document order. */
function headingsAt(root: ParentNode, level: 1 | 2): readonly HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`h${String(level)}`));
}

/** The text of every heading of a subtree at one level, in document order. */
function headingTextsAt(root: ParentNode, level: 1 | 2): readonly string[] {
  return headingsAt(root, level).map((heading) => heading.textContent ?? '');
}

/**
 * Requirement 16.1: exactly one level-one heading, and no level skipped —
 * `validateHeadingOutline`'s verdict, with the sequence itself in the assertion
 * so a failure names the outline that broke rather than only that one did.
 */
function expectWellFormedOutline(container: HTMLElement, description: string): void {
  const outline = headingLevelsOf(container);

  expect({ description, outline, verdict: validateHeadingOutline(outline) }).toEqual({
    description,
    outline,
    verdict: { ok: true },
  });

  // The same claim from the other side: the count the validator counted is one.
  // Stated separately because "exactly one level-one heading" is the half of
  // Requirement 16.1 a reader of this file is most likely to be looking for.
  expect({ description, levelOnes: headingTextsAt(container, 1).length }).toEqual({
    description,
    levelOnes: 1,
  });

  // And it opens the outline. The validator says nothing about the *first*
  // heading — it has no predecessor — so "the title comes before the sections"
  // is asserted here rather than folded into the pure rule it is not part of.
  expect({ description, first: outline[0] }).toEqual({ description, first: 1 });
}

// --- The ten sections, in the one reading order ------------------------------

/**
 * The Player_Stats_Screen's sections, in the document order Requirement 16.3 and
 * the design fix: record, rating, progression, streaks, bibs, the four
 * Pairwise_Sections, rich stats — ten, all below the identity header's
 * level-one heading.
 *
 * The headings are read from `lib/messages.ts` rather than restated, so the
 * expectation cannot drift from the copy the screen renders.
 */
const PROFILE_SECTION_HEADINGS: readonly string[] = [
  RECORD_SECTION_HEADING,
  RATING_SECTION_HEADING,
  PROGRESSION_SECTION_HEADING,
  STREAKS_SECTION_HEADING,
  BIBS_SECTION_HEADING,
  MOST_PLAYED_WITH_HEADING,
  MOST_PLAYED_AGAINST_HEADING,
  BEST_PARTNERSHIPS_HEADING,
  BOGEY_OPPONENTS_HEADING,
  RICH_STATS_SECTION_HEADING,
];

/**
 * Which of the four bodies is on screen, read from the screen's own
 * `data-player-stats-condition` attribute.
 *
 * One condition of the fixture set renders no screen wrapper at all — the
 * pending-retry failure surface, which is the notice as the screen composes it
 * rather than a condition the machine can reach — and it reports no condition
 * here, which is right: it renders no section either.
 */
function renderedConditionOf(container: HTMLElement): string | null {
  const screen = container.querySelector(PLAYER_STATS_SCREEN_SELECTOR);

  return screen === null ? null : screen.getAttribute(SCREEN_CONDITION_ATTRIBUTE);
}

/** The sections a condition renders: the ten when a profile is held, else none. */
function expectedSectionHeadings(condition: string | null): readonly string[] {
  return condition === 'loaded' ? PROFILE_SECTION_HEADINGS : [];
}

/**
 * Requirement 16.3: the sections this condition renders, in the fixed reading
 * order, each a named landmark region associated with its own single level-two
 * heading — and no level-two heading anywhere outside one.
 *
 * The four facts that make up the association are asserted **per section**
 * rather than in aggregate: ten regions and ten headings would otherwise be
 * satisfied by one region holding all ten.
 */
function expectSectionOutline(container: HTMLElement, description: string): void {
  const condition = renderedConditionOf(container);
  const sections = Array.from(
    container.querySelectorAll<HTMLElement>(STAT_SECTION_SELECTOR),
  );

  const expected = expectedSectionHeadings(condition);

  // The order, and the exact set: a condition holding no profile renders no
  // section, and a held profile renders all ten whatever it carries. The
  // level-two headings are counted over the **whole** container rather than over
  // the regions, so a stray `h2` outside a section fails here too.
  expect({
    description,
    condition,
    regions: sections.length,
    headings: headingTextsAt(container, 2),
  }).toEqual({
    description,
    condition,
    regions: expected.length,
    headings: expected,
  });

  sections.forEach((section, index) => {
    const headings = Array.from(section.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
    const heading = headings[0];
    const headingId = heading === undefined ? null : heading.getAttribute('id');

    // A `section` element with one level-two heading, named by that heading.
    expect({
      description,
      index,
      element: section.tagName.toLowerCase(),
      headings: headings.length,
      level: heading === undefined ? null : headingLevelOf(heading),
      labelledBy: section.getAttribute('aria-labelledby'),
      nested: section.querySelectorAll(STAT_SECTION_SELECTOR).length,
    }).toEqual({
      description,
      index,
      element: 'section',
      headings: 1,
      level: 2,
      labelledBy: headingId,
      nested: 0,
    });

    // The reference resolves, and to exactly one element in the whole document:
    // a duplicated id would make `aria-labelledby` announce whichever came
    // first, which is a different section's name.
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[id]')).filter(
      (element) => element.id === headingId,
    );

    expect({ description, index, targets: targets.length }).toEqual({
      description,
      index,
      targets: 1,
    });
    expect(targets[0]).toBe(heading);
  });
}

// --- The first property: every condition of the screen, in both Themes -------

/** Every (condition, Theme) pair of the shared fixture, as an explicit example. */
const EVERY_CONDITION_AND_THEME: readonly [number, Theme][] = SCREEN_STATE_CASES.flatMap(
  (_state, index) => THEMES.map((theme): [number, Theme] => [index, theme]),
);

describe('Property 33 — every rendered condition holds one level-one heading and skips no level', () => {
  // Feature: web-player-stats-screen, Property 33: The heading outline holds in every screen condition
  // Validates: Requirements 16.1, 16.2, 16.3
  it('renders a well-formed outline and its own named sections in every condition, in both themes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: SCREEN_STATE_CASES.length - 1 }),
        fc.constantFrom(...THEMES),
        async (index, theme) => {
          const state = SCREEN_STATE_CASES[index];
          const description = `${state.name} in the ${theme} theme`;

          try {
            const { container } = await state.render(theme);

            expectWellFormedOutline(container, description);
            expectSectionOutline(container, description);
          } finally {
            cleanup();
            resetTheme();
          }
        },
      ),
      // The examples cover the set exhaustively and run first; the remaining
      // runs re-sample it, so a condition that only fails intermittently is
      // still reached.
      { numRuns: 100, examples: [...EVERY_CONDITION_AND_THEME] },
    );
  }, 600_000);
});

// --- The second property: the loaded body over any parsed profile ------------

describe('Property 33 — the loaded body over any parsed profile', () => {
  // Feature: web-player-stats-screen, Property 33: The heading outline holds in every screen condition
  // Validates: Requirements 16.1, 16.2, 16.3
  it('renders the name as the one level-one heading above the ten sections in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        playerProfileArb,
        fc.constantFrom(...THEMES),
        async (profile: PlayerProfile, theme) => {
          const description = `a generated profile in the ${theme} theme`;

          try {
            const { container } = await renderLoadedState(theme, profile, description);

            expectWellFormedOutline(container, description);
            expectSectionOutline(container, description);

            // 5.1, 16.1: the one level-one heading is the Player_Display_Name
            // exactly as parsed — including a name that is empty, whitespace, or
            // made of graphemes no Latin font will draw. A name the header
            // rewrote would make the screen disagree with the player list that
            // opened it, and would also be the obvious way to accidentally
            // render a *second* title.
            expect({
              description,
              titles: headingTextsAt(container, 1),
            }).toEqual({ description, titles: [profile.displayName] });
          } finally {
            cleanup();
            resetTheme();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 600_000);
});

// --- The reader is not vacuous ----------------------------------------------

/**
 * The claims above are only worth their assertions if the reading step can see a
 * broken outline at all — a selector that matched nothing would make every
 * sequence above empty, and an empty sequence would be reported as `no-level-one`
 * rather than as a pass, but a *mis-levelled* reader would not be caught that
 * way. So the pipeline is pointed at markup with each fault in turn.
 */
describe('the rendered-outline reader', () => {
  // Validates: Requirements 16.1, 16.2
  it('reports the three faults from rendered markup', () => {
    const { container } = render(
      <div>
        <section>
          <h1>Ada</h1>
          <h3>Record</h3>
        </section>
        <div role="heading" aria-level="1">
          Also Ada
        </div>
      </div>,
    );

    // Read at their levels, the `role="heading"` element included.
    expect(headingLevelsOf(container)).toEqual([1, 3, 1]);

    // Two titles is the first failure reported, as the validator orders them.
    expect(validateHeadingOutline(headingLevelsOf(container))).toEqual({
      ok: false,
      reason: 'multiple-level-one',
      levelOneCount: 2,
    });

    // And the skip is reported for the same tree without the second title.
    expect(validateHeadingOutline([1, 3])).toEqual({
      ok: false,
      reason: 'skipped-level',
      index: 1,
      previousLevel: 1,
      level: 3,
    });

    // The assertion helper itself fails on that tree, so a screen that rendered
    // it could not pass the properties above.
    expect(() => {
      expectWellFormedOutline(container, 'a deliberately broken outline');
    }).toThrow();
  });
});
