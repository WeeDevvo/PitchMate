/**
 * The Primary_Navigation's contents — one control per registered Destination.
 *
 * Requirement 3.3 asks for exactly one control per registered Destination, each
 * labelled with that Destination's visible label, and no control for anything
 * that is not a registered Destination route path. That is a `map` over
 * {@link SHELL_DESTINATIONS} and nothing else: the registry is the only source of
 * controls, so an unregistered path cannot acquire one and a registered one
 * cannot be missed.
 *
 * ### This component renders no navigation landmark
 *
 * The `<nav aria-label="Primary">` belongs to {@link ShellHeader}, which owns
 * both of the frame's landmarks so that "exactly one banner, exactly one
 * navigation" holds structurally rather than by each child being trusted not to
 * duplicate them (Requirement 1.5). This component renders the destination list
 * and, at compact widths, the disclosure that collapses it — never a `<nav>` of
 * its own.
 *
 * ### Client-side navigation (Requirements 3.4, 1.3)
 *
 * Every control is a router `Link`, so activating it replaces the
 * Content_Region's children while the Shell_Header keeps its DOM node, its
 * disclosure state, and its poll loop. No full-document reload happens, and
 * nothing here calls `window.location`.
 *
 * ### Active marking (Requirements 3.5, 3.10, 3.11)
 *
 * The active Destination comes from {@link resolveDestination} — the one pure
 * resolver the frame also uses to key its content-change announcement — applied
 * to the router's current pathname. Because that function yields either exactly
 * one Destination identifier or the not-found outcome, "exactly one control
 * marked current, and none while the path resolves to nothing" is a property of
 * the resolver rather than of a comparison written here. `aria-current` is
 * omitted rather than set to `false` on the other controls, since
 * `aria-current="false"` is a *stated* "not current" and only the current control
 * should carry the attribute at all.
 *
 * The mark is not colour alone (Requirements 3.5, 13.8): `styles/shell.css`
 * pairs `--nav-current` with a heavier font weight and a left inset bar on
 * `.shell-nav__link[aria-current='page']`, so the active control is
 * distinguishable with colour perception absent and with colour overridden. The
 * `data-current` attribute is the same fact in a form the layout tests can read.
 *
 * ### Compact versus wide (Requirements 1.6, 1.7, 1.11, 1.12, 1.13)
 *
 * At wide widths the list is rendered directly and **no disclosure control
 * exists at all** — not a hidden one — so the Wide_Layout offers exactly one
 * route to each Destination (Requirement 1.7). At compact widths the same list
 * is wrapped in the frame's shared {@link Disclosure}, which supplies the
 * `aria-expanded`/`aria-controls` reporting, Escape closing with focus returned
 * to the trigger, and the outside-pointer close.
 *
 * Two things this component adds on top of that primitive:
 *
 * 1. **Collapse on navigation.** Activating a destination control while the list
 *    is expanded requests an `'activate'` close. `Disclosure` deliberately moves
 *    no focus for that reason, so focus is returned to the trigger *here*, before
 *    the close is requested — the activated `Link` is about to unmount with the
 *    surface, and moving focus first means it never lands on `<body>` in between
 *    (Requirement 1.12).
 * 2. **Nothing else.** The open state is the caller's, arriving through the
 *    header's {@link ShellDisclosureController}. The header keys the subtree
 *    holding that state on the layout value, which is how a breakpoint crossing
 *    discards an expansion while the Destination_Content stays mounted
 *    (Requirement 1.13). No effect here watches the viewport.
 *
 * Requirements: 1.6, 1.7, 1.11, 1.12, 1.13, 3.3, 3.4, 3.5, 3.6
 */
import { useCallback, useRef, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Disclosure } from './Disclosure';
import type { ShellNavigationSlotProps } from './ShellHeader';
import { SHELL_DESTINATIONS, type DestinationId } from '../lib/destinations';
import { PRIMARY_NAVIGATION_TOGGLE } from '../lib/messages';
import { resolveDestination } from '../lib/routeResolution';

/**
 * What the Shell_Header's navigation slot supplies.
 *
 * Aliased from the header's own slot type rather than restated, so the component
 * and the slot it fills cannot drift apart.
 */
export type PrimaryNavigationProps = ShellNavigationSlotProps;

/**
 * Render the destination controls.
 *
 * `onActivate` is supplied only in the Compact_Layout, where activating a control
 * must also collapse the list (Requirement 1.12). In the Wide_Layout there is
 * nothing to collapse, so no handler is attached at all.
 */
function DestinationList({
  currentDestinationId,
  collapsible,
  onActivate,
}: {
  readonly currentDestinationId: DestinationId | null;
  readonly collapsible: boolean;
  readonly onActivate?: () => void;
}): ReactElement {
  return (
    <ul
      className={
        collapsible
          ? 'shell-nav__list shell-nav__list--collapsible'
          : 'shell-nav__list'
      }
    >
      {SHELL_DESTINATIONS.map((destination) => {
        const current = destination.id === currentDestinationId;

        return (
          <li key={destination.id} className="shell-nav__item">
            <Link
              to={destination.path}
              className="shell-nav__link"
              data-destination={destination.id}
              // 3.5: only the active control carries the attribute at all.
              aria-current={current ? 'page' : undefined}
              // The same fact as an attribute the stylesheet and the layout tests
              // can key off without reading ARIA.
              data-current={current ? 'true' : 'false'}
              onClick={onActivate}
            >
              {destination.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Render the Primary_Navigation's destination controls, collapsed behind a
 * disclosure control in the Compact_Layout.
 *
 * Requirements: 1.6, 1.7, 1.11, 1.12, 1.13, 3.3, 3.4, 3.5, 3.6
 */
export function PrimaryNavigation({
  layout,
  disclosure,
}: PrimaryNavigationProps): ReactElement {
  // 3.6: the pathname is whatever the router resolved, whether it arrived from an
  // in-app navigation or from a web address entered directly.
  const { pathname } = useLocation();
  const resolution = resolveDestination(pathname);
  const currentDestinationId: DestinationId | null =
    resolution.kind === 'destination' ? resolution.id : null;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { open, requestClose } = disclosure;

  /**
   * 1.12: collapse the expanded list and return focus to the disclosure control.
   *
   * Focus moves before the close is requested, because the close unmounts the
   * control that currently holds it. The navigation itself is the `Link`'s own
   * business and happens either way.
   */
  const handleActivate = useCallback(() => {
    if (!open) {
      return;
    }
    triggerRef.current?.focus();
    requestClose('activate');
  }, [open, requestClose]);

  // 1.7: at wide widths the controls are rendered directly and no disclosure
  // control is rendered at all.
  if (layout === 'wide') {
    return (
      <DestinationList currentDestinationId={currentDestinationId} collapsible={false} />
    );
  }

  // 1.6: collapsed on first render — the header's disclosure group starts closed
  // — behind a control that reports the expanded or collapsed state
  // programmatically, which `Disclosure` supplies to the trigger.
  return (
    <Disclosure
      id={disclosure.surfaceId}
      open={open}
      onRequestOpen={disclosure.requestOpen}
      onRequestClose={requestClose}
      className="shell-nav__disclosure"
      surfaceClassName="shell-nav__surface"
      trigger={(triggerProps) => (
        <button ref={triggerRef} type="button" className="shell-nav__toggle" {...triggerProps}>
          {PRIMARY_NAVIGATION_TOGGLE}
        </button>
      )}
    >
      <DestinationList
        currentDestinationId={currentDestinationId}
        collapsible
        onActivate={handleActivate}
      />
    </Disclosure>
  );
}

export default PrimaryNavigation;
