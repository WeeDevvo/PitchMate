/**
 * The Shell_Header's PitchMate brand control.
 *
 * Requirement 1.4 asks for a brand control in the header with a text alternative
 * naming PitchMate which, on activation, navigates to the Home_Destination
 * without a full-document reload. All three parts are load-bearing:
 *
 * - **A router `Link`, not an anchor.** The navigation is client-side, so the
 *   Shell_Header stays mounted and only the Content_Region's children change
 *   (Requirements 1.3, 1.4).
 * - **`HOME_ROUTE` from the registry.** The target is the registered
 *   Home_Destination path — the same value as the Auth_Feature's
 *   `DEFAULT_AUTHENTICATED_ROUTE` — rather than a literal repeated here
 *   (Requirement 3.2).
 * - **The name comes from visible text.** The logo image carries an empty text
 *   alternative and the brand name sits beside it as real text, which is exactly
 *   what Requirement 13.9 asks for: an icon whose meaning is already conveyed by
 *   adjacent text takes an empty alternative, so assistive technology announces
 *   "PitchMate" once rather than twice. The name also survives an image that
 *   fails to load.
 *
 * Requirements: 1.4, 13.9
 */
import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { HOME_ROUTE } from '../lib/destinations';
import brandLogoUrl from '../../../assets/PitchMate_Logo.png';

/** The brand name, which is also the control's accessible name (Requirement 1.4). */
export const BRAND_NAME = 'PitchMate';

export interface BrandControlProps {
  /** Optional extra class, for the header's own placement of the control. */
  readonly className?: string;
}

/**
 * Render the brand control that navigates to the Home_Destination.
 *
 * Requirements: 1.4, 13.9
 */
export function BrandControl({ className }: BrandControlProps): ReactElement {
  return (
    <Link
      to={HOME_ROUTE}
      className={className === undefined ? 'shell-brand' : `shell-brand ${className}`}
    >
      <img
        className="shell-brand__logo"
        src={brandLogoUrl}
        // 13.9: empty alternative — the name beside it carries the meaning.
        alt=""
        width={160}
        height={40}
      />
      <span className="shell-brand__name">{BRAND_NAME}</span>
    </Link>
  );
}

export default BrandControl;
