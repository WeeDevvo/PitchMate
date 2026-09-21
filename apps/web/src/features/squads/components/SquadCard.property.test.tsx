/**
 * Property test for the Squad_Card's labelling (task 10.2).
 *
 * **Property 2: Every Squad_Card states name, role, and state in text,
 * including their absences.** *For any* parsed Squad_Summary, the Squad_Card
 * renders the Squad_Name, a text label naming the caller's Member_Role, and a
 * text label naming the caller's Membership_State; where the role is absent the
 * card states that no role is recorded and names no owner, admin, or member;
 * where the state is absent it states that no membership state is recorded and
 * names no active or inactive; and the card is exactly one keyboard-operable
 * control whose accessible name contains that squad's name.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 1.5 — name, a role label, and a state label, each in text | {@link expectNameIsStated}, {@link expectRoleIsLabelled}, {@link expectStateIsLabelled} |
 * | 1.6 — an absent role states its absence and names no role | {@link expectRoleIsLabelled} |
 * | 1.7 — an absent state states its absence and names no state | {@link expectStateIsLabelled} |
 * | 1.14 — exactly one keyboard-operable control, named by the squad | {@link expectExactlyOneKeyboardControl}, {@link expectNameIsStated} |
 * | 19.3 — the value is in the text, not in the colour | {@link expectValueIsConveyedInText} |
 *
 * ### The summaries are parsed, not hand-built
 *
 * The property quantifies over a *parsed* Squad_Summary, so every case here is
 * produced by handing a generated wire body to `parseSquadSummary` and rendering
 * what comes out. That keeps the generator honest about the one distinction that
 * matters for Requirements 1.6 and 1.7: the backend projects `membership?.Role`
 * and `membership?.State`, so a body may carry the field as a **code**, as
 * **`null`**, or **not at all**, and the parser makes the latter two the same
 * absence (16.8). A card asserted only against a hand-written `role: null` would
 * leave the missing-property path — the shape the backend actually serialises —
 * untested end to end. {@link describe} therefore also pins the two absent forms
 * as rendering byte-identical markup, so the equivalence cannot drift.
 *
 * ### Why names differing only in case are generated
 *
 * The Squad_Card order compares names case-insensitively (Requirement 1.3), which
 * makes a case-folded name an easy thing to leak into rendering — a card showing
 * `thursday ballers` for a squad named `Thursday Ballers`. The name generator
 * therefore weights a pool of pure case variants heavily and every assertion
 * matches the name **exactly**, so a card that lower-cased or title-cased its own
 * name fails rather than passes. A dedicated property renders a pair of
 * case-differing names side by side and asserts each states its own casing.
 *
 * ### Absence of a label is not the same as absence of a word
 *
 * "Renders no Member_Role label naming owner, admin, or member" is asserted two
 * ways: no element's text *is* one of those labels, and the card's whole text
 * does not *contain* one. The second catches a card that appends the absence
 * statement beside a role chip rather than in place of it. The generated names
 * are filtered so a squad cannot be called `Owner` and fail the check on its own
 * name; the fixed copy is safe by inspection, since `No membership state
 * recorded` does not contain `Member` and `Inactive` does not contain `Active`.
 *
 * Feature: web-squads-screens, Property 2: Every Squad_Card states name, role, and state in text
 * Validates: Requirements 1.5, 1.6, 1.7, 1.14, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import fc from 'fast-check';

import { SQUAD_CARD_SELECTOR, SquadCard } from './SquadCard';
import {
  codeFromMemberRole,
  codeFromMembershipState,
  type MemberRole,
  type MembershipStateValue,
} from '../lib/enumCodes';
import { parseSquadSummary, type SquadSummary } from '../lib/parse/squadSummary';
import {
  ACTIVE_STATE_LABEL,
  ADMIN_ROLE_LABEL,
  INACTIVE_STATE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
  NO_ROLE_RECORDED_LABEL,
  OWNER_ROLE_LABEL,
} from '../lib/messages';

// --- The labels under test ---------------------------------------------------

/** Every label a Member_Role can render as, including its recorded absence. */
const ROLE_LABELS: readonly string[] = [
  OWNER_ROLE_LABEL,
  ADMIN_ROLE_LABEL,
  MEMBER_ROLE_LABEL,
  NO_ROLE_RECORDED_LABEL,
];

/** Every label a Membership_State can render as, including its absence. */
const STATE_LABELS: readonly string[] = [
  ACTIVE_STATE_LABEL,
  INACTIVE_STATE_LABEL,
  NO_MEMBERSHIP_STATE_RECORDED_LABEL,
];

/** The label a named Member_Role must render as (Requirement 1.5). */
const LABEL_OF_ROLE: Readonly<Record<MemberRole, string>> = {
  owner: OWNER_ROLE_LABEL,
  admin: ADMIN_ROLE_LABEL,
  member: MEMBER_ROLE_LABEL,
};

/** The label a named Membership_State must render as (Requirement 1.5). */
const LABEL_OF_STATE: Readonly<Record<MembershipStateValue, string>> = {
  active: ACTIVE_STATE_LABEL,
  inactive: INACTIVE_STATE_LABEL,
};

// --- Generators --------------------------------------------------------------

/**
 * How a wire body carries an enum field: as its code, as `null`, or not at all.
 * The last two are the same parsed absence, and both are generated because only
 * one of them is the shape the backend serialises (Requirement 16.8).
 */
type FieldForm<T> =
  | { readonly kind: 'present'; readonly value: T }
  | { readonly kind: 'null' }
  | { readonly kind: 'absent' };

const NAMED_ROLES: readonly MemberRole[] = ['owner', 'admin', 'member'];
const NAMED_STATES: readonly MembershipStateValue[] = ['active', 'inactive'];

function formArb<T>(values: readonly T[]): fc.Arbitrary<FieldForm<T>> {
  return fc.oneof(
    {
      weight: 3,
      arbitrary: fc
        .constantFrom(...values)
        .map((value) => ({ kind: 'present', value }) as FieldForm<T>),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'null' } as FieldForm<T>) },
    { weight: 1, arbitrary: fc.constant({ kind: 'absent' } as FieldForm<T>) },
  );
}

/**
 * The same squad name in four castings. Weighted heavily so the "the card states
 * its own casing" claim is exercised on most runs rather than occasionally.
 */
const CASE_VARIANT_NAMES: readonly string[] = [
  'thursday ballers',
  'Thursday Ballers',
  'THURSDAY BALLERS',
  'ThUrSdAy BaLlErS',
];

/**
 * A Squad_Name. Free text on the wire, so arbitrary values are generated too —
 * restricted to letters, numbers, punctuation, and single interior spaces so that
 * the accessible name (which collapses whitespace) can be compared to the name
 * verbatim, and filtered so a squad cannot be *called* `Owner` or `Active` and
 * defeat the "no other label is rendered" checks on its own name.
 */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...CASE_VARIANT_NAMES) },
  {
    weight: 3,
    arbitrary: fc
      .string({ minLength: 1, maxLength: 40, unit: 'grapheme' })
      .map((value) => value.replace(/\s+/gu, ' ').trim())
      .filter(
        (value) =>
          value.length > 0 &&
          /^[\p{L}\p{N}\p{P} ]+$/u.test(value) &&
          ![...ROLE_LABELS, ...STATE_LABELS].some((label) =>
            value.includes(label),
          ),
      ),
  },
);

/** A well-formed squad identity, in either letter case. */
const squadIdArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  { weight: 1, arbitrary: fc.uuid().map((value) => value.toUpperCase()) },
);

interface SummaryCase {
  readonly squadId: string;
  readonly name: string;
  readonly role: FieldForm<MemberRole>;
  readonly state: FieldForm<MembershipStateValue>;
}

const summaryCaseArb: fc.Arbitrary<SummaryCase> = fc.record({
  squadId: squadIdArb,
  name: nameArb,
  role: formArb(NAMED_ROLES),
  state: formArb(NAMED_STATES),
});

// --- From a generated case to a parsed summary -------------------------------

/** The wire body a generated case describes, with absent fields left unwritten. */
function bodyOf(testCase: SummaryCase): Record<string, unknown> {
  const body: Record<string, unknown> = {
    squadId: testCase.squadId,
    name: testCase.name,
  };

  if (testCase.role.kind === 'present') {
    body.role = codeFromMemberRole(testCase.role.value);
  } else if (testCase.role.kind === 'null') {
    body.role = null;
  }

  if (testCase.state.kind === 'present') {
    body.state = codeFromMembershipState(testCase.state.value);
  } else if (testCase.state.kind === 'null') {
    body.state = null;
  }

  return body;
}

/**
 * The parsed Squad_Summary the property quantifies over. Parsing is asserted to
 * succeed rather than assumed, so a generator that wandered outside the accepted
 * wire shape reports itself instead of silently narrowing the property.
 */
function parsedSummaryOf(testCase: SummaryCase): SquadSummary {
  const body = bodyOf(testCase);
  const parsed = parseSquadSummary(body);

  if (!parsed.ok) {
    throw new Error(
      `the generated body must parse, but it did not: ${JSON.stringify(body)} — ${parsed.reason}`,
    );
  }

  return parsed.value;
}

/** The label the card must carry for a case's role (Requirements 1.5, 1.6). */
function expectedRoleLabel(role: FieldForm<MemberRole>): string {
  return role.kind === 'present' ? LABEL_OF_ROLE[role.value] : NO_ROLE_RECORDED_LABEL;
}

/** The label the card must carry for a case's state (Requirements 1.5, 1.7). */
function expectedStateLabel(state: FieldForm<MembershipStateValue>): string {
  return state.kind === 'present'
    ? LABEL_OF_STATE[state.value]
    : NO_MEMBERSHIP_STATE_RECORDED_LABEL;
}

// --- Rendering ---------------------------------------------------------------

/** The single Squad_Card element of a rendering. */
function cardOf(container: HTMLElement): HTMLElement {
  const cards = container.querySelectorAll<HTMLElement>(SQUAD_CARD_SELECTOR);

  expect(cards).toHaveLength(1);

  return cards[0];
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirements 1.5, 1.14: the Squad_Name is stated on the card, verbatim, and is
 * part of the control's own accessible name.
 */
function expectNameIsStated(card: HTMLElement, name: string): void {
  expect(within(card).getAllByText(name)).not.toHaveLength(0);
  expect(card).toHaveAccessibleName(expect.stringContaining(name));
}

/**
 * Requirement 1.14: the card is exactly one control, reachable and operable by
 * keyboard — a native button, enabled, and not removed from the tab order. The
 * card being the *only* focusable element rules out a nested control competing
 * with it for the name and the activation.
 */
function expectExactlyOneKeyboardControl(container: HTMLElement): void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
  );

  expect(focusable).toHaveLength(1);

  const card = focusable[0];
  expect(card.tagName).toBe('BUTTON');
  expect(card.getAttribute('type')).toBe('button');
  expect(card.hasAttribute('disabled')).toBe(false);
  expect(card.getAttribute('aria-disabled')).toBeNull();
  expect(card.tabIndex).toBeGreaterThanOrEqual(0);
  expect(card.matches(SQUAD_CARD_SELECTOR)).toBe(true);
}

/**
 * Requirement 19.3: the value is carried by the words of the label, not by its
 * colour — so the label's own text is exactly the label, it is not hidden from
 * assistive technology, and it reaches the control's accessible name.
 */
function expectValueIsConveyedInText(card: HTMLElement, label: string): void {
  const rendered = within(card).getAllByText(label);

  // Exactly one element states the value, so the label is not duplicated.
  expect(rendered).toHaveLength(1);
  expect(rendered[0].textContent?.trim()).toBe(label);
  expect(rendered[0].closest('[aria-hidden="true"]')).toBeNull();
  // Nothing rendered here leans on an inline colour, and the words are in the
  // accessible name, so the value survives with colour and CSS discarded.
  expect(rendered[0].hasAttribute('style')).toBe(false);
  expect(card).toHaveAccessibleName(expect.stringContaining(label));
}

/**
 * Requirements 1.5, 1.6: the role's own word where a role is carried, the
 * recorded-absence statement where none is, and in the latter case no label
 * naming owner, admin, or member anywhere on the card.
 */
function expectRoleIsLabelled(card: HTMLElement, expected: string): void {
  expectValueIsConveyedInText(card, expected);

  for (const label of ROLE_LABELS) {
    if (label === expected) {
      continue;
    }

    expect(within(card).queryAllByText(label)).toEqual([]);
    // Not beside the expected label either: the absence statement replaces the
    // role label rather than joining it.
    expect(card.textContent ?? '').not.toContain(label);
  }
}

/**
 * Requirements 1.5, 1.7: the state's own word where a state is carried, the
 * recorded-absence statement where none is, and in the latter case no label
 * naming active or inactive anywhere on the card.
 */
function expectStateIsLabelled(card: HTMLElement, expected: string): void {
  expectValueIsConveyedInText(card, expected);

  for (const label of STATE_LABELS) {
    if (label === expected) {
      continue;
    }

    expect(within(card).queryAllByText(label)).toEqual([]);
    expect(card.textContent ?? '').not.toContain(label);
  }
}

// --- The property ------------------------------------------------------------

describe('Property 2 — every Squad_Card states name, role, and state in text, including their absences', () => {
  // Feature: web-squads-screens, Property 2: Every Squad_Card states name, role, and state in text
  // Validates: Requirements 1.5, 1.6, 1.7, 1.14, 19.3
  it('states the name, the role, and the state, replacing an absent value with its recorded absence', () => {
    fc.assert(
      fc.property(summaryCaseArb, (testCase) => {
        const summary = parsedSummaryOf(testCase);
        const { container } = render(
          <SquadCard summary={summary} onOpen={vi.fn()} />,
        );

        try {
          const card = cardOf(container);

          expectExactlyOneKeyboardControl(container);
          expectNameIsStated(card, testCase.name);
          expectRoleIsLabelled(card, expectedRoleLabel(testCase.role));
          expectStateIsLabelled(card, expectedStateLabel(testCase.state));
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 2: Every Squad_Card states name, role, and state in text
  // Validates: Requirements 1.6, 1.7
  it('renders a null field and an absent field identically', () => {
    fc.assert(
      fc.property(squadIdArb, nameArb, (squadId, name) => {
        const markupFor = (role: FieldForm<MemberRole>, state: FieldForm<MembershipStateValue>) => {
          const { container } = render(
            <SquadCard
              summary={parsedSummaryOf({ squadId, name, role, state })}
              onOpen={vi.fn()}
            />,
          );

          try {
            return cardOf(container).innerHTML;
          } finally {
            cleanup();
          }
        };

        const nulled = { kind: 'null' } as const;
        const absent = { kind: 'absent' } as const;

        // Each field on its own, and both together: the parser makes `null` and
        // a missing property one absence, so the card cannot tell them apart.
        expect(markupFor(nulled, { kind: 'present', value: 'active' })).toBe(
          markupFor(absent, { kind: 'present', value: 'active' }),
        );
        expect(markupFor({ kind: 'present', value: 'owner' }, nulled)).toBe(
          markupFor({ kind: 'present', value: 'owner' }, absent),
        );
        expect(markupFor(nulled, nulled)).toBe(markupFor(absent, absent));
      }),
      { numRuns: 100 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 2: Every Squad_Card states name, role, and state in text
  // Validates: Requirements 1.5, 1.14
  it('states each name in its own casing, so two squads differing only in case stay distinguishable', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...CASE_VARIANT_NAMES), {
          minLength: 2,
          maxLength: 2,
        }),
        squadIdArb,
        squadIdArb,
        formArb(NAMED_ROLES),
        formArb(NAMED_STATES),
        ([firstName, secondName], firstId, secondId, role, state) => {
          const accessibleNames = [
            { squadId: firstId, name: firstName },
            { squadId: secondId, name: secondName },
          ].map(({ squadId, name }) => {
            const { container } = render(
              <SquadCard
                summary={parsedSummaryOf({ squadId, name, role, state })}
                onOpen={vi.fn()}
              />,
            );

            try {
              const card = cardOf(container);
              // The casing on the card is the casing on the wire (1.5).
              expect(within(card).getAllByText(name)).not.toHaveLength(0);
              return card.textContent ?? '';
            } finally {
              cleanup();
            }
          });

          // Two names differing only in case yield two distinguishable cards,
          // which a case-folded rendering would not (1.14).
          expect(accessibleNames[0]).not.toBe(accessibleNames[1]);
          expect(accessibleNames[0]).toContain(firstName);
          expect(accessibleNames[1]).toContain(secondName);
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
