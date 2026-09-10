/**
 * The Shell_Header's mutual exclusion between disclosure surfaces.
 *
 * Requirement 8.8 says that opening the Account_Menu closes the
 * Notification_Panel and vice versa, so at most one of the two reports the
 * expanded state at any instant. That could be written as two booleans kept in
 * step by an effect, which is exactly the arrangement that eventually shows both
 * surfaces open at once. Instead there is **one** value naming which surface is
 * open, and "both open" is not a state this hook can represent — the requirement
 * holds by construction rather than by maintenance.
 *
 * The compact Primary_Navigation joins the same group. Requirements 1.6 and 1.11
 * do not demand that it be exclusive with the other two, but a narrow viewport is
 * precisely where two overlapping surfaces would collide, so it shares the value.
 *
 * ### Where the state lives
 *
 * In the Shell_Header, which renders all three triggers. The value must sit above
 * every surface for exclusivity to mean anything, and it must sit *inside* the
 * frame so that it is discarded when the frame unmounts — Requirement 8.1
 * requires the collapsed state on the first render of every shell route, which a
 * surface state held above the router would not give.
 *
 * ### Requirement 1.13 and the discarded navigation expansion
 *
 * A breakpoint crossing must discard an expanded navigation disclosure while
 * leaving the Destination_Content mounted. The consumer gets that by keying the
 * header's use of this hook on the value from `useViewportLayout`, so the crossing
 * remounts the hook with a fresh `null` while the content, keyed on nothing,
 * stays put. Nothing in this module observes the viewport.
 *
 * Requirements: 1.13, 8.8
 */
import { useCallback, useMemo, useState } from 'react';

/**
 * The header's disclosure surfaces, plus `null` for "none open".
 *
 * `null` is part of the type rather than a separate flag because the closed state
 * is the same kind of thing as the open ones: one value, one answer.
 */
export type ShellSurface = 'notifications' | 'account' | 'navigation' | null;

/** A surface that can be opened — the union above without its `null`. */
export type OpenableShellSurface = Exclude<ShellSurface, null>;

export interface DisclosureGroup {
  /** The one open surface, or `null` while every surface is closed. */
  readonly open: ShellSurface;
  /**
   * Open `surface`, or close it where it is already the open one.
   *
   * Wired to each trigger's activation. Opening one surface while another is
   * open replaces the value, which closes the other and makes its trigger report
   * the collapsed state in the same render (Requirement 8.8).
   */
  readonly toggle: (surface: OpenableShellSurface) => void;
  /**
   * Close `surface` if it is the open one, and otherwise change nothing.
   *
   * Naming the surface matters: an Escape or an outside pointer that resolves
   * late — after a different surface has already been opened — must not close the
   * newly opened surface. A close request for a surface that is not open is a
   * no-op, so it is safe to call from an unmounting effect or a settled promise.
   */
  readonly close: (surface: OpenableShellSurface) => void;
}

/**
 * Track which single header disclosure surface is open.
 *
 * @returns the open surface and the two operations over it. The returned object
 *   and both functions have stable identities across renders where `open` has not
 *   changed, so they can be named in dependency lists without re-running effects.
 *
 * Requirements: 1.13, 8.8
 */
export function useDisclosureGroup(): DisclosureGroup {
  // 8.1: closed on the first render of every shell route.
  const [open, setOpen] = useState<ShellSurface>(null);

  const toggle = useCallback((surface: OpenableShellSurface) => {
    setOpen((current) => (current === surface ? null : surface));
  }, []);

  const close = useCallback((surface: OpenableShellSurface) => {
    // Returning `current` unchanged for a surface that is not open keeps React
    // from re-rendering over a no-op close.
    setOpen((current) => (current === surface ? null : current));
  }, []);

  return useMemo(() => ({ open, toggle, close }), [open, toggle, close]);
}

export default useDisclosureGroup;
