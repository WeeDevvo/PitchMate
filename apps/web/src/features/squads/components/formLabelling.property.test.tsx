/**
 * Property test for field labelling and validation-message association across
 * every form of the Squads_Feature (task 16.3).
 *
 * **Property 45: Every field is labelled and every validation message is
 * associated.** *For any* form of the feature and any combination of entered and
 * invalid values, every field renders a persistently visible label
 * programmatically associated with it, and every rendered validation message is
 * programmatically associated with the field it concerns.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 3.1, 4.1, 12.1 — each field of each form carries a persistently visible label | {@link auditFieldLabelling}, run three times per case: freshly opened, after values are entered, and after a submission |
 * | 19.9 — that label is *programmatically associated* with the field | the same audit: exactly one `<label>` claims each control, and the control's accessible name resolves through it rather than through an `aria-label` or a placeholder |
 * | 3.3, 4.3, 12.3 — a rejected submission renders a message on the offending field | {@link auditValidationAssociation}: the rendered message set is exactly the set the pure validators predict, and each message is `aria-describedby` the field it concerns |
 * | 19.9 — and *only* the field it concerns | the same audit: exactly one control references each message, that control's own label is the expected one, and a field with nothing wrong carries no `aria-invalid` |
 * | 3.8, 3.9, 4.8, 12.11 — an outcome message is *not* a field message | {@link auditOutcomeSeparation}: a backend-caused message renders in the live region and is referenced by no field |
 *
 * ### What is quantified over
 *
 * 1. **Which form.** All five: the Create_Squad_Form, the Join_Code_Form, the
 *    Guest_Form in its create and edit modes, and the invite generator. Each is
 *    mounted through the component the screens mount, so the labelling under test
 *    is the shipped markup rather than a restatement of it.
 * 2. **Every combination of entered and invalid values.** Both text fields of each
 *    form are driven independently from one value space covering the accepted
 *    shapes and every rejected one: empty, whitespace-only, exactly the length
 *    bound, one over it, far over it, padded with whitespace either side,
 *    non-ASCII, an Invite_Link, and a link whose final segment is empty. Because
 *    the fields are independent, the generated pairs cover valid × valid,
 *    valid × invalid, invalid × valid, and invalid × invalid, and the two
 *    rejection *reasons* of each field cross with the two of the other.
 * 3. **The non-text controls.** The Skill_Tier selection and the invite validity
 *    selection are each moved to a generated option, and the
 *    Lawful_Basis_Acknowledgement is generated selected and unselected — the
 *    second being the one combination that produces a validation message on a
 *    control that is not a text field (Requirement 12.3).
 * 4. **Whether the form was submitted.** Nothing has been rejected before a
 *    submission, so an unsubmitted case asserts the *absence* of a message as
 *    firmly as a submitted one asserts its presence and its association.
 * 5. **Whether an outcome message is present.** A backend-caused message is
 *    generated alongside the entered values, so "every rendered validation
 *    message is associated with a field" is asserted in the presence of a message
 *    that deliberately is not one.
 *
 * The expected message set is never restated: it is computed per case from the
 * production `validateSquadName`, `validateDisplayName`, and
 * `redeemableValueFrom`, applied to the value the field *actually holds* after
 * entry. A form that stopped applying a rule, or applied it to the untrimmed
 * value, therefore fails rather than agreeing with a duplicated rule here.
 *
 * ### Two mountings, because two things can go wrong
 *
 * The first property — stated once per form, so each form's value space is
 * explored on its own rather than sharing a budget with four others — mounts the
 * form component directly, which is what makes that space affordable to explore.
 * Each of those runs ends by asserting it *reached* every rejection its form can
 * produce, so a value space that drifted towards the acceptable would fail rather
 * than pass while asserting nothing. The last property opens each form the way a
 * person opens it — through the real screens, in both Themes, from the fixture in
 * `../testing/squadsScreenStates.tsx` — because a label can be present in a
 * component and still be wrong in the assembly: a screen can pass a heading level
 * that changes the surface, mount two forms whose labels collide, or wire an
 * `aria-describedby` at a level the component never sees. Both properties run the
 * same two audits, so neither mounting has an audit of its own to drift from.
 *
 * No call is issued by any case: the direct mounts hand the forms a recording
 * `onSubmit`, the fixture's stubbed Squads_Api answers reads and leaves mutations
 * awaiting a response forever, and `fetch` and `XMLHttpRequest` are recorded for
 * the whole file and asserted untouched.
 *
 * Feature: web-squads-screens, Property 45: Every field is labelled and every validation message is associated
 * Validates: Requirements 3.1, 3.3, 4.1, 4.3, 12.1, 12.3, 19.9
 */
import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';

import type { Theme } from '../../../theme';
import {
  CREATOR_DISPLAY_NAME_LABEL,
  DISPLAY_NAME_REQUIRED_MESSAGE,
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  GENERIC_SQUADS_FAILURE,
  GUEST_DISPLAY_NAME_LABEL,
  GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
  INVITE_SECRET_LABEL,
  INVITE_SECRET_REQUIRED_MESSAGE,
  INVITE_VALIDITY_LABEL,
  JOIN_DISPLAY_NAME_LABEL,
  LAWFUL_BASIS_ACKNOWLEDGEMENT,
  LAWFUL_BASIS_REQUIRED_MESSAGE,
  SKILL_TIER_LABEL,
  SQUAD_NAME_LABEL,
  SQUAD_NAME_REQUIRED_MESSAGE,
  SQUAD_NAME_TOO_LONG_MESSAGE,
} from '../lib/messages';
import { redeemableValueFrom } from '../lib/inviteSecret';
import {
  NAME_MAX_LENGTH,
  validateDisplayName,
  validateSquadName,
} from '../lib/nameValidation';
import {
  FORM_PANEL_SELECTOR,
  GUEST_MEMBERSHIP_ID,
  INVITE_SUMMARIES,
  SQUAD_ID,
  THEMES,
  createStubApi,
  openCreateSquadForm,
  openGenerateInviteForm,
  openGuestCreateForm,
  openGuestEditForm,
  openJoinCodeForm,
  renderSquadScreenState,
  renderSquadsHomeState,
  resetTheme,
  type RenderedScreen,
} from '../testing/squadsScreenStates';
import { CreateSquadForm } from './CreateSquadForm';
import { GuestForm } from './GuestForm';
import { InviteManager, INVITE_ENTRY_SELECTOR } from './InviteManager';
import { JoinSquadForm } from './JoinSquadForm';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op — the block the
 * shared fixture's docblock documents, declared here because `vi.mock` is hoisted
 * per test file and the second property renders the Squad_Screen.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

// --- The forms of the feature -------------------------------------------------

/** Every form of the feature, named as the tasks and the design name them. */
type FormName =
  | 'create-squad'
  | 'join-code'
  | 'guest-create'
  | 'guest-edit'
  | 'invite-generator';

const FORM_NAMES: readonly FormName[] = [
  'create-squad',
  'join-code',
  'guest-create',
  'guest-edit',
  'invite-generator',
];

/**
 * The Player_Display_Name the Guest_Form's edit mode opens prefilled with, taken
 * from the fixture's guest membership so the two describe the same guest.
 */
const EDIT_PREFILL = 'Dave';

/**
 * The label of every field each form renders, and nothing else.
 *
 * Stated as a set rather than checked field by field, so a form that *added* an
 * unlabelled control — or dropped a field altogether — fails as loudly as one
 * that mislabelled a field it still renders.
 */
const EXPECTED_FIELD_LABELS: Readonly<Record<FormName, readonly string[]>> = {
  // 3.1: the Squad_Name and the creator's Player_Display_Name.
  'create-squad': [SQUAD_NAME_LABEL, CREATOR_DISPLAY_NAME_LABEL],
  // 4.1: the Invite_Secret, and the optional Player_Display_Name.
  'join-code': [INVITE_SECRET_LABEL, JOIN_DISPLAY_NAME_LABEL],
  // 12.1: the display name, the Skill_Tier selection, and the acknowledgement.
  'guest-create': [
    GUEST_DISPLAY_NAME_LABEL,
    SKILL_TIER_LABEL,
    LAWFUL_BASIS_ACKNOWLEDGEMENT,
  ],
  // 12.8: an edit renders no acknowledgement control at all.
  'guest-edit': [GUEST_DISPLAY_NAME_LABEL, SKILL_TIER_LABEL],
  // 11.5: the one decision the generator offers.
  'invite-generator': [INVITE_VALIDITY_LABEL],
};

/** Which text field of a form the first and second generated values go to. */
const TEXT_FIELD_LABELS: Readonly<Record<FormName, readonly string[]>> = {
  'create-squad': [SQUAD_NAME_LABEL, CREATOR_DISPLAY_NAME_LABEL],
  'join-code': [INVITE_SECRET_LABEL, JOIN_DISPLAY_NAME_LABEL],
  'guest-create': [GUEST_DISPLAY_NAME_LABEL],
  'guest-edit': [GUEST_DISPLAY_NAME_LABEL],
  'invite-generator': [],
};

/**
 * Every message the feature renders *on a field*, so a rendered one can be
 * recognised without depending on a class name or a test id.
 *
 * Every one of them is a fixed string from `lib/messages.ts` taking no
 * interpolation parameter, which is why an exact text match identifies them.
 */
const FIELD_VALIDATION_MESSAGES: ReadonlySet<string> = new Set([
  SQUAD_NAME_REQUIRED_MESSAGE,
  SQUAD_NAME_TOO_LONG_MESSAGE,
  DISPLAY_NAME_REQUIRED_MESSAGE,
  DISPLAY_NAME_TOO_LONG_MESSAGE,
  INVITE_SECRET_REQUIRED_MESSAGE,
  GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
  LAWFUL_BASIS_REQUIRED_MESSAGE,
]);

// --- The generated case -------------------------------------------------------

/**
 * The entered value space, stratified by the shapes the rules distinguish rather
 * than left to an unweighted string generator.
 *
 * Every rejection the forms can reach is a *named* stratum here, so each is
 * sampled often enough for the coverage guard at the end of each property to hold
 * without depending on luck: an unstratified string arbitrary reaches "exactly 101
 * code units after trimming" about never.
 *
 * | Stratum | Why it exists |
 * | --- | --- |
 * | `arbitrary` | anything at all, including values these strata did not anticipate |
 * | `valid`, `padded-valid` | accepted, the second only because trimming happens first |
 * | `empty`, `whitespace` | the empty-after-trimming rejection (Requirements 3.3, 4.3, 12.2) |
 * | `at-bound`, `padded-at-bound` | the accepted boundary: exactly {@link NAME_MAX_LENGTH} after trimming |
 * | `over-bound`, `far-over-bound`, `padded-over-bound` | the rejected side of that boundary |
 * | `astral-over-bound` | 100 graphemes in 200 code units — rejected here exactly as the backend's column rejects it |
 * | `invite-link`, `invite-link-empty-segment`, `invite-code` | the Join_Code_Form derives its value through `redeemableValueFrom`, so a link is a different input from the code it carries |
 */
const VALUE_STRATA: Readonly<Record<string, fc.Arbitrary<string>>> = {
  arbitrary: fc.string({ minLength: 0, maxLength: 20, unit: 'grapheme' }),
  valid: fc
    .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
    .map((value) => `Sunday ${value}`),
  'padded-valid': fc
    .string({ minLength: 1, maxLength: 12, unit: 'grapheme' })
    .map((value) => `  Sunday ${value}\t`),
  empty: fc.constant(''),
  whitespace: fc.constantFrom(' ', '\t\t', '   \t  '),
  'at-bound': fc.constant('a'.repeat(NAME_MAX_LENGTH)),
  'padded-at-bound': fc.constant(`   ${'b'.repeat(NAME_MAX_LENGTH)}   `),
  'over-bound': fc.constant('a'.repeat(NAME_MAX_LENGTH + 1)),
  'padded-over-bound': fc.constant(`   ${'b'.repeat(NAME_MAX_LENGTH + 1)}   `),
  'far-over-bound': fc.constant('a'.repeat(NAME_MAX_LENGTH * 2)),
  'astral-over-bound': fc.constant('⚽'.repeat(NAME_MAX_LENGTH)),
  'invite-link': fc.constantFrom(
    'https://pitch-mate.co.uk/join/abc123',
    'https://pitch-mate.co.uk/join/%E2%9A%BD',
    'pitch-mate.co.uk/join/abc123',
  ),
  'invite-link-empty-segment': fc.constantFrom(
    'https://pitch-mate.co.uk/join/',
    'https://pitch-mate.co.uk/join/   ',
  ),
  'invite-code': fc.constant('PITCHM8'),
};

const enteredValueArb: fc.Arbitrary<string> = fc
  .constantFrom(...Object.keys(VALUE_STRATA))
  .chain((stratum) => VALUE_STRATA[stratum]);

/** One generated case: what was entered into a form, and what happened next. */
interface FormCase {
  /** The value put into the form's first text field, where it has one. */
  readonly first: string;
  /** The value put into the form's second text field, where it has one. */
  readonly second: string;
  /** Whether the Lawful_Basis_Acknowledgement was given (Requirement 12.3). */
  readonly acknowledged: boolean;
  /** Which option of the form's selection was chosen, taken modulo its length. */
  readonly optionChoice: number;
  /** Whether the form was submitted, so a rejection has been reached. */
  readonly submitted: boolean;
  /** Whether a backend-caused outcome message is rendered alongside the fields. */
  readonly outcomeReported: boolean;
}

const formCaseArb: fc.Arbitrary<FormCase> = fc.record({
  first: enteredValueArb,
  second: enteredValueArb,
  acknowledged: fc.boolean(),
  optionChoice: fc.integer({ min: 0, max: 11 }),
  // Weighted towards a submission, because a form that was never submitted has
  // rejected nothing and so exercises only the labelling half of the property.
  submitted: fc.oneof(
    { weight: 3, arbitrary: fc.constant(true) },
    { weight: 1, arbitrary: fc.constant(false) },
  ),
  outcomeReported: fc.boolean(),
});

/**
 * Every field message each form can render — the set the coverage guard requires a
 * property run to have reached.
 *
 * Without it, a property whose generated values never produced a rejection would
 * pass while asserting nothing about association: the message set would be empty
 * every time, and empty equals empty.
 */
const POSSIBLE_MESSAGES: Readonly<Record<FormName, readonly string[]>> = {
  'create-squad': [
    SQUAD_NAME_REQUIRED_MESSAGE,
    SQUAD_NAME_TOO_LONG_MESSAGE,
    DISPLAY_NAME_REQUIRED_MESSAGE,
    DISPLAY_NAME_TOO_LONG_MESSAGE,
  ],
  // 4.2: the display name is optional here, so it has no required message.
  'join-code': [INVITE_SECRET_REQUIRED_MESSAGE, DISPLAY_NAME_TOO_LONG_MESSAGE],
  'guest-create': [
    GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
    DISPLAY_NAME_TOO_LONG_MESSAGE,
    LAWFUL_BASIS_REQUIRED_MESSAGE,
  ],
  // 12.8: an edit renders no acknowledgement control, so it has no such message.
  'guest-edit': [
    GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
    DISPLAY_NAME_TOO_LONG_MESSAGE,
  ],
  'invite-generator': [],
};

/** One generated case for the forms opened through the real screens. */
interface ScreenFormCase {
  readonly form: FormName;
  readonly theme: Theme;
  readonly submitted: boolean;
}

const screenFormCaseArb: fc.Arbitrary<ScreenFormCase> = fc.record({
  form: fc.constantFrom(...FORM_NAMES),
  theme: fc.constantFrom(...THEMES),
  submitted: fc.boolean(),
});

// --- No call is issued anywhere in this file ----------------------------------

const originalFetch = globalThis.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;
let recordedCalls: string[] = [];

globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  recordedCalls.push(`fetch ${String(args[0])}`);
  return Promise.reject(new Error('No call is expected from a form under test.'));
}) as typeof fetch;

XMLHttpRequest.prototype.open = function open(
  ...args: Parameters<XMLHttpRequest['open']>
): void {
  recordedCalls.push(`xhr ${String(args[0])} ${String(args[1])}`);
};

beforeEach(() => {
  recordedCalls = [];
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  XMLHttpRequest.prototype.open = originalXhrOpen;
});

// --- Reading the rendered surface ---------------------------------------------

/** A field control: anything a label can name and a person can enter a value in. */
type FieldControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * Every field control of a surface — deliberately *not* a list of the ones the
 * form was expected to render, so an unlabelled extra control is found rather
 * than skipped. Buttons are excluded: they carry their own name as content.
 */
const FIELD_CONTROL_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
  'select',
  'textarea',
].join(', ');

function fieldControls(surface: HTMLElement): FieldControl[] {
  return Array.from(surface.querySelectorAll<FieldControl>(FIELD_CONTROL_SELECTOR));
}

/** The `<label>` elements that claim this control, through `for` or by wrapping it. */
function labelsOf(control: FieldControl): HTMLLabelElement[] {
  return Array.from(control.labels ?? []);
}

/** The one open Form_Panel of the tree, failing where there is not exactly one. */
function openPanel(container: HTMLElement): HTMLElement {
  const panels = container.querySelectorAll<HTMLElement>(FORM_PANEL_SELECTOR);
  expect(panels).toHaveLength(1);

  return panels[0];
}

/** The submit control of an open panel. */
function submitControl(surface: HTMLElement): HTMLElement {
  const control = surface.querySelector<HTMLElement>('button[type="submit"]');
  expect(control).not.toBeNull();

  return control as HTMLElement;
}

/** A keyboard and pointer driver with no artificial delay, so the runs stay quick. */
function formUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

/**
 * Classes that hide an element from sight while leaving it in the accessibility
 * tree — the usual way a "label" stops being a *visible* one.
 */
const VISUALLY_HIDDEN_CLASS = /(^|\s|-|_)(sr-only|visually-hidden|screen-reader|hidden)(\s|$)/;

/**
 * Why `element` is not visible, or `null` when it is — walking up to `boundary`,
 * because an ancestor is where a label is usually hidden from.
 *
 * Returned as a sentence rather than a boolean so a failure names what hid the
 * label. jsdom resolves the feature's real stylesheets (the suite runs with CSS
 * processing on), so a class-based `display: none` is caught here as well as an
 * inline one.
 */
function hiddenReason(element: HTMLElement, boundary: HTMLElement): string | null {
  let node: HTMLElement | null = element;

  while (node !== null) {
    const where = `${node.tagName.toLowerCase()}.${String(node.className)}`;

    if (node.hasAttribute('hidden')) {
      return `${where} carries the hidden attribute`;
    }
    if (node.getAttribute('aria-hidden') === 'true') {
      return `${where} is aria-hidden`;
    }

    const style = getComputedStyle(node);

    if (style.display === 'none') {
      return `${where} is display:none`;
    }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') {
      return `${where} is visibility:${style.visibility}`;
    }
    if (style.opacity === '0') {
      return `${where} is opacity:0`;
    }
    if (VISUALLY_HIDDEN_CLASS.test(String(node.className))) {
      return `${where} carries a visually-hidden class`;
    }
    if (style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') {
      return `${where} is clipped away`;
    }

    if (node === boundary) {
      break;
    }

    node = node.parentElement;
  }

  return null;
}

// --- The audits ---------------------------------------------------------------

/**
 * Requirements 3.1, 4.1, 12.1, and the first half of 19.9: every field of the
 * surface carries a persistently visible label programmatically associated with
 * it, and the surface carries no field beyond the ones expected.
 *
 * "Programmatically associated" is asserted from both ends: exactly one `<label>`
 * claims the control, *and* the control is what that label's text resolves to
 * through the accessibility tree. "Persistently visible" is asserted by calling
 * this at each stage of a case — opened, filled in, submitted — and by requiring
 * the label to be a visible element rather than an `aria-label` or a placeholder,
 * both of which would satisfy the association alone.
 */
function auditFieldLabelling(
  surface: HTMLElement,
  expectedLabels: readonly string[],
  stage: string,
): void {
  const controls = fieldControls(surface);

  const renderedLabels = controls.map((control) => {
    const labels = labelsOf(control);

    // Exactly one: a control with none is unlabelled, and a control with two has
    // no single label a person can rely on.
    expect(
      labels.length,
      `${stage}: ${control.tagName.toLowerCase()}[name=${String(control.getAttribute('name'))}] should have exactly one label`,
    ).toBe(1);

    const label = labels[0];
    const text = (label.textContent ?? '').trim();

    expect(text, `${stage}: a label should state something`).not.toBe('');
    expect(
      hiddenReason(label, surface),
      `${stage}: the label "${text}" should be visible`,
    ).toBeNull();

    // The association must be the label's, not an override: an `aria-label` or an
    // `aria-labelledby` would name the control something a sighted person cannot
    // see, and a placeholder would vanish as soon as a value was entered.
    expect(control.getAttribute('aria-label')).toBeNull();
    expect(control.getAttribute('aria-labelledby')).toBeNull();

    // And read back from the accessibility tree: the visible text is what names
    // this control, rather than merely sitting next to it.
    expect(within(surface).getAllByLabelText(text)).toContain(control);

    return text;
  });

  expect([...renderedLabels].sort()).toEqual([...expectedLabels].sort());
}

/**
 * The messages the surface is rendering *on a field*, as leaf elements.
 *
 * Recognised by their text, which is exact because every one of them is a fixed
 * string. Leaf elements only, so the panel that contains a message is not counted
 * as a second copy of it.
 */
function fieldMessageElements(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>('*')).filter(
    (node) =>
      node.children.length === 0 &&
      FIELD_VALIDATION_MESSAGES.has((node.textContent ?? '').trim()),
  );
}

/**
 * Requirements 3.3, 4.3, 12.3, and the second half of 19.9: the rendered
 * validation messages are exactly the ones the rules predict, and each one is
 * programmatically associated with the field it concerns — and with no other.
 *
 * @param expected message text → the visible label of the field it concerns
 */
function auditValidationAssociation(
  surface: HTMLElement,
  expected: ReadonlyMap<string, string>,
  stage: string,
): void {
  const messages = fieldMessageElements(surface);

  expect(
    messages.map((node) => (node.textContent ?? '').trim()).sort(),
    `${stage}: the rendered validation messages`,
  ).toEqual([...expected.keys()].sort());

  const controls = fieldControls(surface);
  const offendingLabels = new Set(expected.values());

  for (const message of messages) {
    const text = (message.textContent ?? '').trim();

    // A message with no id cannot be referenced, however it is positioned.
    expect(message.id, `${stage}: "${text}" should carry an id`).not.toBe('');

    // A field message is not an announcement about the call: it belongs to the
    // field, not to the live region the outcomes use.
    expect(message.closest('[role="status"], [role="alert"]')).toBeNull();

    const describedControls = controls.filter((control) =>
      (control.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter((id) => id !== '')
        .includes(message.id),
    );

    expect(
      describedControls.length,
      `${stage}: exactly one field should be described by "${text}"`,
    ).toBe(1);

    const control = describedControls[0];
    const labels = labelsOf(control);
    expect(labels).toHaveLength(1);

    // The field it *concerns*, not merely a field: the described control's own
    // visible label is the one the rule that produced this message applies to.
    expect(
      (labels[0].textContent ?? '').trim(),
      `${stage}: "${text}" should describe its own field`,
    ).toBe(expected.get(text));

    // And the field reports itself invalid, so the association is conveyed as a
    // problem rather than as an incidental description.
    expect(control.getAttribute('aria-invalid')).toBe('true');
  }

  // Nothing is marked invalid that no message explains.
  for (const control of controls) {
    const label = (labelsOf(control)[0]?.textContent ?? '').trim();

    if (offendingLabels.has(label)) {
      continue;
    }

    expect(
      control.getAttribute('aria-invalid'),
      `${stage}: "${label}" has no message, so it is not invalid`,
    ).toBeNull();
  }
}

/**
 * Requirements 3.8, 3.9, 4.8, and 12.11: a message caused by the backend is an
 * *outcome*, announced in the surface's live region and associated with no field.
 *
 * This is what keeps the association clause meaningful. Without it, a form could
 * satisfy "every validation message is associated with a field" by attaching
 * everything it renders — including a rejection the person cannot act on by
 * editing — to whichever field looked closest.
 */
function auditOutcomeSeparation(
  surface: HTMLElement,
  outcomeMessage: string | null,
  stage: string,
): void {
  const regions = Array.from(
    surface.querySelectorAll<HTMLElement>('[role="status"], [role="alert"]'),
  );
  expect(regions, `${stage}: one outcome region`).toHaveLength(1);

  const region = regions[0];
  expect((region.textContent ?? '').trim()).toBe(outcomeMessage ?? '');

  for (const control of fieldControls(surface)) {
    const described = (control.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((id) => id !== '');

    expect(
      described,
      `${stage}: no field is described by the outcome region`,
    ).not.toContain(region.id);
  }
}

/** Requirement 19.8's sibling clause here: no case reaches the network. */
function expectNoCallIssued(): void {
  expect(recordedCalls).toEqual([]);
}

// --- The expected messages, computed from the production rules ----------------

/** What a Squad_Name field holding `value` is messaged with, if anything. */
function squadNameMessage(value: string): string | null {
  const validated = validateSquadName(value);

  if (validated.ok) {
    return null;
  }

  return validated.reason === 'empty'
    ? SQUAD_NAME_REQUIRED_MESSAGE
    : SQUAD_NAME_TOO_LONG_MESSAGE;
}

/** What a required Player_Display_Name field holding `value` is messaged with. */
function requiredDisplayNameMessage(
  value: string,
  requiredMessage: string,
): string | null {
  const validated = validateDisplayName(value);

  if (validated.ok) {
    return null;
  }

  return validated.reason === 'empty'
    ? requiredMessage
    : DISPLAY_NAME_TOO_LONG_MESSAGE;
}

/**
 * The exact set of field messages a case must render, and the field each belongs
 * to — computed from the values the fields actually hold, through the same pure
 * functions the forms call.
 */
function expectedMessages(
  form: FormName,
  values: { readonly first: string; readonly second: string },
  acknowledged: boolean,
  submitted: boolean,
): ReadonlyMap<string, string> {
  const expected = new Map<string, string>();

  // Nothing has been rejected until a submission was attempted, so an unsubmitted
  // form renders no field message at all (Requirements 3.3, 4.3, 12.2).
  if (!submitted) {
    return expected;
  }

  const add = (message: string | null, label: string): void => {
    if (message !== null) {
      expected.set(message, label);
    }
  };

  switch (form) {
    case 'create-squad': {
      add(squadNameMessage(values.first), SQUAD_NAME_LABEL);
      add(
        requiredDisplayNameMessage(values.second, DISPLAY_NAME_REQUIRED_MESSAGE),
        CREATOR_DISPLAY_NAME_LABEL,
      );
      break;
    }
    case 'join-code': {
      // 4.3: the rule is about the *derived* redeemable value, not the field, so a
      // link whose final segment is empty is messaged like an empty field.
      if (redeemableValueFrom(values.first) === '') {
        expected.set(INVITE_SECRET_REQUIRED_MESSAGE, INVITE_SECRET_LABEL);
      }

      // 4.2: the display name is optional, so only the length bound can reject it.
      const trimmed = values.second.trim();
      if (trimmed !== '' && trimmed.length > NAME_MAX_LENGTH) {
        expected.set(DISPLAY_NAME_TOO_LONG_MESSAGE, JOIN_DISPLAY_NAME_LABEL);
      }
      break;
    }
    case 'guest-create': {
      add(
        requiredDisplayNameMessage(
          values.first,
          GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
        ),
        GUEST_DISPLAY_NAME_LABEL,
      );
      // 12.3: stated against the acknowledgement control itself.
      if (!acknowledged) {
        expected.set(LAWFUL_BASIS_REQUIRED_MESSAGE, LAWFUL_BASIS_ACKNOWLEDGEMENT);
      }
      break;
    }
    case 'guest-edit': {
      add(
        requiredDisplayNameMessage(
          values.first,
          GUEST_DISPLAY_NAME_REQUIRED_MESSAGE,
        ),
        GUEST_DISPLAY_NAME_LABEL,
      );
      break;
    }
    default: {
      // 11.5: the generator offers a selection and no value to reject.
      break;
    }
  }

  return expected;
}

// --- Entering the generated values -------------------------------------------

/**
 * Put `value` into a text field and hand back what the field then holds.
 *
 * `fireEvent.change` rather than typing: it bypasses the `maxlength` attribute,
 * which is the only way to reach the over-the-bound rule the forms apply on
 * submission, and it is unaffected by the `<input>`'s own value sanitisation
 * having removed a character — the field's value is read back rather than assumed.
 */
function enterValue(control: FieldControl, value: string): string {
  fireEvent.change(control, { target: { value } });

  return control.value;
}

/** The field of `surface` whose visible label is `label`. */
function fieldLabelled(surface: HTMLElement, label: string): FieldControl {
  const control = fieldControls(surface).find(
    (candidate) => (labelsOf(candidate)[0]?.textContent ?? '').trim() === label,
  );

  expect(control, `a field labelled "${label}"`).not.toBeUndefined();

  return control as FieldControl;
}

/**
 * Drive the generated values into the surface, and report what the text fields
 * then hold — which is what the expected messages are computed from.
 */
function enterGeneratedValues(
  surface: HTMLElement,
  form: FormName,
  testCase: FormCase,
): { readonly first: string; readonly second: string } {
  const textLabels = TEXT_FIELD_LABELS[form];
  const held = [testCase.first, testCase.second].map((value, index) => {
    const label = textLabels[index];

    return label === undefined
      ? ''
      : enterValue(fieldLabelled(surface, label), value);
  });

  // The selection: whichever option the case chose, so the rendered value of the
  // control varies rather than staying at the default in every run.
  const selects = surface.querySelectorAll<HTMLSelectElement>('select');
  for (const select of selects) {
    const option = select.options[testCase.optionChoice % select.options.length];
    fireEvent.change(select, { target: { value: option.value } });
  }

  // 12.3: the acknowledgement, which opens unselected in every case.
  const checkbox = surface.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (checkbox !== null && testCase.acknowledged) {
    fireEvent.click(checkbox);
  }

  return { first: held[0], second: held[1] };
}

// --- The direct mounting ------------------------------------------------------

interface HarnessProps {
  readonly form: FormName;
  readonly outcomeMessage: string | null;
  readonly onSubmit: () => void;
}

/**
 * The caller's half of a form: an opener to return focus to, and the props the
 * screens pass.
 *
 * The invite generator is mounted as its whole surface — the Invite_Manager owns
 * the panel, the selection, and the submission — because there is no smaller
 * component to mount, and mounting it is what makes the generator's field part of
 * this property rather than an exception to it.
 */
function FormHarness({ form, outcomeMessage, onSubmit }: HarnessProps): ReactElement {
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const close = useCallback((): void => setOpen(false), []);

  // Reads answered, and every mutation left awaiting a response forever, so a
  // submission of valid values changes nothing about what is rendered.
  const [api] = useState(() =>
    createStubApi({ invites: { kind: 'success', value: INVITE_SUMMARIES } }),
  );

  return (
    <div>
      <button type="button" ref={openerRef}>
        Open the form
      </button>
      {form === 'create-squad' ? (
        <CreateSquadForm
          open={open}
          openerRef={openerRef}
          onSubmit={onSubmit}
          onClose={close}
          outcomeMessage={outcomeMessage}
        />
      ) : null}
      {form === 'join-code' ? (
        <JoinSquadForm
          open={open}
          openerRef={openerRef}
          onSubmit={onSubmit}
          onClose={close}
          outcomeMessage={outcomeMessage}
        />
      ) : null}
      {form === 'guest-create' || form === 'guest-edit' ? (
        <GuestForm
          open={open}
          openerRef={openerRef}
          mode={
            form === 'guest-create'
              ? { kind: 'create' }
              : {
                  kind: 'edit',
                  membershipId: GUEST_MEMBERSHIP_ID,
                  displayName: EDIT_PREFILL,
                }
          }
          onSubmit={onSubmit}
          onClose={close}
          outcomeMessage={outcomeMessage}
        />
      ) : null}
      {form === 'invite-generator' ? (
        <InviteManager api={api} squadId={SQUAD_ID} />
      ) : null}
    </div>
  );
}

/**
 * Whether this form renders an outcome live region *inside* its panel.
 *
 * The invite generator's outcome region belongs to the Invite_Manager around the
 * panel rather than to the panel, so the separation audit is scoped to the four
 * forms whose live region is part of the surface under audit.
 */
function hasOwnOutcomeRegion(form: FormName): boolean {
  return form !== 'invite-generator';
}

// --- The property -------------------------------------------------------------

describe('Property 45 — every field is labelled and every validation message is associated', () => {
  describe.each(FORM_NAMES)('the %s form', (form) => {
    // Feature: web-squads-screens, Property 45: Every field is labelled and every validation message is associated
    // Validates: Requirements 3.1, 3.3, 4.1, 4.3, 12.1, 12.3, 19.9
    it('labels every field and associates every message with the field it concerns', async () => {
      /**
       * The messages this run actually rendered, so the property can state at the
       * end that it reached every rejection the form has — rather than passing on
       * a value space that happened to be acceptable throughout.
       */
      const reached = new Set<string>();

      await fc.assert(
        fc.asyncProperty(formCaseArb, async (testCase) => {
          const user = formUser();
          const onSubmit = vi.fn();
          const outcomeMessage = testCase.outcomeReported
            ? GENERIC_SQUADS_FAILURE
            : null;
          const { container } = render(
            <FormHarness
              form={form}
              outcomeMessage={outcomeMessage}
              onSubmit={onSubmit}
            />,
          );

          try {
            if (form === 'invite-generator') {
              // The generator's panel is opened the way a person opens it, once
              // its listing has settled.
              await waitFor(() => {
                expect(container.querySelector(INVITE_ENTRY_SELECTOR)).not.toBeNull();
              });
              await openGenerateInviteForm({ container, user });
            }

            const surface = openPanel(container);
            const expectedLabels = EXPECTED_FIELD_LABELS[form];

            // Freshly opened: every field labelled, and nothing yet rejected.
            auditFieldLabelling(surface, expectedLabels, 'opened');
            auditValidationAssociation(surface, new Map(), 'opened');

            const held = enterGeneratedValues(surface, form, testCase);

            // Entered: the labels are still there, which is the "persistently" of
            // "persistently visible" — a placeholder would have gone by now.
            auditFieldLabelling(surface, expectedLabels, 'entered');

            if (testCase.submitted) {
              await user.click(submitControl(surface));
            }

            const stage = testCase.submitted ? 'submitted' : 'not submitted';
            const expected = expectedMessages(
              form,
              held,
              testCase.acknowledged,
              testCase.submitted,
            );
            for (const message of expected.keys()) {
              reached.add(message);
            }

            auditFieldLabelling(surface, expectedLabels, stage);
            auditValidationAssociation(surface, expected, stage);

            if (hasOwnOutcomeRegion(form)) {
              auditOutcomeSeparation(surface, outcomeMessage, stage);
            }

            expectNoCallIssued();
          } finally {
            cleanup();
          }
        }),
        { numRuns: 100 },
      );

      // Every rejection this form can reach was reached, so the association half
      // of the property was exercised rather than trivially satisfied.
      expect([...reached].sort()).toEqual([...POSSIBLE_MESSAGES[form]].sort());
    }, 300_000);
  });

  // Feature: web-squads-screens, Property 45: Every field is labelled and every validation message is associated
  // Validates: Requirements 3.1, 3.3, 4.1, 4.3, 12.1, 12.3, 19.9
  it('holds for every form as the screens open it, in either theme', async () => {
    await fc.assert(
      fc.asyncProperty(screenFormCaseArb, async (testCase) => {
        const rendered = await openThroughScreen(testCase);

        try {
          const surface = openPanel(rendered.container);
          const expectedLabels = EXPECTED_FIELD_LABELS[testCase.form];

          auditFieldLabelling(surface, expectedLabels, 'opened by a person');
          auditValidationAssociation(surface, new Map(), 'opened by a person');

          if (testCase.submitted && testCase.form !== 'invite-generator') {
            // 12.8: the edit mode opens prefilled with an acceptable name, so the
            // rejection it is submitted for has to be entered.
            if (testCase.form === 'guest-edit') {
              enterValue(fieldLabelled(surface, GUEST_DISPLAY_NAME_LABEL), '');
            }

            await rendered.user.click(submitControl(surface));

            // Every field of the submitted form is empty — the Guest_Form's
            // prefill having just been cleared — and the acknowledgement is
            // unselected, so each form's own required-value rules are the ones
            // reached (Requirements 3.3, 4.3, 12.3).
            auditFieldLabelling(surface, expectedLabels, 'submitted by a person');
            auditValidationAssociation(
              surface,
              expectedMessages(testCase.form, { first: '', second: '' }, false, true),
              'submitted by a person',
            );
            auditOutcomeSeparation(surface, null, 'submitted by a person');
          }

          expectNoCallIssued();
        } finally {
          cleanup();
          resetTheme();
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);
});

/** Open one form the way a person opens it: through the screen that owns it. */
async function openThroughScreen(testCase: ScreenFormCase): Promise<RenderedScreen> {
  if (testCase.form === 'create-squad' || testCase.form === 'join-code') {
    const rendered = await renderSquadsHomeState('listed', testCase.theme);

    if (testCase.form === 'create-squad') {
      await openCreateSquadForm(rendered);
    } else {
      await openJoinCodeForm(rendered);
    }

    return rendered;
  }

  // The three admin forms, which need a caller holding Admin_Authority.
  const rendered = await renderSquadScreenState('admin', testCase.theme);

  if (testCase.form === 'guest-create') {
    await openGuestCreateForm(rendered);
  } else if (testCase.form === 'guest-edit') {
    await openGuestEditForm(rendered);
  } else {
    await openGenerateInviteForm(rendered);
  }

  return rendered;
}
