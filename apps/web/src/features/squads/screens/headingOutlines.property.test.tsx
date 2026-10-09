/**
 * Property test for the heading outlines and the Squad_Screen's section order
 * (task 16.2).
 *
 * **Property 43: Each screen holds one level-one heading and skips no level.**
 * *For any* state of the Squads_Home, the Squad_Screen, and the
 * Invite_Landing_Route — every load state, every authority value, every
 * injected-content combination, and every open form or confirmation — the rendered
 * heading sequence contains exactly one level-one heading and skips no heading
 * level, the Squad_Screen's sections appear in the order squad detail, players,
 * matches, stats, administration with exactly one level-two heading each, and the
 * administration section's invite, guest, and feature regions carry exactly one
 * level-three heading each.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 19.1 — exactly one level-one heading, no level skipped | {@link expectWellFormedOutline}, over both properties |
 * | 1.9 — the Squads_Home's one level-one heading | the first property, over its four load states and its two forms |
 * | 6.8 — the five sections in their fixed order, one `h2` each | {@link expectSquadSectionOrder} (any state) and {@link expectedSquadSections} (the exact expectation per state) |
 * | 10.7 — administration's `h2` and its three `h3`s | {@link expectAdminOutline} |
 * | 15.1 — a Placeholder_Section keeps its `h2` whatever is injected | the second property's content dimension, which varies both slots independently |
 *
 * ### The rule is asked of the validator, never restated
 *
 * `lib/headingOutline.ts` holds the whole of "exactly one level-one heading and no
 * level exceeding its predecessor by more than one" (Requirement 19.2), and
 * Property 44 pins that function over generated level sequences. So this file does
 * one thing with it: read the rendered heading levels **in document order** and
 * hand the sequence over. Nothing here re-implements the rule, which is what stops
 * the two drifting — a screen and the validator cannot disagree about what a
 * well-formed outline is when only one of them defines it.
 *
 * A heading is any `h1`–`h6` element or anything carrying `role="heading"`, read at
 * its `aria-level`. The second form is included because it is a heading to
 * assistive technology whether or not this feature happens to produce one today: a
 * component that started using it would otherwise leave the outline unasserted.
 *
 * ### The rendered states come from the shared fixture
 *
 * `../testing/squadsScreenStates.tsx` mounts every state of the three screens that
 * materially changes the tree, in either Theme, through the screens' own state
 * machines and their real routes — the same set the accessibility audits of task
 * 16.1 assess. The first property below quantifies over that set with **every**
 * (state, Theme) pair supplied as an explicit example, so all of them run rather
 * than most of them: fast-check runs custom examples before its random values and
 * counts them toward `numRuns`, so 46 examples inside 100 runs means exhaustive
 * coverage of the set *plus* random re-sampling of it.
 *
 * ### Two dimensions the fixture could not hold as constants
 *
 * Requirement 6.8's section order and Requirement 10.7's administration outline
 * are claimed over **every resolved authority value** and **every
 * injected-content combination**, so neither can be one chosen value:
 *
 * - **Authority** is `resolveAdminAuthority`'s answer over the caller's
 *   Member_Role × Membership_State, which the Squad_Screen resolves from the
 *   `ListMySquads` summary and from nowhere else (Requirement 6.10). All twelve
 *   combinations are generated — including the ten holding no authority, for which
 *   the administration `h2` and its three `h3`s must be *absent* rather than
 *   present-and-empty.
 * - **Injected content** is the two Placeholder_Section slots, varied
 *   independently over four values each: nothing, a value React renders nothing
 *   for, a paragraph, and a paragraph under its own level-three subheading. The
 *   last is the interesting one — it proves the outline stays well-formed when a
 *   later feature nests its own headings under a placeholder's `h2`, which is
 *   exactly what Requirement 15.3 invites it to do.
 *
 * Both are supplied through {@link renderSquadScreenState}'s overrides, so the
 * states themselves stay the fixture's single definition of them.
 *
 * The second property fixes the Theme at dark. A Theme reaches the tree as an
 * attribute on the document element and changes no heading, and the first property
 * already renders every state under both.
 *
 * Feature: web-squads-screens, Property 43: Each screen holds one level-one heading and skips no level
 * Validates: Requirements 1.9, 6.8, 10.7, 15.1, 19.1
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import fc from 'fast-check';

import type { Theme } from '../../../theme';
import {
  ADMIN_SECTION_SELECTOR,
  ADMIN_SUBSECTION_ATTRIBUTE,
  ADMIN_SUBSECTION_SELECTOR,
} from '../components/AdminSection';
import { resolveAdminAuthority } from '../lib/adminAuthority';
import type { MembershipState, SquadRole } from '../lib/wireEnums';
import { validateHeadingOutline } from '../lib/headingOutline';
import {
  ADMIN_SECTION_HEADING,
  FEATURES_SECTION_HEADING,
  GUESTS_SECTION_HEADING,
  INVITES_SECTION_HEADING,
  MATCHES_SECTION_HEADING,
  PLAYERS_SECTION_HEADING,
  SQUAD_DETAIL_SECTION_HEADING,
  STATS_SECTION_HEADING,
} from '../lib/messages';
import {
  SCREEN_STATE_CASES,
  THEMES,
  renderSquadScreenState,
  resetTheme,
  type CallerStanding,
  type SquadScreenStateName,
} from '../testing/squadsScreenStates';
import { SQUAD_SCREEN_SELECTOR } from './SquadScreen';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it — correct for the application, where the Squad_Route is a
 * child of the shell's `/app` layout route, and unusable for a screen rendered on
 * its own. The provider is deliberately not part of the shell's public barrel, so
 * the one export is stubbed and everything else of the shell stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

// --- Reading the rendered outline --------------------------------------------

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
 * validator treats as neither a level-one heading nor a skip. That is deliberate:
 * "a heading with no level" is the accessibility audit's finding to report
 * (task 16.1), not this property's, and inventing a level here would let the
 * outline claim to have checked something it could not read.
 */
function headingLevelOf(heading: Element): number {
  const tag = heading.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    return Number(tag.slice(1));
  }

  return Number(heading.getAttribute('aria-level') ?? Number.NaN);
}

/** The heading levels of a subtree, in document order (Requirement 19.2). */
function headingLevelsOf(root: ParentNode): readonly number[] {
  return Array.from(root.querySelectorAll(HEADING_SELECTOR)).map(headingLevelOf);
}

/** The text of every heading of a subtree at one level, in document order. */
function headingTextsAt(root: ParentNode, level: 1 | 2 | 3): readonly string[] {
  return Array.from(root.querySelectorAll(`h${level}`)).map(
    (heading) => heading.textContent ?? '',
  );
}

/**
 * Requirement 19.1: exactly one level-one heading, and no level skipped —
 * `validateHeadingOutline`'s verdict, with the sequence itself in the assertion so
 * a failure names the outline that broke rather than only that one did.
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
  // Requirement 19.1 a reader of this file is most likely to be looking for.
  expect(headingTextsAt(container, 1)).toHaveLength(1);
}

// --- The Squad_Screen's five sections ----------------------------------------

/**
 * The Squad_Screen's sections, in the document order Requirement 6.8 fixes.
 *
 * The headings are read from `lib/messages.ts` rather than restated, so the
 * expectation cannot drift from the copy the screen renders.
 */
const SQUAD_SECTION_HEADINGS: readonly string[] = [
  SQUAD_DETAIL_SECTION_HEADING,
  PLAYERS_SECTION_HEADING,
  MATCHES_SECTION_HEADING,
  STATS_SECTION_HEADING,
  ADMIN_SECTION_HEADING,
];

/** The administration section's three regions, in the order Req 10.7 names. */
const ADMIN_SUBSECTIONS: readonly string[] = ['invites', 'guests', 'features'];

/** Their three level-three headings, in the same order. */
const ADMIN_SUBSECTION_HEADINGS: readonly string[] = [
  INVITES_SECTION_HEADING,
  GUESTS_SECTION_HEADING,
  FEATURES_SECTION_HEADING,
];

/** The level-two headings of the rendered Squad_Screen, in document order. */
function squadSectionHeadings(container: HTMLElement): readonly string[] {
  const screen = container.querySelector(SQUAD_SCREEN_SELECTOR);

  return screen === null ? [] : headingTextsAt(screen, 2);
}

/** Whether `values` appears within `whole` in order, each value at most once. */
function isOrderedSubsequence(
  values: readonly string[],
  whole: readonly string[],
): boolean {
  let cursor = 0;

  for (const value of values) {
    const found = whole.indexOf(value, cursor);

    if (found === -1) {
      return false;
    }

    cursor = found + 1;
  }

  return true;
}

/**
 * Requirement 6.8: whichever of the five sections a state renders, they are in the
 * fixed order, each is introduced by exactly one level-two heading, and the screen
 * carries no other level-two heading at all.
 *
 * Stated as an ordered subsequence rather than as a fixed list, because this holds
 * of *every* state: a state holding no Squad_Detail renders no players and no
 * administration section (Requirement 6.9), and the exact expectation per state is
 * {@link expectedSquadSections}'. An open form or confirmation adds no level-two
 * heading — each sits one level below the region that opened it — so a surface
 * that started doing so fails here as a stray `h2`.
 */
function expectSquadSectionOrder(container: HTMLElement, description: string): void {
  const rendered = squadSectionHeadings(container);

  expect({
    description,
    rendered,
    inOrder: isOrderedSubsequence(rendered, SQUAD_SECTION_HEADINGS),
  }).toEqual({ description, rendered, inOrder: true });

  // One `h2` each: an ordered subsequence permits no repeat, and this catches a
  // section rendered twice with its two headings adjacent.
  expect(new Set(rendered).size).toBe(rendered.length);
}

/**
 * Requirement 10.7: the administration region carries one level-two heading naming
 * administration, and its invites, guests, and features regions carry exactly one
 * level-three heading each — or the whole region is absent.
 *
 * Absence rather than emptiness is the point where authority does not hold: the
 * Admin_Section renders no subtree at all, so there is nothing to head
 * (Requirement 10.3). The level-three headings are counted **within** the region so
 * the claim is about administration's own outline and not about a level-three
 * heading a Placeholder_Section's injected body or an open confirmation elsewhere
 * on the screen contributed.
 */
function expectAdminOutline(container: HTMLElement, authority: boolean): void {
  const admin = container.querySelector(ADMIN_SECTION_SELECTOR);

  if (!authority) {
    expect(admin).toBeNull();
    expect(squadSectionHeadings(container)).not.toContain(ADMIN_SECTION_HEADING);
    return;
  }

  expect(admin).not.toBeNull();
  if (admin === null) {
    return;
  }

  expect(headingTextsAt(admin, 2)).toEqual([ADMIN_SECTION_HEADING]);

  const subsections = Array.from(
    admin.querySelectorAll<HTMLElement>(ADMIN_SUBSECTION_SELECTOR),
  );

  expect(
    subsections.map((section) => section.getAttribute(ADMIN_SUBSECTION_ATTRIBUTE)),
  ).toEqual(ADMIN_SUBSECTIONS);

  // Exactly one each, asserted per region as well as in aggregate — three regions
  // and three headings would otherwise be satisfied by one region holding all
  // three.
  for (const section of subsections) {
    expect(headingTextsAt(section, 3)).toHaveLength(1);
  }

  expect(headingTextsAt(admin, 3)).toEqual(ADMIN_SUBSECTION_HEADINGS);
}

// --- The first property: every state of every screen -------------------------

/** Every (state, Theme) pair of the shared fixture, as an explicit example. */
const EVERY_STATE_AND_THEME: readonly [number, Theme][] = SCREEN_STATE_CASES.flatMap(
  (_state, index) => THEMES.map((theme): [number, Theme] => [index, theme]),
);

describe('Property 43 — every rendered state holds one level-one heading and skips no level', () => {
  // Feature: web-squads-screens, Property 43: Each screen holds one level-one heading and skips no level
  // Validates: Requirements 1.9, 6.8, 19.1
  it('renders a well-formed heading outline in every state of all three screens, in both themes', async () => {
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
            // 6.8: whichever sections this state renders are in the fixed order.
            // The exact per-state expectation is the second property's.
            expectSquadSectionOrder(container, description);
          } finally {
            cleanup();
            resetTheme();
          }
        },
      ),
      // The examples cover the set exhaustively and run first; the remaining runs
      // re-sample it, so a state that only fails intermittently is still reached.
      { numRuns: 100, examples: [...EVERY_STATE_AND_THEME] },
    );
  }, 600_000);
});

// --- The second property: authority and injected content ---------------------

/** The Squad_Screen states whose section outline the property is claimed over. */
const SQUAD_SCREEN_STATES: readonly SquadScreenStateName[] = [
  'loading',
  'failed',
  'not-found',
  'players',
  'players-unavailable',
];

/** Every Member_Role a caller's summary can carry, absence included. */
const CALLER_ROLES: readonly (SquadRole | null)[] = [
  'Owner',
  'Admin',
  'Member',
  null,
];

/** Every Membership_State a caller's summary can carry, absence included. */
const CALLER_STATES: readonly (MembershipState | null)[] = [
  'Active',
  'Inactive',
  null,
];

/**
 * The twelve caller standings, of which `resolveAdminAuthority` accepts exactly
 * two — so the authority dimension is exhausted rather than sampled
 * (Requirement 6.10).
 */
const CALLER_STANDINGS: readonly CallerStanding[] = CALLER_ROLES.flatMap((role) =>
  CALLER_STATES.map((state): CallerStanding => ({ role, state })),
);

/** One value a Placeholder_Section's content slot can be given (Req 15.3). */
interface PlaceholderContentCase {
  /** How the case is named in a failing assertion. */
  readonly name: string;
  /** The slot value itself. */
  readonly node: ReactNode;
}

/**
 * The four slot values, covering both kinds of absence and both kinds of body.
 *
 * `false` is included because React renders nothing for it, so a section given it
 * must keep its own statement — and its heading — exactly as an omitted slot does.
 * The last case nests a level-three heading under the section's `h2`, which is the
 * shape a later match-lifecycle or stats feature will inject and the one that could
 * break the outline (Requirements 15.3, 15.4).
 */
const PLACEHOLDER_CONTENT_CASES: readonly PlaceholderContentCase[] = [
  { name: 'nothing', node: undefined },
  { name: 'a value React renders nothing for', node: false },
  { name: 'a paragraph', node: <p>Two fixtures are pencilled in.</p> },
  {
    name: 'a paragraph under its own subheading',
    node: (
      <>
        <h3>This season</h3>
        <p>Two fixtures are pencilled in.</p>
      </>
    ),
  },
];

/** The content slot indices, so an example is a plain value fast-check can print. */
const CONTENT_INDICES: readonly number[] = PLACEHOLDER_CONTENT_CASES.map(
  (_content, index) => index,
);

/**
 * Whether a state holds a parsed Squad_Detail — which is what decides whether the
 * players section and the administration section exist at all (Requirement 6.9).
 */
function detailHeld(state: SquadScreenStateName): boolean {
  return state === 'players' || state === 'players-unavailable' || state === 'admin';
}

/**
 * Requirement 6.8's exact expectation for one state: the sections that state
 * renders, in order.
 *
 * A `notFound` detail renders the Not_Found_Treatment alone, so no section at all
 * (Requirements 6.4, 6.5). A detail that is loading or failed renders no
 * Player_List (Requirement 6.9) and no administration, because it renders no squad
 * — but both Placeholder_Sections stay, since neither holds squad data
 * (Requirement 15.1). Administration joins the four only where authority holds
 * (Requirements 10.2, 10.3).
 */
function expectedSquadSections(
  state: SquadScreenStateName,
  authority: boolean,
): readonly string[] {
  if (state === 'not-found') {
    return [];
  }

  if (state === 'loading' || state === 'failed') {
    return [
      SQUAD_DETAIL_SECTION_HEADING,
      MATCHES_SECTION_HEADING,
      STATS_SECTION_HEADING,
    ];
  }

  return [
    SQUAD_DETAIL_SECTION_HEADING,
    PLAYERS_SECTION_HEADING,
    MATCHES_SECTION_HEADING,
    STATS_SECTION_HEADING,
    ...(authority ? [ADMIN_SECTION_HEADING] : []),
  ];
}

/**
 * Every combination of the three dimensions worth pinning explicitly: each caller
 * standing at a loaded state, each state under an authority-holding caller, and
 * each of the sixteen content combinations. Thirty-three examples inside a hundred
 * runs, so the dimensions are exhausted individually and re-sampled jointly.
 */
const SQUAD_SCREEN_EXAMPLES: readonly [SquadScreenStateName, number, number, number][] =
  [
    ...CALLER_STANDINGS.map(
      (_standing, index): [SquadScreenStateName, number, number, number] => [
        'players',
        index,
        0,
        0,
      ],
    ),
    ...SQUAD_SCREEN_STATES.map(
      (state): [SquadScreenStateName, number, number, number] => [state, 0, 0, 0],
    ),
    ...CONTENT_INDICES.flatMap((matches) =>
      CONTENT_INDICES.map(
        (stats): [SquadScreenStateName, number, number, number] => [
          'players',
          0,
          matches,
          stats,
        ],
      ),
    ),
  ];

describe('Property 43 — the Squad_Screen section order over every authority value and injected body', () => {
  // Feature: web-squads-screens, Property 43: Each screen holds one level-one heading and skips no level
  // Validates: Requirements 6.8, 10.7, 15.1, 19.1
  it('keeps the five sections in order with one h2 each and administration under three h3s', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...SQUAD_SCREEN_STATES),
        fc.nat({ max: CALLER_STANDINGS.length - 1 }),
        fc.constantFrom(...CONTENT_INDICES),
        fc.constantFrom(...CONTENT_INDICES),
        async (state, standingIndex, matchesIndex, statsIndex) => {
          const caller = CALLER_STANDINGS[standingIndex];
          const matches = PLACEHOLDER_CONTENT_CASES[matchesIndex];
          const stats = PLACEHOLDER_CONTENT_CASES[statsIndex];

          // 10.2: the expectation is the pure predicate's answer, not a list of
          // which combinations hold — that is Property 25's claim.
          const authority = resolveAdminAuthority(caller.role, caller.state);

          const description =
            `the Squad_Screen ${state} for a ${caller.role ?? 'role-less'} ` +
            `${caller.state ?? 'state-less'} caller, with ${matches.name} injected ` +
            `into matches and ${stats.name} into stats`;

          try {
            const { container } = await renderSquadScreenState(state, 'dark', {
              caller,
              matchesContent: matches.node,
              statsContent: stats.node,
            });

            // 19.1: one level-one heading and no skipped level, whatever a later
            // feature nested under a placeholder's heading.
            expectWellFormedOutline(container, description);

            // 6.8: exactly the sections this state renders, in the fixed order.
            expect({ description, sections: squadSectionHeadings(container) }).toEqual({
              description,
              sections: expectedSquadSections(state, authority),
            });

            // 10.7: administration's own outline, or its absence. A state holding
            // no Squad_Detail renders no section at all, so authority alone does
            // not put administration on screen (Requirement 6.9).
            expectAdminOutline(container, authority && detailHeld(state));
          } finally {
            cleanup();
            resetTheme();
          }
        },
      ),
      { numRuns: 100, examples: [...SQUAD_SCREEN_EXAMPLES] },
    );
  }, 600_000);
});
