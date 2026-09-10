/**
 * The shared test harness for the App_Shell's viewport layout detection.
 *
 * jsdom lays nothing out and evaluates no media query — every query reports
 * `matches: false` — so a suite that needs a *width* has to supply one. Two
 * suites need it: {@link useViewportLayout}'s own unit tests, and the frame's
 * layout tests (task 10.10), which render the whole Shell_Frame at each of the
 * widths Requirement 1.8 names and cross the 768-pixel boundary in both
 * directions (Requirement 1.13).
 *
 * Rather than each of them growing its own stub — and the two drifting on what
 * "a crossing" means — the controllable `matchMedia` lives here, once. Nothing in
 * this module asserts anything: it reports a width and notifies subscribers, and
 * every judgement about what a component did with that belongs to the suite that
 * installed it.
 *
 * ### Why a parsing stub rather than a fixed boolean
 *
 * {@link ViewportStub.matchMedia} reads the `min-width` out of whatever query it
 * is handed and compares it with the reported width, so it answers the shell's
 * `(min-width: 768px)` query and any other the frame may come to ask — a
 * `prefers-color-scheme` query, say, which has no `min-width` and correctly
 * reports non-matching. A stub hard-coded to one query would silently answer
 * `false` for a second one, which is how a Theme test and a layout test end up
 * disagreeing about the same environment.
 *
 * ### Both listener APIs
 *
 * Safari before 14 and Chrome before 39 expose `addListener`/`removeListener`
 * *instead of* `addEventListener`, and choosing between the two pairs is part of
 * what the hook does — so the stub offers them separately rather than both at
 * once, and a suite picks which environment it is testing.
 *
 * Feature: app-shell
 * Requirements: 1.6, 1.7, 1.8, 1.13
 */
import { WIDE_LAYOUT_QUERY } from './useViewportLayout';

/** Which listener API the stubbed `MediaQueryList` exposes. */
export type ViewportListenerApi = 'modern' | 'legacy';

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * A controllable `matchMedia`.
 *
 * {@link setWidth} flips the reported viewport width and notifies every
 * subscriber, standing in for a real breakpoint crossing (a window resize, a
 * device rotation, or a zoom change).
 */
export class ViewportStub {
  private width: number;
  private readonly listenerApi: ViewportListenerApi;
  private readonly listeners = new Set<ChangeListener>();

  /** Every `MediaQueryList` handed out, so removals can be counted. */
  liveListenerCount = 0;

  constructor(width: number, listenerApi: ViewportListenerApi = 'modern') {
    this.width = width;
    this.listenerApi = listenerApi;
  }

  /** Evaluate a `min-width` query against the currently reported width. */
  private matches(query: string): boolean {
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    return minWidth === null ? false : this.width >= Number(minWidth[1]);
  }

  readonly matchMedia = (query: string): MediaQueryList => {
    // Arrow function so `this` is the stub instance without aliasing it.
    const add = (listener: ChangeListener): void => {
      this.listeners.add(listener);
      this.liveListenerCount += 1;
    };
    const remove = (listener: ChangeListener): void => {
      this.listeners.delete(listener);
      this.liveListenerCount -= 1;
    };

    const base = {
      matches: this.matches(query),
      media: query,
      onchange: null,
      dispatchEvent: () => true,
    };

    if (this.listenerApi === 'modern') {
      return {
        ...base,
        addEventListener: (_type: string, listener: ChangeListener) => add(listener),
        removeEventListener: (_type: string, listener: ChangeListener) => remove(listener),
      } as unknown as MediaQueryList;
    }

    // A pre-2020 browser: only the deprecated pair exists.
    return {
      ...base,
      addListener: add,
      removeListener: remove,
    } as unknown as MediaQueryList;
  };

  /** The width currently reported to every query. */
  get reportedWidth(): number {
    return this.width;
  }

  /** Report a new viewport width and notify subscribers, as a real crossing does. */
  setWidth(width: number): void {
    this.width = width;
    const event = {
      matches: this.matches(WIDE_LAYOUT_QUERY),
      media: WIDE_LAYOUT_QUERY,
    } as MediaQueryListEvent;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

/**
 * jsdom's own `matchMedia`, captured at import time so {@link restoreViewport}
 * can put it back whatever a test did to the global.
 */
const originalMatchMedia: typeof window.matchMedia | undefined =
  typeof window === 'undefined' ? undefined : window.matchMedia;

/**
 * Install a controllable `matchMedia` reporting `width`, and hand the stub back.
 *
 * Call it *before* rendering: `useViewportLayout` reads the width on its first
 * render, so a stub installed afterwards would be observed only from the next
 * crossing onwards.
 */
export function installViewport(
  width: number,
  listenerApi: ViewportListenerApi = 'modern',
): ViewportStub {
  const stub = new ViewportStub(width, listenerApi);
  window.matchMedia = stub.matchMedia as unknown as typeof window.matchMedia;
  return stub;
}

/** Put jsdom's own `matchMedia` back. Belongs in an `afterEach`. */
export function restoreViewport(): void {
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window, 'matchMedia');
    return;
  }
  window.matchMedia = originalMatchMedia;
}
