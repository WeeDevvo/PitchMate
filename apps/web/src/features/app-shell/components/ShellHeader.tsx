/**
 * The Shell_Header — the banner landmark of every shell route.
 *
 * It carries the brand control, the Primary_Navigation landmark, the
 * Notification_Indicator, and the Account_Menu, in that document order, which is
 * also the visual reading order and therefore the keyboard focus order
 * (Requirements 1.1, 1.2, 13.3). It renders **no** level-one heading, because
 * the single `h1` of a shell route belongs to the active Destination_Content
 * (Requirements 1.9, 13.2).
 *
 * ### The two landmarks this component owns
 *
 * The `<header>` is the frame's one banner landmark and the `<nav>` inside it is
 * the frame's one navigation landmark (Requirement 1.5). Both elements are owned
 * *here* rather than by the components that fill them, so "exactly one banner,
 * exactly one navigation" is a structural property of the frame rather than
 * something each child has to be trusted not to duplicate. The consequence for
 * `PrimaryNavigation` is explicit: it renders the destination controls and, at
 * compact widths, the disclosure that collapses them — but **not** a `<nav>` of
 * its own.
 *
 * ### The three slots
 *
 * The header takes the navigation, notification, and account surfaces as render
 * props rather than importing them, so this file does not change as those
 * surfaces land (tasks 10.5, 11.x, 12.x). Each slot receives a
 * {@link ShellDisclosureController} for its own surface, whose four members map
 * one-to-one onto {@link Disclosure}'s controlled props:
 *
 * ```tsx
 * <ShellHeader
 *   notifications={({ disclosure }) => (
 *     <Disclosure
 *       id={disclosure.surfaceId}
 *       open={disclosure.open}
 *       onRequestOpen={disclosure.requestOpen}
 *       onRequestClose={disclosure.requestClose}
 *       trigger={(triggerProps) => <NotificationIndicator {...triggerProps} />}
 *     >
 *       <NotificationPanel />
 *     </Disclosure>
 *   )}
 * />
 * ```
 *
 * A slot that is not supplied renders nothing, which keeps the landmark counts
 * and the frame's focus order intact while those surfaces are still to come. The
 * navigation slot additionally receives the current layout, because it is the one
 * surface whose *shape* differs between the Compact_Layout and the Wide_Layout
 * (Requirements 1.6, 1.7).
 *
 * ### Requirement 1.13: the discarded navigation expansion
 *
 * The disclosure group lives in the header, and the header keys the subtree
 * holding it on the layout value from `useViewportLayout`. A breakpoint crossing
 * therefore remounts that subtree with a fresh `null` — the expanded navigation
 * is discarded — while the `<header>` element itself and the Content_Region,
 * which are outside the keyed subtree, stay mounted. No effect watches the
 * viewport, and nothing reaches across to reset state.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.9, 1.13, 8.8, 13.2, 13.3
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { BrandControl } from './BrandControl';
import type { DisclosureCloseReason } from './Disclosure';
import {
  useDisclosureGroup,
  type OpenableShellSurface,
} from '../state/useDisclosureGroup';
import { useViewportLayout, type ShellLayout } from '../state/useViewportLayout';

/** The accessible name of the frame's one navigation landmark (Requirement 1.5). */
export const PRIMARY_NAVIGATION_LABEL = 'Primary';

/**
 * The element ids of the three disclosure surfaces.
 *
 * Fixed rather than generated, so a trigger's `aria-controls` names the same id
 * across renders. Module-private on purpose: every consumer reads the id it needs
 * from its own {@link ShellDisclosureController}, so no surface can name another
 * surface's id.
 */
const SHELL_SURFACE_IDS: Readonly<Record<OpenableShellSurface, string>> = {
  navigation: 'shell-primary-navigation',
  notifications: 'shell-notification-panel',
  account: 'shell-account-menu',
};

/**
 * One header surface's open/close seam, shaped to be handed straight to
 * {@link Disclosure}.
 */
export interface ShellDisclosureController {
  /** The surface element's id, for `Disclosure`'s `id` and `aria-controls`. */
  readonly surfaceId: string;
  /** Whether this surface is the one open surface (Requirement 8.8). */
  readonly open: boolean;
  /** Open this surface, which closes whichever other surface was open. */
  readonly requestOpen: () => void;
  /**
   * Close this surface. The reason is accepted so the seam matches
   * `Disclosure`'s `onRequestClose` exactly; the header itself needs only to
   * know that the surface should close, because `Disclosure` has already
   * returned focus for the reasons that call for it.
   */
  readonly requestClose: (reason: DisclosureCloseReason) => void;
}

/** What the navigation slot receives. */
export interface ShellNavigationSlotProps {
  /** The layout in force, which decides whether the list is collapsed. */
  readonly layout: ShellLayout;
  /** The compact-layout navigation disclosure (Requirements 1.6, 1.11, 1.12). */
  readonly disclosure: ShellDisclosureController;
}

/** What the notification and account slots receive. */
export interface ShellHeaderSlotProps {
  /** That surface's disclosure seam. */
  readonly disclosure: ShellDisclosureController;
}

export interface ShellHeaderProps {
  /**
   * Renders the Primary_Navigation's contents *inside* the header's `<nav>`
   * landmark. Must not render a navigation landmark of its own
   * (Requirement 1.5).
   */
  readonly navigation?: (props: ShellNavigationSlotProps) => ReactNode;
  /** Renders the Notification_Indicator and its panel. */
  readonly notifications?: (props: ShellHeaderSlotProps) => ReactNode;
  /** Renders the Account_Menu's trigger and its menu. */
  readonly account?: (props: ShellHeaderSlotProps) => ReactNode;
}

/**
 * The header's contents, remounted on a breakpoint crossing so the navigation
 * expansion is discarded while the banner element stays put (Requirement 1.13).
 */
function ShellHeaderControls({
  layout,
  navigation,
  notifications,
  account,
}: ShellHeaderProps & { readonly layout: ShellLayout }): ReactElement {
  // 8.8: one value, so at most one surface is open — "both open" is not a state
  // this can represent.
  const { open, toggle, close } = useDisclosureGroup();

  const controllers = useMemo<Readonly<Record<OpenableShellSurface, ShellDisclosureController>>>(
    () => {
      const controllerFor = (surface: OpenableShellSurface): ShellDisclosureController => ({
        surfaceId: SHELL_SURFACE_IDS[surface],
        open: open === surface,
        requestOpen: () => toggle(surface),
        requestClose: () => close(surface),
      });
      return {
        navigation: controllerFor('navigation'),
        notifications: controllerFor('notifications'),
        account: controllerFor('account'),
      };
    },
    [open, toggle, close],
  );

  return (
    <>
      <BrandControl className="shell-header__brand" />
      {/*
       * 1.5: the frame's one navigation landmark. Its contents arrive through the
       * slot; the landmark itself is the frame's, so it cannot be duplicated.
       */}
      <nav className="shell-header__nav" aria-label={PRIMARY_NAVIGATION_LABEL}>
        {navigation?.({ layout, disclosure: controllers.navigation }) ?? null}
      </nav>
      <div className="shell-header__actions">
        {notifications?.({ disclosure: controllers.notifications }) ?? null}
        {account?.({ disclosure: controllers.account }) ?? null}
      </div>
    </>
  );
}

/**
 * Render the banner landmark of a shell route.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.9, 1.13, 8.8, 13.2, 13.3
 */
export function ShellHeader(props: ShellHeaderProps): ReactElement {
  const layout = useViewportLayout();

  return (
    // `role="banner"` is redundant for a top-level `<header>`, and stated anyway
    // so the landmark survives a later change of wrapper element
    // (Requirement 1.5).
    <header role="banner" className="shell-header" data-layout={layout}>
      <ShellHeaderControls key={layout} layout={layout} {...props} />
    </header>
  );
}

export default ShellHeader;
