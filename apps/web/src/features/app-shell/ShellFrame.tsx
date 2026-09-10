/**
 * The Shell_Frame — the persistent chrome every authenticated screen hangs off.
 *
 * Three children in a fixed document order, which is the whole of the frame's
 * structure (Requirements 1.1, 1.2, 13.1):
 *
 * ```
 * SkipLink  →  ShellHeader (banner, containing the one navigation)  →  ContentRegion (main)
 * ```
 *
 * The frame contributes **no** level-one heading, so the single `h1` of a shell
 * route always belongs to the active Destination_Content or to a boundary state
 * rendered inside the Content_Region (Requirements 1.9, 13.2).
 *
 * ### Why the header stays mounted
 *
 * The frame is the element of the `/app` layout route and the destinations are
 * its child routes, so a navigation between destinations re-renders the frame
 * with different `<Outlet />` content and remounts nothing else: the header keeps
 * its DOM node, its disclosure state, and the notification poll loop, and no
 * full-document reload happens (Requirements 1.3, 4.1).
 *
 * ### The announcement key
 *
 * Requirement 13.12 fires on a change of the active Destination or of the content
 * kind, not on every path change — `/app/settings` and `/app/settings/anything`
 * are the same screen. The frame therefore derives the Content_Region's
 * `contentKey` from the pure resolver rather than from the raw pathname, which
 * also means the announcement follows the same single resolution used for
 * active-state marking (Requirements 3.11, 3.12).
 *
 * ### Composition
 *
 * The frame renders the header's three surface slots straight through. It knows
 * nothing about what fills them, so the notification, account, and navigation
 * surfaces are wired where the route table is assembled (task 14.5) and this file
 * does not change as they land.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.9, 13.1, 13.2, 13.12
 */
import { type ReactElement, type ReactNode } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ContentRegion } from './components/ContentRegion';
import { ShellHeader, type ShellHeaderProps } from './components/ShellHeader';
import { SkipLink } from './components/SkipLink';
import { resolveDestination } from './lib/routeResolution';
// The per-Theme token tables first, then the layout that references them: the
// tables are the only place a colour value is written for the shell, and every
// `var(--token)` in `shell.css` resolves from them (Requirements 12.8, 13.4).
import './styles/theme.css';
import './styles/shell.css';

export interface ShellFrameProps extends ShellHeaderProps {
  /**
   * The Content_Region's content. Omitted in the route table, where the active
   * child route supplies it through `<Outlet />`; supplied directly by tests and
   * by any host that composes the frame without nested routes.
   */
  readonly children?: ReactNode;
}

/**
 * Name the content the Content_Region currently holds, for the announcement in
 * Requirement 13.12.
 *
 * A resolving path names its Destination; every non-resolving path under `/app`
 * is the not-found indication, which is one content kind however many paths reach
 * it (Requirement 3.10).
 */
function contentKeyForPath(pathname: string): string {
  const resolution = resolveDestination(pathname);
  return resolution.kind === 'destination' ? `destination:${resolution.id}` : 'not-found';
}

/**
 * Render the persistent frame: skip link, banner header, and main content region.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5, 1.9, 13.1, 13.2, 13.12
 */
export function ShellFrame({ children, ...headerSlots }: ShellFrameProps): ReactElement {
  const { pathname } = useLocation();

  return (
    <div className="shell-frame">
      {/* 13.1: before the header in document order, so it is the first Tab stop. */}
      <SkipLink />
      <ShellHeader {...headerSlots} />
      <ContentRegion contentKey={contentKeyForPath(pathname)}>
        {children === undefined ? <Outlet /> : children}
      </ContentRegion>
    </div>
  );
}

export default ShellFrame;
