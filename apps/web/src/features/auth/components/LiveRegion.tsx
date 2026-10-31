/**
 * LiveRegion — the persistent, polite-or-assertive announcement region the auth
 * screens use for status and error messages.
 *
 * The region element is always in the tree, so a message that appears later is
 * still announced. A message is shown as the design system's `Banner`, with its
 * own announcing turned off so it is read once, by this region.
 */
import { Banner, type BannerTone } from '../../../ui'

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
   * The banner's tone. Defaults to `error` for an assertive message and
   * `info` for a polite one; pass `success` for a completed action.
   */
  tone?: BannerTone
  /**
   * Optional id so a control can reference this region (e.g. via
   * `aria-describedby`) while keeping its own focus.
   */
  id?: string
}

export function LiveRegion({
  message,
  politeness = 'polite',
  tone,
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
      className="auth-live"
    >
      {hasMessage ? (
        <Banner tone={tone ?? (politeness === 'assertive' ? 'error' : 'info')} announce={false}>
          {message}
        </Banner>
      ) : null}
    </div>
  )
}

export default LiveRegion
