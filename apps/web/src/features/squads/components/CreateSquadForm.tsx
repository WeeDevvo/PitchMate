/**
 * The Create_Squad_Form — the Squad_Name and the creator's Player_Display_Name,
 * rendered inside the feature's shared {@link FormPanel}.
 *
 * It is presentational and issues nothing. `onSubmit` receives a
 * {@link CreateSquadRequest} already validated and trimmed, and the Squads_Home
 * hands that to `createSquad`; this component holds no api, no timeout, and no
 * knowledge of what happens next (Requirement 3.6 belongs to the screen).
 *
 * ### Two kinds of message, and they are not interchangeable
 *
 * | What happened | Where it is rendered |
 * | --- | --- |
 * | a rule the form can settle alone — empty after trimming, longer than the column | a **field** message, `aria-describedby` the offending input (Requirement 3.3) |
 * | anything the backend said — a rejected name, a failed call, a lapsed timeout | an **outcome** message in a live region beneath the fields (Requirements 3.8, 3.9) |
 *
 * Requirement 3.9 makes the backend the authority on whether a name is
 * acceptable, so a backend rejection is *never* rendered as a red field: the
 * value stays exactly as entered, the submit control stays available, and the
 * person is told the outcome rather than being blocked by a client-side guess at
 * the backend's taste. The `outcomeMessage` prop is the only channel for that,
 * and it takes a message the caller already chose from `lib/messages.ts` — no
 * backend text reaches it (Requirement 17.2).
 *
 * ### What is validated here, and by what
 *
 * Both fields go through `lib/nameValidation.ts` — `validateSquadName` and
 * `validateDisplayName` — which is a pure function of a string, so the rule is
 * stated where it can be tested without a browser (Requirement 3.4). This
 * component only maps the named failure to its message and picks the field the
 * message attaches to. A failed validation issues **no** call and keeps every
 * entered value (Requirement 3.3); an accepted validation submits the *trimmed*
 * value (Requirement 3.2).
 *
 * A field's message is cleared as soon as that field is edited, so a message
 * never outlives the value it was about. It reappears on the next submission if
 * the value still fails.
 *
 * ### Focus, Escape, and the pending state
 *
 * All three come from {@link FormPanel}: focus enters on open and returns to the
 * opener on close, Escape closes without submitting, and `pending` marks the
 * submit control `aria-disabled` and `aria-busy` rather than `disabled` so it
 * keeps the focus of whoever just activated it (Requirements 3.5, 19.7, 19.8).
 * The panel also blocks a submission while `pending`, which is the rendering half
 * of single-flight; the state hook enforces the other half.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.8, 3.9
 */
import { useCallback, useState, type ReactElement, type RefObject } from 'react';

import { FormField, LiveRegion } from '../../auth';
import type { CreateSquadRequest } from '../api/squadsApi';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  DISPLAY_NAME_REQUIRED_MESSAGE,
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  SQUAD_NAME_LABEL,
  SQUAD_NAME_REQUIRED_MESSAGE,
  SQUAD_NAME_TOO_LONG_MESSAGE,
} from '../lib/messages';
import {
  NAME_MAX_LENGTH,
  validateDisplayName,
  validateSquadName,
  type NameValidationFailureReason,
} from '../lib/nameValidation';
import { FormPanel } from './FormPanel';
import type { SurfaceCloseReason, SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';

/**
 * The id of the panel, so the Create_Squad entry point can name it through
 * `aria-controls` without inventing an id of its own.
 */
export const CREATE_SQUAD_FORM_ID = 'squads-create-squad-form';

/** The id of the outcome live region, so a caller can reference it. */
export const CREATE_SQUAD_OUTCOME_REGION_ID = 'squads-create-squad-outcome';

export interface CreateSquadFormProps {
  /** Whether the panel is open. Owned by the caller, as {@link FormPanel} asks. */
  readonly open: boolean;
  /** The control that opened the panel, which receives focus back on close. */
  readonly openerRef: RefObject<HTMLElement | null>;
  /**
   * Called with the validated, trimmed command — and only then (Requirements
   * 3.2, 3.3). Never called while `pending`.
   */
  readonly onSubmit: (command: CreateSquadRequest) => void;
  /** Called when the panel should close, carrying why. No submission attaches. */
  readonly onClose: (reason: SurfaceCloseReason) => void;
  /** True while a `CreateSquad` call awaits a response (Requirement 3.5). */
  readonly pending?: boolean;
  /**
   * The outcome of the last submission — a failed call, a lapsed timeout, or a
   * name the backend rejected — as a fixed message from `lib/messages.ts`
   * (Requirements 3.8, 3.9). `null` while there is nothing to report.
   */
  readonly outcomeMessage?: string | null;
  /** The panel heading's level, defaulting to {@link FormPanel}'s own default. */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/** The Squad_Name field's message for a named validation failure (Req 3.3). */
function squadNameMessage(reason: NameValidationFailureReason): string {
  return reason === 'empty'
    ? SQUAD_NAME_REQUIRED_MESSAGE
    : SQUAD_NAME_TOO_LONG_MESSAGE;
}

/** The Player_Display_Name field's message for a named failure (Req 3.3). */
function displayNameMessage(reason: NameValidationFailureReason): string {
  return reason === 'empty'
    ? DISPLAY_NAME_REQUIRED_MESSAGE
    : DISPLAY_NAME_TOO_LONG_MESSAGE;
}

/**
 * Render the Create_Squad_Form.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.8, 3.9
 */
export function CreateSquadForm({
  open,
  openerRef,
  onSubmit,
  onClose,
  pending = false,
  outcomeMessage = null,
  headingLevel,
}: CreateSquadFormProps): ReactElement {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

  // A message about a value that has since changed is worse than no message, so
  // editing a field clears its own message and leaves the other field's alone.
  const handleNameChange = useCallback((value: string): void => {
    setName(value);
    setNameError(null);
  }, []);

  const handleDisplayNameChange = useCallback((value: string): void => {
    setDisplayName(value);
    setDisplayNameError(null);
  }, []);

  const handleSubmit = useCallback((): void => {
    const validatedName = validateSquadName(name);
    const validatedDisplayName = validateDisplayName(displayName);

    // 3.3: both fields are messaged in one pass, so a person fixes both together
    // rather than discovering the second problem after fixing the first.
    setNameError(
      validatedName.ok ? null : squadNameMessage(validatedName.reason),
    );
    setDisplayNameError(
      validatedDisplayName.ok
        ? null
        : displayNameMessage(validatedDisplayName.reason),
    );

    // 3.3: no `CreateSquad` call, and every entered value stays exactly as it is
    // — this component never rewrites a field's value.
    if (!validatedName.ok || !validatedDisplayName.ok) {
      return;
    }

    // 3.2: the trimmed values are what get submitted.
    onSubmit({
      name: validatedName.value,
      displayName: validatedDisplayName.value,
    });
  }, [displayName, name, onSubmit]);

  return (
    <FormPanel
      open={open}
      openerRef={openerRef}
      id={CREATE_SQUAD_FORM_ID}
      heading={CREATE_SQUAD_HEADING}
      headingLevel={headingLevel}
      submitLabel={CREATE_SQUAD_SUBMIT_LABEL}
      pending={pending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {/* 3.1: a persistently visible label, and the message programmatically
          associated with the field it is about (Requirement 3.3). */}
      <FormField
        label={SQUAD_NAME_LABEL}
        value={name}
        onValueChange={handleNameChange}
        error={nameError}
        name="squadName"
        autoComplete="off"
        // The backend's own column bound, so the field cannot be typed past what
        // the backend would take. The rule is still applied on submission,
        // because a pasted value can arrive longer than this attribute allows.
        maxLength={NAME_MAX_LENGTH}
      />

      {/* 3.1: the creator's own display name within the squad being created. */}
      <FormField
        label={CREATOR_DISPLAY_NAME_LABEL}
        value={displayName}
        onValueChange={handleDisplayNameChange}
        error={displayNameError}
        name="creatorDisplayName"
        autoComplete="off"
        maxLength={NAME_MAX_LENGTH}
      />

      {/* 3.8, 3.9: the outcome of the last submission, announced where it appears
          without moving focus. Always present, so a message inserted later is
          announced; never a field message, whatever the backend said. */}
      <LiveRegion
        id={CREATE_SQUAD_OUTCOME_REGION_ID}
        message={outcomeMessage}
      />
    </FormPanel>
  );
}

export default CreateSquadForm;
