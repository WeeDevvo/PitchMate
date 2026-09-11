/**
 * Viewport layout detection for the Shell_Frame.
 *
 * Requirements 1.6 and 1.7 split the frame at one width: below 768 pixels the
 * Primary_Navigation is collapsed behind a disclosure control (the
 * Compact_Layout), at 768 pixels and above every navigation control is directly
 * reachable and no disclosure control is rendered at all (the Wide_Layout). This
 * hook is the single place that decides which of the two is in force, so the
 * breakpoint is declared once and the header, the navigation, and their tests
 * can never disagree about where it sits.
 *
 * The value is read from `matchMedia('(min-width: 768px)')` rather than from
 * `window.innerWidth`: the media query is what the stylesheet keys off, and a
 * query subscription reports a crossing the moment it happens without polling or
 * a resize listener. Requirement 1.13 gives 500 milliseconds to render the new
 * layout after a crossing; a `change` subscription lands well inside that.
 *
 * ### Why `useSyncExternalStore`
 *
 * The media query is exactly what that hook is for — an external, mutable value
 * React does not own. Using it rather than a `useState` + `useEffect` pair buys
 * three things this hook wants:
 *
 * - the first render already sees the current width, so a Compact_Layout frame
 *   is never painted for one frame at a wide viewport (and vice versa);
 * - a crossing that happens between render and subscription cannot be missed,
 *   because React re-reads the snapshot when it subscribes; and
 * - concurrent renders all read one consistent value.
 *
 * ### Requirement 1.13 and the discarded disclosure state
 *
 * This hook deliberately holds **no** state of its own beyond the reported
 * layout. Requirement 1.13 asks that a crossing keep the active
 * Destination_Content mounted while discarding any previously expanded
 * navigation disclosure. That is achieved by the *consumer* keying the
 * disclosure's expanded state on the returned value (task 10.5) — the layout
 * changes, the keyed state is discarded, and the content, which is not keyed on
 * anything here, stays mounted. Nothing in this module unmounts anything.
 *
 * ### Environments without a usable `matchMedia`
 *
 * jsdom reports every query as non-matching, older browsers expose only the
 * deprecated `addListener`/`removeListener` pair, and a hostile or stubbed
 * `window.matchMedia` may throw. All three are handled here rather than by the
 * components: an unusable `matchMedia` yields the **Compact_Layout**, which is
 * the safe fallback because every Destination stays reachable through the
 * disclosure control (Requirement 1.6). Reporting the Wide_Layout on a guess
 * would instead render no disclosure control at an unknown width, which could
 * leave navigation off-screen (Requirement 1.8).
 *
 * Requirements: 1.6, 1.7, 1.13
 */
import { useSyncExternalStore } from 'react';

/** The two Shell_Frame layouts (Requirements 1.6, 1.7). */
export type ShellLayout = 'compact' | 'wide';

/**
 * The viewport width, in CSS pixels, at which the Wide_Layout takes over.
 *
 * Declared here and consumed by `styles/shell.css`'s media query and by the
 * layout tests, so the boundary is stated once. Requirement 1.7 makes 768
 * itself a *wide* width, which `min-width` matches inclusively.
 */
export const WIDE_LAYOUT_MIN_WIDTH_PX = 768;

/** The media query the hook and the stylesheet both key off. */
export const WIDE_LAYOUT_QUERY = `(min-width: ${WIDE_LAYOUT_MIN_WIDTH_PX}px)`;

/**
 * The layout reported where the viewport width cannot be established.
 *
 * Compact keeps every Destination reachable behind the disclosure control, so an
 * unknown width degrades to the more conservative frame rather than to one that
 * renders no disclosure control (Requirements 1.6, 1.8).
 */
const FALLBACK_LAYOUT: ShellLayout = 'compact';

/**
 * A `MediaQueryList` also carrying the deprecated listener pair, which Safari
 * before 14 and Chrome before 39 expose *instead of* `addEventListener`.
 *
 * Declared as optional members rather than asserted at the call site, so the
 * runtime checks below are type-checked too.
 */
type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

/**
 * Evaluate the Wide_Layout query, or `null` where the environment cannot.
 *
 * `window.matchMedia` is looked up on every call rather than captured once: a
 * module-level capture would bind whatever was installed at import time, which
 * both breaks stubbing in tests and misses a late-installed polyfill.
 */
function wideLayoutQuery(): LegacyMediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  try {
    return window.matchMedia(WIDE_LAYOUT_QUERY);
  } catch {
    // A rejected query is an absent one: fall back rather than fail the frame.
    return null;
  }
}

/**
 * Read the layout in force right now.
 *
 * Returns one of two string literals, so React's snapshot comparison is a value
 * comparison and re-evaluating the query object each call causes no re-render.
 */
function readLayout(): ShellLayout {
  const query = wideLayoutQuery();
  if (query === null) {
    return FALLBACK_LAYOUT;
  }
  return query.matches === true ? 'wide' : FALLBACK_LAYOUT;
}

/**
 * Subscribe to breakpoint crossings.
 *
 * Defined at module scope so its identity is stable across renders and React
 * never tears down a live subscription to install an identical one.
 */
function subscribeToLayout(onStoreChange: () => void): () => void {
  const query = wideLayoutQuery();
  if (query === null) {
    // Nothing to observe: the layout cannot change, so the snapshot cannot
    // either.
    return () => {};
  }

  // The event's own `matches` is deliberately ignored — React re-reads the
  // snapshot itself, which keeps one code path deciding the layout.
  const handleChange = (): void => {
    onStoreChange();
  };

  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', handleChange);
    return () => {
      query.removeEventListener('change', handleChange);
    };
  }

  if (typeof query.addListener === 'function') {
    // Deprecated pair, still the only one on older browsers.
    query.addListener(handleChange);
    return () => {
      query.removeListener?.(handleChange);
    };
  }

  // A `matchMedia` offering neither: the current width is still usable, there is
  // just nothing to notify us of a crossing.
  return () => {};
}

/**
 * Report which Shell_Frame layout the current viewport width calls for, and
 * re-render on every crossing of the 768-pixel boundary.
 *
 * @returns `'wide'` while the viewport is 768 CSS pixels or wider
 *   (Requirement 1.7), and `'compact'` while it is narrower — or where the
 *   width cannot be established at all (Requirement 1.6).
 *
 * Requirements: 1.6, 1.7, 1.13
 */
export function useViewportLayout(): ShellLayout {
  return useSyncExternalStore(subscribeToLayout, readLayout, () => FALLBACK_LAYOUT);
}

export default useViewportLayout;
