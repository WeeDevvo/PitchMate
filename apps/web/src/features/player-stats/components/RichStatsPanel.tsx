/**
 * The rich-stats section's body — the live-tracking figures, in whichever of the
 * three rich conditions holds.
 *
 * Live match tracking is a per-squad opt-in, so this is the one section of the
 * Player_Stats_Screen whose *contents* depend on the squad's own settings rather
 * than on the player. The decision is already made before this component is
 * reached — `resolveRichCondition` in `lib/richStats.ts` returns exactly one of
 * three conditions (Requirement 11.6) — so the panel receives **one tagged
 * value** rather than a nullable block to re-interpret, exactly as `RatingPanel`
 * receives a resolved Rating_Condition. There is therefore no arrangement of
 * props that renders two conditions, and no second place in the feature that
 * could decide what an absent Rich_Stats block means.
 *
 * ### The three presentations
 *
 * | Condition | Visible | Requirement |
 * | --- | --- | --- |
 * | `disabled` | {@link TRACKING_DISABLED} alone — **no figure and no per-statistic statement** | 11.1 |
 * | `empty` | {@link TRACKING_EMPTY} alone | 11.2 |
 * | `present` | the four statistics, each labelled, each a value or {@link STATISTIC_NO_DATA} | 11.3, 11.4 |
 *
 * The `disabled` arm renders no statistic at all, not even a no-data row per
 * statistic: Requirement 11.1 asks for no goals, clean-sheets, goals-conceded,
 * or Keeper_Time value, and four rows reading "No data" would imply this squad
 * records live detail and happens to have none — which is the *other* condition.
 * The union's `disabled` arm carries no block, so there is nothing here to
 * render even by accident.
 *
 * ### An absent member is a sentence, never a zero (Requirement 11.4)
 *
 * Within the `present` condition each of the four members degrades
 * independently, and the test for each is **absence, never falsiness**. A
 * member that carries no value renders {@link STATISTIC_NO_DATA} and **no
 * numeral whatsoever, including no zero** — a keeper who conceded nothing and a
 * keeper whose minutes were never recorded are different facts, and only one of
 * them is a zero. The converse matters just as much: a member whose value is
 * genuinely `0` renders its formatted value (`'0'`, or `'0m'` for a Keeper_Time
 * under a minute), because that is a recorded figure and a true statement about
 * that player. Both halves are claimed by Property 27.
 *
 * ### Formatting happens in `lib/`
 *
 * The three counts pass through `formatCount` and the Keeper_Time through
 * `formatDuration`, so this component contains no formatting logic: the digits a
 * person reads are determined solely by the parsed value and are covered by
 * those modules' own property tests rather than by a snapshot of this markup
 * (Requirement 11.5).
 *
 * ### What it does not do
 *
 * It renders **no heading** — the screen wraps this panel in a `StatSection`,
 * which contributes the one level-two heading the section owes, and a heading
 * here would either duplicate that or skip a level (Requirements 16.1, 16.2).
 * It renders **no control**, and it holds **no copy**: every string comes from
 * `lib/messages.ts` and every colour from a custom property declared in
 * `styles/playerStatsTokens.css`, so `RichStatsPanel.css` holds no colour value.
 *
 * It also makes no judgement about whether the rest of the screen should render.
 * The Appearance_Count is not a prop and neither is any other section's data:
 * disabling live tracking removes the rich statistics and nothing else
 * (Requirement 11.7), which is a property of the screen's shape rather than a
 * condition this panel could influence.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { type ReactElement } from 'react';
import { StatTile } from '../../../ui';

import { formatDuration } from '../lib/duration';
import {
  CLEAN_SHEETS_LABEL,
  GOALS_CONCEDED_AS_KEEPER_LABEL,
  GOALS_LABEL,
  KEEPER_TIME_LABEL,
  STATISTIC_NO_DATA,
  TRACKING_DISABLED,
  TRACKING_EMPTY,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { RichStats } from '../lib/parse/playerProfile';
import type { RichCondition } from '../lib/richStats';

// The feature token table, so a panel rendered outside the App_Shell frame still
// resolves every custom property `RichStatsPanel.css` reads (Requirement 15.2).
import '../styles/playerStatsTokens.css';
import './RichStatsPanel.css';

/** The selector of the panel, so a test can assert over its whole subtree. */
export const RICH_STATS_PANEL_SELECTOR = '[data-player-stats-rich="true"]';

/**
 * The attribute carrying which of the three conditions was rendered, so a test
 * can name the condition it means rather than matching on copy.
 */
export const RICH_STATS_CONDITION_ATTRIBUTE = 'data-rich-condition';

/**
 * The selector of the condition statement the two figure-less conditions render
 * — {@link TRACKING_DISABLED} or {@link TRACKING_EMPTY} (Requirements 11.1,
 * 11.2). The `present` condition renders no such element.
 */
export const RICH_STATS_STATEMENT_SELECTOR =
  '[data-player-stats-rich-statement="true"]';

/**
 * The attribute naming which statistic an **entry** reports — the group holding
 * one label and the one value or statement beside it. Its value is a
 * {@link RichStatKind}, so a test can take the whole of one statistic's
 * presentation and assert what it does and does not contain.
 */
export const RICH_STATS_ENTRY_ATTRIBUTE = 'data-player-stats-rich-entry';

/** The selector of every statistic's entry, so a test can count the entries. */
export const RICH_STATS_ENTRY_SELECTOR = '[data-player-stats-rich-entry]';

/**
 * The attribute naming which statistic an entry's **value** reports, so a test
 * can read the value on its own. Its value is a {@link RichStatKind}.
 */
export const RICH_STATS_VALUE_ATTRIBUTE = 'data-player-stats-rich-statistic';

/** The selector of every statistic's value element. */
export const RICH_STATS_VALUE_SELECTOR = '[data-player-stats-rich-statistic]';

/**
 * The attribute stating whether an entry rendered a value or the no-data
 * statement, so a test can tell the two apart without inspecting text. Its value
 * is `'true'` or `'false'`.
 */
export const RICH_STATS_HAS_VALUE_ATTRIBUTE = 'data-player-stats-rich-has-value';

/** The attribute naming which statistic an entry's **label** names. */
export const RICH_STATS_LABEL_ATTRIBUTE = 'data-player-stats-rich-label';

/**
 * The four statistics, in the fixed order they render, and the values the
 * `data-player-stats-rich-statistic` attribute takes.
 *
 * Exported as a tuple so a test can iterate the statistics this panel renders
 * rather than restating them — and so a fifth member added to `RichStats`
 * without a kind here fails the exhaustive switch in {@link richStatReading}.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the statistics this panel renders, and their order, are the panel's own; a separate module for them would put the list a step away from the markup it drives
export const RICH_STAT_KINDS = [
  'goals',
  'clean-sheets',
  'goals-conceded',
  'keeper-time',
] as const;

/** Which of the four rich statistics an entry reports. */
export type RichStatKind = (typeof RICH_STAT_KINDS)[number];

/**
 * The label naming each statistic (Requirement 11.3).
 *
 * One table rather than four hand-written labels in the markup: the pairing of a
 * statistic with its words is then written once, and a test can assert the
 * pairing without duplicating the mapping. Every string is `lib/messages.ts`'s.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the statistic-to-label pairing is this panel's, and stays beside the markup that applies it
export const RICH_STAT_LABELS: Readonly<Record<RichStatKind, string>> = {
  goals: GOALS_LABEL,
  'clean-sheets': CLEAN_SHEETS_LABEL,
  'goals-conceded': GOALS_CONCEDED_AS_KEEPER_LABEL,
  'keeper-time': KEEPER_TIME_LABEL,
};

/** What one statistic reads as, and whether that text is a value at all. */
interface RichStatReading {
  /** The formatted value, or {@link STATISTIC_NO_DATA}. */
  readonly text: string;

  /** Whether the member carried a value (Requirements 11.3, 11.4). */
  readonly hasValue: boolean;
}

/** The reading of an absent member: a statement, and no numeral. */
const NO_DATA_READING: RichStatReading = {
  text: STATISTIC_NO_DATA,
  hasValue: false,
};

/**
 * What one statistic of a present block reads as.
 *
 * Exhaustive over {@link RichStatKind} with no default arm, so a fifth statistic
 * is a compile failure here rather than a silently unrendered figure. Pure,
 * total, and free of exceptions — every arm is one absence test and one `lib/`
 * formatter.
 *
 * Requirements: 11.3, 11.4, 11.5
 */
function richStatReading(kind: RichStatKind, stats: RichStats): RichStatReading {
  switch (kind) {
    case 'goals':
      return countReading(stats.goals);
    case 'clean-sheets':
      return countReading(stats.cleanSheets);
    case 'goals-conceded':
      return countReading(stats.goalsConcededAsKeeper);
    // 11.5: the duration in a form determined solely by the parsed value, by the
    // feature's own formatter rather than by anything locale-dependent.
    case 'keeper-time': {
      const keeperTimeMs = stats.keeperTimeMs;

      if (keeperTimeMs === null || keeperTimeMs === undefined) {
        return NO_DATA_READING;
      }

      return { text: formatDuration(keeperTimeMs), hasValue: true };
    }
  }
}

/**
 * A count member's reading: the whole number exactly as parsed, or the no-data
 * statement where the member carries none.
 *
 * `null` is the absence the Response_Parser produces for every absent member,
 * whichever way the wire spelled it; `undefined` is tested too so a caller
 * holding the block as optional properties cannot turn an absence into a
 * rendered `'undefined'`. Nothing is coerced, so a falsy *value* — a genuine
 * zero — is not an absence (Requirements 11.3, 11.4).
 */
function countReading(value: number | null | undefined): RichStatReading {
  if (value === null || value === undefined) {
    return NO_DATA_READING;
  }

  return { text: formatCount(value), hasValue: true };
}

/**
 * The statement a figure-less condition renders, or `null` where the condition
 * carries figures instead.
 *
 * Exhaustive over the `RichCondition` union with no default arm. The two
 * statements are distinct strings in `lib/messages.ts` and neither contains the
 * other, which is what makes "neither condition is ever presented as the other"
 * hold of the rendered panel as well as of the resolver (Requirements 11.1,
 * 11.2, 11.6).
 */
function conditionStatementOf(condition: RichCondition): string | null {
  switch (condition.kind) {
    // 11.1: the squad does not record live match detail — so no statistic is
    // rendered at all, not even a no-data row.
    case 'disabled':
      return TRACKING_DISABLED;
    // 11.2: detail is recorded and none exists yet, which is a different claim.
    case 'empty':
      return TRACKING_EMPTY;
    case 'present':
      return null;
  }
}

export interface RichStatsPanelProps {
  /**
   * The one condition this panel renders, as resolved by `resolveRichCondition`
   * (Requirement 11.6).
   *
   * The only prop. The block itself arrives on the `present` arm alone, so there
   * is no condition in which this component could read a figure that is not
   * there.
   */
  readonly condition: RichCondition;
}

/**
 * Render the rich-stats section's body: the statement for a squad that records
 * no live detail or has none yet, or the four labelled statistics.
 *
 * The statistics are a description list, so each figure is associated with its
 * label in the markup rather than only by proximity — matching the streak panel
 * and the bib figure above it. Each pair is wrapped in a `div`, which HTML
 * permits as a grouping element inside a `dl` and which the record panel already
 * uses for the same reason: it gives the four statistics a layout group each, and
 * gives a test one element holding the whole of one statistic's presentation.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
export function RichStatsPanel({
  condition,
}: RichStatsPanelProps): ReactElement {
  const statement = conditionStatementOf(condition);

  return (
    <div
      className="player-stats-rich"
      data-player-stats-rich="true"
      data-rich-condition={condition.kind}
    >
      {statement === null ? null : (
        <p
          className="player-stats-rich__statement"
          data-player-stats-rich-statement="true"
        >
          {statement}
        </p>
      )}

      {condition.kind === 'present' ? (
        <dl className="player-stats-rich__figures">
          {RICH_STAT_KINDS.map((kind) => {
            const { text, hasValue } = richStatReading(kind, condition.stats);

            // 11.3: the words naming which statistic this figure is, and the
            // value through a `lib/` formatter. 11.4: or the no-data statement,
            // with no numeral of any kind beside it.
            return (
              <StatTile
                key={kind}
                className="player-stats-rich__entry"
                data-player-stats-rich-entry={kind}
                label={RICH_STAT_LABELS[kind]}
                value={text}
                empty={!hasValue}
                labelProps={{
                  className: 'player-stats-rich__label',
                  'data-player-stats-rich-label': kind,
                }}
                valueProps={{
                  className: hasValue
                    ? 'player-stats-rich__value'
                    : 'player-stats-rich__value player-stats-rich__value--absent',
                  'data-player-stats-rich-statistic': kind,
                  'data-player-stats-rich-has-value': hasValue ? 'true' : 'false',
                }}
              />
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}

export default RichStatsPanel;
