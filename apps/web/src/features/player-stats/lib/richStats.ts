/**
 * The one place the feature decides which of three rich-stats conditions holds.
 *
 * Live match tracking is a per-squad opt-in, so the live-detail figures — goals,
 * clean sheets, goals conceded as keeper, Keeper_Time — are present for some
 * squads and meaningless for others. That gives the Rich_Stats section three
 * genuinely different things to say, and {@link resolveRichCondition} is the only
 * function in the feature that chooses between them:
 *
 * | Condition | The block | What it means |
 * | --- | --- | --- |
 * | `disabled` | absent | the squad's `LiveMatchTracking` flag is off |
 * | `empty` | present, every member absent | tracking is on, nothing recorded yet |
 * | `present` | present, at least one member carries a value | there is live detail to render |
 *
 * ## Why the two empty-looking conditions are kept apart
 *
 * An absent block and a block of four absences both render *no figures*, and it
 * would be easy to collapse them. Requirement 11.6 asks for the opposite,
 * because the sentence each one licenses is a different claim about the squad:
 * `TRACKING_DISABLED` says this squad does not record live match detail — a
 * settings statement, with nothing for a member to do about it — while
 * `TRACKING_EMPTY` says detail is recorded and none exists yet, which resolves
 * itself as soon as a tracked match is played. Presenting either as the other
 * misdescribes the squad's own configuration, so the distinction is drawn here
 * once, in a pure function, rather than inferred at a render site from whether
 * four fields happen to be null. The Response_Parser cooperates by never
 * collapsing an all-absent block to an absent one.
 *
 * ## A present member whose value is zero is present
 *
 * The test for `empty` is **absence**, never falsiness. A membership that has
 * played tracked matches and scored nothing carries `goals: 0`, which is a
 * recorded figure and a true statement about that player — so such a block
 * resolves to `present` and the panel renders the zero. A falsy test would
 * report "no live match detail has been recorded yet" for a squad that records
 * it diligently, and would erase the difference between a goalless player and an
 * unmeasured one. That is the same rule Requirement 11.4 states from the other
 * side: an absent member renders a statement and no numeral, *including no zero*.
 *
 * ## The condition carries the block
 *
 * The `present` arm carries the whole `RichStats` block rather than a reduced
 * summary, because each member degrades independently (Requirements 11.3, 11.4)
 * and the panel needs every one of the four to decide, member by member, between
 * a formatted value and a no-data statement. Discriminating on `kind` means the
 * panel reaches a block only on the arm where one exists, so there is no arm in
 * which it could read a figure that is not there.
 *
 * Pure, total, and free of exceptions: four absence tests and no coercion, no
 * clock, no locale, and no ambient state. React-free and DOM-free like every
 * module under `lib/`, importing only the parsed type it is given
 * (Requirement 14.3).
 *
 * Requirements: 11.1, 11.2, 11.6
 */

import type { RichStats } from './parse/playerProfile';

/**
 * Which of the three rich-stats conditions holds, as a discriminated union so a
 * render site cannot read a block on an arm that carries none.
 *
 * Requirements: 11.1, 11.2, 11.6
 */
export type RichCondition =
  | { readonly kind: 'disabled' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'present'; readonly stats: RichStats };

/**
 * Resolves the rich-stats condition from the parsed `rich` block.
 *
 * An absent block — `null` from the wire, or `undefined` from a caller holding an
 * optional property — is the Tracking_Disabled_Condition: the squad does not
 * record live match detail at all. A present block whose every member is absent
 * is the Tracking_Empty_Condition: tracking is on and no figure has been
 * recorded. Every other block is `present` and carries the block through, zeros
 * included (see the module note on why zero is a value, not an absence).
 *
 * @param rich the parsed Rich_Stats block, or its absence
 * @returns exactly one of the three conditions, for every input
 *
 * Requirements: 11.1, 11.2, 11.6
 */
export function resolveRichCondition(
  rich: RichStats | null | undefined,
): RichCondition {
  if (rich === null || rich === undefined) {
    return { kind: 'disabled' };
  }

  const everyMemberAbsent =
    rich.goals === null &&
    rich.cleanSheets === null &&
    rich.goalsConcededAsKeeper === null &&
    rich.keeperTimeMs === null;

  if (everyMemberAbsent) {
    return { kind: 'empty' };
  }

  return { kind: 'present', stats: rich };
}
