/**
 * The Shell_Frame's Skip_Link — the first focusable control of every shell route.
 *
 * Requirement 13.1 is precise about all three of its properties:
 *
 * - **Position.** It is rendered before the Shell_Header in document order and
 *   therefore before every focusable control of the header in the keyboard focus
 *   order. {@link ShellFrame} places it, and nothing in the frame carries a
 *   positive `tabindex` that could reorder around it.
 * - **Effect.** Activating it moves keyboard focus to the Content_Region, so the
 *   *next* Tab reaches the first focusable control inside that region and no
 *   control of the header. That works because the region is
 *   `tabIndex={-1}` — focusable programmatically, absent from the Tab order.
 * - **Presentation.** Requirement 13.11 asks for no visible presentation while
 *   it holds no focus, and for the label and its focus indicator wholly inside
 *   the viewport at every width from 360 to 1920 pixels while it does. That is
 *   declared in `styles/shell.css`; the control here is a plain anchor so it
 *   stays in the Tab order while invisible, which a `display: none` or a
 *   `hidden` attribute would not.
 *
 * ### Why an anchor with a click handler
 *
 * The element is a real `<a href="#…">`, so it is announced as a link, activates
 * on Enter, and still works if scripting is unavailable. The handler then focuses
 * the target directly rather than relying on fragment navigation, for two
 * reasons: a fragment jump alone moves the scroll position without reliably
 * moving keyboard focus in every browser, and letting the fragment land in the
 * address bar would push a history entry the person then has to back out of.
 * Where the target is genuinely absent the default is left alone, so the browser
 * does whatever it would have done.
 *
 * Requirements: 13.1, 13.3, 13.11
 */
import { type MouseEvent, type ReactElement } from 'react';
import { SHELL_CONTENT_ID } from './ContentRegion';

/** The Skip_Link's visible label and accessible name. */
export const SKIP_LINK_LABEL = 'Skip to main content';

export interface SkipLinkProps {
  /**
   * The id of the element focus moves to. Defaults to the Content_Region's id,
   * which is the only target the shell uses (Requirement 13.1).
   */
  readonly targetId?: string;
}

/**
 * Render the control that moves keyboard focus past the Shell_Header and into
 * the Content_Region.
 *
 * Requirements: 13.1, 13.3, 13.11
 */
export function SkipLink({ targetId = SHELL_CONTENT_ID }: SkipLinkProps): ReactElement {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    const target = document.getElementById(targetId);
    if (target === null) {
      // Nothing to focus: leave the browser's own fragment handling in place.
      return;
    }
    // 13.1: focus, not just scroll — and without adding a history entry.
    event.preventDefault();
    target.focus();
  };

  return (
    <a className="shell-skip-link" href={`#${targetId}`} onClick={handleClick}>
      {SKIP_LINK_LABEL}
    </a>
  );
}

export default SkipLink;
