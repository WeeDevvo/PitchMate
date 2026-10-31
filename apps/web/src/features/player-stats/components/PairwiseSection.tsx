/**
 * One Pairwise_Section: who this player plays with and against most, and who
 * they win and lose alongside — each entry a ranked row carrying the one control
 * that opens *that* player's own stats.
 *
 * Four sections of the Player_Stats_Screen are this component with different
 * copy and different data: most played with, most played against, best
 * partnerships, and bogey opponents (Requirement 10.1). Two of them count
 * co-appearances and two report a Win_Percentage, so the component takes a
 * **variant** rather than being written four times — the link, the order, the
 * empty treatment, and the Former_Player presentation are then implemented once
 * and cannot drift between the four surfaces that need them identically.
 *
 * ### It is the whole section, heading included
 *
 * Unlike the feature's panels and tables — `RecordPanel`, `StreakPanel`,
 * `ProgressionTable` — this component renders its own {@link StatSection}
 * wrapper, so the heading and the body are one unit. Requirement 10.7 asks for
 * the heading **together with** the nothing-to-show-yet statement where a
 * section carries no entry, and a component that rendered only the statement
 * would leave that pairing to whichever caller remembered it, in the one
 * condition where the section has nothing else to say.
 *
 * **The screen therefore renders `<PairwiseSection …>` directly and must not
 * wrap it in a second `StatSection`** — that would nest two regions and two
 * level-two headings, which the heading-outline property would then reject.
 *
 * ### The order is the backend's
 *
 * Each collection arrives already ranked, so the entries render in exactly the
 * order the Player_Profile carries them: no sort, no filter, no re-rank, and no
 * truncation (Requirement 10.2). A client-side sort would be a second ranking
 * rule the backend's own ordering could silently disagree with, and a "top five"
 * cut here would hide entries the read model deliberately sent.
 *
 * ### One control per entry, and it is a button
 *
 * Each entry renders exactly one control, whose accessible name is that entry's
 * Player_Display_Name (Requirement 10.5) and whose activation navigates to the
 * Player_Stats_Route for that entry's membership inside the route's current
 * squad (Requirement 10.6).
 *
 * A native `<button>` with {@link useNavigate}, rather than an anchor: a button
 * is operable by **both** Enter and Space, where an anchor answers only Enter,
 * and it carries no `href` and touches no `location`, so no full-document reload
 * is possible. `navigate` pushes exactly one history entry. This is the same
 * arrangement the squads feature's `PlayerRow` uses for the same journey, and
 * the control additionally states its target in
 * {@link PAIRWISE_LINK_PATH_ATTRIBUTE} so the seam is recoverable from the
 * rendered entry rather than only observable by activating it.
 *
 * The path comes from the squads barrel's own `playerStatsPath` builder — the
 * same function the player list's rows and the route registration are built from
 * — so **no path literal appears in this feature** (Requirement 1.7) and this
 * control cannot drift from where the screen is registered.
 *
 * ### A Former_Player keeps its link
 *
 * Where an entry's name is the Anonymised_Placeholder, the entry is presented as
 * a Former_Player and **keeps its control** (Requirement 10.8). Erasure is
 * anonymisation rather than deletion: the membership keeps its ratings, its
 * stats, and its match history, so its own stats screen is still worth reaching.
 * The label is a sibling of the control rather than inside it, so the control's
 * accessible name stays the display name exactly as parsed.
 *
 * ### A real table, with real headers
 *
 * The same reasoning as the `ProgressionTable`: a column of figures is only
 * navigable by a screen reader if the association between a figure and its
 * column exists in the markup. The name is each row's `th scope="row"`, because
 * it is what identifies the row — a count alone says nothing about whose it is —
 * and each figure sits in a `td` under a `th scope="col"`. One heading per column
 * also keeps the figures legible without repeating a label on every one of up to
 * two hundred rows.
 *
 * Every figure passes through a `lib/` formatter: `formatCount` for both counts
 * and `formatWinPercentage` for the value, which supplies the one decimal place
 * and the explicit percentage indication Requirement 10.4 asks for. Nothing is
 * formatted here, and no colour carries a meaning — the rows are ordinary body
 * text, because a high count and a low one mean nothing without the heading
 * above them.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */
import { type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../../../ui';

import { StatSection } from './StatSection';
import { playerStatsPath } from '../../squads';
import { isAnonymisedPlaceholder } from '../lib/anonymisedName';
import {
  FORMER_PLAYER_LABEL,
  NO_WIN_PERCENTAGE,
  PAIRWISE_NOTHING_YET_STATEMENT,
  WIN_PERCENTAGE_LABEL,
} from '../lib/messages';
import { formatCount, formatWinPercentage } from '../lib/numberFormat';
import type {
  CoAppearanceEntry,
  PairedStatEntry,
} from '../lib/parse/playerProfile';

// The feature token table, so a section rendered outside the App_Shell frame
// still resolves every custom property `PairwiseSection.css` reads
// (Requirement 15.2).
import '../styles/playerStatsTokens.css';
import './PairwiseSection.css';

/** The selector of the section's body, so a test can assert over its subtree. */
export const PAIRWISE_SECTION_SELECTOR = '[data-player-stats-pairwise="true"]';

/**
 * The attribute carrying which variant was rendered, so a test can name the
 * presentation it means rather than matching on copy.
 */
export const PAIRWISE_SECTION_VARIANT_ATTRIBUTE = 'data-pairwise-variant';

/**
 * The selector of one entry, so a test can read the entries **in order** — the
 * attribute's value is that entry's index in the collection as it arrived
 * (Requirement 10.2).
 */
export const PAIRWISE_ENTRY_SELECTOR = '[data-player-stats-pairwise-entry]';

/**
 * The attribute carrying an entry's membership identity, so a test can assert
 * the rendered set holds one entry per parsed entry and no other identity.
 */
export const PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE = 'data-membership-id';

/** The selector of an entry's single Pairwise_Link (Requirement 10.5). */
export const PAIRWISE_LINK_SELECTOR = '[data-player-stats-pairwise-link="true"]';

/**
 * The attribute carrying the Player_Stats_Route path a Pairwise_Link opens, as
 * built by `playerStatsPath` — so the navigation target is recoverable from the
 * rendered entry (Requirements 1.7, 10.6).
 */
export const PAIRWISE_LINK_PATH_ATTRIBUTE = 'data-player-stats-path';

/** The selector of any figure cell, whichever quantity it carries. */
export const PAIRWISE_FIGURE_SELECTOR = '[data-player-stats-pairwise-figure]';

/** The selector of a co-appearance entry's count (Requirement 10.3). */
export const PAIRWISE_COUNT_SELECTOR =
  "[data-player-stats-pairwise-figure='count']";

/** The selector of a paired-stat entry's Win_Percentage (Requirement 10.4). */
export const PAIRWISE_VALUE_SELECTOR =
  "[data-player-stats-pairwise-figure='value']";

/**
 * The selector of a paired-stat entry's qualifying-match count
 * (Requirement 10.4).
 */
export const PAIRWISE_QUALIFYING_SELECTOR =
  "[data-player-stats-pairwise-figure='qualifying']";

/**
 * The selector of the nothing-to-show-yet statement, rendered in place of the
 * table where a section carries no entry (Requirement 10.7).
 */
export const PAIRWISE_EMPTY_SELECTOR = '[data-player-stats-pairwise-empty="true"]';

/** The selector of an entry's Former_Player label (Requirement 10.8). */
export const PAIRWISE_FORMER_PLAYER_SELECTOR =
  '[data-player-stats-pairwise-former-player="true"]';

/**
 * Which presentation a section renders, and the value of
 * {@link PAIRWISE_SECTION_VARIANT_ATTRIBUTE}.
 *
 * `co-appearance` is the most-played-with and most-played-against pair, which
 * carry a count; `paired-stat` is the best-partnerships and bogey-opponents
 * pair, which carry a Win_Percentage and the matches it was computed over.
 */
export type PairwiseVariant = 'co-appearance' | 'paired-stat';

/**
 * Which quantity a figure cell carries, and the value of its
 * `data-player-stats-pairwise-figure` attribute — so a test names the figure it
 * means rather than counting columns.
 */
export type PairwiseFigureKind = 'count' | 'value' | 'qualifying';

/**
 * The column header naming the other player (Requirements 10.3, 10.4).
 *
 * Declared here rather than in `lib/messages.ts`, for the reason
 * `ProgressionTable` declares its own two headings beside it: these are the
 * table's notation — the words naming its columns — rather than statements about
 * an outcome, and they are needed for the table to have real headers at all.
 * They belong in the feature's one copy module and should move there when it is
 * next edited.
 */
export const PAIRWISE_PLAYER_HEADING = 'Player';

/**
 * The column header naming a Co_Appearance_Entry's count (Requirement 10.3).
 * See {@link PAIRWISE_PLAYER_HEADING}.
 *
 * It names the figure without saying "with" or "against": the section heading
 * above already says which it is, and a column heading that repeated it would be
 * wrong for one of the two sections that share this variant.
 */
export const PAIRWISE_COUNT_HEADING = 'Matches';

/**
 * The column header naming a Paired_Stat_Entry's count of qualifying matches
 * (Requirement 10.4). See {@link PAIRWISE_PLAYER_HEADING}.
 *
 * "Qualifying" because the Win_Percentage beside it is computed over only the
 * matches that counted for this pairing, which is a smaller number than either
 * player's appearances — presenting it as a plain match count would invite the
 * two to be compared.
 */
export const PAIRWISE_QUALIFYING_HEADING = 'Qualifying matches';

/** What every section needs, whichever variant it renders. */
interface PairwiseSectionBaseProps {
  /**
   * The section's heading, naming what it measures (Requirement 10.1).
   *
   * Supplied by the screen from `lib/messages.ts` — one of the four
   * Pairwise_Section headings — and rendered as this section's single level-two
   * heading by {@link StatSection}.
   */
  readonly heading: string;

  /**
   * The squad identity the route carries, used solely to build each entry's
   * Pairwise_Link (Requirement 10.6).
   *
   * The route's own squad and nothing else, so an entry always opens inside the
   * squad the reader is already in — these stats are squad-scoped, and the same
   * person in another squad has another record entirely.
   */
  readonly squadId: string;
}

/** A section of co-appearance entries: most played with, most played against. */
export interface CoAppearanceSectionProps extends PairwiseSectionBaseProps {
  readonly variant: 'co-appearance';

  /** The entries, in the order the Player_Profile carries them. */
  readonly entries: readonly CoAppearanceEntry[];
}

/** A section of paired-stat entries: best partnerships, bogey opponents. */
export interface PairedStatSectionProps extends PairwiseSectionBaseProps {
  readonly variant: 'paired-stat';

  /** The entries, in the order the Player_Profile carries them. */
  readonly entries: readonly PairedStatEntry[];
}

/**
 * One of the two section shapes.
 *
 * A discriminated union rather than one interface with four optional members, so
 * a co-appearance section cannot be handed paired-stat entries, nothing is cast,
 * and a third variant added to {@link PairwiseVariant} fails `tsc -b` at the
 * switch below rather than rendering an empty table.
 */
export type PairwiseSectionProps =
  | CoAppearanceSectionProps
  | PairedStatSectionProps;

/** One figure cell: which quantity it carries, and the text it reads as. */
interface PairwiseFigure {
  readonly kind: PairwiseFigureKind;
  readonly text: string;
}

/** One figure column: which quantity it holds, and its heading. */
interface PairwiseColumn {
  readonly kind: PairwiseFigureKind;
  readonly heading: string;
}

/** One rendered entry: its identity, its name, and its figures in order. */
interface PairwiseRow {
  readonly membershipId: string;
  readonly displayName: string;
  readonly figures: readonly PairwiseFigure[];
}

/** A section's figure columns and its rows, already formatted. */
interface PairwiseTable {
  readonly columns: readonly PairwiseColumn[];
  readonly rows: readonly PairwiseRow[];
}

/**
 * The one mapping from a variant and its entries to columns and formatted rows.
 *
 * Exhaustive over {@link PairwiseVariant} with no default arm, so a third
 * variant is a compile failure here rather than a silently empty section. Every
 * figure is produced by a `lib/` formatter, and the rows are built in the order
 * the entries arrived with nothing added, removed, or reordered
 * (Requirement 10.2).
 *
 * Requirements: 10.2, 10.3, 10.4
 */
function pairwiseTableOf(props: PairwiseSectionProps): PairwiseTable {
  switch (props.variant) {
    // 10.3: the display name and the count, each as text.
    case 'co-appearance':
      return {
        columns: [{ kind: 'count', heading: PAIRWISE_COUNT_HEADING }],
        rows: props.entries.map((entry) => ({
          membershipId: entry.membershipId,
          displayName: entry.displayName,
          figures: [{ kind: 'count', text: formatCount(entry.count) }],
        })),
      };
    // 10.4: the display name, the Win_Percentage with one decimal place and an
    // explicit percentage indication, and the qualifying-match count.
    case 'paired-stat':
      return {
        columns: [
          { kind: 'value', heading: WIN_PERCENTAGE_LABEL },
          { kind: 'qualifying', heading: PAIRWISE_QUALIFYING_HEADING },
        ],
        rows: props.entries.map((entry) => ({
          membershipId: entry.membershipId,
          displayName: entry.displayName,
          figures: [
            {
              kind: 'value',
              // A value the formatter declines — which no parsed entry carries,
              // since `readPercentage` admits only 0.0 to 100.0 — falls back to
              // the statement an absent percentage renders, so a fault never
              // reads as an earned figure.
              text: formatWinPercentage(entry.value) ?? NO_WIN_PERCENTAGE,
            },
            { kind: 'qualifying', text: formatCount(entry.qualifyingMatches) },
          ],
        })),
      };
  }
}

/**
 * Render one Pairwise_Section: its heading, and either its ranked entries or the
 * statement that there is nothing to show yet.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */
export function PairwiseSection(props: PairwiseSectionProps): ReactElement {
  const { heading, squadId, variant } = props;
  const { columns, rows } = pairwiseTableOf(props);

  // The section's one navigation seam. Called with the path `playerStatsPath`
  // built, so an activation pushes exactly one history entry and nothing
  // reloads the document (Requirement 10.6).
  const navigate = useNavigate();

  return (
    <StatSection heading={heading}>
      <div
        className="player-stats-pairwise"
        data-player-stats-pairwise="true"
        data-pairwise-variant={variant}
      >
        {rows.length === 0 ? (
          // 10.7: the heading stays above it, and the statement stands in for
          // the whole body — an empty table with its headings in place reads as
          // a ranking that exists and happens to be blank.
          <p
            className="player-stats-pairwise__empty"
            data-player-stats-pairwise-empty="true"
          >
            {PAIRWISE_NOTHING_YET_STATEMENT}
          </p>
        ) : (
          <table className="player-stats-pairwise__table">
            <thead>
              <tr>
                <th className="player-stats-pairwise__heading" scope="col">
                  {PAIRWISE_PLAYER_HEADING}
                </th>
                {columns.map((column) => (
                  <th
                    key={column.kind}
                    className="player-stats-pairwise__heading"
                    scope="col"
                  >
                    {column.heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 10.2: one row per parsed entry, in the order it arrived. Two
                  entries can carry the same identity and the same name — nothing
                  on the wire forbids it — so the index completes the key. */}
              {rows.map((row, index) => (
                <tr
                  key={`${row.membershipId}:${String(index)}`}
                  className="player-stats-pairwise__entry"
                  data-player-stats-pairwise-entry={index}
                  data-membership-id={row.membershipId}
                >
                  {/* The name identifies the row, so it is the row's header. */}
                  <th className="player-stats-pairwise__player" scope="row">
                    {/* 10.5, 10.6, 10.8: one keyboard-operable control, named by
                        this entry's own display name exactly as parsed, present
                        on every entry including a Former_Player's — and carrying
                        the path `playerStatsPath` built, so the target is
                        recoverable from the row. */}
                    {/* Decorative: the control beside it carries the name. */}
                    <span className="player-stats-pairwise__avatar">
                      <Avatar name={row.displayName} size={32} />
                    </span>
                    <button
                      type="button"
                      className="player-stats-pairwise__link"
                      data-player-stats-pairwise-link="true"
                      data-player-stats-path={playerStatsPath(
                        squadId,
                        row.membershipId,
                      )}
                      onClick={() => {
                        navigate(playerStatsPath(squadId, row.membershipId));
                      }}
                    >
                      {row.displayName}
                    </button>
                    {/* 10.8: a sibling of the control rather than inside it, so
                        the control's accessible name stays the name as parsed. */}
                    {isAnonymisedPlaceholder(row.displayName) ? (
                      <span
                        className="player-stats-pairwise__former-player"
                        data-player-stats-pairwise-former-player="true"
                      >
                        {FORMER_PLAYER_LABEL}
                      </span>
                    ) : null}
                  </th>

                  {/* 10.3, 10.4: the figures, each already through its
                      formatter, in their column order. */}
                  {row.figures.map((figure) => (
                    <td
                      key={figure.kind}
                      className="player-stats-pairwise__figure"
                      data-player-stats-pairwise-figure={figure.kind}
                    >
                      {figure.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </StatSection>
  );
}

export default PairwiseSection;
