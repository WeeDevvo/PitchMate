/**
 * The Guest_Manager — the admin-only surface that adds a guest and edits an
 * existing one.
 *
 * It is the wiring between three things that already exist, and it adds no rule of
 * its own:
 *
 *  - {@link useGuestManager}, the machine that issues every `CreateGuest` and
 *    `EditGuest` call, holds each outcome, keeps each operation single-flight, and
 *    triggers the post-mutation re-read — one further `GetSquad` **and** one
 *    further `GetSquadLeaderboard` after a create, the `GetSquad` alone after an
 *    edit (Requirements 12.6, 12.10, 12.13);
 *  - {@link GuestForm}, which renders the fields, the tier options, and the
 *    Lawful_Basis_Acknowledgement, and emits a validated submission
 *    (Requirements 12.1–12.5, 12.8, 12.9);
 *  - {@link isGuestEditable}, the pure predicate that decides which rows have an
 *    editable guest behind them (Requirements 7.8, 12.7).
 *
 * ### Where an edit comes from, and why the target is a prop
 *
 * The edit affordance lives on the Player_Row, not here: Requirement 12.7 puts it
 * on each row whose Guest_Flag is set and whose name is not the
 * Anonymised_Placeholder, and `PlayerRow` renders it through the same predicate.
 * The row hands the activation up as a membership identity, the Squad_Screen holds
 * it, and it arrives as {@link GuestManagerProps.editingMembershipId}. This
 * component then resolves the guest from the Player_List it is rendering
 * alongside, so the prefilled name is *that guest's* name as parsed — and applies
 * the predicate a second time, so an identity that names a registered member or a
 * Former_Player opens no form even if a caller asked it to (Requirement 12.7).
 *
 * Resolving the name here rather than accepting it as a prop keeps one fact in one
 * place: the row and the form read the same parsed display name, so a form can
 * never open prefilled with a name the list is not showing.
 *
 * ### Which message a failure gets, and where it goes
 *
 * The machine reports exactly two failures per operation, which is exactly what
 * the requirements distinguish:
 *
 * | Machine failure           | Message                     | Requirement |
 * | ------------------------- | --------------------------- | ----------- |
 * | `display-name-rejected`   | {@link DISPLAY_NAME_UNAVAILABLE} | 12.11 |
 * | `generic`                 | {@link GENERIC_SQUADS_FAILURE}   | 12.12 |
 *
 * Both are rendered as the Guest_Form's **outcome** message, in the live region
 * the form already owns, with the panel left open: every entered value is
 * retained and the submit control is available for a further submission
 * (Requirement 12.11). Nothing of the response reaches the copy — the machine
 * carries no status code and no backend text to begin with (Requirement 17.2).
 *
 * A failure also leaves the Player_List exactly as last accepted
 * (Requirement 12.12), which is structural rather than defended here: this
 * component holds no squad data, and only a *success* calls the re-read seam.
 *
 * ### What closes a form
 *
 * A successful create closes the create panel; a successful edit clears the
 * screen's edit target. Both also clear that operation's outcome, so a settled
 * outcome cannot be presented against the next opening. Escape and the cancel
 * control close through the same paths, and {@link FormPanel} returns focus to the
 * control that opened the panel either way (Requirements 19.7, 19.8).
 *
 * The section heading is the Admin_Section's (`h3` naming guests), so nothing here
 * renders a heading of its own — the form's panel heading sits one level below it.
 *
 * Requirements: 12.1, 12.6, 12.7, 12.10, 12.11, 12.12, 12.13
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';

import type { AuthState } from '../../auth';
import type { SquadsApi } from '../api/squadsApi';
import {
  ADD_GUEST_HEADING,
  DISPLAY_NAME_UNAVAILABLE,
  GENERIC_SQUADS_FAILURE,
} from '../lib/messages';
import { isGuestEditable, type PlayerListRow } from '../lib/playerList';
import {
  useGuestManager,
  type GuestFailure,
  type GuestOperationPhase,
} from '../state/useGuestManager';
import type { SquadRefreshOptions } from '../state/useSquadScreen';
import { GuestForm, GUEST_CREATE_FORM_ID, type GuestCommand } from './GuestForm';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';
import './surfaces.css';

/** The selector of the control that opens the Guest_Form for creation (Req 12.1). */
export const GUEST_MANAGER_ADD_SELECTOR = '[data-squads-guest-add="true"]';

export interface GuestManagerProps {
  /** The squad the guest belongs to, from the parsed Squad_Detail. */
  readonly squadId: string;
  /** The Squads_Api facade — the feature's only transport seam. */
  readonly api: SquadsApi;
  /**
   * The composed Player_List the Squad_Screen is rendering, from which an edit
   * target's Player_Display_Name and guest flag are read (Requirement 12.8).
   */
  readonly rows: readonly PlayerListRow[];
  /**
   * The membership identity whose Player_Row edit control was activated, or
   * `null` while no guest is being edited. Owned by the Squad_Screen, because the
   * control that sets it lives on a row rather than in this section.
   */
  readonly editingMembershipId?: string | null;
  /**
   * Called when the edit form should close — dismissed, closed by Escape, or
   * closed because the `EditGuest` call succeeded. The caller clears its target.
   */
  readonly onEditingFinished?: () => void;
  /**
   * The post-mutation re-read: `useSquadScreen`'s `refresh`, which issues one
   * further `GetSquad` and, when asked, one further `GetSquadLeaderboard`
   * (Requirements 12.6, 12.10). Which of the two a success wants is
   * {@link useGuestManager}'s statement, not this component's.
   */
  readonly onSquadChanged: (options?: SquadRefreshOptions) => void;
  /**
   * The control that activated the edit — the row's edit control — which receives
   * focus back when the edit form closes (Requirement 19.7). Optional: without
   * it, focus simply stays where the form left it rather than being moved
   * somewhere the person did not come from.
   */
  readonly editOpenerRef?: RefObject<HTMLElement | null>;
  /**
   * The Auth_State, so an ended session discards both calls and holds no outcome
   * (Requirement 17.5). Defaults to the machine's own default.
   */
  readonly authState?: AuthState;
  /**
   * The heading level of the Guest_Form's panel. Defaults to `4`, which is one
   * level below the Admin_Section's guests `h3` (Requirements 19.1, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/**
 * The outcome message for one operation's settled state, or `null`.
 *
 * The single place the machine's two failures become copy, shared by both
 * operations so a rejected display name reads identically whichever call reported
 * it (Requirements 12.11, 12.12).
 */
function outcomeMessageFor(
  phase: GuestOperationPhase,
  failure: GuestFailure | null,
): string | null {
  if (phase !== 'failed') {
    return null;
  }

  return failure === 'display-name-rejected'
    ? DISPLAY_NAME_UNAVAILABLE
    : GENERIC_SQUADS_FAILURE;
}

/**
 * Render the Guest_Manager: the control that opens the create form, the create
 * form, and the edit form for whichever guest the screen has targeted.
 *
 * Requirements: 12.1, 12.6, 12.7, 12.10, 12.11, 12.12, 12.13
 */
export function GuestManager({
  squadId,
  api,
  rows,
  editingMembershipId = null,
  onEditingFinished,
  onSquadChanged,
  editOpenerRef,
  authState,
  headingLevel = 4,
}: GuestManagerProps): ReactElement {
  const machine = useGuestManager({
    api,
    squadId,
    refresh: onSquadChanged,
    ...(authState === undefined ? {} : { authState }),
  });

  const [createRequested, setCreateRequested] = useState(false);
  const addRef = useRef<HTMLButtonElement | null>(null);
  // Used when the caller supplies no opener for the edit: a ref whose current is
  // never set, which `useSurfaceFocus` reads as "no opener to return focus to".
  const absentOpenerRef = useRef<HTMLElement | null>(null);

  const { clearOutcome, createPhase, editPhase } = machine;

  /**
   * The guest being edited, or `null`.
   *
   * 12.7, 12.8: the row must exist in the list being rendered *and* satisfy the
   * guest-and-not-anonymised predicate. Admin_Authority holds — this section is
   * rendered only within the Admin_Section — so the predicate is asked about the
   * membership alone.
   */
  const editRow = useMemo((): PlayerListRow | null => {
    if (editingMembershipId === null) {
      return null;
    }

    const row =
      rows.find((candidate) => candidate.membershipId === editingMembershipId) ??
      null;

    return row !== null && isGuestEditable(row, true) ? row : null;
  }, [editingMembershipId, rows]);

  /**
   * Whether each form is open.
   *
   * **Derived from the machine rather than closed by an effect.** A settled
   * `succeeded` phase *is* the closed state, so a successful create needs no
   * state change to close its panel and a successful edit needs none to close
   * its own — which keeps the "one submission, one close" rule out of a cascade
   * of renders and means the panel cannot be open while its call has succeeded.
   *
   * A fresh opening clears that operation's outcome, which returns the phase to
   * `idle` and makes the form open again — freshly mounted, so the
   * acknowledgement is unselected and the tier default reselected
   * (Requirement 12.4).
   */
  const createOpen = createRequested && createPhase !== 'succeeded';
  const editOpen = editRow !== null && editPhase !== 'succeeded';

  // A previous operation's outcome must not be presented against a fresh opening,
  // so each opening clears the outcome of the operation it belongs to.
  const handleOpenCreate = useCallback((): void => {
    clearOutcome('create');
    setCreateRequested(true);
  }, [clearOutcome]);

  const closeCreate = useCallback((): void => {
    setCreateRequested(false);
    clearOutcome('create');
  }, [clearOutcome]);

  const closeEdit = useCallback((): void => {
    clearOutcome('edit');
    onEditingFinished?.();
  }, [clearOutcome, onEditingFinished]);

  /**
   * A change of edit target starts that form with no outcome.
   *
   * Two things depend on it, and both are about *this* form belonging to *this*
   * guest: a failure recorded against the previous guest is not presented against
   * a form that has just opened for someone else, and a settled `succeeded` phase
   * from the previous edit does not keep the next form closed. The edit's opener
   * is a Player_Row control outside this component, so there is no open handler to
   * do the clearing the way {@link handleOpenCreate} does.
   *
   * Keyed on the target alone, so a failure recorded for the target currently open
   * stays rendered until that form closes.
   */
  useEffect(() => {
    clearOutcome('edit');
  }, [clearOutcome, editingMembershipId]);

  // 12.10: a successful edit is finished with, so the screen drops its target. The
  // form is already closed by the phase above, and the recomposed Player_List
  // comes from the re-read the machine triggered — nothing is applied here.
  useEffect(() => {
    if (editPhase === 'succeeded' && editingMembershipId !== null) {
      onEditingFinished?.();
    }
  }, [editPhase, editingMembershipId, onEditingFinished]);

  const handleSubmit = useCallback(
    (command: GuestCommand): void => {
      // The machine is the only issue site for either call, and it is what keeps
      // each operation single-flight (Requirement 12.13).
      if (command.kind === 'create') {
        machine.create(command);
        return;
      }

      machine.edit(command);
    },
    [machine],
  );

  return (
    <div className="squads-guest-manager" data-squads-guest-manager="true">
      {/* 12.1: the control that opens the Guest_Form for creation, named after
          the panel it opens so the two cannot read differently. */}
      <button
        type="button"
        ref={addRef}
        className="squads-surface__action"
        data-squads-guest-add="true"
        aria-expanded={createOpen}
        // Named only while the panel exists: a closed panel renders nothing at
        // all, and pointing at an absent id would be a broken association.
        aria-controls={createOpen ? GUEST_CREATE_FORM_ID : undefined}
        onClick={handleOpenCreate}
      >
        {ADD_GUEST_HEADING}
      </button>

      {/* 12.1–12.5: the create mode. Each opening is a fresh mount, so the
          acknowledgement is unselected and the tier default reselected (12.4). */}
      <GuestForm
        open={createOpen}
        openerRef={addRef}
        mode={{ kind: 'create' }}
        headingLevel={headingLevel}
        pending={machine.creating}
        outcomeMessage={outcomeMessageFor(createPhase, machine.createFailure)}
        onSubmit={handleSubmit}
        onClose={closeCreate}
      />

      {/* 12.8, 12.9: the edit mode — prefilled, tier left unchanged by default,
          and no acknowledgement control. Rendered only for a row the predicate
          accepts (12.7). */}
      {editRow !== null && (
        <GuestForm
          open={editOpen}
          openerRef={editOpenerRef ?? absentOpenerRef}
          mode={{
            kind: 'edit',
            membershipId: editRow.membershipId,
            displayName: editRow.displayName,
          }}
          headingLevel={headingLevel}
          pending={machine.editing}
          outcomeMessage={outcomeMessageFor(editPhase, machine.editFailure)}
          onSubmit={handleSubmit}
          onClose={closeEdit}
        />
      )}
    </div>
  );
}

export default GuestManager;
