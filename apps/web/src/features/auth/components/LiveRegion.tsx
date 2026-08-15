/**
 * LiveRegion — an accessible live region for auth validation and backend
 * messages.
 *
 * When a validation message or a backend error is shown on an auth screen, it
 * must be conveyed to assistive technology without moving keyboard focus
 * (Requirement 14.6). This component is that announcement surface, mirroring
 * the landing feature's `NavigationErrorRegion` pattern:
 *
 *   - It is always present in the DOM, even when empty, so a message inserted
 *     into it later is reliably announced.
 *   - It carries `aria-live` (default `polite`) and `aria-atomic`, so a newly
 *     appearing message is announced in place — focus is never moved here, so
 *     keyboard flow is preserved (Requirement 14.6).
 *   - It is presentational and controlled: it owns no message logic and no
 *     focus management; the screen passes the current `message` (or `null` when
 *     there is nothing to report).
 *
 * For an assertive announcement (e.g. a submit failure) callers pass
 * `politeness="assertive"`, which also exposes `role="alert"`.
 *
 * Requirements: 14.6
 */

export interface LiveRegionProps {
  /**
   * The message to announce, or `null`/`undefined` when there is nothing to
   * report. When empty, the region renders quietly so future messages are
   * still announced.
   */
  message?: string | null
  /**
   * How urgently the message is announced. `polite` (default) waits for a
   * pause; `assertive` interrupts and also exposes `role="alert"`.
   */
  politeness?: 'polite' | 'assertive'
  /**
   * Optional id so a control can reference this region (e.g. via
   * `aria-describedby`) while keeping its own focus.
   */
  id?: string
}

/**
 * A live region that announces auth messages without moving focus.
 */
export function LiveRegion({
  message,
  politeness = 'polite',
  id,
}: LiveRegionProps) {
  const hasMessage = typeof message === 'string' && message.trim().length > 0

  return (
    <div
      id={id}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      data-testid="auth-live-region"
    >
      {hasMessage ? message : null}
    </div>
  )
}

export default LiveRegion
