/**
 * AuthLayout — the single-`h1` themed shell shared by every auth screen.
 *
 * Every auth screen renders its content inside this layout so a single code
 * path guarantees the shared presentation and accessibility contract:
 *
 *   - It renders exactly one level-one heading (`<h1>`) for the screen, from
 *     the required `heading` prop, and no other `h1`. Screens compose only
 *     subordinate headings (`h2`+) beneath it, keeping the outline well-formed
 *     with no skipped levels (Requirement 14.1).
 *   - It follows the design system's auth screens (ScreenWebAuth): the
 *     PitchMate logo above one centred design-system `Card`, the heading in the
 *     display face with an optional line beneath it, optional icon art (the
 *     mail or tick of a confirmation), and an optional footer line below the
 *     card for switching screens ("Already in? Log in"). Everything is painted
 *     from the `--pm-*` tokens, never hard-coded colours (Requirement 13.4).
 *   - The heading is programmatically associated with the surrounding region
 *     via `aria-labelledby`, so assistive technology announces the screen by
 *     its heading.
 *
 * The layout is intentionally presentational: it owns no form state, no
 * validation, and no navigation. Screens pass their fields, controls, and
 * messages as `children`.
 *
 * Requirements: 13.4, 14.1
 */
import { useId, type ReactNode } from 'react'
import { Card, Icon, Logo, type IconName } from '../../../ui'
import './AuthLayout.css'

export interface AuthLayoutProps {
  /**
   * The screen's single level-one heading text. Rendered as the only `<h1>`
   * on the screen (Requirement 14.1).
   */
  heading: string
  /** A short line under the heading: "Free. Takes about 20 seconds." */
  subheading?: ReactNode
  /** Icon art above the content, for a confirmation; `accent` fills it green. */
  art?: { icon: IconName; tone?: 'accent' }
  /** The screen's fields, controls, and messages. */
  children: ReactNode
  /** A line below the card, usually the link to the neighbouring screen. */
  footer?: ReactNode
  /** Optional extra class names for the outer shell. */
  className?: string
}

export function AuthLayout({ heading, subheading, art, children, footer, className }: AuthLayoutProps) {
  const headingId = useId()
  const classes = ['auth-layout', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <Logo size={34} className="auth-layout__logo" />
      <Card as="section" className="auth-layout__surface" aria-labelledby={headingId}>
        <div className="auth-layout__head">
          <h1 id={headingId} className="auth-layout__heading">
            {heading}
          </h1>
          {subheading && <p className="auth-layout__subheading">{subheading}</p>}
        </div>
        {art && (
          <span className={`auth-art${art.tone === 'accent' ? ' auth-art--accent' : ''}`} aria-hidden="true">
            <Icon name={art.icon} size={44} strokeWidth={art.tone === 'accent' ? 2.5 : 1.8} />
          </span>
        )}
        <div className="auth-layout__body">{children}</div>
      </Card>
      {footer && <div className="auth-layout__footer">{footer}</div>}
    </div>
  )
}

export default AuthLayout
