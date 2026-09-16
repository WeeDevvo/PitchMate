/**
 * The Join_Code_Form — the Invite_Secret an already-authenticated person pastes
 * or types, with an optional Player_Display_Name, rendered inside the feature's
 * shared {@link FormPanel}.
 *
 * Presentational, like its sibling {@link CreateSquadForm}: `onSubmit` receives a
 * {@link RedeemInviteRequest} ready to send and the Squads_Home issues the call.
 *
 * ### One field, two shapes of invite
 *
 * An invite reaches a person either as the Invite_Link or as the short
 * Invite_Code, and the backend matches exactly one value. There is therefore one
 * field, and `redeemableValueFrom` from `lib/inviteSecret.ts` reduces both shapes
 * to that value: the decoded final segment of a `/join/…` link, or the input
 * itself for anything else (Requirement 4.4). The derivation is a pure function,
 * so what a given paste yields is settled without rendering anything.
 *
 * ### The secret goes to two places, and nowhere else (Requirement 4.10)
 *
 * It reaches the value of its own input and the `presentedSecret` of the emitted
 * command. It is in no other rendered attribute — no `placeholder`, no `title`,
 * no `aria-label`, no `data-` attribute, and no `id` derived from it — it is in no
 * message, because the field message and the outcome messages are fixed strings
 * that take no interpolation parameter, and it is passed to no logging function,
 * because this component calls none. The secret is also never held anywhere but
 * this component's field state, which goes with the panel when it closes.
 *
 * ### The optional display name
 *
 * Left empty, the display name is **omitted from the command entirely** rather
 * than sent as an empty string, so the backend applies its own default
 * (Requirement 4.2). Entered, it is trimmed and submitted — and if it exceeds the
 * backend's column it is messaged on its own field, the same client-side bound the
 * Create_Squad_Form applies. Whether the name is *available* within the squad is
 * the backend's to answer, and comes back as an outcome message (Requirement 4.9).
 *
 * ### Two kinds of message, and they are not interchangeable
 *
 * A rule the form can settle alone — an empty Invite_Secret (Requirement 4.3), a
 * display name past the column — is a **field** message, programmatically
 * associated with the offending input. Everything the backend said — an invite
 * that matches nothing, is revoked, or is expired (one identical message for all
 * three, Requirement 4.8), a rejected display name (Requirement 4.9), a failed
 * call — is an **outcome** message in the live region beneath the fields, with
 * every entered value retained and the submit control available for a further
 * submission.
 *
 * Focus entry and return, Escape without submitting, and the pending submit
 * control are {@link FormPanel}'s (Requirements 4.5, 19.7, 19.8).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.9, 4.10
 */
import { useCallback, useState, type ReactElement, type RefObject } from 'react';

import { FormField, LiveRegion } from '../../auth';
import type { RedeemInviteRequest } from '../api/squadsApi';
import { redeemableValueFrom } from '../lib/inviteSecret';
import {
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  INVITE_SECRET_LABEL,
  INVITE_SECRET_REQUIRED_MESSAGE,
  JOIN_DISPLAY_NAME_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
} from '../lib/messages';
import { NAME_MAX_LENGTH, validateDisplayName } from '../lib/nameValidation';
import { FormPanel } from './FormPanel';
import type { SurfaceCloseReason, SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';

/**
 * The id of the panel, so the Join_Squad entry point can name it through
 * `aria-controls` without inventing an id of its own.
 */
export const JOIN_SQUAD_FORM_ID = 'squads-join-squad-form';

/** The id of the outcome live region, so a caller can reference it. */
export const JOIN_SQUAD_OUTCOME_REGION_ID = 'squads-join-squad-outcome';

export interface JoinSquadFormProps {
  /** Whether the panel is open. Owned by the caller, as {@link FormPanel} asks. */
  readonly open: boolean;
  /** The control that opened the panel, which receives focus back on close. */
  readonly openerRef: RefObject<HTMLElement | null>;
  /**
   * Called with the command to redeem — the derived Invite_Secret, and the
   * display name only where one was entered (Requirements 4.2, 4.4). Never
   * called while `pending`, and never called with an empty secret.
   */
  readonly onSubmit: (command: RedeemInviteRequest) => void;
  /** Called when the panel should close, carrying why. No submission attaches. */
  readonly onClose: (reason: SurfaceCloseReason) => void;
  /** True while a `RedeemInvite` call awaits a response (Requirement 4.5). */
  readonly pending?: boolean;
  /**
   * The outcome of the last submission — an unusable invite, a rejected display
   * name, a failed call — as a fixed message from `lib/messages.ts`
   * (Requirements 4.8, 4.9). `null` while there is nothing to report.
   */
  readonly outcomeMessage?: string | null;
  /** The panel heading's level, defaulting to {@link FormPanel}'s own default. */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/**
 * Render the Join_Code_Form.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.9, 4.10
 */
export function JoinSquadForm({
  open,
  openerRef,
  onSubmit,
  onClose,
  pending = false,
  outcomeMessage = null,
  headingLevel,
}: JoinSquadFormProps): ReactElement {
  const [secret, setSecret] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [secretError, setSecretError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

  const handleSecretChange = useCallback((value: string): void => {
    setSecret(value);
    setSecretError(null);
  }, []);

  const handleDisplayNameChange = useCallback((value: string): void => {
    setDisplayName(value);
    setDisplayNameError(null);
  }, []);

  const handleSubmit = useCallback((): void => {
    // 4.2, 4.4: one derivation for both shapes, trimmed. An empty or
    // whitespace-only field yields the empty string, which is the check below.
    const presentedSecret = redeemableValueFrom(secret);

    // 4.2: the display name is optional, so an empty field is not a failure —
    // it means the key is omitted from the command altogether.
    const entered = displayName.trim();
    const validatedDisplayName =
      entered === '' ? null : validateDisplayName(displayName);

    // 4.3: an empty Invite_Secret issues no `RedeemInvite` call and is messaged
    // on its own field. The message names what to enter and never what was.
    setSecretError(
      presentedSecret === '' ? INVITE_SECRET_REQUIRED_MESSAGE : null,
    );
    setDisplayNameError(
      validatedDisplayName !== null && !validatedDisplayName.ok
        ? DISPLAY_NAME_TOO_LONG_MESSAGE
        : null,
    );

    // Nothing is submitted while either field is messaged, and every entered
    // value stays exactly as it is.
    if (presentedSecret === '') {
      return;
    }
    if (validatedDisplayName !== null && !validatedDisplayName.ok) {
      return;
    }

    // 4.2: `displayName` is present only where a name was entered, carrying the
    // trimmed value; absent otherwise, rather than an empty string.
    onSubmit(
      validatedDisplayName === null
        ? { presentedSecret }
        : { presentedSecret, displayName: validatedDisplayName.value },
    );
  }, [displayName, onSubmit, secret]);

  return (
    <FormPanel
      open={open}
      openerRef={openerRef}
      id={JOIN_SQUAD_FORM_ID}
      heading={JOIN_SQUAD_HEADING}
      headingLevel={headingLevel}
      submitLabel={JOIN_SQUAD_SUBMIT_LABEL}
      pending={pending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {/* 4.1: a persistently visible label naming both shapes of invite. 4.10:
          the value is the only attribute of this input carrying the secret —
          no placeholder, no title, no data attribute, and nothing derived. */}
      <FormField
        label={INVITE_SECRET_LABEL}
        value={secret}
        onValueChange={handleSecretChange}
        error={secretError}
        name="presentedSecret"
        // A secret is not a saved credential and is not a word: keeping the
        // browser's autofill, autocorrect, and capitalisation out of it also
        // keeps it out of any store this component does not control.
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      {/* 4.1: the optional display name, with its optionality in the label. */}
      <FormField
        label={JOIN_DISPLAY_NAME_LABEL}
        value={displayName}
        onValueChange={handleDisplayNameChange}
        error={displayNameError}
        name="displayName"
        autoComplete="off"
        maxLength={NAME_MAX_LENGTH}
      />

      {/* 4.8, 4.9: the outcome of the last submission, announced where it appears
          without moving focus — never a field message, and never the secret. */}
      <LiveRegion id={JOIN_SQUAD_OUTCOME_REGION_ID} message={outcomeMessage} />
    </FormPanel>
  );
}

export default JoinSquadForm;
