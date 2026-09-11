/**
 * The Shell_Frame's one disclosure primitive.
 *
 * Three surfaces of the frame open and close the same way: the
 * Notification_Panel (Requirements 5.1–5.3, 5.14), the Account_Menu
 * (Requirements 8.1, 8.5–8.7), and the Primary_Navigation list at compact widths
 * (Requirements 1.6, 1.11, 1.12). Rather than three near-identical
 * implementations drifting apart, all three wrap their content in this
 * component, which owns exactly four behaviours:
 *
 * 1. **State reporting.** The trigger receives `aria-expanded` and
 *    `aria-controls`, so the expanded or collapsed state is reported
 *    programmatically and the trigger names the surface it controls.
 * 2. **Document order.** The surface is rendered immediately after the trigger,
 *    inside a shared container. That single fact is what satisfies Requirement
 *    13.6 without a focus trap: the surface's controls already fall in the
 *    keyboard focus order immediately after the trigger and before every
 *    following control of the frame, so Tab from the last control of the surface
 *    leaves it (and leaves it open), and Shift+Tab from the first control of the
 *    surface lands back on the trigger. Nothing here confines focus, and nothing
 *    here sets `aria-modal` — these are disclosures, not dialogs.
 * 3. **Escape.** Escape pressed while focus is inside the surface, or on the
 *    trigger itself, moves focus back to the trigger and *then* requests the
 *    close (Requirements 5.3, 8.5, 1.11).
 * 4. **Outside pointer.** A `pointerdown` anywhere outside both the surface and
 *    the trigger requests the close and moves no focus at all, leaving it where
 *    the pointer put it (Requirements 5.14, 8.7).
 *
 * Points 3 and 4 are the distinction Requirements 5.3/8.5 and 5.14/8.7 draw
 * between the two ways a surface closes, and the reason this component reports a
 * close *reason* rather than a bare "closed": focus return happens for keyboard
 * closes only.
 *
 * ### Controlled, not stateful
 *
 * The component holds no open state. `open` comes from the caller — in the shell
 * that is always {@link useDisclosureGroup}, whose single `open` value makes the
 * panel, the menu, and the compact navigation mutually exclusive by construction
 * (Requirement 8.8). Keeping the state outside is what lets one surface's
 * opening close another's without either component knowing about the other, and
 * it is what lets the navigation disclosure's expansion be keyed on the viewport
 * layout so a breakpoint crossing discards it (Requirement 1.13).
 *
 * ### The closed surface is unmounted
 *
 * A closed surface renders nothing at all rather than rendering hidden. Hiding
 * with CSS alone would leave its controls in the accessibility tree and in the
 * focus order, which would contradict both the collapsed state the trigger
 * reports and Requirement 13.6's focus-order claim. `hidden` would fix the tree
 * but still leaves a stale DOM subtree behind; unmounting is unambiguous.
 *
 * ### What this component deliberately does not do
 *
 * - It does not move focus *into* the surface on opening. Only the
 *   Notification_Panel requires that (Requirement 5.1); the Account_Menu and the
 *   navigation list are reached by Tab precisely because of point 2 above. The
 *   panel therefore focuses its own content, which keeps that one-surface rule
 *   out of the shared primitive.
 * - It does not close on focus leaving the surface — Requirement 13.6 explicitly
 *   requires the surface to stay open when focus tabs out of it.
 * - It carries no colour, spacing, or position of its own: the container and
 *   surface elements carry class names only, and the shell's stylesheet supplies
 *   the presentation from theme tokens.
 *
 * Requirements: 1.11, 1.12, 5.3, 5.14, 8.5, 8.7, 13.6
 */
import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';

/**
 * Why a close was requested.
 *
 * The reason is reported so a caller can distinguish the four ways a surface
 * closes, and because this component's own focus handling differs between them:
 *
 * - `'escape'` — Escape pressed with focus inside the surface or on the trigger.
 *   Focus has already been returned to the trigger when the caller is told
 *   (Requirements 5.3, 8.5, 1.11).
 * - `'outside-pointer'` — a pointer activation outside both the surface and the
 *   trigger. No focus was moved (Requirements 5.14, 8.7).
 * - `'toggle'` — the trigger was activated while the surface was open. Focus is
 *   already on the trigger, so none is moved (Requirement 5.2).
 * - `'activate'` — reported by the *caller*, not by this component, when a
 *   control inside the surface was activated: a navigation control of the
 *   Account_Menu or of the compact Primary_Navigation closes the surface it sits
 *   in (Requirements 8.6, 1.11). The navigation that follows places focus
 *   itself, so this component moves none.
 */
export type DisclosureCloseReason = 'escape' | 'outside-pointer' | 'activate' | 'toggle';

/**
 * The props this component supplies to the caller's trigger element.
 *
 * Spread them onto the control — always a real `<button>` in the shell, so
 * Enter, Space, and pointer all activate it without a key handler of its own:
 *
 * ```tsx
 * trigger={(triggerProps) => (
 *   <button type="button" {...triggerProps}>Notifications</button>
 * )}
 * ```
 *
 * `aria-controls` is supplied whether the surface is open or closed. A reference
 * to an element that is not currently rendered is harmless, and keeping the
 * attribute stable means the relationship is discoverable before the surface is
 * ever opened.
 */
export interface DisclosureTriggerProps {
  /** The state to report programmatically (Requirements 8.1, 5.1). */
  readonly 'aria-expanded': boolean;
  /** The surface's element id, naming what the trigger controls. */
  readonly 'aria-controls': string;
  /** Opens the surface while closed, requests a `'toggle'` close while open. */
  readonly onClick: () => void;
}

export interface DisclosureProps {
  /**
   * The surface element's id, which the trigger's `aria-controls` names. Must be
   * unique in the document; the shell derives it from the surface's identity in
   * {@link useDisclosureGroup}.
   */
  readonly id: string;
  /** Whether the surface is open. Owned by the caller, never by this component. */
  readonly open: boolean;
  /**
   * Called when the trigger is activated while the surface is closed.
   *
   * A controlled disclosure cannot open itself, so this is the other half of
   * {@link onRequestClose}: together they let the trigger's single `onClick`
   * behave as a toggle without this component holding any state.
   */
  readonly onRequestOpen: () => void;
  /**
   * Called when the surface should close, carrying why.
   *
   * By the time this is called for `'escape'`, focus has already been returned
   * to the trigger; for every other reason no focus has been moved. Because the
   * caller owns `open`, a call it chooses to ignore simply leaves the surface
   * open.
   */
  readonly onRequestClose: (reason: DisclosureCloseReason) => void;
  /** Renders the control that opens and closes the surface. */
  readonly trigger: (props: DisclosureTriggerProps) => ReactElement;
  /** The surface's content, rendered only while open. */
  readonly children: ReactNode;
  /** Optional extra class for the container, for per-surface positioning. */
  readonly className?: string;
  /** Optional extra class for the surface element itself. */
  readonly surfaceClassName?: string;
}

/** Container class: the positioning context a surface is placed against. */
const CONTAINER_CLASS = 'shell-disclosure';

/** Surface class: the panel, menu, or navigation list wrapper. */
const SURFACE_CLASS = 'shell-disclosure__surface';

/**
 * Locate the trigger's focusable element within the container.
 *
 * The trigger is always the container's first element child, since the surface
 * is rendered after it. Where the caller's trigger renders a wrapper around the
 * real control, the props this component supplied identify the control inside
 * it, so `aria-controls` is used as the second attempt. Resolving the node from
 * the DOM rather than cloning a ref onto the caller's element keeps the trigger
 * entirely the caller's: it may hold its own ref, and nothing here overwrites
 * it.
 */
function resolveTriggerNode(container: HTMLElement | null): HTMLElement | null {
  const first = container?.firstElementChild;
  if (!(first instanceof HTMLElement)) {
    return null;
  }
  if (first.hasAttribute('aria-controls')) {
    return first;
  }
  return first.querySelector<HTMLElement>('[aria-controls]') ?? first;
}

/**
 * Render a trigger and the surface it discloses, with the frame's shared
 * open/close behaviour.
 *
 * Requirements: 1.11, 1.12, 5.3, 5.14, 8.5, 8.7, 13.6
 */
export function Disclosure({
  id,
  open,
  onRequestOpen,
  onRequestClose,
  trigger,
  children,
  className,
  surfaceClassName,
}: DisclosureProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleTriggerClick = useCallback(() => {
    if (open) {
      // 5.2: activating the trigger of an open surface closes it. Focus is
      // already on the trigger, so none is moved.
      onRequestClose('toggle');
      return;
    }
    onRequestOpen();
  }, [open, onRequestClose, onRequestOpen]);

  useEffect(() => {
    // Nothing to listen for while closed, so a closed disclosure costs no
    // document listeners at all — the frame keeps three of these mounted.
    if (!open) {
      return;
    }
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    /**
     * 5.14, 8.7: a pointer activation outside both the surface and the trigger
     * closes the surface and moves no focus.
     *
     * `pointerdown` rather than `click` so the close happens at the start of the
     * gesture, matching how a person perceives "I pressed somewhere else", and
     * so a press that ends outside the document still closes. Captured, so a
     * handler somewhere that stops propagation cannot leave the surface stuck
     * open. The container holds the trigger *and* the surface, which is exactly
     * the "outside both" the two requirements name.
     */
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && container.contains(target)) {
        return;
      }
      onRequestClose('outside-pointer');
    };

    /**
     * 5.3, 8.5, 1.11: Escape closes and returns focus to the trigger.
     *
     * Scoped to events originating inside the container, so Escape pressed
     * elsewhere in the document — in a form field, say — is none of this
     * surface's business. Focus is moved *before* the close is requested: the
     * surface is about to unmount, and moving focus first means it never lands
     * on `<body>` in between.
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node) || !container.contains(target)) {
        return;
      }
      resolveTriggerNode(container)?.focus();
      onRequestClose('escape');
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onRequestClose]);

  return (
    <div
      ref={containerRef}
      className={className === undefined ? CONTAINER_CLASS : `${CONTAINER_CLASS} ${className}`}
      data-shell-disclosure={id}
      // A non-colour hook for the stylesheet and for the layout tests; the
      // authoritative state for assistive technology is the trigger's
      // `aria-expanded`.
      data-open={open ? 'true' : 'false'}
    >
      {trigger({ 'aria-expanded': open, 'aria-controls': id, onClick: handleTriggerClick })}
      {open ? (
        <div
          id={id}
          className={
            surfaceClassName === undefined ? SURFACE_CLASS : `${SURFACE_CLASS} ${surfaceClassName}`
          }
          data-shell-disclosure-surface={id}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default Disclosure;
