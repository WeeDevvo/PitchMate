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
 *   - It paints a themed surface and a centred, width-constrained form column
 *     entirely from the per-Theme CSS custom-property tokens in
 *     `styles/theme.css`, never from hard-coded colours (Requirements 13.4).
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
// Import the per-Theme token tables so any screen rendered through the layout
// has the auth theme tokens available (dark-mode-first; Requirements 13.1–13.4).
import '../styles/theme.css'
import './AuthLayout.css'

export interface AuthLayoutProps {
  /**
   * The screen's single level-one heading text. Rendered as the only `<h1>`
   * on the screen (Requirement 14.1).
   */
  heading: string
  /** The screen's fields, controls, and messages. */
  children: ReactNode
  /** Optional extra class names for the outer shell. */
  className?: string
}

/**
 * The themed, single-`h1` shell for an auth screen. Renders a centred form
 * column on a themed surface with the screen's heading as the only `h1`.
 */
export function AuthLayout({ heading, children, className }: AuthLayoutProps) {
  const headingId = useId()
  const classes = ['auth-layout', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <section className="auth-layout__surface" aria-labelledby={headingId}>
        <h1 id={headingId} className="auth-layout__heading">
          {heading}
        </h1>
        <div className="auth-layout__body">{children}</div>
      </section>
    </div>
  )
}

export default AuthLayout
