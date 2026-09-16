/**
 * Property test for the Placeholder_Sections of the Squad_Screen (task 9.4).
 *
 * **Property 33: A placeholder section renders its heading, and its slot
 * replaces only its statement.** *For any* injected content value and for its
 * absence, each Placeholder_Section renders exactly one level-two heading naming
 * its subject, renders the injected content in place of its text statement when
 * content is supplied and the statement otherwise, renders no level-one heading,
 * and renders no error indication.
 *
 * That is the whole of Requirement 15's rendering contract:
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 15.1 — exactly one `h2` naming the subject | {@link expectHeadingIsRendered} |
 * | 15.2 — the statement while nothing is injected, and no error indication | {@link expectStatementRendered}, {@link expectNoErrorIndication} |
 * | 15.3 — the body is an injected value the component never sources | the `content` generator |
 * | 15.4 — an injected body replaces the statement, heading kept | {@link expectContentRendered} |
 * | 15.6 — no level-one heading inside the section | {@link expectNoLevelOneHeading} |
 * | 15.5 — no call is issued | {@link expectNoCallIssued} |
 *
 * ### What is generated
 *
 * 1. **Which section.** Both of them: the matches section and the stats section,
 *    each carrying its own fixed statement imported from `lib/messages.ts` — the
 *    production copy, not a restatement (Requirement 15.2). The heading text is
 *    supplied by the Squad_Screen rather than by the component, so it is
 *    generated too: the two subjects the screen will use, plus arbitrary safe
 *    headings, so "the heading is rendered verbatim" is checked against more than
 *    two strings.
 * 2. **The content slot.** Every way of being absent — the prop omitted,
 *    `undefined`, `null`, `true`, and `false`, none of which React renders — and
 *    a spread of supplied bodies: an element, a bare string, a number, a
 *    fragment, an array of nodes, and a body carrying its own level-three
 *    heading and a focusable control. Each supplied body contains
 *    {@link INJECTED_MARKER}, so "the content is rendered" and "no content is
 *    rendered" are one lookup either way.
 *
 * ### Why the absent forms are quantified over rather than assumed
 *
 * `content?: ReactNode` admits `undefined`, `null`, and a boolean, and React
 * renders nothing for any of them. A component that tested only `!== undefined`
 * would render a heading and an empty space for `null` — a section with nothing
 * to say and no statement saying so. The generator makes all five absent forms
 * one equivalence class, which is exactly the claim.
 *
 * ### No call, checked rather than reasoned about
 *
 * Requirement 15.5 says no match or leaderboard call comes from these sections.
 * `fetch` and `XMLHttpRequest.prototype.open` are recorded for the whole file and
 * asserted untouched, so the claim rests on a measurement rather than on the
 * absence of an import.
 *
 * Feature: web-squads-screens, Property 33: A placeholder section renders its heading, and its slot replaces only its statement
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.6
 */
import { type ReactNode } from 'react';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import fc from 'fast-check';

import { PlaceholderSection } from './PlaceholderSection';
import {
  MATCHES_PLACEHOLDER_STATEMENT,
  STATS_PLACEHOLDER_STATEMENT,
} from '../lib/messages';

// --- The two sections --------------------------------------------------------

/** The fixed statements the Squad_Screen's two Placeholder_Sections carry. */
const SECTION_STATEMENTS: readonly string[] = [
  MATCHES_PLACEHOLDER_STATEMENT,
  STATS_PLACEHOLDER_STATEMENT,
];

/** The other section's statement — never rendered by the one under test. */
function otherStatement(statement: string): string {
  return statement === MATCHES_PLACEHOLDER_STATEMENT
    ? STATS_PLACEHOLDER_STATEMENT
    : MATCHES_PLACEHOLDER_STATEMENT;
}

// --- The injected bodies -----------------------------------------------------

/** Present in every supplied body and in none of the fixed copy. */
const INJECTED_MARKER = 'marker:injected-section-body';

/** How a slot can be absent. `'omitted'` leaves the optional prop unpassed. */
type AbsentForm = 'omitted' | 'undefined' | 'null' | 'true' | 'false';

/** A generated slot: either one of the absent forms or a renderable body. */
type SlotCase =
  | { readonly kind: 'absent'; readonly form: AbsentForm }
  | { readonly kind: 'supplied'; readonly label: string; readonly node: ReactNode };

const ABSENT_FORMS: readonly AbsentForm[] = [
  'omitted',
  'undefined',
  'null',
  'true',
  'false',
];

/** The `content` value each absent form passes. */
function absentValue(form: AbsentForm): ReactNode {
  switch (form) {
    case 'null':
      return null;
    case 'true':
      return true;
    case 'false':
      return false;
    // 'omitted' and 'undefined' both reach the component as `undefined`; the
    // difference is whether the prop is written at all, handled at render time.
    default:
      return undefined;
  }
}

/**
 * The supplied bodies. Each carries {@link INJECTED_MARKER}; none carries a
 * level-one heading or any error wording, so what the assertions detect is the
 * component's own output rather than something smuggled in through the slot.
 */
const SUPPLIED_BODIES: readonly { label: string; node: ReactNode }[] = [
  { label: 'element', node: <p>{INJECTED_MARKER}</p> },
  { label: 'string', node: INJECTED_MARKER },
  {
    label: 'fragment',
    node: (
      <>
        <span>{INJECTED_MARKER}</span>
      </>
    ),
  },
  {
    label: 'array',
    node: [
      <span key="one">{INJECTED_MARKER}</span>,
      <span key="two">Another node</span>,
    ],
  },
  {
    label: 'rich region',
    node: (
      <div>
        {/* A deeper heading is fine; only a level-one one is ruled out (15.6). */}
        <h3>Upcoming</h3>
        <p>{INJECTED_MARKER}</p>
        <button type="button">Open</button>
      </div>
    ),
  },
  {
    label: 'number and text',
    node: (
      <p>
        {12} {INJECTED_MARKER}
      </p>
    ),
  },
];

// --- Generators --------------------------------------------------------------

/** Wording that would frame an empty section as something going wrong. */
const ERROR_VOCABULARY =
  /\b(error|errors|failed|failure|fail|wrong|sorry|problem|unable|invalid|broken|oops|missing)\b/i;

/**
 * A section subject. The two the Squad_Screen will name, plus arbitrary
 * alphabetic headings — filtered only so a random string cannot itself introduce
 * the error wording {@link expectNoErrorIndication} looks for.
 */
const headingArb: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fc.constantFrom('Matches', 'Stats and leaderboards'), weight: 3 },
  {
    arbitrary: fc
      .string({ minLength: 1, maxLength: 40, unit: 'grapheme' })
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && !ERROR_VOCABULARY.test(value)),
    weight: 1,
  },
);

const slotArb: fc.Arbitrary<SlotCase> = fc.oneof(
  fc
    .constantFrom(...ABSENT_FORMS)
    .map((form) => ({ kind: 'absent', form }) as SlotCase),
  fc
    .constantFrom(...SUPPLIED_BODIES)
    .map((body) => ({ kind: 'supplied', ...body }) as SlotCase),
);

interface RenderCase {
  readonly heading: string;
  readonly emptyStatement: string;
  readonly slot: SlotCase;
}

const renderCaseArb: fc.Arbitrary<RenderCase> = fc.record({
  heading: headingArb,
  emptyStatement: fc.constantFrom(...SECTION_STATEMENTS),
  slot: slotArb,
});

// --- No call is issued anywhere in this file ---------------------------------

const originalFetch = globalThis.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;
let recordedCalls: string[] = [];

globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  recordedCalls.push(`fetch ${String(args[0])}`);
  return Promise.reject(new Error('No call is expected from a placeholder section.'));
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

// --- Rendering ---------------------------------------------------------------

function renderCase(testCase: RenderCase): HTMLElement {
  const { heading, emptyStatement, slot } = testCase;

  // The omitted form is a separate rendering on purpose: an optional prop left
  // unwritten and an explicit `undefined` must behave identically.
  const { container } =
    slot.kind === 'absent' && slot.form === 'omitted'
      ? render(
          <PlaceholderSection heading={heading} emptyStatement={emptyStatement} />,
        )
      : render(
          <PlaceholderSection
            heading={heading}
            emptyStatement={emptyStatement}
            content={slot.kind === 'absent' ? absentValue(slot.form) : slot.node}
          />,
        );

  return container;
}

/** The rendered section, found by its own accessible region rather than by class. */
function sectionOf(container: HTMLElement): HTMLElement {
  const section = container.querySelector<HTMLElement>('section');
  expect(section).not.toBeNull();
  return section as HTMLElement;
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirement 15.1: exactly one level-two heading, carrying the subject the
 * screen supplied, inside the section it introduces.
 */
function expectHeadingIsRendered(container: HTMLElement, heading: string): void {
  const section = sectionOf(container);
  const levelTwo = within(section).getAllByRole('heading', { level: 2 });

  expect(levelTwo).toHaveLength(1);
  expect(levelTwo[0].textContent).toBe(heading);
  // The heading also names the region, so it is announced by the words on screen.
  expect(section.getAttribute('aria-labelledby')).toBe(levelTwo[0].id);
}

/** Requirement 15.6: no level-one heading is rendered within the section. */
function expectNoLevelOneHeading(container: HTMLElement): void {
  expect(
    within(sectionOf(container)).queryAllByRole('heading', { level: 1 }),
  ).toEqual([]);
  expect(container.querySelector('h1')).toBeNull();
}

/** Requirement 15.2: the statement stands while nothing is injected. */
function expectStatementRendered(container: HTMLElement, statement: string): void {
  const section = sectionOf(container);

  expect(within(section).getByText(statement)).toBeInTheDocument();
  expect(within(section).queryByText(INJECTED_MARKER)).toBeNull();
  // The other section's copy never appears in this one.
  expect(within(section).queryByText(otherStatement(statement))).toBeNull();
}

/**
 * Requirement 15.4: an injected body replaces the statement — and only the
 * statement, the heading having already been asserted by
 * {@link expectHeadingIsRendered}.
 */
function expectContentRendered(container: HTMLElement, statement: string): void {
  const section = sectionOf(container);

  expect(section.textContent).toContain(INJECTED_MARKER);
  expect(within(section).queryByText(statement)).toBeNull();
  expect(within(section).queryByText(otherStatement(statement))).toBeNull();
}

/**
 * Requirement 15.2: no error indication — not as a role, not as an announcement,
 * not as an attribute, and not as wording.
 */
function expectNoErrorIndication(container: HTMLElement): void {
  const section = sectionOf(container);

  expect(within(section).queryByRole('alert')).toBeNull();
  expect(section.querySelector('[aria-live]')).toBeNull();
  expect(section.querySelector('[role="status"]')).toBeNull();
  expect(section.querySelector('[role="alert"]')).toBeNull();
  expect(section.querySelector('[aria-invalid]')).toBeNull();
  expect(section.querySelector('[aria-errormessage]')).toBeNull();
  expect(section.textContent ?? '').not.toMatch(ERROR_VOCABULARY);
}

/** Requirement 15.5: the section issues no call of any kind. */
function expectNoCallIssued(): void {
  expect(recordedCalls).toEqual([]);
}

// --- The property ------------------------------------------------------------

describe('Property 33 — a placeholder section renders its heading, and its slot replaces only its statement', () => {
  // Feature: web-squads-screens, Property 33: A placeholder section renders its heading, and its slot replaces only its statement
  // Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.6
  it('renders the heading always, and the injected content in place of the statement alone', () => {
    fc.assert(
      fc.property(renderCaseArb, (testCase) => {
        const container = renderCase(testCase);
        try {
          expectHeadingIsRendered(container, testCase.heading);
          expectNoLevelOneHeading(container);
          expectNoErrorIndication(container);

          if (testCase.slot.kind === 'supplied') {
            expectContentRendered(container, testCase.emptyStatement);
          } else {
            expectStatementRendered(container, testCase.emptyStatement);
          }

          expectNoCallIssued();
        } finally {
          cleanup();
        }
      }),
      { numRuns: 300 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 33: A placeholder section renders its heading, and its slot replaces only its statement
  // Validates: Requirements 15.2, 15.3, 15.4
  it('treats every non-renderable slot value as an absent slot', () => {
    fc.assert(
      fc.property(
        headingArb,
        fc.constantFrom(...SECTION_STATEMENTS),
        (heading, statement) => {
          // The whole equivalence class in one iteration: each absent form shows
          // the statement, each supplied body hides it, checked as a set rather
          // than one form at a time.
          const statementShownFor = [
            ...ABSENT_FORMS.map((form) => ({
              label: `absent:${form}`,
              slot: { kind: 'absent', form } as SlotCase,
            })),
            ...SUPPLIED_BODIES.map((body) => ({
              label: `supplied:${body.label}`,
              slot: { kind: 'supplied', ...body } as SlotCase,
            })),
          ].filter(({ slot }) => {
            const container = renderCase({
              heading,
              emptyStatement: statement,
              slot,
            });
            try {
              // The heading survives either way (15.4).
              expectHeadingIsRendered(container, heading);
              return (
                within(sectionOf(container)).queryByText(statement) !== null
              );
            } finally {
              cleanup();
            }
          });

          expect(statementShownFor.map(({ label }) => label)).toEqual(
            ABSENT_FORMS.map((form) => `absent:${form}`),
          );
          expectNoCallIssued();
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
