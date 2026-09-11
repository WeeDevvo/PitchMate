/**
 * Property test for the Shell_Header's disclosure exclusivity (task 10.2).
 *
 * **Property 26: At most one header disclosure surface is open.** *For any*
 * sequence of activations of the notification indicator and the account-menu
 * control, at most one of the notification panel and the account menu reports the
 * expanded state at any instant, and opening either reports the collapsed state on
 * the other's control.
 *
 * That is Requirement 8.8: opening the Account_Menu while the Notification_Panel
 * is open closes the panel and reports the collapsed state on the
 * Notification_Indicator, and opening the panel while the menu is open does the
 * mirror image, "so that at most one of those two disclosure surfaces is open at
 * any instant".
 *
 * The property is checked at both levels the shell relies on:
 *
 * 1. **Through the hook** ({@link useDisclosureGroup}), against an independent
 *    model held as *one boolean per surface* — deliberately the very arrangement
 *    the hook exists to avoid. If the hook could ever represent "both open", the
 *    model would diverge from it or the model's own exclusivity assertion would
 *    fail, so the property cannot be satisfied by accident of the return type.
 * 2. **Through the rendered primitive** ({@link Disclosure}), where the observable
 *    claim of Requirement 8.8 actually lives: at most one trigger reports
 *    `aria-expanded="true"` and at most one surface is in the document, after
 *    *every* step of the generated sequence rather than only at its end.
 *
 * The rendered sequences drive all three of the ways a surface closes that could
 * race with an opening — trigger activation, Escape from inside the surface, and a
 * pointer landing outside — because a real pointer activation on a *second*
 * trigger is both an outside-pointer close of the first surface and an opening of
 * the second, in that order. Trigger activations therefore dispatch `pointerdown`
 * before `click`, as a pointer does, instead of a bare synthetic click that would
 * skip the interleaving entirely.
 *
 * The compact Primary_Navigation joins the generated surfaces even though
 * Requirement 8.8 names only two: it shares the same single `open` value, so
 * including it can only strengthen the exclusivity claim, never weaken it.
 *
 * Per-transition examples live in `useDisclosureGroup.test.ts` and
 * `../components/Disclosure.test.tsx`; this file is the generator-driven property
 * at the 100-iteration floor Requirement 14.2 sets.
 *
 * Feature: app-shell, Property 26: At most one header disclosure surface is open
 * Validates: Requirements 8.8
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import fc from 'fast-check';

import { Disclosure } from '../components/Disclosure';
import { useDisclosureGroup, type OpenableShellSurface } from './useDisclosureGroup';

/**
 * Every surface in the group. The first two are the pair Requirement 8.8 names;
 * the third shares the same value, so it is generated too.
 */
const SURFACES: readonly OpenableShellSurface[] = ['notifications', 'account', 'navigation'];

/** The two surfaces Requirement 8.8 states its rule over, for the paired property. */
type RequiredPairSurface = 'notifications' | 'account';

const REQUIRED_PAIR: readonly RequiredPairSurface[] = ['notifications', 'account'];

/** The surface Requirement 8.8 requires to collapse when the other one opens. */
const OTHER_OF_PAIR: Record<RequiredPairSurface, RequiredPairSurface> = {
  notifications: 'account',
  account: 'notifications',
};

/** The visible label, and so the accessible name, of each surface's trigger. */
const TRIGGER_LABEL: Record<OpenableShellSurface, string> = {
  notifications: 'Notifications',
  account: 'Account menu',
  navigation: 'Main menu',
};

/** The surface element id each trigger's `aria-controls` names. */
const surfaceId = (surface: OpenableShellSurface): string => `shell-surface-${surface}`;

// --- The model ---------------------------------------------------------------

/**
 * One boolean per surface: the "two flags kept in step" shape Requirement 8.8
 * would be maintained by if it were not made true by construction. Written from
 * the requirement text rather than from the hook, so the two can disagree.
 */
type ExpandedModel = Readonly<Record<OpenableShellSurface, boolean>>;

const ALL_COLLAPSED: ExpandedModel = {
  notifications: false,
  account: false,
  navigation: false,
};

/** Which surfaces the model reports as expanded. */
function modelExpanded(model: ExpandedModel): readonly OpenableShellSurface[] {
  return SURFACES.filter((surface) => model[surface]);
}

/** Open `surface` and, per Requirement 8.8, collapse every other one. */
function modelOpen(surface: OpenableShellSurface): ExpandedModel {
  return { ...ALL_COLLAPSED, [surface]: true };
}

/** Activating a trigger opens its surface, or collapses it where already open. */
function modelToggle(model: ExpandedModel, surface: OpenableShellSurface): ExpandedModel {
  return model[surface] ? ALL_COLLAPSED : modelOpen(surface);
}

/** A close request for a surface that is not open changes nothing. */
function modelClose(model: ExpandedModel, surface: OpenableShellSurface): ExpandedModel {
  return model[surface] ? { ...model, [surface]: false } : model;
}

// --- Generators --------------------------------------------------------------

const surfaceArb = fc.constantFrom(...SURFACES);

/** The two operations the group exposes, over any surface. */
type GroupOperation =
  | { readonly kind: 'toggle'; readonly surface: OpenableShellSurface }
  | { readonly kind: 'close'; readonly surface: OpenableShellSurface };

const groupOperationArb: fc.Arbitrary<GroupOperation> = fc.oneof(
  // Weighted towards toggles: activations are what Requirement 8.8 is stated
  // over, and a `close` of a surface that is not open is mostly a no-op.
  {
    arbitrary: fc.record({ kind: fc.constant('toggle' as const), surface: surfaceArb }),
    weight: 3,
  },
  {
    arbitrary: fc.record({ kind: fc.constant('close' as const), surface: surfaceArb }),
    weight: 1,
  },
);

/** What a person can do to the rendered header, in the DOM. */
type RenderedOperation =
  | { readonly kind: 'activate-trigger'; readonly surface: OpenableShellSurface }
  | { readonly kind: 'escape-inside' }
  | { readonly kind: 'pointer-outside' };

const renderedOperationArb: fc.Arbitrary<RenderedOperation> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('activate-trigger' as const),
      surface: surfaceArb,
    }),
    weight: 4,
  },
  { arbitrary: fc.constant({ kind: 'escape-inside' as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'pointer-outside' as const }), weight: 1 },
);

// --- The rendered header ----------------------------------------------------

/**
 * The header's disclosure arrangement, reduced to what Requirement 8.8 is about:
 * one {@link useDisclosureGroup} above three {@link Disclosure} surfaces, each
 * with a real `<button>` trigger, plus focusable controls outside the group for a
 * pointer to land on.
 */
function DisclosureHeaderHarness(): ReactElement {
  const { open, toggle, close } = useDisclosureGroup();

  return (
    <div>
      <button type="button">Outside before</button>
      {SURFACES.map((surface) => (
        <Disclosure
          key={surface}
          id={surfaceId(surface)}
          open={open === surface}
          onRequestOpen={() => toggle(surface)}
          onRequestClose={() => close(surface)}
          trigger={(triggerProps) => (
            <button type="button" {...triggerProps}>
              {TRIGGER_LABEL[surface]}
            </button>
          )}
        >
          <button type="button">{`${TRIGGER_LABEL[surface]} item`}</button>
        </Disclosure>
      ))}
      <button type="button">Outside after</button>
    </div>
  );
}

/** Each surface's trigger, in the order the surfaces are declared. */
function triggerFor(surface: OpenableShellSurface): HTMLElement {
  return screen.getByRole('button', { name: TRIGGER_LABEL[surface] });
}

/** The surfaces whose triggers report the expanded state programmatically. */
function expandedSurfaces(): readonly OpenableShellSurface[] {
  return SURFACES.filter(
    (surface) => triggerFor(surface).getAttribute('aria-expanded') === 'true',
  );
}

/** The surface elements actually present in the document. */
function renderedSurfaceIds(): readonly string[] {
  return Array.from(document.querySelectorAll('[data-shell-disclosure-surface]')).map(
    (element) => element.id,
  );
}

/**
 * The invariant, asserted after every step: at most one trigger reports expanded,
 * at most one surface is in the document, and the two agree with each other.
 */
function expectAtMostOneOpen(): readonly OpenableShellSurface[] {
  const expanded = expandedSurfaces();
  const rendered = renderedSurfaceIds();

  expect(expanded.length).toBeLessThanOrEqual(1);
  expect(rendered.length).toBeLessThanOrEqual(1);

  const openSurface = expanded[0];
  if (openSurface === undefined) {
    expect(rendered).toEqual([]);
  } else {
    expect(rendered).toEqual([surfaceId(openSurface)]);
    expect(triggerFor(openSurface).getAttribute('aria-controls')).toBe(surfaceId(openSurface));
    for (const other of SURFACES.filter((surface) => surface !== openSurface)) {
      expect(triggerFor(other)).toHaveAttribute('aria-expanded', 'false');
    }
  }

  return expanded;
}

/**
 * Activate a trigger the way a pointer does: `pointerdown` first — which is an
 * outside-pointer close for any *other* open surface — then the click that opens
 * or closes this one.
 */
function activateTrigger(surface: OpenableShellSurface): void {
  const control = triggerFor(surface);
  fireEvent.pointerDown(control);
  fireEvent.click(control);
}

/** Press Escape inside the open surface, or outside the group when none is open. */
function pressEscapeInsideOpenSurface(): void {
  const openSurface = expandedSurfaces()[0];
  const target =
    openSurface === undefined
      ? screen.getByRole('button', { name: 'Outside before' })
      : screen.getByRole('button', { name: `${TRIGGER_LABEL[openSurface]} item` });
  fireEvent.keyDown(target, { key: 'Escape' });
}

/** Land a pointer on a control outside every surface and every trigger. */
function pointerOutside(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside after' }));
}

function performRendered(operation: RenderedOperation): void {
  switch (operation.kind) {
    case 'activate-trigger':
      activateTrigger(operation.surface);
      return;
    case 'escape-inside':
      pressEscapeInsideOpenSurface();
      return;
    case 'pointer-outside':
      pointerOutside();
      return;
  }
}

// --- Properties -------------------------------------------------------------

describe('useDisclosureGroup — Property 26 (at most one header disclosure surface is open)', () => {
  // Feature: app-shell, Property 26: At most one header disclosure surface is open
  // Validates: Requirements 8.8
  it('never reports two surfaces expanded, for any sequence of operations on the group', () => {
    fc.assert(
      fc.property(
        fc.array(groupOperationArb, { minLength: 1, maxLength: 24 }),
        (operations) => {
          const { result } = renderHook(() => useDisclosureGroup());
          try {
            let model = ALL_COLLAPSED;
            // Requirement 8.1: collapsed before anything is activated.
            expect(modelExpanded(model)).toEqual([]);
            expect(result.current.open).toBeNull();

            for (const operation of operations) {
              act(() => {
                if (operation.kind === 'toggle') {
                  result.current.toggle(operation.surface);
                } else {
                  result.current.close(operation.surface);
                }
              });

              model =
                operation.kind === 'toggle'
                  ? modelToggle(model, operation.surface)
                  : modelClose(model, operation.surface);

              // The model, held as one flag per surface, never has two set...
              expect(modelExpanded(model).length).toBeLessThanOrEqual(1);
              // ...and the hook agrees with it, surface by surface.
              const expanded = SURFACES.filter((surface) => result.current.open === surface);
              expect(expanded).toEqual(modelExpanded(model));
              expect(expanded.length).toBeLessThanOrEqual(1);
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  // Feature: app-shell, Property 26: At most one header disclosure surface is open
  // Validates: Requirements 8.8
  it('keeps at most one trigger reporting expanded and one surface rendered, at every step', () => {
    fc.assert(
      fc.property(
        fc.array(renderedOperationArb, { minLength: 1, maxLength: 16 }),
        (operations) => {
          render(<DisclosureHeaderHarness />);
          try {
            // Requirement 8.1: every trigger reports collapsed on first render.
            expect(expectAtMostOneOpen()).toEqual([]);

            for (const operation of operations) {
              performRendered(operation);
              expectAtMostOneOpen();
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);

  // Feature: app-shell, Property 26: At most one header disclosure surface is open
  // Validates: Requirements 8.8
  it('reports the collapsed state on the other control whenever either surface is opened', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_PAIR),
        fc.array(fc.constantFrom(...REQUIRED_PAIR), { minLength: 1, maxLength: 8 }),
        (first, laterOpenings) => {
          render(<DisclosureHeaderHarness />);
          try {
            activateTrigger(first);
            expect(expandedSurfaces()).toEqual([first]);

            let currentlyOpen: RequiredPairSurface | null = first;
            for (const next of laterOpenings) {
              if (next === currentlyOpen) {
                // Activating the open surface's own trigger closes it, which is
                // Requirement 5.2's toggle, not an opening.
                activateTrigger(next);
                expect(expandedSurfaces()).toEqual([]);
                currentlyOpen = null;
                continue;
              }

              activateTrigger(next);
              const other = OTHER_OF_PAIR[next];

              // The opened surface reports expanded and is in the document...
              expect(triggerFor(next)).toHaveAttribute('aria-expanded', 'true');
              expect(document.getElementById(surfaceId(next))).not.toBeNull();
              // ...and the other one reports collapsed and is gone.
              expect(triggerFor(other)).toHaveAttribute('aria-expanded', 'false');
              expect(document.getElementById(surfaceId(other))).toBeNull();

              currentlyOpen = next;
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);
});
