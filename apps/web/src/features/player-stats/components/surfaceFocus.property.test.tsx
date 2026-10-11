// Feature: web-player-stats-screen, focus seam invariant: a change of rendered condition never leaves a keyboard user outside the main content region
// Validates: Requirements 16.5

import { type ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MAIN_CONTENT_SELECTOR,
  useConditionFocus,
  type ScreenCondition,
} from './surfaceFocus';

/**
 * A property test for the seam, over *sequences* of condition changes rather
 * than single transitions.
 *
 * ## Why a sequence, and not four transitions
 *
 * There are twelve ordered pairs of the four conditions, which an example test
 * could enumerate. What it could not enumerate is the interaction between a
 * transition and the one before it: the seam carries two pieces of state across
 * renders — the previous condition, and (through the DOM) where focus currently
 * is — and a defect in either shows up only on the *second or later* change.
 * Recording the previous condition in a ref that was never updated, or repairing
 * focus once and then reading a stale region node, would both pass a
 * single-transition test and fail here.
 *
 * A real session is a sequence too: load, loaded, retry after a failure, a
 * Pairwise_Link to a sibling profile, another load. Nothing bounds how many
 * changes a person sees, so the claim has to survive arbitrarily many.
 *
 * ## The claim, stated precisely
 *
 * For any sequence of rendered conditions and any placement of focus before each
 * change, after the change:
 *
 * | Focus before the change | After the change |
 * | --- | --- |
 * | on a control inside the region, or dropped to the document body | **inside the region** |
 * | on a connected control outside the region | **unmoved** |
 *
 * The second row is as much a part of Requirement 16.5 as the first. The
 * requirement is that a keyboard user's *position* survives a change of
 * condition; a person reading the shell frame's navigation when a response
 * arrives has a position, and dragging them into the body would destroy it just
 * as surely as dropping them onto `<body>` would. So the seam repairs a lost
 * position and never relocates a placed one, and both halves are generated over
 * here.
 *
 * ## Why focus is placed programmatically rather than by typing
 *
 * `fc.property` is synchronous, and `user-event` is not. Calling `.focus()` on
 * the control a person would be standing on produces the same DOM state that
 * tabbing to it produces — `document.activeElement` is the control — and the
 * seam reads nothing else. The keyboard route itself is exercised by the
 * example-based tests beside this file, and the assembled screen's keyboard
 * reachability is Property 34's business.
 *
 * ## Non-vacuity
 *
 * The body control is keyed on the condition, so every change really does unmount
 * the control that held focus; the final test in this file asserts that, so a
 * harness that quietly reused one DOM node — and therefore never lost focus at
 * all — could not make the property pass by accident.
 */

/** The four rendered conditions Requirement 16.5 enumerates. */
const SCREEN_CONDITIONS: readonly ScreenCondition[] = [
  'loading',
  'loaded',
  'not-found',
  'failed',
];

/** Where a person's focus sits at the moment the condition changes. */
type FocusPlacement = 'inside' | 'body' | 'outside';

/** Every placement, so the generator covers all three without naming them twice. */
const FOCUS_PLACEMENTS: readonly FocusPlacement[] = ['inside', 'body', 'outside'];

/** One step of a generated session: the body to render, and where focus was. */
interface Step {
  readonly condition: ScreenCondition;
  readonly placement: FocusPlacement;
}

/** A control outside the region, standing in for the App_Shell frame's own. */
const OUTSIDE_LABEL = 'Outside the region';

/** The harness's region, body control, and outside control. */
interface HarnessNodes {
  readonly region: HTMLElement;
  readonly body: HTMLElement;
  readonly outside: HTMLElement;
}

/**
 * A screen stand-in.
 *
 * The body control is keyed on the condition so a change of condition unmounts
 * it, which is what the real screen does: the four bodies share no element, and
 * the retry control a person activates exists only in the failed body.
 */
function Harness({ condition }: { readonly condition: ScreenCondition }): ReactElement {
  const { ref, regionProps } = useConditionFocus(condition);

  return (
    <>
      <button type="button" data-testid="outside">
        {OUTSIDE_LABEL}
      </button>
      <div ref={ref} {...regionProps}>
        <button key={condition} type="button" data-testid="body">
          {`Body control: ${condition}`}
        </button>
      </div>
    </>
  );
}

/** Read the harness's three nodes, failing loudly rather than asserting on null. */
function nodesOf(container: HTMLElement): HarnessNodes {
  const region = container.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR);
  const body = container.querySelector<HTMLElement>('[data-testid="body"]');
  const outside = container.querySelector<HTMLElement>('[data-testid="outside"]');

  if (region === null || body === null || outside === null) {
    throw new Error('the harness did not render its region, body, and outside control');
  }

  return { region, body, outside };
}

/** Put focus where the step says a person was standing. */
function placeFocus(nodes: HarnessNodes, placement: FocusPlacement): void {
  switch (placement) {
    case 'inside':
      nodes.body.focus();
      return;
    case 'outside':
      nodes.outside.focus();
      return;
    case 'body':
      // What a browser reports once the focused control has been unmounted, and
      // what holds before anyone has tabbed anywhere at all.
      (document.activeElement as HTMLElement | null)?.blur();
      return;
  }
}

/** A session: at least two steps, so at least one change is possible. */
const stepArb: fc.Arbitrary<Step> = fc.record({
  condition: fc.constantFrom(...SCREEN_CONDITIONS),
  placement: fc.constantFrom(...FOCUS_PLACEMENTS),
});

const sessionArb: fc.Arbitrary<readonly Step[]> = fc.array(stepArb, {
  minLength: 2,
  maxLength: 10,
});

describe('the focus seam across a session of condition changes (Req 16.5)', () => {
  it('leaves focus inside the main content region after every change that lost it', () => {
    fc.assert(
      fc.property(sessionArb, (steps) => {
        try {
          const first = steps[0];
          const { container, rerender } = render(<Harness condition={first.condition} />);

          let previous = first.condition;

          for (const step of steps.slice(1)) {
            placeFocus(nodesOf(container), step.placement);

            rerender(<Harness condition={step.condition} />);

            const nodes = nodesOf(container);

            if (step.condition === previous) {
              // No change of body, so nothing was removed and nothing is
              // repaired: focus is exactly where it was put.
              previous = step.condition;
              continue;
            }

            if (step.placement === 'outside') {
              // A position a person chose. Untouched.
              expect(document.activeElement).toBe(nodes.outside);
            } else {
              // A position that was lost, or never taken. Inside the region.
              expect(nodes.region.contains(document.activeElement)).toBe(true);
            }

            previous = step.condition;
          }
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never moves focus on a re-render that changes no condition', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SCREEN_CONDITIONS),
        fc.constantFrom(...FOCUS_PLACEMENTS),
        fc.integer({ min: 1, max: 6 }),
        (condition, placement, rerenders) => {
          try {
            const { container, rerender } = render(<Harness condition={condition} />);

            placeFocus(nodesOf(container), placement);
            const placed = document.activeElement;

            for (let index = 0; index < rerenders; index += 1) {
              rerender(<Harness condition={condition} />);
            }

            expect(document.activeElement).toBe(placed);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('the focus seam harness is not vacuous', () => {
  it('really does unmount the focused control on every change of condition', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SCREEN_CONDITIONS),
        fc.constantFrom(...SCREEN_CONDITIONS),
        (from, to) => {
          fc.pre(from !== to);

          try {
            const { container, rerender } = render(<Harness condition={from} />);

            const before = nodesOf(container).body;
            before.focus();
            expect(document.activeElement).toBe(before);

            rerender(<Harness condition={to} />);

            // The node that held focus is gone from the document, which is the
            // loss the seam exists to repair.
            expect(before.isConnected).toBe(false);
            expect(nodesOf(container).body).not.toBe(before);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
