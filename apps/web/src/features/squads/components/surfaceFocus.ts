/**
 * The one implementation of "focus enters an opened surface and returns to its
 * opener", shared by {@link FormPanel} and {@link ConfirmDialog}.
 *
 * Requirements 19.7 and 19.8 apply to *every* form and *every* confirmation of
 * the Squads_Feature — the create-squad form, the join-code form, the guest form
 * in both its modes, the invite generator, and the revoke and promote
 * confirmations. Rather than each of those repeating a focus effect and an Escape
 * handler that would drift apart, all of them render through one of the two
 * surface components, and both of those components get their focus behaviour from
 * this module. There is therefore exactly one place where the rule is written and
 * exactly one place to correct if it is wrong.
 *
 * ### Why the opener arrives as a ref
 *
 * The App_Shell's {@link Disclosure} resolves its trigger from the DOM, because a
 * disclosure's trigger is always the container's first element child and the
 * surface sits inside the same container. A squads form or confirmation has no
 * such relationship: the control that opens the guest form is a row action a long
 * way from where the form renders, and a confirmation's opener is one revoke
 * control among several identical-looking ones. Searching the DOM would have to
 * guess which one, so the caller hands over the ref it already holds and no guess
 * is made (design.md → FormPanel and ConfirmDialog).
 *
 * ### Why the surface is unmounted while closed, and what that buys
 *
 * Both components render `null` while closed rather than rendering hidden, which
 * makes *opening* the same event as *mounting* and *closing* the same event as
 * *unmounting*. Focus entry is then a mount effect and focus return is its
 * cleanup, so the two halves of Requirement 19.7 cannot fall out of step: there
 * is no code path that opens without focusing inward or closes without returning
 * focus, whatever the reason for the close — the dismiss control, Escape, or the
 * caller closing the surface itself after a successful submission.
 *
 * It also means a closed surface leaves no controls in the accessibility tree or
 * the focus order, which is what keeps the document-order keyboard reachability
 * of Requirement 19.4 true for the screen around it.
 *
 * ### What this module deliberately does not do
 *
 * - **It confines no focus.** Neither surface is `aria-modal`, and Tab out of one
 *   reaches the rest of the screen, exactly as the shell's disclosures do. A trap
 *   is not asked for by 19.7 or 19.8, and an incorrect one is worse than none.
 * - **It owns no open state.** `open` comes from the caller, so a screen can keep
 *   a form open through a failed submission with every entered value retained.
 * - **It listens on no document.** Escape is handled by a React key handler on
 *   the surface element, so it fires only for a key pressed with focus inside the
 *   surface — which is the literal condition of Requirement 19.8 — and two nested
 *   surfaces cannot both close from one keypress.
 *
 * Requirements: 19.7, 19.8
 */
import { useEffect, useRef, type RefObject } from 'react';

/**
 * The controls that can hold keyboard focus, in document order.
 *
 * `[tabindex="-1"]` is excluded, which also excludes each surface's own root
 * element — it carries `tabIndex={-1}` solely so it can be the fallback focus
 * target for a surface holding no focusable control at all. A `disabled` control
 * is excluded because it cannot hold focus; an `aria-disabled` one is not,
 * because it can, and both surfaces mark a pending submit control that way for
 * exactly that reason.
 *
 * The same selector as the App_Shell's Notification_Panel, deliberately: "the
 * first focusable element" should mean the same thing on a squads screen as it
 * does inside the shell frame around it.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Why a surface is closing.
 *
 * Reported to the caller so a screen can distinguish an abandoned form from one
 * closed by Escape if it ever needs to, and because naming the reason makes the
 * "closes without submitting" half of Requirement 19.8 explicit at the call site:
 * neither reason carries a submission.
 *
 * - `'escape'` — Escape pressed with keyboard focus inside the surface (19.8).
 * - `'dismiss'` — the surface's own cancel control was activated (19.7).
 *
 * A caller that closes the surface for its own reasons — a successful submission,
 * say — simply sets `open` to `false` and is never handed a reason.
 */
export type SurfaceCloseReason = 'escape' | 'dismiss';

/**
 * The heading levels a surface may use.
 *
 * A form or confirmation opens inside a section that already has a heading, so
 * the level is the caller's to state: a panel opened from the Squads_Home sits
 * under its `h1` and takes `h2`, while the guest form sits under the
 * administration `h2` and its guests `h3` and takes `h4`. Constraining the prop
 * to this union keeps a surface from skipping a level, which
 * `validateHeadingOutline` would otherwise catch only once a screen renders
 * (Requirements 19.1, 19.2).
 */
export type SurfaceHeadingLevel = 2 | 3 | 4 | 5;

/** The first focusable control inside `root`, or `null` when it holds none. */
export function firstFocusableWithin(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
}

/**
 * Moves focus into a surface on mount and back to its opener on unmount.
 *
 * Returns the ref to attach to the surface's root element. Only ever called from
 * a component that is mounted *because* the surface is open, so the effect below
 * is mount-only by construction rather than by a dependency list that has to be
 * kept honest.
 *
 * `openerRef` must be a stable ref object — in practice one from `useRef` in the
 * screen or row that owns the opener control. It is read at the moment focus is
 * returned rather than captured on mount, so a caller re-rendering around the
 * opener does not strand the reference.
 *
 * Requirements: 19.7
 */
export function useSurfaceFocus(
  openerRef: RefObject<HTMLElement | null>,
): RefObject<HTMLDivElement | null> {
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) {
      return;
    }

    // 19.7, entry: the first focusable element of the surface, or the surface
    // itself when it has none. Reading the DOM once here — rather than each
    // component picking a field to focus — is what makes "the first focusable
    // element" a fact about document order instead of a per-form decision.
    (firstFocusableWithin(surface) ?? surface).focus();

    return () => {
      // 19.7, return: focus goes back to the control that opened the surface.
      //
      // Two conditions guard it, because "return focus" is only right while the
      // opener is still there to receive it and while nobody has deliberately
      // moved focus elsewhere:
      //
      //  1. The opener must still be connected to the document. When a surface
      //     closes because its whole screen unmounted — a successful creation
      //     navigating to the new squad, or the session ending — the opener is
      //     gone, and focusing a detached node would silently drop focus onto
      //     `<body>` on the *new* screen.
      //  2. Focus must not already sit on some *other* control of the screen.
      //     Neither surface confines focus, so a person may Tab out and keep
      //     working; pulling them back to the opener at the moment the surface
      //     closed would be the surface taking focus, not returning it.
      //
      // `<body>` is what focus reads as in the ordinary case, because by the time
      // this cleanup runs React has already detached the surface's subtree and the
      // control that had focus went with it. So `<body>` — and a node that is no
      // longer connected — both mean "focus was inside", and both pass.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reading the ref late is the point: the opener node may have been re-rendered or removed since the surface opened, and the connectedness check below is what makes the late reading safe
      const opener = openerRef.current;
      if (opener === null || !opener.isConnected) {
        return;
      }

      const active = document.activeElement;
      const focusLeftDeliberately =
        active instanceof HTMLElement &&
        active !== opener &&
        active !== document.body &&
        active.isConnected &&
        !surface.contains(active);
      if (focusLeftDeliberately) {
        return;
      }

      opener.focus();
    };
  }, [openerRef]);

  return surfaceRef;
}
