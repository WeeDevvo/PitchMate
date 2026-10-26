/**
 * The Player_Stats_Screen's streak panel — the Win_Streak and the
 * Unbeaten_Streak, as two separately labelled whole numbers.
 *
 * Both figures are always rendered, and each is always labelled. There is no
 * condition in which this panel renders one streak and not the other, and no
 * condition in which a figure appears without the words that say which streak it
 * is (Requirements 9.1, 9.2) — the two entries are built from one table below,
 * so a label cannot go missing for one of them without going missing for both
 * and failing every test in the adjacent suite.
 *
 * ### Why two labels rather than one heading and two numbers
 *
 * An unbeaten run counts draws and a winning run does not, so the two figures
 * are routinely different and the larger one is always the unbeaten run. A
 * shared label — "Streaks", with two bare numbers beneath — would leave a reader
 * to guess which was which, and guessing wrong turns a modest record into an
 * impressive one. Requirement 9.2 asks for two separately labelled values such
 * that neither can be mistaken for the other, so each figure sits in a
 * description list beside its own term: the association is in the markup, not
 * only in the layout, and survives a screen reader and a stylesheet that failed
 * to load.
 *
 * ### A zero is rendered *and* explained
 *
 * Requirement 9.3 is specific: where a streak is zero, the value is rendered
 * **together with** a statement that no such run has been recorded, rather than
 * being omitted. Both halves matter. Omitting the figure would make the panel's
 * shape depend on its contents, so a reader could not tell "no run yet" from "a
 * section that failed to render"; and a bare `0` beside "Longest winning run"
 * reads as a measurement nobody made — a player with no appearances has no
 * winning run rather than a winning run of zero. So the zero stays and the
 * sentence sits with it, in the same entry as the figure it explains.
 *
 * A non-zero streak renders no such statement, which is what keeps the sentence
 * meaningful where it does appear.
 *
 * ### What it does not do
 *
 * It renders **no heading**. The screen wraps this panel in a `StatSection`,
 * which contributes the one level-two heading the section owes, and a heading
 * here would either duplicate that or skip a level (Requirements 16.1, 16.2).
 *
 * It renders **no control**, formats nothing itself — every figure passes through
 * `formatCount` from `lib/numberFormat.ts`, so the digits are determined solely
 * by the parsed value and are covered by that module's own property test — and
 * holds **no copy**: all three strings come from `lib/messages.ts`.
 *
 * It also makes no judgement about whether a streak is worth showing. The
 * Appearance_Count is not a prop, so there is nothing here to gate on: a player
 * who has played nothing gets the same two labelled zeroes and the same two
 * statements as everyone else, and the no-matches-played statement that explains
 * why is the Record_Panel's to render.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
import { type ReactElement } from 'react';
import { StatTile } from '../../../ui';

import {
  NO_RUN_RECORDED_STATEMENT,
  UNBEATEN_STREAK_LABEL,
  WIN_STREAK_LABEL,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import '../styles/playerStatsTokens.css';
import './StreakPanel.css';

/** The selector of the panel, so a test can assert over its whole subtree. */
export const STREAK_PANEL_SELECTOR = '[data-player-stats-streaks="true"]';

/** The selector of one streak's value, so a test can read them by kind. */
export const STREAK_VALUE_SELECTOR = '[data-player-stats-streak]';

/**
 * Which streak an entry is, and the value of the `data-player-stats-streak`
 * attribute — so a test can name the streak it means rather than matching on its
 * copy.
 */
export type StreakKind = 'win' | 'unbeaten';

/** One rendered entry: its kind, its label, and the run it reports. */
interface StreakEntry {
  readonly kind: StreakKind;
  readonly label: string;
  readonly value: number;
}

/** The value at which a run has not been recorded (Requirement 9.3). */
const NO_RUN = 0;

export interface StreakPanelProps {
  /** The Player_Profile's Win_Streak, exactly as parsed (Requirement 9.1). */
  readonly winStreak: number;

  /** The Player_Profile's Unbeaten_Streak, exactly as parsed (Requirement 9.1). */
  readonly unbeatenStreak: number;
}

/**
 * The two entries, in their fixed order.
 *
 * One table rather than two hand-written blocks of markup: the labelling, the
 * ordering, and the zero treatment are then written once and apply to both
 * streaks identically.
 */
function streakEntries(
  winStreak: number,
  unbeatenStreak: number,
): readonly StreakEntry[] {
  return [
    { kind: 'win', label: WIN_STREAK_LABEL, value: winStreak },
    { kind: 'unbeaten', label: UNBEATEN_STREAK_LABEL, value: unbeatenStreak },
  ];
}

/**
 * Render the two streaks, each with its own label and — where it is zero — with
 * the statement that no such run has been recorded.
 *
 * A description list, so each figure is associated with its term in the markup
 * rather than only by proximity. Each pair is a design-system stat tile: a `div`
 * grouping one `dt` and its `dd`, which is one of the content models HTML gives
 * a `dl`.
 *
 * Requirements: 9.1, 9.2, 9.3
 */
export function StreakPanel({
  winStreak,
  unbeatenStreak,
}: StreakPanelProps): ReactElement {
  const entries = streakEntries(winStreak, unbeatenStreak);

  return (
    <dl className="player-stats-streaks" data-player-stats-streaks="true">
      {entries.map((entry) => (
        // 9.1, 9.2: the words naming which streak this is, each figure's own,
        // so neither can be read as the other; 9.1: the whole number exactly as
        // parsed; 9.3: a zero is explained, never omitted.
        <StatTile
          key={entry.kind}
          icon="flame"
          label={entry.label}
          value={formatCount(entry.value)}
          sub={
            entry.value === NO_RUN ? (
              <span className="player-stats-streaks__no-run">{NO_RUN_RECORDED_STATEMENT}</span>
            ) : undefined
          }
          labelProps={{ className: 'player-stats-streaks__label' }}
          valueProps={{
            className: 'player-stats-streaks__value',
            'data-player-stats-streak': entry.kind,
          }}
        />
      ))}
    </dl>
  );
}

export default StreakPanel;
