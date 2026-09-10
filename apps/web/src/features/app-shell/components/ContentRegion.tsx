/**
 * The Shell_Frame's Content_Region — the one main landmark of every shell route.
 *
 * Two jobs, both of them frame-level concerns the hosted Destination_Content
 * must not have to think about:
 *
 * 1. **It is the skip target.** The `<main>` element carries a stable id and
 *    `tabIndex={-1}`, which is what lets {@link SkipLink} move keyboard focus
 *    into it (Requirement 13.1). `tabIndex={-1}` makes the element
 *    programmatically focusable without putting it in the Tab order, so the
 *    first Tab after a skip lands on the first focusable control *inside* the
 *    region and on no control of the Shell_Header.
 * 2. **It announces a content change.** Requirement 13.12 asks that an in-app
 *    navigation which changes the active Destination — or swaps the region to the
 *    Unavailable_State or the not-found indication — move keyboard focus to that
 *    route's level-one heading and convey the heading text through a live region,
 *    with no full-document reload. Both happen here.
 *
 * ### Why this component reads the DOM
 *
 * The level-one heading belongs to the Destination_Content, not to the frame
 * (Requirements 1.9, 13.2) — including for content a later feature injects,
 * which the shell never sees the source of. So rather than asking every
 * destination to register its heading with the frame, the region locates the
 * rendered `h1` inside itself after the content has committed, makes it
 * programmatically focusable, focuses it, and publishes its text. This is the
 * single place in the shell that reads DOM it does not own, and it is what keeps
 * heading ownership with the content (design → "ContentRegion").
 *
 * ### `contentKey`, not `children`, decides when to announce
 *
 * The effect keys on a caller-supplied `contentKey` naming *which* content is
 * rendered — the resolved Destination identifier, or the kind of boundary state.
 * Keying on `children` identity would re-announce on any re-render of the same
 * screen, and keying on the raw pathname would re-announce for a path change
 * that resolves to the same Destination. Requirement 13.12 fires on a change of
 * the active Destination or of the content kind, which is exactly what a change
 * of this value means.
 *
 * The first render is deliberately **not** treated as a change: arriving at a
 * shell route is not an in-app navigation, and stealing focus on arrival would
 * move it away from the start of the document before the person has done
 * anything.
 *
 * Requirements: 1.1, 1.2, 1.5, 13.1, 13.7, 13.12
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { LiveRegion } from '../../auth';

/**
 * The Content_Region element's id.
 *
 * Declared here, beside the element that carries it, and consumed by
 * {@link SkipLink}'s fragment target — so the skip link and its target cannot
 * drift apart (Requirement 13.1).
 */
export const SHELL_CONTENT_ID = 'shell-content';

export interface ContentRegionProps {
  /** The active Destination_Content, or a boundary state, to render inside `<main>`. */
  readonly children?: ReactNode;
  /**
   * Names the content currently rendered — the resolved Destination identifier
   * or the kind of boundary state.
   *
   * A change of this value is what Requirement 13.12 calls a change of the
   * Content_Region: the new content's `h1` is focused and announced. An
   * unchanged value re-renders silently, however often it happens.
   */
  readonly contentKey?: string;
  /** The element id, overridable only so a test can render two regions. */
  readonly id?: string;
}

/** The heading text of the rendered content, or `null` when it has none. */
function headingAnnouncement(heading: HTMLElement | null): string | null {
  const text = heading?.textContent?.trim() ?? '';
  return text.length > 0 ? text : null;
}

/**
 * Render the main landmark of a shell route, focusing and announcing the
 * content's level-one heading whenever the content changes.
 *
 * Requirements: 1.1, 1.2, 1.5, 13.1, 13.7, 13.12
 */
export function ContentRegion({
  children,
  contentKey,
  id = SHELL_CONTENT_ID,
}: ContentRegionProps): ReactElement {
  const regionRef = useRef<HTMLElement | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  // Seeded with the first render's value, so the first commit is not a change.
  const announcedKeyRef = useRef<string | undefined>(contentKey);

  useEffect(() => {
    if (announcedKeyRef.current === contentKey) {
      return;
    }
    announcedKeyRef.current = contentKey;

    const region = regionRef.current;
    if (region === null) {
      return;
    }

    // 13.2: the route's one level-one heading is contributed by the content, so
    // it is looked up rather than rendered here.
    const heading = region.querySelector<HTMLElement>('h1');
    if (heading === null) {
      // Content without an `h1` is a defect in that content, not a reason to
      // throw or to announce the previous screen's heading again.
      setAnnouncement(null);
      return;
    }

    // 13.12: the heading must be focusable to be focused. An `h1` the content
    // has already made focusable is left exactly as it is.
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
    }
    heading.focus();
    setAnnouncement(headingAnnouncement(heading));
  }, [contentKey]);

  return (
    <main
      id={id}
      ref={regionRef}
      // 13.1: programmatically focusable, but not in the Tab order — so the Tab
      // after a skip reaches the first control inside the region.
      tabIndex={-1}
      className="shell-content"
      data-content-key={contentKey}
    >
      {children}
      {/*
       * 13.7, 13.12: the announcement surface. It sits inside the landmark so
       * every node of the frame belongs to one, and is visually hidden by
       * `styles/shell.css` because the heading it names is already on screen.
       */}
      <div className="shell-content__announcer">
        <LiveRegion message={announcement} />
      </div>
    </main>
  );
}

export default ContentRegion;
