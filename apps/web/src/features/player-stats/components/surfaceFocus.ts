/**
 * The Player_Stats_Screen's focus seam — the one place that decides where a
 * keyboard user stands after the screen changes what it is rendering.
 *
 * Requirement 16.5 is about a specific loss. The screen renders one of four
 * bodies — loading, loaded, not-found, failed — and a change between them
 * replaces the whole body, not part of it. So the control a person was standing
 * on routinely stops existing: activating the retry control takes the screen
 * from `failed` to `loading` and the retry control goes with the failure;
 * arriving at `loaded` from `loading` replaces a statement with ten sections.
 * When the focused element is removed, the browser drops focus to `document.body`
 * — which is outside the main content region, announces nothing, and starts the
 * next Tab from the very top of the document, past the whole shell frame. The
 * person has been thrown out of the screen by an outcome they asked for.
 *
 * This module puts them back: on every change of rendered condition, if focus is
 * no longer anywhere inside the main content region, focus moves to the region
 * itself. The region is a programmatic focus target (`tabIndex = -1`), so it can
 * receive focus without ever entering the Tab order, and the next Tab continues
 * from inside the screen's new body rather than from the document's start.
 *
 * ### What it deliberately does not do
 *
 * - **It does not focus on first render.** Focus placement is a response to a
 *   *change*; moving focus on mount would take it away from whatever brought the
 *   person here — a Player_Row on the Squad_Screen, say — which is focus theft
 *   rather than focus repair. {@link useConditionFocus} therefore records the
 *   first condition and acts only from the second onwards.
 * - **It does not pull focus back from somewhere a person chose to be.** If
 *   focus sits on a connected element *outside* the region — the shell frame's
 *   navigation, its account menu, its notification surface — it stays there. A
 *   response arriving while someone is reading the nav must not yank them into
 *   the body. This is the same "focus left deliberately" rule the
 *   Squads_Feature's own surface focus applies, and it means the requirement's
 *   claim holds in the form that matters: a change of condition never *loses* a
 *   keyboard user's position, and never moves one that is already placed.
 * - **It traps nothing and confines nothing.** The region is not `aria-modal`,
 *   Tab leaves it freely in both directions, and nothing here listens on the
 *   document.
 * - **It announces nothing.** The appearance of the Generic_Profile_Failure and
 *   of the Not_Found_Treatment is announced by their own live regions
 *   (Requirement 4.6), precisely so a person learns the outcome *without* focus
 *   moving. This module moves focus only where it would otherwise have been
 *   dropped, so the two mechanisms do not compete.
 *
 * ### Why the region's attributes are handed out rather than documented
 *
 * {@link useConditionFocus} returns the attributes the region must carry
 * alongside the ref, so a screen cannot attach the ref and forget the
 * `tabIndex`. A region without it is not focusable, the repair silently does
 * nothing, and the only symptom is a keyboard user occasionally landing on
 * `<body>` — which is exactly the kind of defect that survives review.
 *
 * Requirements: 16.5
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';

import '../styles/playerStatsTokens.css';
import './surfaces.css';

/**
 * The four bodies the Player_Stats_Screen can be rendering, named as the
 * conditions Requirement 16.5 enumerates rather than as the load machine's
 * phases.
 *
 * The machine has six phases and the screen has four bodies, because two pairs
 * collapse: `idle` and `loading` both render the loading indication while no
 * profile is held, and `refreshing` renders the held profile exactly as `loaded`
 * does, with a busy indication beside it. Mapping phases to conditions is the
 * screen's job; what this module needs is only the identity of the body on
 * screen, so that a *change* of body is recognisable. Keeping the union to the
 * four rendered conditions is also what stops a busy indication appearing beside
 * an already-rendered profile from counting as a change — nothing was removed,
 * so there is nothing to repair.
 */
export type ScreenCondition = 'loading' | 'loaded' | 'not-found' | 'failed';

/**
 * The selector of the main content region, so a test can assert where focus
 * landed without reaching for an implementation detail of the screen.
 */
export const MAIN_CONTENT_SELECTOR = '[data-player-stats-main="true"]';

/** The attributes the main content region must carry. See {@link useConditionFocus}. */
export interface MainContentRegionProps {
  /** The region's class, styled by `surfaces.css`. */
  readonly className: string;
  /**
   * Programmatically focusable, never in the Tab order.
   *
   * `-1` rather than `0`: the region is a place to *put* focus, not a stop on
   * the way through the screen, and adding a tab stop before every body would
   * cost a keystroke on every pass for no benefit (Requirement 16.4 asks for the
   * controls to be reachable in render order, and a wrapper is not a control).
   */
  readonly tabIndex: -1;
  /** The hook into {@link MAIN_CONTENT_SELECTOR}. */
  readonly 'data-player-stats-main': 'true';
}

/** What {@link useConditionFocus} hands back to the screen. */
export interface ConditionFocus {
  /** Attach to the element wrapping the screen's condition-selected body. */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** Spread onto that same element. */
  readonly regionProps: MainContentRegionProps;
}

/**
 * True when focus has been *lost* rather than *placed* — the only situation in
 * which this module moves it.
 *
 * Three readings of `document.activeElement` mean lost, and all three arise from
 * the same cause, a focused element being unmounted with the previous body:
 *
 * - `null`, which jsdom and some browsers report transiently;
 * - `document.body`, which is what a browser falls back to;
 * - a disconnected element, which is the removed control itself in the window
 *   before the fallback is applied.
 *
 * Anything else is a connected element somewhere in the document: either inside
 * the region, where focus is already where it should be, or outside it, where a
 * person put it on purpose. Neither needs the region to recognise, which is why
 * this takes no argument — the test is about focus having gone, not about where
 * it would go.
 *
 * @returns whether focus should be moved into the main content region
 */
function focusWasLost(): boolean {
  const active = document.activeElement;

  if (active === null || active === document.body) {
    return true;
  }

  if (!(active instanceof HTMLElement) || !active.isConnected) {
    return true;
  }

  // A connected element. Inside the region, focus is already placed, and moving
  // it to the wrapper would be a regression — a person standing on the retry
  // control after a failed retry should stay on it. Outside the region, it is
  // somewhere a person chose to be. Neither is a loss.
  return false;
}

/**
 * Keep a keyboard user's position inside the main content region across a change
 * of rendered condition.
 *
 * Returns the ref for the region element and the attributes it must carry. The
 * effect runs on every change of `condition` and on no other render, and moves
 * focus only when it has been dropped out of the region altogether.
 *
 * @param condition the body the screen is rendering now
 * @returns the region's ref and its attributes
 *
 * Requirements: 16.5
 */
export function useConditionFocus(condition: ScreenCondition): ConditionFocus {
  const ref = useRef<HTMLDivElement | null>(null);
  /**
   * The condition as of the last run of the effect below, so a *change* is
   * distinguishable from a first render. `null` until the first run, which is
   * the render this module deliberately leaves alone.
   */
  const previousConditionRef = useRef<ScreenCondition | null>(null);

  useEffect(() => {
    const previous = previousConditionRef.current;
    previousConditionRef.current = condition;

    // First render: whatever brought the person here still holds focus, and
    // taking it would be theft rather than repair.
    if (previous === null || previous === condition) {
      return;
    }

    const region = ref.current;
    if (region === null) {
      return;
    }

    if (focusWasLost()) {
      // 16.5: the body that held focus has gone, so focus goes to the region
      // wrapping the new one. The next Tab then continues from inside the
      // screen rather than from the top of the document.
      region.focus();
    }
  }, [condition]);

  const regionProps = useMemo<MainContentRegionProps>(
    () => ({
      className: 'player-stats-main',
      tabIndex: -1,
      'data-player-stats-main': 'true',
    }),
    [],
  );

  return useMemo<ConditionFocus>(() => ({ ref, regionProps }), [regionProps]);
}
