/**
 * PageHead — emits the landing page's discovery and social-sharing metadata.
 *
 * The marketing landing page must present complete, valid metadata on load
 * (Requirement 7.1): a document title (7.2), a meta description (7.3), Open
 * Graph social-sharing tags (7.4) with sensible fallbacks (7.5), and a declared
 * primary language of English (7.6).
 *
 * Values are derived from the single metadata source of truth by calling
 * `resolveShareMetadata(landingShareInput, landingMetadataBase)`, so the runtime
 * tags always satisfy their bounds and fall back correctly when share overrides
 * are missing.
 *
 * React 19 natively hoists `<title>`, `<meta>`, and `<link>` rendered anywhere
 * in the tree up into `<head>`, so this component simply renders those tags
 * declaratively. Native metadata hoisting does *not* cover the `<html lang>`
 * attribute, so `lang` is applied to `document.documentElement` via an effect —
 * mirroring the `data-theme` pattern used by `ThemeProvider`.
 *
 * Static, crawler-safe base tags also live in `index.html`; this component owns
 * the live/resolved values for JavaScript-capable clients.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
import { useEffect } from 'react'
import {
  landingMetadataBase,
  landingShareInput,
} from '../content/landingMetadata'
import { resolveShareMetadata } from '../lib/metadata'

/**
 * Canonical site origin. Open Graph consumers require absolute URLs, so the
 * (relative) resolved preview-image url is made absolute against this origin,
 * matching the static base tags in `index.html`.
 */
const SITE_URL = 'https://pitch-mate.co.uk'

/** Resolve a possibly-relative asset url to an absolute URL for OG consumers. */
function toAbsoluteUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${SITE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

export function PageHead() {
  const metadata = resolveShareMetadata(landingShareInput, landingMetadataBase)
  const imageUrl = toAbsoluteUrl(metadata.previewImage.url)

  // Declare the primary language on <html> (Requirement 7.6). React does not
  // hoist the html lang attribute, so apply it directly to the document element.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', metadata.lang)
    }
  }, [metadata.lang])

  return (
    <>
      {/* Document title + meta description (Requirements 7.2, 7.3). */}
      <title>{metadata.documentTitle}</title>
      <meta name="description" content={metadata.metaDescription} />

      {/* Open Graph social-sharing tags (Requirements 7.4, 7.5). */}
      <meta property="og:type" content="website" />
      <meta property="og:url" content={`${SITE_URL}/`} />
      <meta property="og:title" content={metadata.shareTitle} />
      <meta property="og:description" content={metadata.shareDescription} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content={String(metadata.previewImage.width)} />
      <meta property="og:image:height" content={String(metadata.previewImage.height)} />
    </>
  )
}

export default PageHead
