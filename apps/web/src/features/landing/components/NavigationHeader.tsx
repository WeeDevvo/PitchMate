/**
 * NavigationHeader — the persistent header region of the landing page.
 *
 * This is the first landmark on the page. It carries the PitchMate brand and
 * the two account entry points so a visitor can act the moment they arrive,
 * without scrolling:
 *
 *   - The `Brand_Logo` is the design system's `Logo`: the mark for the active
 *     theme and the wordmark, exposed as one image named `"PitchMate"` (its
 *     marks carry empty alternatives), so the brand is announced once and
 *     survives an image failing to load (Requirements 1.6, 6.6).
 *   - A primary call to action (Sign Up) begins account creation and a *distinct*
 *     secondary call to action (Log In) begins logging in. Both render through
 *     the shared {@link Cta} control, so activation, accessibility, and
 *     defensive navigation all follow the one code path (Requirement 3.1).
 *
 * Like its sibling section components this is a thin, presentational component:
 * it reads its copy from the typed content model and owns no navigation logic.
 * The content model is injectable via props (defaulting to the authored
 * `landingContent`) so the header can be rendered in isolation under test. An
 * optional `onNavigationError` handler is forwarded to both CTAs so navigation
 * failures can be surfaced by the page-level `NavigationErrorRegion`
 * (Requirement 3.7).
 *
 * Requirements: 1.6, 3.1
 */
import { Cta, type NavigationErrorHandler } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'
import { Logo } from '../../../ui'

export interface NavigationHeaderProps {
  /**
   * The content model supplying the brand name and header CTAs. Defaults to the
   * authored {@link landingContent}; injectable for testing in isolation.
   */
  content?: LandingContent
  /**
   * Forwarded to both CTAs so a navigation failure or timeout can be surfaced
   * by the page-level navigation error region (Requirement 3.7).
   */
  onNavigationError?: NavigationErrorHandler
}

/**
 * The landing page header: brand logo plus the primary (Sign Up) and distinct
 * secondary (Log In) calls to action.
 */
export function NavigationHeader({
  content = landingContent,
  onNavigationError,
}: NavigationHeaderProps) {
  const { primary, secondary } = content.headerCtas

  return (
    <header className="landing-header">
      <Logo size={36} className="landing-header__logo" />
      <nav className="landing-header__actions" aria-label="Account">
        <Cta cta={secondary} onNavigationError={onNavigationError} />
        <Cta cta={primary} onNavigationError={onNavigationError} />
      </nav>
    </header>
  )
}

export default NavigationHeader
