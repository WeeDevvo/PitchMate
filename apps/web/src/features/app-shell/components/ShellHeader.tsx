/**
 * The Shell_Header — the banner landmark of every shell route.
 *
 * It follows the design system's top bar: the brand control (the way home), then
 * the Notification_Indicator and the Account_Menu, in that document order, which
 * is also the visual reading order and therefore the keyboard focus order
 * (Requirements 1.1, 1.2, 13.3). There is no row of destination links: Profile
 * and Settings live in the Account_Menu, and the Notification_Panel links to the
 * Notifications_Destination. It renders **no** level-one heading, because the
 * single `h1` of a shell route belongs to the active Destination_Content
 * (Requirements 1.9, 13.2).
 *
 * ### The landmark this component owns
 *
 * The `<header>` is the frame's one banner landmark (Requirement 1.5). It is owned
 * *here* rather than by the components that fill it, so "exactly one banner" is a
 * structural property of the frame rather than something each child has to be
 * trusted not to duplicate.
 *
 * ### The two slots
 *
 * The header takes the notification and account surfaces as render props rather
 * than importing them. Each slot receives a {@link ShellDisclosureController} for
 * its own surface, whose four members map one-to-one onto {@link Disclosure}'s
 * controlled props:
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
 * A slot that is not supplied renders nothing, which keeps the landmark count and
 * the frame's focus order intact.
 *
 * ### A breakpoint crossing closes an open surface
 *
 * The disclosure group lives in the header, and the header keys the subtree
 * holding it on the layout value from `useViewportLayout`. A breakpoint crossing
 * therefore remounts that subtree with a fresh `null` — an open panel or menu,
 * positioned for the old layout, is discarded — while the `<header>` element
 * itself and the Content_Region, which are outside the keyed subtree, stay
 * mounted. No effect watches the viewport, and nothing reaches across to reset
 * state.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.9, 8.8, 13.2, 13.3
 */
import { useMemo, type ReactElement, type ReactNode } from 'react';
import { TopBar } from '../../../ui';
import { BrandControl } from './BrandControl';
import type { DisclosureCloseReason } from './Disclosure';
import {
  useDisclosureGroup,
  type OpenableShellSurface,
} from '../state/useDisclosureGroup';
import { useViewportLayout, type ShellLayout } from '../state/useViewportLayout';

/**
 * The element ids of the two disclosure surfaces.
 *
 * Fixed rather than generated, so a trigger's `aria-controls` names the same id
 * across renders. Module-private on purpose: every consumer reads the id it needs
 * from its own {@link ShellDisclosureController}, so no surface can name another
 * surface's id.
 */
const SHELL_SURFACE_IDS: Readonly<Record<OpenableShellSurface, string>> = {
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

/** What each header slot is given. */
export interface ShellHeaderSlotProps {
  /** That surface's disclosure seam. */
  readonly disclosure: ShellDisclosureController;
}

export interface ShellHeaderProps {
  /** Renders the Notification_Indicator and its panel. */
  readonly notifications?: (props: ShellHeaderSlotProps) => ReactNode;
  /** Renders the Account_Menu's trigger and its menu. */
  readonly account?: (props: ShellHeaderSlotProps) => ReactNode;
}

/**
 * The header's contents below the banner element: the part keyed on the layout,
 * so a breakpoint crossing discards an open surface.
 */
function ShellHeaderControls({ notifications, account }: ShellHeaderProps): ReactElement {
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
        notifications: controllerFor('notifications'),
        account: controllerFor('account'),
      };
    },
    [open, toggle, close],
  );

  return (
    <>
      <BrandControl className="shell-header__brand" />
      <div className="shell-header__actions">
        {notifications?.({ disclosure: controllers.notifications }) ?? null}
        {account?.({ disclosure: controllers.account }) ?? null}
      </div>
    </>
  );
}

/**
 * The Shell_Header: the banner landmark around the brand control and the two
 * header surfaces.
 */
export function ShellHeader(props: ShellHeaderProps): ReactElement {
  const layout: ShellLayout = useViewportLayout();

  return (
    // `role="banner"` is redundant for a top-level `<header>`, and stated anyway
    // so the landmark survives a later change of wrapper element
    // (Requirement 1.5).
    <TopBar role="banner" className="shell-header" data-layout={layout}>
      <ShellHeaderControls key={layout} {...props} />
    </TopBar>
  );
}

export default ShellHeader;
