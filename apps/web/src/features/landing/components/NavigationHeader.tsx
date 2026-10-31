/**
 * NavigationHeader — the persistent header region of the landing page.
 *
 * This is the first landmark on the page. It carries the PitchMate brand, links
 * to the page's own sections, and the two account entry points so a visitor can
 * act the moment they arrive, without scrolling:
 *
 *   - The `Brand_Logo` is the design system's `Logo`: the mark for the active
 *     theme and the wordmark, exposed as one image named `"PitchMate"` (its
 *     marks carry empty alternatives), so the brand is announced once and
 *     survives an image failing to load (Requirements 1.6, 6.6).
 *   - Section links ("How it works", "Fair teams", "Stats") are plain fragment
 *     links the browser scrolls to. They are hidden on narrow screens, where
 *     the page is one short column anyway.
 *   - A primary call to action (Start a squad) begins account creation and a
 *     *distinct* ghost call to action (Log in) begins logging in. Both render
 *     through the shared {@link Cta} control, so activation, accessibility, and
 *     defensive navigation all follow the one code path (Requirement 3.1).
 *
 * Like its sibling section components this is a thin, presentational component:
 * it reads its copy from the typed content model and owns no navigation logic.
 * An optional `onNavigationError` handler is forwarded to both CTAs so
 * navigation failures can be surfaced by the page-level `NavigationErrorRegion`
 * (Requirement 3.7).
 *
 * Requirements: 1.6, 3.1
 */
import { Cta, type NavigationErrorHandler } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'
import { Logo } from '../../../ui'

export interface NavigationHeaderProps {
  /**
   * The content model supplying the section links and header CTAs. Defaults to
   * the authored {@link landingContent}; injectable for testing in isolation.
   */
  content?: LandingContent
  /**
   * Forwarded to both CTAs so a navigation failure or timeout can be surfaced
   * by the page-level navigation error region (Requirement 3.7).
   */
  onNavigationError?: NavigationErrorHandler
}

/**
 * The landing page header: brand logo, section links, then the ghost (Log in)
 * and primary (Start a squad) calls to action.
 */
export function NavigationHeader({
  content = landingContent,
  onNavigationError,
}: NavigationHeaderProps) {
  const { sections, primary, secondary } = content.header

  return (
    <header className="landing-header">
      <Logo size={28} className="landing-header__logo" />
      <nav className="landing-header__sections" aria-label="On this page">
        {sections.map((section) => (
          <a key={section.href} href={section.href} className="landing-header__section">
            {section.label}
          </a>
        ))}
      </nav>
      <nav className="landing-header__actions" aria-label="Account">
        <Cta cta={secondary} size="sm" onNavigationError={onNavigationError} />
        <Cta cta={primary} size="sm" onNavigationError={onNavigationError} />
      </nav>
    </header>
  )
}

export default NavigationHeader
