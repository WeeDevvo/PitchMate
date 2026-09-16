/**
 * Property test for focus management across every surface of the Squads_Feature
 * (task 9.2).
 *
 * **Property 46: Focus enters an opened surface and returns to its opener.**
 * *For any* form or confirmation surface of the feature and the control that
 * opened it, opening the surface moves keyboard focus into it, closing or
 * dismissing it returns keyboard focus to that control, and pressing Escape while
 * focus is inside it closes the surface without issuing the call it would submit
 * and returns focus to that control.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 19.7 — focus moves *into* the opened surface | {@link expectFocusEnteredSurface} |
 * | 19.7 — focus returns to the control that opened it, on close *and* on dismissal | {@link expectFocusReturnedToOpener} |
 * | 19.8 — Escape closes the surface | the `'escape'` close path |
 * | 19.8 — Escape submits nothing, so no call is issued | {@link expectNothingSubmitted}, {@link expectNoCallIssued} |
 *
 * ### What is quantified over, and why each dimension exists
 *
 * 1. **Which surface.** Both surface components, carrying the heading and control
 *    labels of each of the feature's seven surfaces: the create-squad form, the
 *    join-with-a-code form, the guest form in its create and edit modes, the
 *    invite generator, and the revoke-invite and promote-to-admin confirmations.
 *    Every form and every confirmation of the feature renders through one of these
 *    two components, so quantifying over the two components with each caller's
 *    labels is quantifying over the feature's surfaces — there is no third place
 *    the behaviour could be implemented differently.
 * 2. **The heading level.** All four levels a surface may state, because the level
 *    changes which element the heading is and a focus effect that reached for "the
 *    heading" rather than for the first focusable element would pass at one level
 *    and fail at another.
 * 3. **The field and control composition.** Fifteen compositions in which *which
 *    element is first in document order* varies: a text field, a checkbox, a
 *    select, a textarea, a link, a `tabindex="0"` region, a read-only field, and
 *    an `aria-disabled` control each leading; a non-focusable statement or a
 *    `tabindex="-1"` region ahead of the first field; a `disabled` field ahead of
 *    an enabled one; and content holding no focusable control at all, where the
 *    expectation falls through to the surface's own first control. Without this
 *    dimension, "the first focusable element" and "the first field" are the same
 *    claim, and only one of them is the requirement.
 * 4. **Which opener.** Two to four openers reading alike — the shape the feature
 *    actually produces, where a revoke control is one of several identical ones
 *    down an invite list — plus a control before and after them. "Focus returned
 *    to the one that opened it" therefore has somewhere else it could plausibly
 *    have gone, and the assertion is an identity rather than a coincidence.
 * 5. **The close path.** All three: the surface's own dismiss control, Escape, and
 *    the caller closing the surface itself after a successful submission. The
 *    third is the path no surface is told about — the caller simply stops
 *    rendering it — and it is the one a focus implementation keyed on a close
 *    reason would silently miss.
 * 6. **Where Escape is pressed from.** The element focus entered on, and the
 *    dismiss control, so the Escape handler is exercised both at its target and
 *    through a bubble from a descendant.
 *
 * ### The fallback focus target
 *
 * Both surface components always render their own action row, so neither can ever
 * be a surface with *no* focusable control — which is exactly why each carries
 * `tabIndex={-1}` on its root, and why {@link useSurfaceFocus} falls back to that
 * root. The second property below reaches that branch the only way it can be
 * reached: a minimal surface built on the same production hook, with the same
 * `tabIndex={-1}` root the two components declare, holding generated content that
 * contains nothing focusable. It supplies markup only — the focus behaviour under
 * test is imported, not restated — and it deliberately implements no Escape
 * handling, because duplicating the handler here would test this file rather than
 * the feature.
 *
 * ### No call is issued
 *
 * Requirement 19.8's "without submitting it" is asserted twice over: the caller's
 * submit and confirm handlers are recorded and asserted untouched, and `fetch` and
 * `XMLHttpRequest.prototype.open` are recorded for the whole file and asserted
 * untouched, as the sibling `PlaceholderSection.property.test.tsx` does. The first
 * says the surface did not submit; the second says nothing reached the network by
 * any other route.
 *
 * Feature: web-squads-screens, Property 46: Focus enters an opened surface and returns to its opener
 * Validates: Requirements 19.7, 19.8
 */
import {
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';

import { CANCEL_LABEL } from '../lib/messages';
import { ConfirmDialog } from './ConfirmDialog';
import { FormPanel } from './FormPanel';
import {
  firstFocusableWithin,
  useSurfaceFocus,
  type SurfaceCloseReason,
  type SurfaceHeadingLevel,
} from './surfaceFocus';

// --- The surfaces of the feature ---------------------------------------------

/** A form surface: the heading, submit label, and opener wording it will carry. */
interface FormSurface {
  readonly kind: 'form-panel';
  readonly heading: string;
  readonly actionLabel: string;
  readonly openerLabel: string;
}

/** A confirmation surface, in the same shape so the two can be generated as one. */
interface ConfirmSurface {
  readonly kind: 'confirm-dialog';
  readonly heading: string;
  readonly actionLabel: string;
  readonly openerLabel: string;
}

type Surface = FormSurface | ConfirmSurface;

/**
 * Every form of the feature, as the screens that own them will configure the
 * Form_Panel. The wording is the caller's, which is why it is stated here rather
 * than imported: `lib/messages.ts` holds the fixed *copy* of the feature, and a
 * form's heading and submit label belong to the screen that opens it.
 */
const FORM_SURFACES: readonly FormSurface[] = [
  {
    kind: 'form-panel',
    heading: 'Create a squad',
    actionLabel: 'Create squad',
    openerLabel: 'Create a squad',
  },
  {
    kind: 'form-panel',
    heading: 'Join a squad with a code',
    actionLabel: 'Join squad',
    openerLabel: 'Join with a code',
  },
  {
    kind: 'form-panel',
    heading: 'Add a guest player',
    actionLabel: 'Add guest',
    openerLabel: 'Add a guest',
  },
  {
    kind: 'form-panel',
    heading: 'Edit guest player',
    actionLabel: 'Save changes',
    openerLabel: 'Edit guest',
  },
  {
    kind: 'form-panel',
    heading: 'Generate an invite link',
    actionLabel: 'Generate link',
    openerLabel: 'Generate an invite link',
  },
];

/** Every confirmation of the feature: revoking an invite, and promoting a member. */
const CONFIRM_SURFACES: readonly ConfirmSurface[] = [
  {
    kind: 'confirm-dialog',
    heading: 'Revoke this invite?',
    actionLabel: 'Revoke invite',
    openerLabel: 'Revoke',
  },
  {
    kind: 'confirm-dialog',
    heading: 'Promote this player to admin?',
    actionLabel: 'Promote to admin',
    openerLabel: 'Promote',
  },
];

// --- The compositions inside a surface ---------------------------------------

/**
 * A generated body for a surface: the fields of a form, or the statement of a
 * confirmation.
 *
 * `leadsWithFocusable` states independently of the production code which element
 * document order puts first: when it holds, the intended element carries
 * {@link FIRST_FOCUSABLE_ATTRIBUTE}; when it does not, the body contains nothing
 * focusable and focus is expected on the surface's own first control instead.
 */
interface Composition {
  readonly label: string;
  readonly leadsWithFocusable: boolean;
  readonly node: ReactNode;
}

/** Marks the element this file claims is the body's first focusable one. */
const FIRST_FOCUSABLE_ATTRIBUTE = 'data-first-focusable';

const firstFocusableProps = { [FIRST_FOCUSABLE_ATTRIBUTE]: 'true' } as const;

/**
 * The bodies. Each is valid as a form's fields and as a confirmation's statement,
 * so the same composition space applies to both surfaces and a divergence between
 * them would show up as a failure rather than as an untested gap.
 */
const COMPOSITIONS: readonly Composition[] = [
  {
    label: 'text field first',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-name">Squad name</label>
        <input id="surface-name" type="text" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'statement then text field',
    leadsWithFocusable: true,
    node: (
      <>
        <p>Give the squad a name your friends will recognise.</p>
        <label htmlFor="surface-name">Squad name</label>
        <input id="surface-name" type="text" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'checkbox first',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-ack">I have a lawful basis</label>
        <input id="surface-ack" type="checkbox" {...firstFocusableProps} />
        <label htmlFor="surface-guest">Display name</label>
        <input id="surface-guest" type="text" />
      </>
    ),
  },
  {
    label: 'select first',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-tier">Starting skill tier</label>
        <select id="surface-tier" {...firstFocusableProps} defaultValue="do-not-seed">
          <option value="do-not-seed">Do not seed</option>
          <option value="beginner">Beginner</option>
        </select>
      </>
    ),
  },
  {
    label: 'textarea first',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-note">Note</label>
        <textarea id="surface-note" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'link first',
    leadsWithFocusable: true,
    node: (
      <>
        <a href="#invite-terms" {...firstFocusableProps}>
          What an invite link shares
        </a>
        <label htmlFor="surface-uses">Maximum uses</label>
        <input id="surface-uses" type="text" />
      </>
    ),
  },
  {
    label: 'tabindex zero region first',
    leadsWithFocusable: true,
    node: (
      <>
        <div tabIndex={0} {...firstFocusableProps}>
          A focusable region
        </div>
        <label htmlFor="surface-name">Squad name</label>
        <input id="surface-name" type="text" />
      </>
    ),
  },
  {
    label: 'read-only field first',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-code">Invite code</label>
        {/* Read-only, not disabled: it can still hold focus, so it is still first. */}
        <input id="surface-code" type="text" readOnly value="ABC123" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'aria-disabled control first',
    leadsWithFocusable: true,
    node: (
      <>
        {/* `aria-disabled` keeps a control focusable, which is precisely why both
            surfaces mark a pending action that way rather than disabling it. */}
        <button type="button" aria-disabled="true" {...firstFocusableProps}>
          Copy link
        </button>
        <label htmlFor="surface-name">Squad name</label>
        <input id="surface-name" type="text" />
      </>
    ),
  },
  {
    label: 'disabled field before an enabled one',
    leadsWithFocusable: true,
    node: (
      <>
        <label htmlFor="surface-locked">Squad (locked)</label>
        <input id="surface-locked" type="text" disabled value="Sunday Ballers" />
        <label htmlFor="surface-guest">Display name</label>
        <input id="surface-guest" type="text" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'tabindex minus one region before a field',
    leadsWithFocusable: true,
    node: (
      <>
        {/* Programmatically focusable but not in the focus order, so skipped. */}
        <div tabIndex={-1}>An announced region</div>
        <label htmlFor="surface-name">Squad name</label>
        <input id="surface-name" type="text" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'heading and statement before a field',
    leadsWithFocusable: true,
    node: (
      <>
        <p>This cannot be undone.</p>
        <label htmlFor="surface-confirm">Type the squad name to confirm</label>
        <input id="surface-confirm" type="text" {...firstFocusableProps} />
      </>
    ),
  },
  {
    label: 'radio group first',
    leadsWithFocusable: true,
    node: (
      <fieldset>
        <legend>Starting skill tier</legend>
        <label htmlFor="surface-tier-beginner">Beginner</label>
        <input
          id="surface-tier-beginner"
          type="radio"
          name="surface-tier"
          {...firstFocusableProps}
        />
        <label htmlFor="surface-tier-strong">Strong</label>
        <input id="surface-tier-strong" type="radio" name="surface-tier" />
      </fieldset>
    ),
  },
  {
    label: 'statement only, nothing focusable',
    leadsWithFocusable: false,
    node: <p>This invite will stop working immediately.</p>,
  },
  {
    label: 'disabled control only, nothing focusable',
    leadsWithFocusable: false,
    node: (
      <>
        <p>Nothing here can be changed.</p>
        <button type="button" disabled>
          Copy link
        </button>
        <label htmlFor="surface-locked">Squad (locked)</label>
        <input id="surface-locked" type="text" disabled value="Sunday Ballers" />
      </>
    ),
  },
];

// --- Generators ---------------------------------------------------------------

/** How a surface came to be closed. */
type ClosePath = 'dismiss' | 'escape' | 'caller-close-after-submit';

const CLOSE_PATHS: readonly ClosePath[] = [
  'dismiss',
  'escape',
  'caller-close-after-submit',
];

/** Which element inside the surface Escape is pressed from. */
type EscapeOrigin = 'entry-element' | 'dismiss-control';

const ESCAPE_ORIGINS: readonly EscapeOrigin[] = ['entry-element', 'dismiss-control'];

/** Every surface of the feature, forms and confirmations as one space. */
const ALL_SURFACES: readonly Surface[] = [...FORM_SURFACES, ...CONFIRM_SURFACES];

interface SurfaceCase {
  readonly surface: Surface;
  readonly headingLevel: SurfaceHeadingLevel;
  readonly composition: Composition;
  readonly openerCount: number;
  readonly openerIndex: number;
  readonly closePath: ClosePath;
  readonly escapeOrigin: EscapeOrigin;
}

const HEADING_LEVELS: readonly SurfaceHeadingLevel[] = [2, 3, 4, 5];

const surfaceCaseArb: fc.Arbitrary<SurfaceCase> = fc
  .record({
    surface: fc.constantFrom(...ALL_SURFACES),
    headingLevel: fc.constantFrom(...HEADING_LEVELS),
    composition: fc.constantFrom(...COMPOSITIONS),
    // Several openers that read alike, as an invite list or a player list produces.
    openerCount: fc.integer({ min: 2, max: 4 }),
    closePath: fc.constantFrom(...CLOSE_PATHS),
    escapeOrigin: fc.constantFrom(...ESCAPE_ORIGINS),
  })
  .chain((partial) =>
    fc
      .integer({ min: 0, max: partial.openerCount - 1 })
      .map((openerIndex) => ({ ...partial, openerIndex })),
  );

/** Content for the fallback surface: every form of "nothing focusable in here". */
interface NonFocusableContent {
  readonly label: string;
  readonly node: ReactNode;
}

const NON_FOCUSABLE_CONTENTS: readonly NonFocusableContent[] = [
  { label: 'empty', node: null },
  { label: 'statement', node: <p>Nothing to do here.</p> },
  {
    label: 'disabled field',
    node: (
      <>
        <span>Locked</span>
        <input type="text" disabled aria-label="Locked field" value="Sunday Ballers" />
      </>
    ),
  },
  {
    label: 'disabled button',
    node: (
      <>
        <p>Waiting for something else.</p>
        <button type="button" disabled>
          Copy link
        </button>
      </>
    ),
  },
  {
    label: 'tabindex minus one region',
    node: <div tabIndex={-1}>An announced region with no controls</div>,
  },
];

const nonFocusableContentArb: fc.Arbitrary<NonFocusableContent> = fc.constantFrom(
  ...NON_FOCUSABLE_CONTENTS,
);

// --- No call is issued anywhere in this file ----------------------------------

const originalFetch = globalThis.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;
let recordedCalls: string[] = [];

globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
  recordedCalls.push(`fetch ${String(args[0])}`);
  return Promise.reject(new Error('No call is expected from a surface under test.'));
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

// --- The harness --------------------------------------------------------------

/** A keyboard and pointer driver with no artificial delay, so 200 runs stay quick. */
function surfaceUser(): UserEvent {
  return userEvent.setup({ delay: null });
}

/** The accessible name of the opener at `index`, unique so lookups are exact. */
function openerName(surface: Surface, index: number): string {
  return `${surface.openerLabel} ${index + 1}`;
}

interface HarnessProps {
  readonly testCase: SurfaceCase;
  readonly onAction: () => void;
  readonly onClose: (reason: SurfaceCloseReason) => void;
}

/**
 * A screen fragment shaped like the ones the feature will build: a control before
 * the openers, several openers that read alike, the surface, and a control after
 * them. Whichever opener was activated is the one whose ref the surface receives,
 * so nothing but the activation decides where focus returns.
 */
function Harness({ testCase, onAction, onClose }: HarnessProps): ReactElement {
  const { surface, headingLevel, composition, openerCount, closePath } = testCase;
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Stable ref objects, one per opener: `useSurfaceFocus` reads the ref late, and
  // a ref recreated on render would be a different object each time.
  const openerRefs = useMemo<RefObject<HTMLElement | null>[]>(
    () =>
      Array.from({ length: openerCount }, () => ({
        current: null as HTMLElement | null,
      })),
    [openerCount],
  );

  const close = (reason: SurfaceCloseReason): void => {
    onClose(reason);
    setOpenIndex(null);
  };

  const act = (): void => {
    onAction();
    if (closePath === 'caller-close-after-submit') {
      // The successful-submission path: the caller closes the surface itself and
      // is never told a reason, so focus return cannot depend on one.
      setOpenIndex(null);
    }
  };

  const openerRef = openIndex === null ? null : openerRefs[openIndex];

  return (
    <div>
      <button type="button">Before the openers</button>
      {openerRefs.map((ref, index) => (
        <button
          key={index}
          type="button"
          ref={(node) => {
            ref.current = node;
          }}
          onClick={() => setOpenIndex(index)}
        >
          {openerName(surface, index)}
        </button>
      ))}
      {openerRef !== null && surface.kind === 'form-panel' ? (
        <FormPanel
          open
          openerRef={openerRef}
          heading={surface.heading}
          headingLevel={headingLevel}
          submitLabel={surface.actionLabel}
          onSubmit={act}
          onClose={close}
        >
          {composition.node}
        </FormPanel>
      ) : null}
      {openerRef !== null && surface.kind === 'confirm-dialog' ? (
        <ConfirmDialog
          open
          openerRef={openerRef}
          heading={surface.heading}
          headingLevel={headingLevel}
          confirmLabel={surface.actionLabel}
          onConfirm={act}
          onClose={close}
        >
          {composition.node}
        </ConfirmDialog>
      ) : null}
      <button type="button">After the openers</button>
    </div>
  );
}

/** The rendered surface, or `null` when none is open. */
function surfaceElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-squads-surface]');
}

function openSurface(container: HTMLElement): HTMLElement {
  const surface = surfaceElement(container);
  expect(surface).not.toBeNull();
  return surface as HTMLElement;
}

// --- The assertions -----------------------------------------------------------

/**
 * Requirement 19.7, entry: focus is inside the opened surface, on the element
 * document order puts first — the body's first focusable control when it has one,
 * and the surface's own first control otherwise.
 */
function expectFocusEnteredSurface(surface: HTMLElement, testCase: SurfaceCase): void {
  const { composition } = testCase;

  const expected = composition.leadsWithFocusable
    ? surface.querySelector<HTMLElement>(`[${FIRST_FOCUSABLE_ATTRIBUTE}="true"]`)
    : // Nothing focusable in the body, so the surface's own action row leads: the
      // submit control of a form, and the dismiss control of a confirmation, which
      // renders its way out before its way on.
      within(surface).getByRole('button', {
        name:
          testCase.surface.kind === 'form-panel'
            ? testCase.surface.actionLabel
            : CANCEL_LABEL,
      });

  expect(expected).not.toBeNull();
  expect(document.activeElement).toBe(expected);
  expect(surface.contains(document.activeElement)).toBe(true);
}

/** Requirements 19.7 and 19.8: focus is back on the opener that was activated. */
function expectFocusReturnedToOpener(
  container: HTMLElement,
  testCase: SurfaceCase,
): void {
  const { surface, openerCount, openerIndex } = testCase;

  const opener = within(container).getByRole('button', {
    name: openerName(surface, openerIndex),
  });
  expect(document.activeElement).toBe(opener);

  // Not merely "an opener": every other one that reads alike is unfocused.
  for (let index = 0; index < openerCount; index += 1) {
    if (index === openerIndex) {
      continue;
    }
    expect(
      within(container).getByRole('button', { name: openerName(surface, index) }),
    ).not.toBe(document.activeElement);
  }
}

/** Requirement 19.8: the Escape path submits and confirms nothing. */
function expectNothingSubmitted(onAction: ReturnType<typeof vi.fn>): void {
  expect(onAction).not.toHaveBeenCalled();
}

/** Requirement 19.8: and nothing reached the network by any other route. */
function expectNoCallIssued(): void {
  expect(recordedCalls).toEqual([]);
}

// --- The property -------------------------------------------------------------

describe('Property 46 — focus enters an opened surface and returns to its opener', () => {
  // Feature: web-squads-screens, Property 46: Focus enters an opened surface and returns to its opener
  // Validates: Requirements 19.7, 19.8
  it('moves focus into every opened surface and returns it to the activated opener on every close path', async () => {
    await fc.assert(
      fc.asyncProperty(surfaceCaseArb, async (testCase) => {
        const user = surfaceUser();
        const onAction = vi.fn();
        const onClose = vi.fn();
        const { container } = render(
          <Harness testCase={testCase} onAction={onAction} onClose={onClose} />,
        );

        try {
          const openerControl = within(container).getByRole('button', {
            name: openerName(testCase.surface, testCase.openerIndex),
          });
          await user.click(openerControl);

          const surface = openSurface(container);
          expectFocusEnteredSurface(surface, testCase);

          switch (testCase.closePath) {
            case 'dismiss': {
              await user.click(
                within(surface).getByRole('button', { name: CANCEL_LABEL }),
              );
              expect(onClose).toHaveBeenCalledExactlyOnceWith('dismiss');
              expectNothingSubmitted(onAction);
              break;
            }
            case 'escape': {
              if (testCase.escapeOrigin === 'dismiss-control') {
                // Pressed from a descendant of the surface, so the handler is
                // reached by a bubble as well as at its own target.
                within(surface)
                  .getByRole('button', { name: CANCEL_LABEL })
                  .focus();
              }
              await user.keyboard('{Escape}');
              expect(onClose).toHaveBeenCalledExactlyOnceWith('escape');
              // The whole of 19.8's "without submitting it".
              expectNothingSubmitted(onAction);
              break;
            }
            default: {
              await user.click(
                within(surface).getByRole('button', {
                  name: testCase.surface.actionLabel,
                }),
              );
              expect(onAction).toHaveBeenCalledOnce();
              // The caller closed it; the surface was never told why.
              expect(onClose).not.toHaveBeenCalled();
              break;
            }
          }

          expect(surfaceElement(container)).toBeNull();
          expectFocusReturnedToOpener(container, testCase);
          expectNoCallIssued();
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 46: Focus enters an opened surface and returns to its opener
  // Validates: Requirements 19.7
  it('focuses the surface itself when it holds no focusable control, and still returns focus to its opener', async () => {
    await fc.assert(
      fc.asyncProperty(
        nonFocusableContentArb,
        fc.integer({ min: 2, max: 4 }).chain((openerCount) =>
          fc
            .integer({ min: 0, max: openerCount - 1 })
            .map((openerIndex) => ({ openerCount, openerIndex })),
        ),
        async (content, openers) => {
          const user = surfaceUser();
          const { container, rerender } = render(
            <FallbackHarness
              content={content.node}
              openerCount={openers.openerCount}
            />,
          );

          try {
            await user.click(
              within(container).getByRole('button', {
                name: fallbackOpenerName(openers.openerIndex),
              }),
            );

            const surface = openSurface(container);
            // The branch under test is only reached when there is genuinely
            // nothing focusable inside, so that is stated rather than assumed.
            expect(firstFocusableWithin(surface)).toBeNull();
            expect(document.activeElement).toBe(surface);

            // Closed by the caller without moving focus out of the surface, which
            // is the only close a surface with no controls can have.
            rerender(
              <FallbackHarness
                content={content.node}
                openerCount={openers.openerCount}
                closed
              />,
            );

            expect(surfaceElement(container)).toBeNull();
            expect(document.activeElement).toBe(
              within(container).getByRole('button', {
                name: fallbackOpenerName(openers.openerIndex),
              }),
            );
            expectNoCallIssued();
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});

// --- The fallback surface -----------------------------------------------------

/**
 * A surface with no action row, built on the production {@link useSurfaceFocus}
 * and carrying the same `tabIndex={-1}` root the Form_Panel and the Confirm_Dialog
 * declare.
 *
 * It exists because neither real surface can hold zero focusable controls — both
 * always render their actions — so the hook's fallback target is unreachable
 * through them. It restates none of the behaviour under test: the hook is
 * imported, and this component contributes markup alone.
 */
function FallbackSurface({
  openerRef,
  children,
}: {
  readonly openerRef: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
}): ReactElement {
  const surfaceRef = useSurfaceFocus(openerRef);

  return (
    <div
      ref={surfaceRef}
      role="group"
      aria-label="A surface with no focusable control"
      tabIndex={-1}
      data-squads-surface="fallback-surface"
    >
      {children}
    </div>
  );
}

function fallbackOpenerName(index: number): string {
  return `Open surface ${index + 1}`;
}

/**
 * The fallback surface's screen fragment. `closed` is a prop rather than an
 * in-surface control on purpose: clicking anything outside the surface would move
 * focus out of it first, which the hook correctly reads as a person choosing to
 * work elsewhere.
 */
function FallbackHarness({
  content,
  openerCount,
  closed = false,
}: {
  readonly content: ReactNode;
  readonly openerCount: number;
  readonly closed?: boolean;
}): ReactElement {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const openerRefs = useMemo<RefObject<HTMLElement | null>[]>(
    () =>
      Array.from({ length: openerCount }, () => ({
        current: null as HTMLElement | null,
      })),
    [openerCount],
  );

  const openerRef = openIndex === null || closed ? null : openerRefs[openIndex];

  return (
    <div>
      <button type="button">Before the openers</button>
      {openerRefs.map((ref, index) => (
        <button
          key={index}
          type="button"
          ref={(node) => {
            ref.current = node;
          }}
          onClick={() => setOpenIndex(index)}
        >
          {fallbackOpenerName(index)}
        </button>
      ))}
      {openerRef !== null ? (
        <FallbackSurface openerRef={openerRef}>{content}</FallbackSurface>
      ) : null}
      <button type="button">After the openers</button>
    </div>
  );
}
