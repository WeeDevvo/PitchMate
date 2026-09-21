/**
 * The Promotion_Control: the whole of promoting one Squad_Member to admin, from
 * the affordance through the confirmation to the announcement.
 *
 * Requirement 13 splits into four claims about one interaction, and they are here
 * together because they are only true together:
 *
 *  1. **It exists exactly where it may** (Requirements 13.1, 13.2, 13.3). The
 *     component asks {@link isPromotable} and renders nothing when the answer is
 *     `false`. No condition of its own is added, not even a seemingly harmless
 *     one — the accepted set is pinned by a property test over role × state ×
 *     guest × placeholder × self, and a component-local `&&` would be a second
 *     rule that property never sees.
 *  2. **It confirms, naming the player** (Requirement 13.4). Through the shared
 *     {@link ConfirmDialog}, so focus entry, focus return to *this* row's control,
 *     and Escape-closes-without-confirming are the feature's one implementation
 *     rather than a fourth copy (Requirements 19.7, 19.8). The name is rendered as
 *     a node in the dialog's body, because no message takes an interpolation
 *     parameter — see `lib/messages.ts`.
 *  3. **It is disabled while its own call is in flight** (Requirement 13.6). The
 *     pending state is read from the machine per membership, so promoting one
 *     player never disables another row's control.
 *  4. **It announces both outcomes, and changes nothing on failure**
 *     (Requirements 13.5, 13.7). One live region per control; the promoted role
 *     label arrives from the machine's re-read of `GetSquad`, and a failure leaves
 *     the last accepted Player_List untouched — trivially, because nothing here
 *     holds a Player_List or edits a row.
 *
 * ### The announcement outlives the affordance
 *
 * A successful promotion is exactly the case in which the row *stops* being
 * eligible: the re-read returns the same membership with the `admin` role, and
 * {@link isPromotable} then answers `false`. If ineligibility removed the whole
 * subtree, the confirmation Requirement 13.5 asks for would vanish at the moment
 * it became true — or never render at all, if the re-read landed first.
 *
 * So the eligibility test governs the **trigger and the confirmation**, while the
 * **live region** is rendered whenever this membership has a settled outcome. The
 * component returns `null` only when it is both ineligible and silent. The region
 * is one element in one wrapper across every one of those states, so its content
 * *changes* rather than the region being replaced — which is what makes a polite
 * live region announce at all.
 *
 * ### Why the control is composed per row rather than once per screen
 *
 * A confirmation must return focus to the control that opened it, and a promotion
 * control is one of several identically-labelled controls down a Player_List. A
 * single screen-level surface would have to guess which one to return focus to;
 * one component per eligible row holds its own opener ref and guesses nothing
 * (design.md → FormPanel and ConfirmDialog). It is why {@link isPromotable} is
 * asked here as well as by the row: both read the same predicate, so they cannot
 * disagree about which rows are eligible, and this component stays composable
 * anywhere without a caller re-deriving the rule.
 *
 * ### What it does not do
 *
 * It issues no call and holds no promotion state: `promote` and the pending set
 * belong to `state/usePromotion.ts`, which is the feature's one issue site for
 * `PromoteToAdmin` and the one place a response is accepted. It holds no Player_List
 * and performs no re-read. It carries no copy of its own — every string comes from
 * `lib/messages.ts`, so a backend's own wording has nowhere to arrive
 * (Requirement 17.2) — and no colour value, reading the feature token table like
 * every other component (Requirement 18.9).
 *
 * Absence is not the access control. Requirement 10.5 keeps the backend
 * authoritative: an eligible-looking row whose promotion the backend refuses
 * announces the generic failure and changes nothing on screen.
 *
 * Requirements: 13.4, 13.5, 13.6, 13.7
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';

import { ConfirmDialog } from './ConfirmDialog';
import type { ViewerContext } from './PlayerRow';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import {
  GENERIC_SQUADS_FAILURE,
  PROMOTE_TO_ADMIN_LABEL,
  PROMOTION_CONFIRM_HEADING,
  PROMOTION_CONFIRM_STATEMENT,
  PROMOTION_SUCCEEDED,
} from '../lib/messages';
import type { SquadMember } from '../lib/parse/squadDetail';
import { isPromotable } from '../lib/promotionEligibility';
import type { PromotionMachine } from '../state/usePromotion';

// The token table, so a control rendered outside the App_Shell frame still
// resolves every custom property the shared row and surface styles read
// (Requirement 18.9).
import '../styles/squadsTokens.css';
// The trigger wears the Player_Row's action styling, because that is where it is
// rendered: one appearance for both admin controls on a row, declared once.
import './PlayerRow.css';

/**
 * The selector of a Promotion_Control's wrapper, so a test can find the control
 * and its announcement together without depending on rendered copy.
 */
export const PROMOTION_CONTROL_SELECTOR = '[data-squads-promotion="true"]';

/**
 * The selector of the trigger itself — the same attribute the Player_Row uses for
 * its promotion affordance, because it is the same affordance. A row renders one
 * or the other, never both, so the eligibility scans of Requirements 13.1 and 13.2
 * read one selector whichever composes it.
 */
export const PROMOTION_TRIGGER_SELECTOR = '[data-squads-player-promote="true"]';

/** The selector of the live region carrying this control's outcome message. */
export const PROMOTION_OUTCOME_SELECTOR = '[data-squads-promotion-outcome="true"]';

export interface PromotionControlProps {
  /**
   * The Squad_Member whose row this control sits on. A `PlayerListRow` is
   * structurally a Squad_Member, so a composed row can be passed straight in.
   */
  readonly member: SquadMember;

  /** Who is looking: their own membership identity, and their Admin_Authority. */
  readonly viewer: ViewerContext;

  /**
   * The promotion machine from `usePromotion`, shared by every control of the
   * screen — which is what makes the single-flight guard per membership rather
   * than per component (Requirement 13.6).
   */
  readonly promotion: PromotionMachine;

  /**
   * The confirmation's heading level. Defaults to `3`: the Player_List sits under
   * a level-two heading, so its confirmations state the next level down and no
   * screen skips a level (Requirements 19.1, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/**
 * Render the Promotion_Control for one Squad_Member: the trigger where the
 * predicate allows it, the confirmation naming the player, and the live region
 * carrying the outcome.
 *
 * Requirements: 13.4, 13.5, 13.6, 13.7
 */
export function PromotionControl({
  member,
  viewer,
  promotion,
  headingLevel = 3,
}: PromotionControlProps): ReactElement | null {
  const { membershipId, displayName } = member;

  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // 13.1, 13.2, 13.3: the predicate decides, and this component adds nothing to it.
  const promotable = isPromotable(member, viewer.membershipId, viewer.isAdmin);

  // 13.6: this membership's own call, so one row's pending state never reaches
  // another's control.
  const pending = promotion.isPending(membershipId);

  // 13.5, 13.7: only an outcome for *this* membership is this control's to
  // announce. The machine holds the latest settlement across the screen.
  const outcome =
    promotion.outcome !== null && promotion.outcome.membershipId === membershipId
      ? promotion.outcome
      : null;
  const outcomeKind = outcome === null ? null : outcome.kind;

  const openConfirmation = useCallback((): void => {
    // Keeps the `aria-disabled` the trigger reports truthful. The machine guards
    // the call itself regardless (Requirement 13.6).
    if (pending) {
      return;
    }

    setConfirming(true);
  }, [pending]);

  const confirmPromotion = useCallback((): void => {
    // 13.4: exactly one call per confirmation, issued by the machine — the one
    // issue site for `PromoteToAdmin` in the feature.
    promotion.promote(membershipId);

    // The confirmation has done its work, so it closes as the call goes out
    // rather than waiting for the response. Closing returns focus to this row's
    // trigger (Requirement 19.7), which is where the pending state is reported
    // (Requirement 13.6) and where the outcome is then announced — one place to
    // look, instead of a dialog that lingers over its own result. It also means
    // the decision to close is never derived from a settled outcome, so no
    // rendered state has to be synchronised with the machine's.
    setConfirming(false);
  }, [membershipId, promotion]);

  const closeConfirmation = useCallback((): void => {
    // 19.8: neither close reason confirms anything, so nothing is issued here.
    setConfirming(false);
  }, []);

  // Nothing to render only when there is nothing to offer *and* nothing to say.
  if (!promotable && outcome === null) {
    return null;
  }

  return (
    <div
      className="squads-promotion"
      data-squads-promotion="true"
      data-membership-id={membershipId}
    >
      {promotable && (
        <button
          type="button"
          ref={triggerRef}
          className="squads-player-row__action squads-promotion__trigger"
          data-squads-player-promote="true"
          // The visible label names the act; the accessible name adds whose row it
          // is, composed here because no message carries an interpolation
          // parameter. It contains the visible label, so the two agree.
          aria-label={`${PROMOTE_TO_ADMIN_LABEL}: ${displayName}`}
          // 13.6: reported unavailable while this membership's call awaits a
          // response — `aria-disabled` rather than `disabled` so the focus of
          // whoever just activated it is not dropped mid-operation
          // (Requirement 19.4).
          aria-disabled={pending ? true : undefined}
          aria-busy={pending ? true : undefined}
          data-pending={pending ? 'true' : 'false'}
          aria-haspopup="dialog"
          aria-expanded={confirming}
          onClick={openConfirmation}
        >
          {PROMOTE_TO_ADMIN_LABEL}
        </button>
      )}

      {/* 13.4: the confirmation, naming the player. Focus entry, focus return to
          this row's trigger, and Escape-without-confirming are the shared
          surface's (Requirements 19.7, 19.8). */}
      {promotable && (
        <ConfirmDialog
          open={confirming}
          openerRef={triggerRef}
          heading={PROMOTION_CONFIRM_HEADING}
          headingLevel={headingLevel}
          confirmLabel={PROMOTE_TO_ADMIN_LABEL}
          pending={pending}
          className="squads-promotion__dialog"
          onConfirm={confirmPromotion}
          onClose={closeConfirmation}
        >
          {/* The player, as a rendered value rather than as text folded into a
              message — which is the mechanism by which no message of this feature
              takes a parameter. */}
          <p className="squads-promotion__player">{displayName}</p>
          <p className="squads-promotion__statement">
            {PROMOTION_CONFIRM_STATEMENT}
          </p>
        </ConfirmDialog>
      )}

      {/* 13.5, 13.7: one region, always the same element, so a settled outcome is
          a content change a polite live region announces — and announces where it
          appears, leaving keyboard focus where it was (Requirement 17.3). Empty
          until something has settled: the region carries outcomes, not status. */}
      <p
        className="squads-promotion__outcome"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-squads-promotion-outcome="true"
      >
        {outcomeKind === null
          ? ''
          : outcomeKind === 'promoted'
            ? PROMOTION_SUCCEEDED
            : // 13.7, 17.2: every non-success arm — not-found, the "cannot be
              // promoted" rejection, a lapsed timeout, a transport or parse
              // failure — is this one message, carrying nothing of the backend.
              GENERIC_SQUADS_FAILURE}
      </p>
    </div>
  );
}

export default PromotionControl;
