/**
 * Unit tests for the rich-stats panel.
 *
 * Five clauses of Requirement 11 are observable here:
 *
 *   - the Tracking_Disabled_Condition renders the statement that this squad does
 *     not record live match detail, and **no figure at all** (11.1) — the
 *     failure mode is four "No data" rows, which would describe a squad that
 *     records live detail and happens to have none,
 *   - the Tracking_Empty_Condition renders its own, distinct statement (11.2),
 *   - a present member renders its value with a label naming the statistic
 *     (11.3),
 *   - an absent member renders a no-data statement and **no numeral, including
 *     no zero** (11.4) — while a member whose value is genuinely zero renders
 *     that zero, which is the half of the rule a falsy test would break,
 *   - the Keeper_Time is rendered through the feature's own duration formatter
 *     (11.5), so the text is the formatter's and not this component's.
 *
 * The exhaustive-over-all-subsets version of the absent-member rule is
 * Property 27's; these are the worked examples beside it.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RICH_STAT_KINDS,
  RICH_STAT_LABELS,
  RICH_STATS_CONDITION_ATTRIBUTE,
  RICH_STATS_ENTRY_SELECTOR,
  RICH_STATS_HAS_VALUE_ATTRIBUTE,
  RICH_STATS_PANEL_SELECTOR,
  RICH_STATS_STATEMENT_SELECTOR,
  RichStatsPanel,
  type RichStatKind,
  type RichStatsPanelProps,
} from './RichStatsPanel';
import { formatDuration } from '../lib/duration';
import {
  STATISTIC_NO_DATA,
  TRACKING_DISABLED,
  TRACKING_EMPTY,
} from '../lib/messages';
import type { RichStats } from '../lib/parse/playerProfile';
import { resolveRichCondition, type RichCondition } from '../lib/richStats';

/** Any numeral at all — the thing an absent member may not render. */
const NUMERAL = /\d/;

/** A Keeper_Time of 75 minutes, which the formatter states as `'1h 15m'`. */
const KEEPER_TIME_MS = 4_500_000;

/** A fully populated block: three counts and that Keeper_Time. */
const FULL_STATS: RichStats = {
  goals: 12,
  cleanSheets: 2,
  goalsConcededAsKeeper: 18,
  keeperTimeMs: KEEPER_TIME_MS,
};

/** A block whose every member is a genuine zero. */
const ZERO_STATS: RichStats = {
  goals: 0,
  cleanSheets: 0,
  goalsConcededAsKeeper: 0,
  keeperTimeMs: 0,
};

/** The three conditions, built through the resolver the screen uses. */
const DISABLED: RichCondition = resolveRichCondition(null);
const EMPTY: RichCondition = resolveRichCondition({
  goals: null,
  cleanSheets: null,
  goalsConcededAsKeeper: null,
  keeperTimeMs: null,
});

/** The `present` condition over a given block. */
function present(stats: RichStats): RichCondition {
  return { kind: 'present', stats };
}

/** The rendered panel root. */
function panel(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>(RICH_STATS_PANEL_SELECTOR);

  expect(root).not.toBeNull();

  return root as HTMLElement;
}

/** One statistic's whole entry: its label and its value or statement. */
function entry(container: HTMLElement, kind: RichStatKind): HTMLElement {
  const group = container.querySelector<HTMLElement>(
    `[data-player-stats-rich-entry="${kind}"]`,
  );

  expect(group).not.toBeNull();

  return group as HTMLElement;
}

/** The text of one statistic's value element. */
function valueText(container: HTMLElement, kind: RichStatKind): string {
  const value = container.querySelector<HTMLElement>(
    `[data-player-stats-rich-statistic="${kind}"]`,
  );

  expect(value).not.toBeNull();

  return (value as HTMLElement).textContent ?? '';
}

describe('RichStatsPanel tracking-disabled condition (Req 11.1)', () => {
  it('states that this squad does not record live match detail', () => {
    const { container } = render(<RichStatsPanel condition={DISABLED} />);

    expect(screen.getByText(TRACKING_DISABLED)).toBeVisible();
    expect(
      container.querySelector(RICH_STATS_STATEMENT_SELECTOR)?.textContent,
    ).toBe(TRACKING_DISABLED);
  });

  it('renders no statistic, not even a no-data row', () => {
    const { container } = render(<RichStatsPanel condition={DISABLED} />);

    expect(container.querySelectorAll(RICH_STATS_ENTRY_SELECTOR)).toHaveLength(0);
    expect(screen.queryByText(STATISTIC_NO_DATA)).toBeNull();

    for (const kind of RICH_STAT_KINDS) {
      expect(screen.queryByText(RICH_STAT_LABELS[kind])).toBeNull();
    }
  });

  it('renders no numeral anywhere in the panel', () => {
    const { container } = render(<RichStatsPanel condition={DISABLED} />);

    expect(panel(container).textContent ?? '').not.toMatch(NUMERAL);
  });
});

describe('RichStatsPanel tracking-empty condition (Req 11.2)', () => {
  it('states that no live match detail has been recorded yet', () => {
    const { container } = render(<RichStatsPanel condition={EMPTY} />);

    expect(screen.getByText(TRACKING_EMPTY)).toBeVisible();
    expect(
      container.querySelector(RICH_STATS_STATEMENT_SELECTOR)?.textContent,
    ).toBe(TRACKING_EMPTY);
  });

  it('renders text distinct from the tracking-disabled statement', () => {
    const empty = render(<RichStatsPanel condition={EMPTY} />);
    const emptyText = panel(empty.container).textContent ?? '';

    empty.unmount();

    const disabled = render(<RichStatsPanel condition={DISABLED} />);
    const disabledText = panel(disabled.container).textContent ?? '';

    expect(emptyText).not.toBe(disabledText);
    expect(emptyText).not.toContain(disabledText);
    expect(disabledText).not.toContain(emptyText);
  });

  it('renders no statistic and no numeral', () => {
    const { container } = render(<RichStatsPanel condition={EMPTY} />);

    expect(container.querySelectorAll(RICH_STATS_ENTRY_SELECTOR)).toHaveLength(0);
    expect(panel(container).textContent ?? '').not.toMatch(NUMERAL);
  });
});

describe('RichStatsPanel present values (Reqs 11.3, 11.5)', () => {
  it('renders each statistic with its label', () => {
    render(<RichStatsPanel condition={present(FULL_STATS)} />);

    for (const kind of RICH_STAT_KINDS) {
      expect(screen.getByText(RICH_STAT_LABELS[kind])).toBeVisible();
    }
  });

  it('renders the three counts exactly as parsed', () => {
    const { container } = render(<RichStatsPanel condition={present(FULL_STATS)} />);

    expect(valueText(container, 'goals')).toBe('12');
    expect(valueText(container, 'clean-sheets')).toBe('2');
    expect(valueText(container, 'goals-conceded')).toBe('18');
  });

  it('renders the keeper time through the feature’s duration formatter', () => {
    const { container } = render(<RichStatsPanel condition={present(FULL_STATS)} />);

    expect(valueText(container, 'keeper-time')).toBe(
      formatDuration(KEEPER_TIME_MS),
    );
    expect(valueText(container, 'keeper-time')).toBe('1h 15m');
  });

  it('renders exactly one entry per statistic', () => {
    const { container } = render(<RichStatsPanel condition={present(FULL_STATS)} />);

    expect(container.querySelectorAll(RICH_STATS_ENTRY_SELECTOR)).toHaveLength(
      RICH_STAT_KINDS.length,
    );
  });

  it('renders no condition statement where there are figures to show', () => {
    const { container } = render(<RichStatsPanel condition={present(FULL_STATS)} />);

    expect(container.querySelector(RICH_STATS_STATEMENT_SELECTOR)).toBeNull();
    expect(screen.queryByText(TRACKING_DISABLED)).toBeNull();
    expect(screen.queryByText(TRACKING_EMPTY)).toBeNull();
  });

  it('associates each value with its own label', () => {
    const { container } = render(<RichStatsPanel condition={present(FULL_STATS)} />);

    for (const kind of RICH_STAT_KINDS) {
      const childTags = Array.from(entry(container, kind).children).map(
        (child) => child.tagName,
      );

      expect(childTags).toEqual(['DT', 'DD']);
      expect(entry(container, kind).children[0]?.textContent).toBe(
        RICH_STAT_LABELS[kind],
      );
    }
  });
});

describe('RichStatsPanel a zero is a value (Req 11.3)', () => {
  it('renders a genuine zero for each count', () => {
    const { container } = render(<RichStatsPanel condition={present(ZERO_STATS)} />);

    expect(valueText(container, 'goals')).toBe('0');
    expect(valueText(container, 'clean-sheets')).toBe('0');
    expect(valueText(container, 'goals-conceded')).toBe('0');
  });

  it('renders a zero keeper time as the formatter states it', () => {
    const { container } = render(<RichStatsPanel condition={present(ZERO_STATS)} />);

    expect(valueText(container, 'keeper-time')).toBe(formatDuration(0));
    expect(valueText(container, 'keeper-time')).toBe('0m');
  });

  it('reports every zero member as carrying a value', () => {
    const { container } = render(<RichStatsPanel condition={present(ZERO_STATS)} />);

    for (const kind of RICH_STAT_KINDS) {
      expect(
        container
          .querySelector(`[data-player-stats-rich-statistic="${kind}"]`)
          ?.getAttribute(RICH_STATS_HAS_VALUE_ATTRIBUTE),
      ).toBe('true');
    }
  });

  it('renders no no-data statement for an all-zero block', () => {
    render(<RichStatsPanel condition={present(ZERO_STATS)} />);

    expect(screen.queryByText(STATISTIC_NO_DATA)).toBeNull();
  });
});

describe('RichStatsPanel absent members (Req 11.4)', () => {
  it.each(RICH_STAT_KINDS)(
    'renders a statement and no numeral for an absent %s',
    (kind) => {
      const stats: RichStats = {
        goals: kind === 'goals' ? null : FULL_STATS.goals,
        cleanSheets: kind === 'clean-sheets' ? null : FULL_STATS.cleanSheets,
        goalsConcededAsKeeper:
          kind === 'goals-conceded' ? null : FULL_STATS.goalsConcededAsKeeper,
        keeperTimeMs: kind === 'keeper-time' ? null : FULL_STATS.keeperTimeMs,
      };

      const { container } = render(<RichStatsPanel condition={present(stats)} />);

      // The statement, and nothing numeric anywhere in that statistic's entry —
      // including no zero.
      expect(valueText(container, kind)).toBe(STATISTIC_NO_DATA);
      expect(entry(container, kind).textContent ?? '').not.toMatch(NUMERAL);
      expect(
        container
          .querySelector(`[data-player-stats-rich-statistic="${kind}"]`)
          ?.getAttribute(RICH_STATS_HAS_VALUE_ATTRIBUTE),
      ).toBe('false');
    },
  );

  it('keeps rendering the members that do carry a value', () => {
    const stats: RichStats = {
      goals: null,
      cleanSheets: 2,
      goalsConcededAsKeeper: null,
      keeperTimeMs: KEEPER_TIME_MS,
    };

    const { container } = render(<RichStatsPanel condition={present(stats)} />);

    expect(valueText(container, 'goals')).toBe(STATISTIC_NO_DATA);
    expect(valueText(container, 'goals-conceded')).toBe(STATISTIC_NO_DATA);
    expect(valueText(container, 'clean-sheets')).toBe('2');
    expect(valueText(container, 'keeper-time')).toBe('1h 15m');
  });

  it('labels an absent statistic exactly as a present one', () => {
    const stats: RichStats = { ...FULL_STATS, goals: null };

    render(<RichStatsPanel condition={present(stats)} />);

    expect(screen.getByText(RICH_STAT_LABELS.goals)).toBeVisible();
  });
});

describe('RichStatsPanel structure', () => {
  const CONDITIONS: readonly (readonly [string, RichCondition])[] = [
    ['disabled', DISABLED],
    ['empty', EMPTY],
    ['present', present(FULL_STATS)],
  ];

  it.each(CONDITIONS)('names the %s condition on the panel', (kind, condition) => {
    const { container } = render(<RichStatsPanel condition={condition} />);

    expect(panel(container).getAttribute(RICH_STATS_CONDITION_ATTRIBUTE)).toBe(
      kind,
    );
  });

  it.each(CONDITIONS)(
    'renders no heading in the %s condition, leaving that to its wrapper',
    (_kind, condition) => {
      render(<RichStatsPanel condition={condition} />);

      expect(screen.queryAllByRole('heading')).toHaveLength(0);
    },
  );

  it.each(CONDITIONS)(
    'renders nothing activatable in the %s condition',
    (_kind, condition) => {
      const { container } = render(<RichStatsPanel condition={condition} />);

      expect(
        panel(container).querySelectorAll(
          'a, button, input, select, textarea, [tabindex]',
        ),
      ).toHaveLength(0);
    },
  );

  it('takes only the resolved condition, so there is no block to re-interpret', () => {
    // A complete props value: the one member is the whole interface, so no raw
    // Rich_Stats block, feature flag, or appearance count can reach the
    // component and produce a second opinion on which condition holds (11.6).
    const props: RichStatsPanelProps = { condition: DISABLED };
    const keys: readonly (keyof RichStatsPanelProps)[] = Object.keys(
      props,
    ) as (keyof RichStatsPanelProps)[];

    expect(keys).toEqual(['condition']);
  });
});
