// Feature: web-player-stats-screen, Property 27: An absent rich member renders a statement, never a numeral
// Validates: Requirements 11.3, 11.4

import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  RICH_STAT_KINDS,
  RICH_STAT_LABELS,
  RICH_STATS_CONDITION_ATTRIBUTE,
  RICH_STATS_ENTRY_ATTRIBUTE,
  RICH_STATS_ENTRY_SELECTOR,
  RICH_STATS_HAS_VALUE_ATTRIBUTE,
  RICH_STATS_LABEL_ATTRIBUTE,
  RICH_STATS_PANEL_SELECTOR,
  RICH_STATS_STATEMENT_SELECTOR,
  RICH_STATS_VALUE_ATTRIBUTE,
  RichStatsPanel,
  type RichStatKind,
} from './RichStatsPanel';
import { formatDuration } from '../lib/duration';
import { STATISTIC_NO_DATA } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { RichStats } from '../lib/parse/playerProfile';
import { resolveRichCondition, type RichCondition } from '../lib/richStats';

/**
 * Property test for the rule the four live-tracking statistics degrade by, one
 * member at a time: **an absent member is a sentence, and a present member is
 * its figure — including when that figure is zero.**
 *
 * The claim (Requirements 11.3, 11.4): *for any present Rich_Stats block and any
 * subset of its four members that are absent, the panel renders the no-data
 * statement for each absent member and no numeral attributable to it — no zero
 * included — and renders the formatted value, with its label, for each member
 * that carries one.*
 *
 * ## Why this is a property and not four more examples
 *
 * `RichStatsPanel.test.tsx` beside this file exercises one absent member at a
 * time and one fully populated block, which is four of the sixteen ways a
 * present block can degrade. The defect this property exists to catch does not
 * live in those four: it is the single `value ?? …` or `value ? … : …` that
 * reads a **falsy** member as an absent one. Such a mistake passes every example
 * whose values are non-zero and fails only for the block where a real zero and a
 * real absence sit beside each other — so the quantifier has to run over the
 * subsets *and* over the values, with zero deliberately in the value space.
 *
 * Both halves of the rule are therefore asserted together on each render. A
 * component that rendered `STATISTIC_NO_DATA` for all four members would satisfy
 * "no numeral for an absent member" perfectly and be useless; the present-member
 * half is what makes the absent-member half mean something.
 *
 * ## All sixteen subsets, enumerated rather than sampled
 *
 * The absence pattern is drawn from an enumeration of all sixteen subsets of the
 * four members — including the empty subset (a fully populated block) and the
 * full one (a `present` arm whose every member is absent) — so coverage of the
 * subset lattice is a fact about the generator rather than a hope about the
 * sample. The grounding block below asserts the enumeration really is all
 * sixteen, and that a sample reaches every one of them.
 *
 * The all-absent subset is reachable here only because the `present` arm is
 * constructed directly: applied to such a block, `resolveRichCondition` answers
 * `empty` instead, so the screen never hands this panel that arm. It is asserted
 * anyway — the panel owes a coherent answer for the arm it is given, not for the
 * arm its caller happens to produce. The final block states that relationship
 * explicitly and checks the other fifteen subsets against the resolver, so the
 * blocks this property quantifies over are the ones the screen really produces.
 *
 * ## What "no numeral attributable to it" is read as
 *
 * An absent member's whole entry — the group holding its label and its value — is
 * scanned for **any digit at all**, in its text and in every attribute value in
 * its subtree. Scanning the entry rather than the value element alone is the
 * stronger claim: a figure smuggled into the label, into a title, or into a data
 * attribute beside the statement would still be a numeral a person or a screen
 * reader could reach. The scan is only attributable if the panel's own fixed
 * vocabulary carries no digit, so the grounding block asserts that of every
 * label, every kind name, and `STATISTIC_NO_DATA` — a label reading "Goals (90
 * mins)" would make this property unfalsifiable, and would fail there first.
 *
 * Deliberately **not** claimed here: that the two figure-less conditions are
 * distinct from one another and from `present` (Property 26), and that the
 * Keeper_Time's text is determined solely by its duration (Property 25). The
 * expected text below is taken from `formatCount` and `formatDuration` rather
 * than restated, so this file asserts *which* value is rendered and leaves *how*
 * it reads to the modules that own it.
 *
 * Requirements: 11.3, 11.4, 14.5
 */

// --- the subset lattice -------------------------------------------------------

/** Which of the four members are absent, as a flag per statistic. */
type AbsenceMask = Readonly<Record<RichStatKind, boolean>>;

/** The number of subsets of the four members: 2^4. */
const SUBSET_COUNT = 16;

/** One subset, read off the four low bits so the enumeration is exhaustive. */
function maskOf(bits: number): AbsenceMask {
  return {
    goals: (bits & 1) !== 0,
    'clean-sheets': (bits & 2) !== 0,
    'goals-conceded': (bits & 4) !== 0,
    'keeper-time': (bits & 8) !== 0,
  };
}

/** Every subset of the four members' absence, the empty and full ones included. */
const ABSENCE_MASKS: readonly AbsenceMask[] = Array.from(
  { length: SUBSET_COUNT },
  (_unused, bits) => maskOf(bits),
);

/** The statistics a mask marks absent. */
function absentKinds(mask: AbsenceMask): readonly RichStatKind[] {
  return RICH_STAT_KINDS.filter((kind) => mask[kind]);
}

/** The statistics a mask leaves carrying a value. */
function presentKinds(mask: AbsenceMask): readonly RichStatKind[] {
  return RICH_STAT_KINDS.filter((kind) => !mask[kind]);
}

// --- generators ---------------------------------------------------------------

/** Any numeral at all — the thing an absent member may not render. */
const NUMERAL = /\d/u;

/**
 * A count a present member can carry: ordinary figures, the named edge
 * magnitudes, and **zero**, which is the value the whole property turns on.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 5000 }) },
  {
    weight: 4,
    arbitrary: fc.constantFrom(0, 0, 1, 2, 7, 12, 99, 1000, 123456, Number.MAX_SAFE_INTEGER),
  },
);

/**
 * A Keeper_Time a present member can carry, in milliseconds: zero, durations
 * below the minute the formatter's smallest unit is, whole minutes, multi-hour
 * and multi-day spells.
 *
 * Every value is a non-negative whole number, which is exactly what
 * `readDurationMs` yields, so no generated block is one the Response_Parser
 * could not have produced.
 */
const keeperTimeArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 7_200_000 }) },
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      0,
      0,
      1,
      999,
      59_999,
      60_000,
      4_500_000,
      3_600_000,
      86_400_000,
      172_800_000,
    ),
  },
);

/** A generated block together with the subset of absences it was built from. */
interface MaskedBlock {
  readonly mask: AbsenceMask;
  readonly stats: RichStats;
}

/**
 * A present Rich_Stats block for a generated subset of absences, with a
 * generated value in each member the subset leaves present.
 */
const maskedBlockArb: fc.Arbitrary<MaskedBlock> = fc
  .tuple(
    fc.constantFrom(...ABSENCE_MASKS),
    countArb,
    countArb,
    countArb,
    keeperTimeArb,
  )
  .map(([mask, goals, cleanSheets, goalsConceded, keeperTimeMs]) => ({
    mask,
    stats: blockOf(mask, goals, cleanSheets, goalsConceded, keeperTimeMs),
  }));

/** A subset of absences, for the claims that fix the values themselves. */
const maskArb: fc.Arbitrary<AbsenceMask> = fc.constantFrom(...ABSENCE_MASKS);

/** Build the block a subset and four values describe. */
function blockOf(
  mask: AbsenceMask,
  goals: number,
  cleanSheets: number,
  goalsConceded: number,
  keeperTimeMs: number,
): RichStats {
  return {
    goals: mask.goals ? null : goals,
    cleanSheets: mask['clean-sheets'] ? null : cleanSheets,
    goalsConcededAsKeeper: mask['goals-conceded'] ? null : goalsConceded,
    keeperTimeMs: mask['keeper-time'] ? null : keeperTimeMs,
  };
}

/** The `present` arm over a block, which is the arm this property is about. */
function present(stats: RichStats): RichCondition {
  return { kind: 'present', stats };
}

// --- what each member should read as ------------------------------------------

/** The value one statistic's member carries, or `null` where it carries none. */
function memberValue(kind: RichStatKind, stats: RichStats): number | null {
  switch (kind) {
    case 'goals':
      return stats.goals;
    case 'clean-sheets':
      return stats.cleanSheets;
    case 'goals-conceded':
      return stats.goalsConcededAsKeeper;
    case 'keeper-time':
      return stats.keeperTimeMs;
  }
}

/**
 * The text one statistic should read as: the no-data statement for an absent
 * member, and otherwise the text the owning `lib/` formatter produces — taken
 * from those modules rather than restated, so this file never becomes a second
 * opinion on how a figure reads.
 */
function expectedValueText(kind: RichStatKind, stats: RichStats): string {
  const value = memberValue(kind, stats);

  if (value === null) {
    return STATISTIC_NO_DATA;
  }

  return kind === 'keeper-time' ? formatDuration(value) : formatCount(value);
}

// --- rendering ----------------------------------------------------------------

/** What one statistic's entry says, across every channel a numeral could use. */
interface RenderedEntry {
  /** The whole entry's text: the label and the value or statement together. */
  readonly entryText: string;

  /** The label naming the statistic. */
  readonly labelText: string;

  /** The value element's text — the figure, or the no-data statement. */
  readonly valueText: string;

  /** What the entry reports about carrying a value: `'true'` or `'false'`. */
  readonly hasValue: string;

  /** Every attribute value in the entry's subtree, joined. */
  readonly attributeText: string;
}

/** What the whole panel rendered for one condition. */
interface RenderedPanel {
  /** One reading per statistic, by kind. */
  readonly entries: Readonly<Record<RichStatKind, RenderedEntry>>;

  /** How many entries rendered; one per statistic is the contract. */
  readonly entryCount: number;

  /** How many condition statements rendered; the `present` arm renders none. */
  readonly statementCount: number;

  /** The condition the panel records having rendered. */
  readonly conditionAttribute: string;

  /** The panel's whole text. */
  readonly panelText: string;
}

/**
 * Render one condition and read every statistic's entry off it.
 *
 * Unmounted in a `finally` before returning, because a property runs hundreds of
 * times within a single test and Testing Library's automatic cleanup only fires
 * between tests — without this, the second render of a run would be read out of a
 * document still holding the first, and a "no numeral" scan would be looking at
 * the wrong panel.
 */
function renderPanel(condition: RichCondition): RenderedPanel {
  try {
    const { container } = render(<RichStatsPanel condition={condition} />);

    const panel = container.querySelector<HTMLElement>(RICH_STATS_PANEL_SELECTOR);

    if (panel === null) {
      throw new Error('the rich stats panel did not render');
    }

    const entries = Object.fromEntries(
      RICH_STAT_KINDS.map((kind) => [kind, readEntry(panel, kind)]),
    ) as Readonly<Record<RichStatKind, RenderedEntry>>;

    return {
      entries,
      entryCount: panel.querySelectorAll(RICH_STATS_ENTRY_SELECTOR).length,
      statementCount: panel.querySelectorAll(RICH_STATS_STATEMENT_SELECTOR).length,
      conditionAttribute:
        panel.getAttribute(RICH_STATS_CONDITION_ATTRIBUTE) ?? '',
      panelText: panel.textContent ?? '',
    };
  } finally {
    cleanup();
  }
}

/** Read one statistic's entry, or an empty reading where it did not render. */
function readEntry(panel: HTMLElement, kind: RichStatKind): RenderedEntry {
  const entry = panel.querySelector<HTMLElement>(
    `[${RICH_STATS_ENTRY_ATTRIBUTE}="${kind}"]`,
  );

  if (entry === null) {
    return {
      entryText: '',
      labelText: '',
      valueText: '',
      hasValue: '',
      attributeText: '',
    };
  }

  const label = entry.querySelector<HTMLElement>(
    `[${RICH_STATS_LABEL_ATTRIBUTE}="${kind}"]`,
  );
  const value = entry.querySelector<HTMLElement>(
    `[${RICH_STATS_VALUE_ATTRIBUTE}="${kind}"]`,
  );

  return {
    entryText: entry.textContent ?? '',
    labelText: label?.textContent ?? '',
    valueText: value?.textContent ?? '',
    hasValue: value?.getAttribute(RICH_STATS_HAS_VALUE_ATTRIBUTE) ?? '',
    attributeText: attributeValuesOf(entry),
  };
}

/**
 * Every attribute value on an element and its descendants, joined.
 *
 * A numeral in an attribute is still a numeral attributable to the statistic —
 * a `title`, an `aria-label`, or a data attribute carrying the figure beside the
 * no-data statement would hand a reader exactly the number Requirement 11.4
 * withholds — so the scan covers the markup as well as the words.
 */
function attributeValuesOf(root: HTMLElement): string {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];

  return elements
    .flatMap((element) =>
      element
        .getAttributeNames()
        .map((name) => element.getAttribute(name) ?? ''),
    )
    .join(' ');
}

// --- grounding: the scan is a real discriminator ------------------------------

// Feature: web-player-stats-screen, Property 27: An absent rich member renders a statement, never a numeral
// Validates: Requirements 11.3, 11.4
describe('the subsets and the vocabulary this suite is written against', () => {
  it('enumerates all sixteen subsets of the four members, each exactly once', () => {
    expect(RICH_STAT_KINDS).toHaveLength(4);
    expect(ABSENCE_MASKS).toHaveLength(SUBSET_COUNT);

    const spellings = ABSENCE_MASKS.map((mask) => absentKinds(mask).join('+'));

    expect(new Set(spellings).size).toBe(SUBSET_COUNT);

    // The lattice by cardinality: one empty subset, four singletons, six pairs,
    // four triples, one full — so no subset size is missing from the quantifier.
    const sizes = ABSENCE_MASKS.map((mask) => absentKinds(mask).length);

    expect([0, 1, 2, 3, 4].map((size) => sizes.filter((n) => n === size).length))
      .toEqual([1, 4, 6, 4, 1]);
  });

  it('carries no digit in any label, kind name, or the no-data statement', () => {
    // Without this, "the entry renders no numeral" could hold or fail for
    // reasons that have nothing to do with the member's value.
    expect(STATISTIC_NO_DATA).not.toMatch(NUMERAL);

    for (const kind of RICH_STAT_KINDS) {
      expect(kind).not.toMatch(NUMERAL);
      expect(RICH_STAT_LABELS[kind]).not.toMatch(NUMERAL);
    }
  });

  it('formats a genuine zero as digits, so the present half is falsifiable', () => {
    // The non-vacuity hinge: a zero *does* have a numeral to render, so a panel
    // that rendered no numerals at all would fail the present-member claims
    // below rather than passing the absent-member ones for free.
    expect(formatCount(0)).toBe('0');
    expect(formatCount(0)).toMatch(NUMERAL);
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(0)).toMatch(NUMERAL);
  });

  it('generates every subset and reaches zero in every member', () => {
    const samples = fc.sample(maskedBlockArb, { numRuns: 600, seed: 27 });

    expect(
      new Set(samples.map(({ mask }) => absentKinds(mask).join('+'))).size,
    ).toBe(SUBSET_COUNT);

    // And a real zero arrives in each of the four members, which is the value
    // the falsy-test defect hides behind.
    for (const kind of RICH_STAT_KINDS) {
      expect(
        samples.some(({ stats }) => memberValue(kind, stats) === 0),
      ).toBe(true);
    }
  });
});

// --- the property proper ------------------------------------------------------

// Feature: web-player-stats-screen, Property 27: An absent rich member renders a statement, never a numeral
// Validates: Requirements 11.3, 11.4
describe('an absent rich member renders a statement, never a numeral (Req 11.4)', () => {
  it('renders the no-data statement and no digit anywhere in that statistic', () => {
    fc.assert(
      fc.property(maskedBlockArb, ({ mask, stats }) => {
        const rendered = renderPanel(present(stats));

        for (const kind of absentKinds(mask)) {
          const entry = rendered.entries[kind];

          // The statement, verbatim, in place of a figure.
          expect(entry.valueText).toBe(STATISTIC_NO_DATA);
          expect(entry.hasValue).toBe('false');

          // And no numeral attributable to the statistic — not in its words,
          // not in its markup. Including no zero: the member carries nothing,
          // and nothing is not a recorded figure.
          expect(entry.entryText).not.toMatch(NUMERAL);
          expect(entry.attributeText).not.toMatch(NUMERAL);

          // Still named, so the reader knows which statistic has no data
          // rather than finding a labelless sentence (11.3).
          expect(entry.labelText).toBe(RICH_STAT_LABELS[kind]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('renders the formatted value, with its label, for every present member (Req 11.3)', () => {
    fc.assert(
      fc.property(maskedBlockArb, ({ mask, stats }) => {
        const rendered = renderPanel(present(stats));

        for (const kind of presentKinds(mask)) {
          const entry = rendered.entries[kind];

          // The figure the owning formatter produces, and nothing else.
          expect(entry.valueText).toBe(expectedValueText(kind, stats));
          expect(entry.valueText).not.toBe(STATISTIC_NO_DATA);
          expect(entry.hasValue).toBe('true');

          // A present count or duration always has digits to show — which is
          // what makes the absent-member scan above a discriminator and not a
          // statement about a panel that renders no numerals at all.
          expect(entry.valueText).toMatch(NUMERAL);
          expect(entry.labelText).toBe(RICH_STAT_LABELS[kind]);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('confines every numeral in the panel to the members that carry a value', () => {
    fc.assert(
      fc.property(maskedBlockArb, ({ mask, stats }) => {
        const rendered = renderPanel(present(stats));

        // The same claim read globally rather than entry by entry: the set of
        // statistics whose presentation contains a digit is exactly the set of
        // members carrying a value. An absent member cannot borrow a numeral
        // from its neighbour, and a present one cannot go unrendered.
        const numeralBearing = RICH_STAT_KINDS.filter((kind) =>
          NUMERAL.test(rendered.entries[kind].entryText),
        );

        expect(numeralBearing).toEqual(presentKinds(mask));

        // The all-absent subset is the one where this says the panel shows no
        // numeral whatsoever, which is the strongest form of 11.4.
        if (presentKinds(mask).length === 0) {
          expect(rendered.panelText).not.toMatch(NUMERAL);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('renders all four statistics, each once, whichever members are absent', () => {
    fc.assert(
      fc.property(maskedBlockArb, ({ stats }) => {
        const rendered = renderPanel(present(stats));

        // Degradation is per member: an absent member becomes a statement, it
        // does not remove its statistic from the panel (11.3, 11.4).
        expect(rendered.entryCount).toBe(RICH_STAT_KINDS.length);
        expect(rendered.conditionAttribute).toBe('present');

        // And no condition statement, which belongs to the two figure-less
        // conditions rather than to a block that has members to report.
        expect(rendered.statementCount).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

// --- the other half: a genuine zero is a figure --------------------------------

// Feature: web-player-stats-screen, Property 27: An absent rich member renders a statement, never a numeral
// Validates: Requirements 11.3, 11.4
describe('a present member whose value is zero renders that zero (Req 11.3)', () => {
  it('renders a zero for every present member of every subset', () => {
    fc.assert(
      fc.property(maskArb, (mask) => {
        // Every present member fixed at a genuine zero, beside whichever
        // members the subset makes absent. This is the block a falsy test
        // cannot tell apart, and the one that separates "no data" from "none".
        const stats = blockOf(mask, 0, 0, 0, 0);
        const rendered = renderPanel(present(stats));

        for (const kind of presentKinds(mask)) {
          const entry = rendered.entries[kind];

          expect(entry.valueText).toBe(
            kind === 'keeper-time' ? formatDuration(0) : formatCount(0),
          );
          expect(entry.valueText).toMatch(NUMERAL);
          expect(entry.valueText).not.toBe(STATISTIC_NO_DATA);
          expect(entry.hasValue).toBe('true');
        }

        // The absent members of the very same block still read as statements,
        // so the two facts are told apart within one render rather than across
        // two.
        for (const kind of absentKinds(mask)) {
          expect(rendered.entries[kind].valueText).toBe(STATISTIC_NO_DATA);
          expect(rendered.entries[kind].entryText).not.toMatch(NUMERAL);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('renders a zero beside a non-zero figure without confusing the two', () => {
    fc.assert(
      fc.property(maskArb, countArb, (mask, count) => {
        fc.pre(count > 0);

        // Goals zero, the other counts non-zero: a block carrying both a
        // recorded nothing and a recorded something, for every subset.
        const stats = blockOf(mask, 0, count, count, 0);
        const rendered = renderPanel(present(stats));

        for (const kind of presentKinds(mask)) {
          expect(rendered.entries[kind].valueText).toBe(
            expectedValueText(kind, stats),
          );
          expect(rendered.entries[kind].hasValue).toBe('true');
        }
      }),
      { numRuns: 200 },
    );
  });
});

// --- the blocks the screen really produces ------------------------------------

// Feature: web-player-stats-screen, Property 27: An absent rich member renders a statement, never a numeral
// Validates: Requirements 11.3, 11.4
describe('the subsets this property quantifies over are the screen’s own', () => {
  it('reaches the same presentation through the resolver for every non-empty subset', () => {
    fc.assert(
      fc.property(maskedBlockArb, ({ mask, stats }) => {
        fc.pre(presentKinds(mask).length > 0);

        // The screen never constructs the `present` arm by hand; it resolves it
        // from the parsed block. A block with at least one member present
        // resolves to `present`, so all fifteen of those subsets are reached by
        // the real path and render exactly as the constructed arm does.
        const resolved = resolveRichCondition(stats);

        expect(resolved.kind).toBe('present');
        expect(renderPanel(resolved).panelText).toBe(
          renderPanel(present(stats)).panelText,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('notes that the all-absent subset is the resolver’s empty condition instead', () => {
    // Stated so the coverage claim above is honest: the sixteenth subset is
    // asserted against the `present` arm the panel may be given, not against an
    // arm the screen would produce for it.
    const allAbsent = blockOf(maskOf(0b1111), 0, 0, 0, 0);

    expect(resolveRichCondition(allAbsent).kind).toBe('empty');
    expect(renderPanel(present(allAbsent)).conditionAttribute).toBe('present');
  });
});
