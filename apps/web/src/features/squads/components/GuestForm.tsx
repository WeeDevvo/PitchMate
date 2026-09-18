/**
 * The Guest_Form — one form, two modes, rendered inside the feature's shared
 * {@link FormPanel}.
 *
 * | Mode     | Fields                                                                   | Sentinel tier option selected by default |
 * | -------- | ------------------------------------------------------------------------ | ---------------------------------------- |
 * | `create` | display name, tier selection, **Lawful_Basis_Acknowledgement** checkbox   | **Do not seed a tier** (Requirement 12.5) |
 * | `edit`   | display name **prefilled**, tier selection, and **no** acknowledgement    | **Leave unchanged** (Requirements 12.8, 12.9) |
 *
 * It is presentational and issues nothing: `onSubmit` receives a
 * {@link GuestCommand} — a tagged submission carrying the *trimmed* display name
 * and the tier **selection** — and `GuestManager` hands that to
 * `useGuestManager`, which is the feature's only site that issues `CreateGuest`
 * and `EditGuest`.
 *
 * ### Why the emitted command carries a selection rather than a tier code
 *
 * Requirement 12.5 wants the create default to omit `skillTier` from the body
 * entirely, and Requirement 12.9 wants an edit to convey *whether* the tier
 * changes and only then the tier. Both mappings are `lib/skillTier.ts`'s —
 * `skillTierFieldsForCreate` and `skillTierFieldsForEdit` — and
 * `useGuestManager` already applies them at the one place each command is built.
 * This component therefore reads the *option model* from that same module (the
 * offered options, the two defaults, and the guards that turn a control's string
 * back into an option) and never a tier code, so no numeric enum literal appears
 * here and there is exactly one place the 0-based codes are produced
 * (Requirement 16.12).
 *
 * ### Two kinds of message, and they are not interchangeable
 *
 * A rule the form can settle alone is a **field** message, `aria-describedby` the
 * control it is about: an empty display name (Requirement 12.2), one past the
 * backend's column, and a create submission attempted without the
 * acknowledgement — which issues **no** `CreateGuest` call and states the
 * requirement against the checkbox itself (Requirement 12.3).
 *
 * Everything the backend said is an **outcome** message in the live region
 * beneath the fields: a rejected Player_Display_Name (Requirement 12.11), a
 * failed call, a lapsed Squad_Call_Timeout, an unreadable body, a not-found
 * (Requirement 12.12). The caller keeps the panel open across it, so every
 * entered value is retained — this component never rewrites a field — and the
 * submit control stays available for a further submission. The prop takes a
 * message the caller already chose from `lib/messages.ts`, so no backend text can
 * reach it (Requirement 17.2).
 *
 * ### The acknowledgement is unselected on every opening, structurally
 *
 * Requirement 12.4 makes the acknowledgement a deliberate act **per guest**, so
 * it must not be inherited from the last guest added. Rather than resetting state
 * in an effect, the open form is a separate component: opening the panel *mounts*
 * it, so its state starts at the defaults every time, and the `key` below
 * remounts it when the mode changes — switching from creating to editing, or from
 * one guest to another, cannot leave a previous guest's name or tier in the
 * fields. That is the same construction {@link FormPanel} uses for focus, for the
 * same reason: a structural guarantee needs no discipline to hold.
 *
 * Focus entry and return, Escape without submitting, and the pending submit
 * control are all {@link FormPanel}'s (Requirements 12.13, 19.7, 19.8).
 *
 * No colour value appears here; the panel and the token table own presentation
 * (Requirement 18.9).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8, 12.9, 12.11, 12.12, 12.13
 */
import {
  useCallback,
  useId,
  useState,
  type ChangeEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { FormField, LiveRegion } from '../../auth';
import {
  ADD_GUEST_HEADING,
  ADD_GUEST_SUBMIT_LABEL,
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  EDIT_GUEST_HEADING,
  GUEST_DISPLAY_NAME_LABEL,
  GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
  LAWFUL_BASIS_ACKNOWLEDGEMENT,
  LAWFUL_BASIS_REQUIRED_MESSAGE,
  SAVE_GUEST_SUBMIT_LABEL,
  SKILL_TIER_AVERAGE_LABEL,
  SKILL_TIER_BEGINNER_LABEL,
  SKILL_TIER_DO_NOT_SEED_LABEL,
  SKILL_TIER_LABEL,
  SKILL_TIER_LEAVE_UNCHANGED_LABEL,
  SKILL_TIER_STRONG_LABEL,
} from '../lib/messages';
import {
  NAME_MAX_LENGTH,
  validateDisplayName,
  type NameValidationFailureReason,
} from '../lib/nameValidation';
import type { SkillTierValue } from '../lib/enumCodes';
import {
  DEFAULT_SKILL_TIER_CREATE_OPTION,
  DEFAULT_SKILL_TIER_EDIT_OPTION,
  DO_NOT_SEED_TIER,
  isSkillTierCreateOption,
  isSkillTierEditOption,
  LEAVE_TIER_UNCHANGED,
  SKILL_TIER_CREATE_OPTIONS,
  SKILL_TIER_EDIT_OPTIONS,
  type SkillTierCreateOption,
  type SkillTierEditOption,
} from '../lib/skillTier';
import type {
  GuestCreateSubmission,
  GuestEditSubmission,
} from '../state/useGuestManager';
import { FormPanel } from './FormPanel';
import type { SurfaceCloseReason, SurfaceHeadingLevel } from './surfaceFocus';
import '../styles/squadsTokens.css';
import './GuestForm.css';

/** The id of the panel in `create` mode, for a caller's `aria-controls`. */
export const GUEST_CREATE_FORM_ID = 'squads-guest-create-form';

/** The id of the panel in `edit` mode, for a caller's `aria-controls`. */
export const GUEST_EDIT_FORM_ID = 'squads-guest-edit-form';

/** The id of the Guest_Form's outcome live region. */
export const GUEST_FORM_OUTCOME_REGION_ID = 'squads-guest-form-outcome';

/** The selector of the Skill_Tier selection, in either mode. */
export const GUEST_FORM_TIER_SELECTOR = '[data-squads-guest-tier="true"]';

/**
 * The selector of the Lawful_Basis_Acknowledgement control, which exists in
 * `create` mode only (Requirements 12.4, 12.8).
 */
export const GUEST_FORM_ACKNOWLEDGEMENT_SELECTOR =
  '[data-squads-guest-acknowledgement="true"]';

/**
 * Which guest the form is for.
 *
 * `edit` carries the membership identity the `EditGuest` call is for and the
 * guest's current Player_Display_Name to prefill (Requirement 12.8). It does
 * *not* carry a current Skill_Tier, because `SquadData.Members` does not report
 * one — which is exactly why the edit mode's default is "leave unchanged" rather
 * than a tier.
 */
export type GuestFormMode =
  | { readonly kind: 'create' }
  | {
      readonly kind: 'edit';
      readonly membershipId: string;
      readonly displayName: string;
    };

/**
 * What a submission of the Guest_Form emits: the mode it was submitted in, plus
 * exactly the values `useGuestManager` needs to build the command.
 *
 * A tagged union rather than two callbacks, so a caller cannot wire the create
 * path to the edit call. The tier is the *selection*; the display name is
 * already trimmed by `validateDisplayName`, and the hook applies the same
 * function again, which is idempotent (Requirement 12.2).
 */
export type GuestCommand =
  | ({ readonly kind: 'create' } & GuestCreateSubmission)
  | ({ readonly kind: 'edit' } & GuestEditSubmission);

export interface GuestFormProps {
  /** Whether the panel is open. Owned by the caller, as {@link FormPanel} asks. */
  readonly open: boolean;
  /** The control that opened the panel, which receives focus back on close. */
  readonly openerRef: RefObject<HTMLElement | null>;
  /** Which guest the form is for, and therefore which fields it renders. */
  readonly mode: GuestFormMode;
  /**
   * Called with the validated submission — and only then. Never called while
   * `pending`, never called with an untrimmed or empty display name, and never
   * called in `create` mode without the acknowledgement (Requirements 12.2,
   * 12.3).
   */
  readonly onSubmit: (command: GuestCommand) => void;
  /** Called when the panel should close, carrying why. No submission attaches. */
  readonly onClose: (reason: SurfaceCloseReason) => void;
  /**
   * True while the matching `CreateGuest` or `EditGuest` call awaits a response
   * (Requirement 12.13).
   */
  readonly pending?: boolean;
  /**
   * The outcome of the last submission — a rejected display name, a failed call,
   * a lapsed timeout, a not-found — as a fixed message from `lib/messages.ts`
   * (Requirements 12.11, 12.12). `null` while there is nothing to report.
   */
  readonly outcomeMessage?: string | null;
  /**
   * The panel heading's level. The Guest_Form opens under the administration
   * `h2` and its guests `h3`, so the Admin_Section states `4`.
   */
  readonly headingLevel?: SurfaceHeadingLevel;
}

/** The three Skill_Tier labels, keyed by the tier names `lib/enumCodes.ts` declares. */
const TIER_LABELS: Readonly<Record<SkillTierValue, string>> = {
  beginner: SKILL_TIER_BEGINNER_LABEL,
  average: SKILL_TIER_AVERAGE_LABEL,
  strong: SKILL_TIER_STRONG_LABEL,
};

/**
 * The visible label of one offered option — the mode's sentinel, or a tier.
 *
 * The two sentinels read differently because they *mean* differently: creating
 * with no tier leaves the backend to apply its default μ, while editing without
 * touching the tier must not overwrite one an admin seeded earlier
 * (Requirements 12.5, 12.9).
 */
function tierOptionLabel(
  option: SkillTierCreateOption | SkillTierEditOption,
): string {
  if (option === DO_NOT_SEED_TIER) {
    return SKILL_TIER_DO_NOT_SEED_LABEL;
  }

  if (option === LEAVE_TIER_UNCHANGED) {
    return SKILL_TIER_LEAVE_UNCHANGED_LABEL;
  }

  return TIER_LABELS[option];
}

/** The display-name field's message for a named validation failure (Req 12.2). */
function displayNameMessage(reason: NameValidationFailureReason): string {
  return reason === 'empty'
    ? GUEST_DISPLAY_NAME_REQUIRED_MESSAGE
    : DISPLAY_NAME_TOO_LONG_MESSAGE;
}

/**
 * The open form.
 *
 * Split out so that opening the panel *is* mounting this component: the display
 * name starts at the mode's prefill, the tier at the mode's default, and the
 * acknowledgement unselected — on **every** opening, with no reset effect to keep
 * honest (Requirements 12.4, 12.8).
 */
function OpenGuestForm({
  openerRef,
  mode,
  onSubmit,
  onClose,
  pending = false,
  outcomeMessage = null,
  headingLevel = 4,
}: Omit<GuestFormProps, 'open'>): ReactElement {
  const creating = mode.kind === 'create';

  // 12.8: prefilled in `edit` mode, empty in `create` mode.
  const [displayName, setDisplayName] = useState(
    mode.kind === 'edit' ? mode.displayName : '',
  );
  // 12.5, 12.9: the mode's sentinel is what the form opens with.
  const [tier, setTier] = useState<SkillTierCreateOption | SkillTierEditOption>(
    creating ? DEFAULT_SKILL_TIER_CREATE_OPTION : DEFAULT_SKILL_TIER_EDIT_OPTION,
  );
  // 12.4: unselected on every opening, because every opening is a fresh mount.
  const [acknowledged, setAcknowledged] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [acknowledgementError, setAcknowledgementError] = useState<
    string | null
  >(null);

  const tierId = useId();
  const acknowledgementId = useId();
  const acknowledgementErrorId = useId();

  // A message about a value that has since changed is worse than no message.
  const handleDisplayNameChange = useCallback((value: string): void => {
    setDisplayName(value);
    setDisplayNameError(null);
  }, []);

  const handleTierChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>): void => {
      const { value } = event.target;

      // The control reports a string, and this is the single place that string
      // becomes an option: a value no mode offered is disregarded rather than
      // carried into a command as a tier nobody selected.
      if (creating) {
        if (isSkillTierCreateOption(value)) {
          setTier(value);
        }
        return;
      }

      if (isSkillTierEditOption(value)) {
        setTier(value);
      }
    },
    [creating],
  );

  const handleAcknowledgementChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      setAcknowledged(event.target.checked);
      setAcknowledgementError(null);
    },
    [],
  );

  const handleSubmit = useCallback((): void => {
    const validated = validateDisplayName(displayName);

    setDisplayNameError(
      validated.ok ? null : displayNameMessage(validated.reason),
    );

    // 12.3: the acknowledgement is stated against its own control, and only in
    // `create` mode — an edit renders no such control to message.
    const acknowledgementMissing = creating && !acknowledged;
    setAcknowledgementError(
      acknowledgementMissing ? LAWFUL_BASIS_REQUIRED_MESSAGE : null,
    );

    // 12.2, 12.3: no call at all, and every entered value stays exactly as it is.
    if (!validated.ok || acknowledgementMissing) {
      return;
    }

    // 12.2: the trimmed display name is what gets submitted, in both modes.
    if (mode.kind === 'edit') {
      onSubmit({
        kind: 'edit',
        membershipId: mode.membershipId,
        displayName: validated.value,
        // 12.9: the selection, which `skillTierFieldsForEdit` turns into the
        // change flag and — only when the flag is set — the tier code.
        skillTier: isSkillTierEditOption(tier)
          ? tier
          : DEFAULT_SKILL_TIER_EDIT_OPTION,
      });
      return;
    }

    onSubmit({
      kind: 'create',
      displayName: validated.value,
      // 12.5: the selection, which `skillTierFieldsForCreate` turns into an
      // omitted `skillTier` while the default is selected.
      skillTier: isSkillTierCreateOption(tier)
        ? tier
        : DEFAULT_SKILL_TIER_CREATE_OPTION,
      // 12.2: reached only while the acknowledgement is given.
      lawfulBasisAcknowledged: true,
    });
  }, [acknowledged, creating, displayName, mode, onSubmit, tier]);

  const options = creating ? SKILL_TIER_CREATE_OPTIONS : SKILL_TIER_EDIT_OPTIONS;
  const hasAcknowledgementError = acknowledgementError !== null;

  return (
    <FormPanel
      openerRef={openerRef}
      open
      id={creating ? GUEST_CREATE_FORM_ID : GUEST_EDIT_FORM_ID}
      heading={creating ? ADD_GUEST_HEADING : EDIT_GUEST_HEADING}
      headingLevel={headingLevel}
      submitLabel={creating ? ADD_GUEST_SUBMIT_LABEL : SAVE_GUEST_SUBMIT_LABEL}
      pending={pending}
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      {/* 12.1, 12.8: a persistently visible label, prefilled for an edit, with
          its validation message programmatically associated with the field. */}
      <FormField
        label={GUEST_DISPLAY_NAME_LABEL}
        value={displayName}
        onValueChange={handleDisplayNameChange}
        error={displayNameError}
        name="guestDisplayName"
        autoComplete="off"
        // The backend's own column bound. The rule is still applied on
        // submission, because a pasted value can arrive longer than this allows.
        maxLength={NAME_MAX_LENGTH}
      />

      {/* 12.1, 12.5, 12.8, 12.9: exactly three tiers plus the mode's sentinel,
          the sentinel selected by default, under a persistently visible label. */}
      <div className="squads-guest-form__field">
        <label className="squads-guest-form__label" htmlFor={tierId}>
          {SKILL_TIER_LABEL}
        </label>
        <select
          id={tierId}
          className="squads-guest-form__select"
          data-squads-guest-tier="true"
          name="skillTier"
          value={tier}
          onChange={handleTierChange}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {tierOptionLabel(option)}
            </option>
          ))}
        </select>
      </div>

      {/* 12.1, 12.4: the acknowledgement, stated in text and unselected on every
          opening. 12.8: absent altogether in `edit` mode — not disabled, not
          hidden, but never rendered. */}
      {creating && (
        <div className="squads-guest-form__field">
          <div className="squads-guest-form__checkbox">
            <input
              id={acknowledgementId}
              className="squads-guest-form__checkbox-input"
              type="checkbox"
              data-squads-guest-acknowledgement="true"
              name="lawfulBasisAcknowledged"
              checked={acknowledged}
              onChange={handleAcknowledgementChange}
              aria-invalid={hasAcknowledgementError || undefined}
              // 12.3: the message is associated with this control, so it is
              // conveyed without focus having to move onto the text.
              aria-describedby={
                hasAcknowledgementError ? acknowledgementErrorId : undefined
              }
            />
            <label
              className="squads-guest-form__label"
              htmlFor={acknowledgementId}
            >
              {LAWFUL_BASIS_ACKNOWLEDGEMENT}
            </label>
          </div>
          {hasAcknowledgementError && (
            <p
              id={acknowledgementErrorId}
              className="squads-guest-form__error"
            >
              {acknowledgementError}
            </p>
          )}
        </div>
      )}

      {/* 12.11, 12.12: the outcome of the last submission, announced where it
          appears without moving focus — never a field message, and never
          anything of the response but a message chosen from `lib/messages.ts`. */}
      <LiveRegion id={GUEST_FORM_OUTCOME_REGION_ID} message={outcomeMessage} />
    </FormPanel>
  );
}

/**
 * Render the Guest_Form.
 *
 * A closed form renders nothing at all, and each opening is a fresh mount — which
 * is what makes the acknowledgement unselected per guest and the edit prefill
 * belong to the guest currently being edited (Requirements 12.4, 12.8).
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.8, 12.9, 12.11, 12.12, 12.13
 */
export function GuestForm({
  open,
  ...rest
}: GuestFormProps): ReactElement | null {
  if (!open) {
    return null;
  }

  // The key remounts the form when the mode changes, so switching from creating
  // to editing — or from one guest to another — cannot leave the previous
  // guest's name, tier, or acknowledgement in the fields (Requirement 12.4).
  const key =
    rest.mode.kind === 'edit' ? `edit:${rest.mode.membershipId}` : 'create';

  return <OpenGuestForm key={key} {...rest} />;
}

export default GuestForm;
