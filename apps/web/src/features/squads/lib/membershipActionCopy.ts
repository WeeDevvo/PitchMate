/**
 * The fixed copy each Player_Row membership action presents, gathered from
 * `./messages` so `MembershipActionControl` is handed one value per action.
 *
 * React-free and DOM-free like every module under `lib/`.
 */

import {
  DEMOTE_TO_MEMBER_LABEL,
  DEMOTION_CONFIRM_HEADING,
  DEMOTION_CONFIRM_STATEMENT,
  DEMOTION_CONFLICT,
  DEMOTION_SUCCEEDED,
  REMOVAL_CONFIRM_HEADING,
  REMOVAL_CONFIRM_STATEMENT,
  REMOVAL_CONFLICT,
  REMOVAL_SUCCEEDED,
  REMOVE_MEMBER_LABEL,
} from './messages';

/** The fixed copy one action presents. */
export interface MembershipActionCopy {
  /** The trigger's visible label, and the confirm action's. */
  readonly label: string;
  /** The confirmation's heading. */
  readonly heading: string;
  /** The confirmation's statement of what happens. */
  readonly statement: string;
  /** Announced on success. */
  readonly succeeded: string;
  /** Announced when the backend refuses under the squad's own rules. */
  readonly conflict: string;
}

/** The removal control's copy. */
export const REMOVAL_COPY: MembershipActionCopy = {
  label: REMOVE_MEMBER_LABEL,
  heading: REMOVAL_CONFIRM_HEADING,
  statement: REMOVAL_CONFIRM_STATEMENT,
  succeeded: REMOVAL_SUCCEEDED,
  conflict: REMOVAL_CONFLICT,
};

/** The demotion control's copy. */
export const DEMOTION_COPY: MembershipActionCopy = {
  label: DEMOTE_TO_MEMBER_LABEL,
  heading: DEMOTION_CONFIRM_HEADING,
  statement: DEMOTION_CONFIRM_STATEMENT,
  succeeded: DEMOTION_SUCCEEDED,
  conflict: DEMOTION_CONFLICT,
};
