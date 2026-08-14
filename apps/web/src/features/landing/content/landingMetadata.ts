/**
 * Typed discovery and social-sharing metadata for the marketing landing page.
 *
 * `landingMetadataBase` is the valid base that `resolveShareMetadata` falls back
 * to, and `landingShareInput` holds optional authored share overrides. Together
 * they feed both the static base tags in `index.html` (crawler-safe) and the
 * runtime `PageHead`.
 *
 * Requirements: 7.2, 7.3, 7.4, 7.6
 */

import type { ImageRef, MetadataBase, ShareMetadataInput } from '../lib/metadata';

/**
 * The default social preview image. Must be at least 1200×630 px so social
 * scrapers render a full-size card (Requirement 7.4).
 */
const defaultPreviewImage: ImageRef = {
  url: '/og-default.png',
  width: 1200,
  height: 630,
};

/**
 * Valid base metadata for the landing page.
 *
 * - `documentTitle` — 42 chars, contains "PitchMate" (≤ 60). Requirement 7.2.
 * - `metaDescription` — 131 chars, non-technical, describes the benefit
 *   (50–160). Requirements 7.3.
 * - `lang` — English (Requirement 7.6).
 */
export const landingMetadataBase: MetadataBase = {
  documentTitle: 'PitchMate — Fair teams for casual football',
  metaDescription:
    'PitchMate helps friends organise casual football matches with fair, balanced teams and keeps your results, stats, and leaderboards.',
  defaultImage: defaultPreviewImage,
  lang: 'en',
};

/**
 * Optional authored share overrides. Left empty so the resolver falls back to
 * the document title, meta description, and default preview image
 * (Requirement 7.5); add valid overrides here to tailor the shared card.
 */
export const landingShareInput: ShareMetadataInput = {};
