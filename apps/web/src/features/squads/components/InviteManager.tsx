/**
 * The Invite_Manager — the Admin_Section's invite surface: the listing of a
 * squad's invites, the control that generates another, and the revoke control on
 * each invite that is still live.
 *
 * Everything it renders was built before it, so it composes and decides rather
 * than implements. The call discipline is entirely `state/useInviteManager.ts`'s:
 * one `ListInvites` per mount, one further list after a successful generate or
 * revoke, single-flight per operation, and the transient reveal that unmount
 * clears (Requirements 11.1, 11.6, 11.7, 11.10, 11.11). This component issues
 * nothing itself — every call it causes goes through that machine.
 *
 * ### Nothing here sorts, filters, or derives an expiry
 *
 * The order is the pure `orderInviteSummaries` applied once inside the machine, so
 * this file holds no comparator (Requirement 11.3). Nor does it *select*: a
 * revoked or expired invite is rendered like any other, and only its revoke
 * control is absent (Requirement 11.9). And it performs no expiry arithmetic — an
 * `expired` Invite_State is derived by the backend's clock and arrives like any
 * other state, so an entry states what the response carried rather than what a
 * comparison here would conclude. Writing an instant out is
 * `lib/inviteInstant.ts`, so a test states its expectation through the same
 * function this component renders through.
 *
 * ### No listing discloses a redeemable value (Requirement 11.4)
 *
 * True by construction rather than by discipline: an `InviteSummary` carries no
 * token, no hash, and no code — the parser names five properties and reads no
 * others — so an entry has nothing redeemable to render. The one place a secret
 * appears in this feature is the {@link InviteReveal}, from the one response that
 * carries one.
 *
 * ### The two ways a failure is reported (Requirement 11.12)
 *
 * | Situation | Rendered |
 * | --- | --- |
 * | a first `ListInvites` failed, so no listing is held | the shared `FailureNotice`: the one generic message in its live region, plus a manual retry |
 * | anything else — a failed refresh, a failed generate, a failed revoke | the one generic message in this surface's live region, with the last accepted listing rendered unchanged |
 *
 * The active-invite-limit rejection Requirement 11.12 names arrives as the same
 * failure as a timeout, because the machine carries an operation name and nothing
 * else (Requirement 17.2). Neither path removes the generate control or the
 * listing, so the remainder of the Squad_Screen keeps rendering throughout.
 *
 * ### The heading is the Admin_Section's, not this component's
 *
 * Requirement 10.7 has the Admin_Section introduce each of its three subsections
 * with exactly one `h3`, so this component renders **no** section heading of its
 * own — a second one would be a duplicate rather than an outline. The surfaces it
 * opens take {@link InviteManagerProps.headingLevel}, defaulting to `4`: one level
 * below that `h3`, so nothing is skipped (Requirements 19.1, 19.2).
 *
 * Requirements: 11.2, 11.4, 11.5, 11.6, 11.8, 11.9, 11.10, 11.11, 11.12
 */
import {
  useCallback,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { LiveRegion } from '../../auth';
import type { AuthState } from '../../auth';
import type { GenerateInviteRequest, SquadsApi } from '../api/squadsApi';
import type { InviteState } from '../lib/wireEnums';
import {
  formatInviteInstant,
  inviteInstantAttribute,
} from '../lib/inviteInstant';
import {
  GENERATE_INVITE_HEADING,
  GENERATE_INVITE_SUBMIT_LABEL,
  GENERIC_SQUADS_FAILURE,
  INVITE_ACTIVE_STATE_LABEL,
  INVITE_CREATED_LABEL,
  INVITE_EXPIRED_STATE_LABEL,
  INVITE_EXPIRES_LABEL,
  INVITE_NEVER_EXPIRES_LABEL,
  INVITE_REVOKED_STATE_LABEL,
  INVITE_VALIDITY_LABEL,
  INVITE_VALIDITY_NINETY_DAYS_LABEL,
  INVITE_VALIDITY_ONE_DAY_LABEL,
  INVITE_VALIDITY_ONE_HOUR_LABEL,
  INVITE_VALIDITY_SEVEN_DAYS_LABEL,
  INVITE_VALIDITY_THIRTY_DAYS_LABEL,
  INVITES_LOADING_LABEL,
  NO_INVITES_STATEMENT,
  REVOKE_INVITE_CONFIRM_LABEL,
  REVOKE_INVITE_HEADING,
  REVOKE_INVITE_LABEL,
  REVOKE_INVITE_STATEMENT,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import { useInviteManager } from '../state/useInviteManager';
import { ConfirmDialog } from './ConfirmDialog';
import { FailureNotice } from './FailureNotice';
import { FormPanel } from './FormPanel';
import { InviteReveal } from './InviteReveal';
import { LoadingIndication } from './LoadingIndication';
import type { SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';
import './InviteManager.css';

/** The selector of the invite surface, so a test can scope its queries to it. */
export const INVITE_MANAGER_SELECTOR = '[data-squads-invite-manager="true"]';

/**
 * The selector of one invite entry. Its value is that invite's identity, so a
 * test can read the rendered order and match entries to summaries without
 * depending on any copy (Requirements 11.2, 11.3).
 */
export const INVITE_ENTRY_SELECTOR = '[data-squads-invite-entry]';

/** The attribute carrying an entry's invite identity. */
export const INVITE_ENTRY_ATTRIBUTE = 'data-squads-invite-entry';

/**
 * The selector of an entry's Invite_State label. Its value is the named state, so
 * a test can assert the label without pinning its wording (Requirement 11.2).
 */
export const INVITE_STATE_LABEL_SELECTOR = '[data-squads-invite-state]';

/** The attribute carrying the named Invite_State a label states. */
export const INVITE_STATE_ATTRIBUTE = 'data-squads-invite-state';

/** The selector of an entry's creation instant (Requirement 11.2). */
export const INVITE_CREATED_SELECTOR = '[data-squads-invite-created="true"]';

/** The selector of an expiring entry's expiry instant (Requirement 11.2). */
export const INVITE_EXPIRES_SELECTOR = '[data-squads-invite-expires="true"]';

/**
 * The selector of the label a non-expiring entry states in place of an expiry
 * instant (Requirement 11.2).
 */
export const INVITE_NEVER_EXPIRES_SELECTOR =
  '[data-squads-invite-never-expires="true"]';

/**
 * The selector of an entry's revoke control, present only on an `active` invite
 * (Requirement 11.9).
 */
export const INVITE_REVOKE_SELECTOR = '[data-squads-invite-revoke]';

/** The selector of the control that opens the invite generator (Req 11.5). */
export const GENERATE_INVITE_CONTROL_SELECTOR =
  '[data-squads-generate-invite="true"]';

/** The id of the invite generator's panel, for the opener's `aria-controls`. */
export const GENERATE_INVITE_FORM_ID = 'squads-generate-invite-form';

/** The id of the surface's outcome live region (Requirement 11.12). */
export const INVITE_MANAGER_OUTCOME_REGION_ID = 'squads-invite-outcome';

/**
 * The label of each named Invite_State — a total lookup, so none is missable
 * (Requirement 11.2).
 */
const INVITE_STATE_LABELS: Readonly<Record<InviteState, string>> = {
  Active: INVITE_ACTIVE_STATE_LABEL,
  Revoked: INVITE_REVOKED_STATE_LABEL,
  Expired: INVITE_EXPIRED_STATE_LABEL,
};

/**
 * One offered validity, and the `GenerateInvite` body it submits
 * (Requirement 11.5).
 */
interface InviteValidityChoice {
  /** The option's stable identity, used as its `<option>` value. */
  readonly id: string;
  /** The option's visible label, from `lib/messages.ts`. */
  readonly label: string;
  /** The request body this option submits, unaltered by the hook. */
  readonly request: GenerateInviteRequest;
}

/**
 * The offered choice: four expiring validities and the non-expiring invite
 * (Requirement 11.5).
 *
 * The durations are written in the backend's `TimeSpan` form — `d.hh:mm:ss` — and
 * every one of them lies inside the range the backend accepts (1 hour to 90 days),
 * so no offered option can be rejected as out of range. The 7-day option is the
 * one selected when the generator opens, matching the period the backend applies
 * when a request supplies none.
 *
 * `nonExpiring` is stated on every entry rather than left to a default, because
 * the request schema requires it and an omitted `false` would be a second way of
 * saying the same thing.
 */
const INVITE_VALIDITY_CHOICES: readonly InviteValidityChoice[] = [
  {
    id: 'one-hour',
    label: INVITE_VALIDITY_ONE_HOUR_LABEL,
    request: { validity: '01:00:00', nonExpiring: false },
  },
  {
    id: 'one-day',
    label: INVITE_VALIDITY_ONE_DAY_LABEL,
    request: { validity: '1.00:00:00', nonExpiring: false },
  },
  {
    id: 'seven-days',
    label: INVITE_VALIDITY_SEVEN_DAYS_LABEL,
    request: { validity: '7.00:00:00', nonExpiring: false },
  },
  {
    id: 'thirty-days',
    label: INVITE_VALIDITY_THIRTY_DAYS_LABEL,
    request: { validity: '30.00:00:00', nonExpiring: false },
  },
  {
    id: 'ninety-days',
    label: INVITE_VALIDITY_NINETY_DAYS_LABEL,
    request: { validity: '90.00:00:00', nonExpiring: false },
  },
  {
    // 11.5: the other half of the choice — no validity at all.
    id: 'non-expiring',
    label: INVITE_NEVER_EXPIRES_LABEL,
    request: { validity: null, nonExpiring: true },
  },
];

/** The option selected when the generator opens. */
const DEFAULT_VALIDITY_CHOICE_ID = 'seven-days';

export interface InviteManagerProps {
  /**
   * The Squads_Api facade — the feature's only transport seam, handed down from
   * the Squad_Screen. This component holds no client and builds none.
   */
  readonly api: SquadsApi;
  /**
   * The squad whose invites these are, taken from the parsed Squad_Detail the
   * Squad_Screen is rendering.
   */
  readonly squadId: string;
  /**
   * The Auth_State, as the Auth_Feature's `useAuth().state` reports it. Passed
   * through to the machine, which issues no call while it is `unauthenticated` and
   * discards everything — including a revealed secret — on a transition to it
   * (Requirement 17.5). Omitted, the machine assumes an authenticated session.
   */
  readonly authState?: AuthState;
  /**
   * The heading level of the surfaces this component opens — the generator panel,
   * the revoke confirmation, and the reveal.
   *
   * Defaults to `4`, one level below the `h3` the Admin_Section uses to introduce
   * the invites subsection (Requirements 10.7, 19.2).
   */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/**
 * Render the Invite_Manager.
 *
 * Requirements: 11.2, 11.4, 11.5, 11.6, 11.8, 11.9, 11.10, 11.11, 11.12
 */
export function InviteManager({
  api,
  squadId,
  authState,
  headingLevel = 4,
}: InviteManagerProps): ReactElement {
  const machine = useInviteManager({ api, squadId, authState });

  /**
   * Whether the generator has been opened. Owned here, as `FormPanel` asks —
   * though whether the panel is *rendered* also depends on the reveal, which is
   * what `generatorVisible` below settles.
   */
  const [generatorOpen, setGeneratorOpen] = useState(false);
  /** The selected validity option's identity (Requirement 11.5). */
  const [choiceId, setChoiceId] = useState(DEFAULT_VALIDITY_CHOICE_ID);
  /**
   * The invite whose revocation is awaiting confirmation, or `null` when none is
   * (Requirement 11.10). Confirming issues the call; dismissing issues nothing.
   */
  const [confirmingInviteId, setConfirmingInviteId] = useState<string | null>(null);

  /**
   * The control that opens the generator — the opener the panel and the reveal
   * both return focus to (Requirement 19.7).
   */
  const generateOpenerRef = useRef<HTMLButtonElement>(null);
  /**
   * The revoke control that opened the confirmation.
   *
   * One ref rather than one per entry, assigned from the activated control: every
   * revoke control reads identically, so returning focus to *the* one the person
   * used is the only way they keep their place in the listing.
   */
  const revokeOpenerRef = useRef<HTMLElement | null>(null);

  const validityFieldId = useId();
  const entryIdPrefix = useId();

  /**
   * Whether the generator panel is rendered.
   *
   * A reveal **replaces** the form that produced it, so the panel is derived from
   * both facts rather than closed by an effect: an effect that called `setState`
   * would be a cascading render for something the render already knows
   * (Requirement 11.6).
   *
   * Dismissing the reveal therefore has to close the panel too — otherwise the
   * form the person already submitted would reappear underneath it — which is what
   * {@link dismissReveal} does below.
   */
  const generatorVisible = generatorOpen && machine.reveal === null;

  const openGenerator = useCallback((): void => {
    setGeneratorOpen((open) => !open);
  }, []);

  const closeGenerator = useCallback((): void => {
    setGeneratorOpen(false);
  }, []);

  const handleValidityChange = useCallback((value: string): void => {
    setChoiceId(value);
  }, []);

  /**
   * Discard the reveal (Requirement 11.7), and leave the generator closed with it.
   *
   * The machine clears the one place the Invite_Link and Invite_Code are held; this
   * only settles what is rendered in their place.
   */
  const dismissReveal = useCallback((): void => {
    setGeneratorOpen(false);
    machine.dismissReveal();
  }, [machine]);

  const handleGenerate = useCallback((): void => {
    const choice =
      INVITE_VALIDITY_CHOICES.find((candidate) => candidate.id === choiceId) ??
      INVITE_VALIDITY_CHOICES.find(
        (candidate) => candidate.id === DEFAULT_VALIDITY_CHOICE_ID,
      );

    if (choice === undefined) {
      return;
    }

    // 11.5: the selected choice, submitted exactly as the option declares it. The
    // machine passes the body through unaltered and enforces single-flight.
    machine.generate(choice.request);
  }, [choiceId, machine]);

  /**
   * Ask for confirmation before revoking (Requirement 11.10).
   *
   * The activated control becomes the confirmation's opener, so focus returns to
   * the entry the person was working on. A request made while a revocation is
   * already awaiting a response opens nothing, because the machine would refuse
   * the call (Requirement 11.11) and a confirmation that led nowhere would be
   * worse than no confirmation.
   */
  const requestRevoke = useCallback(
    (inviteId: string, event: MouseEvent<HTMLButtonElement>): void => {
      if (machine.revokingInviteId !== null) {
        return;
      }

      revokeOpenerRef.current = event.currentTarget;
      setConfirmingInviteId(inviteId);
    },
    [machine.revokingInviteId],
  );

  const dismissConfirmation = useCallback((): void => {
    setConfirmingInviteId(null);
  }, []);

  const confirmRevoke = useCallback((): void => {
    if (confirmingInviteId === null) {
      return;
    }

    // 11.10: exactly one `RevokeInvite` for that invite identity, and — on success
    // — exactly one further `ListInvites`, both the machine's doing. The
    // confirmation closes immediately, which returns focus to the revoke control
    // that issued the call; that control is what reports the pending state.
    machine.revoke(confirmingInviteId);
    setConfirmingInviteId(null);
  }, [confirmingInviteId, machine]);

  const invites = machine.invites ?? [];
  const listFailedWithNothingHeld = machine.listPhase === 'failed';

  /**
   * The outcome message for a failure that is *not* the first-load failure the
   * `FailureNotice` already states — a failed refresh, a failed generate, a failed
   * revoke, or the active-invite limit (Requirement 11.12).
   *
   * One message for all of them, carrying nothing of the backend's own wording
   * (Requirement 17.2). The held listing is untouched either way.
   */
  const outcomeMessage =
    machine.failure !== null && !listFailedWithNothingHeld
      ? GENERIC_SQUADS_FAILURE
      : null;

  /**
   * One entry per parsed Invite_Summary, in the order the machine already applied
   * (Requirements 11.2, 11.3).
   *
   * Nothing is filtered: a revoked or expired invite is listed like any other, and
   * only its revoke control is absent (Requirement 11.9).
   */
  function renderEntry(invite: InviteSummary): ReactElement {
    const entryId = `${entryIdPrefix}${invite.inviteId}`;
    const revoking = machine.revokingInviteId === invite.inviteId;

    return (
      <li
        key={invite.inviteId}
        id={entryId}
        className="squads-invite-entry"
        data-squads-invite-entry={invite.inviteId}
      >
        <span className="squads-invite-entry__facts">
          {/* 11.2: a text label naming the Invite_State. Its colour is emphasis
              over the word, never the carrier of it (Requirement 19.3). */}
          <span
            className="squads-invite-entry__state"
            data-squads-invite-state={invite.state}
          >
            {INVITE_STATE_LABELS[invite.state]}
          </span>

          {/* 11.2: the creation instant. */}
          <span className="squads-invite-entry__field">
            <span className="squads-invite-entry__label">{INVITE_CREATED_LABEL}</span>
            <time
              className="squads-invite-entry__instant"
              dateTime={inviteInstantAttribute(invite.createdAtMs)}
              data-squads-invite-created="true"
            >
              {formatInviteInstant(invite.createdAtMs)}
            </time>
          </span>

          {/* 11.2: either the expiry instant, or the label stating that this
              invite does not expire — never a blank column. */}
          {invite.expiresAtMs === null ? (
            <span
              className="squads-invite-entry__never-expires"
              data-squads-invite-never-expires="true"
            >
              {INVITE_NEVER_EXPIRES_LABEL}
            </span>
          ) : (
            <span className="squads-invite-entry__field">
              <span className="squads-invite-entry__label">{INVITE_EXPIRES_LABEL}</span>
              <time
                className="squads-invite-entry__instant"
                dateTime={inviteInstantAttribute(invite.expiresAtMs)}
                data-squads-invite-expires="true"
              >
                {formatInviteInstant(invite.expiresAtMs)}
              </time>
            </span>
          )}
        </span>

        {/* 11.9: a revoke control on an `Active` invite, and none on a revoked or
            expired one — there is nothing left to revoke. */}
        {invite.state === 'Active' ? (
          <button
            type="button"
            className="squads-invite-entry__revoke"
            // Several controls read "Revoke", so the entry describes its own:
            // the state and both instants become the control's description
            // rather than a message here taking a parameter.
            aria-describedby={entryId}
            // 11.11: the control that issued the call reports it, and stays in the
            // keyboard order while it does — `aria-disabled` rather than
            // `disabled`, so the focus of whoever activated it is not dropped.
            aria-disabled={revoking ? true : undefined}
            aria-busy={revoking ? true : undefined}
            data-squads-invite-revoke={invite.inviteId}
            data-pending={revoking ? 'true' : 'false'}
            onClick={(event) => requestRevoke(invite.inviteId, event)}
          >
            {REVOKE_INVITE_LABEL}
          </button>
        ) : null}
      </li>
    );
  }

  /**
   * Exactly one of the listing states, and never two.
   *
   * - `failed` with nothing held — the generic failure and a manual retry, and no
   *   listing to keep (Requirement 11.12).
   * - a held listing — the entries, plus the busy indication while a further list
   *   is awaiting a response, so a refresh never blanks what was accepted.
   * - an accepted empty listing — the no-invites statement, which is an absence
   *   rather than a failure.
   * - `idle` — nothing requested yet, or the session ended: nothing is rendered,
   *   because a busy indication would claim a call that was never made.
   */
  let listing: ReactNode = null;

  if (listFailedWithNothingHeld) {
    listing = (
      <FailureNotice
        retryLabel={SQUADS_RETRY_LABEL}
        onRetry={machine.retry}
        retryBusy={machine.busy}
      />
    );
  } else if (invites.length > 0) {
    listing = (
      <>
        {machine.busy ? <LoadingIndication label={INVITES_LOADING_LABEL} /> : null}
        <ul className="squads-invite-manager__entries">{invites.map(renderEntry)}</ul>
      </>
    );
  } else if (machine.busy) {
    listing = <LoadingIndication label={INVITES_LOADING_LABEL} />;
  } else if (machine.listPhase === 'listed') {
    listing = <p className="squads-invite-manager__empty">{NO_INVITES_STATEMENT}</p>;
  }

  return (
    <div className="squads-invite-manager" data-squads-invite-manager="true">
      {/* 11.5: the control that opens the generator. Outside the listing branch,
          so it is rendered in every load state — including while the listing
          failed, which is exactly when a fresh invite may be wanted. */}
      <button
        type="button"
        className="squads-invite-manager__generate"
        ref={generateOpenerRef}
        aria-expanded={generatorVisible}
        aria-controls={GENERATE_INVITE_FORM_ID}
        data-squads-generate-invite="true"
        onClick={openGenerator}
      >
        {GENERATE_INVITE_HEADING}
      </button>

      {/* 11.5: the choice between an expiring invite with a selected validity and
          a non-expiring one, submitted as the selected option's body. */}
      <FormPanel
        open={generatorVisible}
        openerRef={generateOpenerRef}
        id={GENERATE_INVITE_FORM_ID}
        heading={GENERATE_INVITE_HEADING}
        headingLevel={headingLevel}
        submitLabel={GENERATE_INVITE_SUBMIT_LABEL}
        pending={machine.generating}
        onSubmit={handleGenerate}
        onClose={closeGenerator}
      >
        <div className="squads-invite-manager__field">
          {/* A persistently visible label, associated with the control rather than
              placed inside it, so it survives a selection being made. */}
          <label className="squads-invite-manager__field-label" htmlFor={validityFieldId}>
            {INVITE_VALIDITY_LABEL}
          </label>
          <select
            id={validityFieldId}
            className="squads-invite-manager__select"
            value={choiceId}
            data-squads-invite-validity="true"
            onChange={(event) => handleValidityChange(event.target.value)}
          >
            {INVITE_VALIDITY_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      </FormPanel>

      {/* 11.6, 11.7, 11.8: the reveal, mounted only while the machine holds one.
          Dismissal clears that state, which unmounts this and takes both values
          with it. */}
      {machine.reveal !== null ? (
        <InviteReveal
          redeemableLink={machine.reveal.redeemableLink}
          code={machine.reveal.code}
          openerRef={generateOpenerRef}
          onDismiss={dismissReveal}
          headingLevel={headingLevel}
        />
      ) : null}

      {/* 11.12: the outcome of a generate, a revoke, or a failed refresh,
          announced where it appears without moving focus. Always rendered, so a
          message inserted later is announced. */}
      <LiveRegion id={INVITE_MANAGER_OUTCOME_REGION_ID} message={outcomeMessage} />

      {listing}

      {/* 11.10: the confirmation. One dialog for the whole listing, because only
          one revocation can be under consideration at a time, and it returns focus
          to the revoke control that opened it. */}
      <ConfirmDialog
        open={confirmingInviteId !== null}
        openerRef={revokeOpenerRef}
        heading={REVOKE_INVITE_HEADING}
        headingLevel={headingLevel}
        confirmLabel={REVOKE_INVITE_CONFIRM_LABEL}
        onConfirm={confirmRevoke}
        onClose={dismissConfirmation}
      >
        {REVOKE_INVITE_STATEMENT}
      </ConfirmDialog>
    </div>
  );
}

export default InviteManager;
