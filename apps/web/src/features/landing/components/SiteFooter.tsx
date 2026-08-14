/**
 * SiteFooter — the bottom region of the landing page.
 *
 * The footer closes the page with the PitchMate brand and the supporting legal
 * links a privacy-conscious visitor looks for before signing up:
 *
 *   - The PitchMate brand is rendered as visible text within the `<footer>`, so
 *     the brand is identifiable to assistive technology even without the logo
 *     image (Requirement 8.2).
 *   - A distinctly labelled privacy policy link and a distinctly labelled terms
 *     link are rendered from the content model, each visible label identifying
 *     its destination (Requirement 8.1). Activating them navigates to the
 *     privacy / terms content (Requirements 8.3, 8.4).
 *
 * The footer links render through the shared {@link NavAnchor} control as plain
 * links (no CTA `kind`), so keyboard and pointer activation share the one
 * defensive navigation code path. If a link's destination cannot be reached the
 * control invokes `onNavigationError`; the page-level navigation error region
 * then keeps the visitor on the page and indicates the requested content is
 * unavailable (Requirement 8.5). This component forwards the handler and owns no
 * navigation logic itself.
 *
 * Like its sibling section components this is a thin, presentational component:
 * it reads its copy from the typed content model (injectable via props,
 * defaulting to the authored `landingContent`) and renders semantic markup.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */
import { NavAnchor, type NavigationErrorHandler } from './Cta'
import { landingContent, type LandingContent } from '../content/landingContent'

export interface SiteFooterProps {
  /**
   * The content model supplying the brand name and footer links. Defaults to
   * the authored {@link landingContent}; injectable for testing in isolation.
   */
  content?: LandingContent
  /**
   * Forwarded to each footer link so an unreachable destination can be surfaced
   * by the page-level navigation error region as an "unavailable" indication
   * (Requirement 8.5).
   */
  onNavigationError?: NavigationErrorHandler
}

/**
 * The landing page footer: the PitchMate brand as visible text plus the
 * distinctly labelled privacy and terms links.
 */
export function SiteFooter({
  content = landingContent,
  onNavigationError,
}: SiteFooterProps) {
  const { brandName, links } = content.footer

  return (
    <footer className="landing-footer">
      <p className="landing-footer__brand">{brandName}</p>
      <nav className="landing-footer__links" aria-label="Legal">
        {links.map((link) => (
          <NavAnchor
            key={link.href}
            label={link.label}
            href={link.href}
            onNavigationError={onNavigationError}
          />
        ))}
      </nav>
    </footer>
  )
}

export default SiteFooter
