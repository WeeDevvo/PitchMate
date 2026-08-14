/**
 * Pure share-metadata resolution for the marketing landing page.
 *
 * The landing page must always present valid discovery and social-sharing
 * metadata. Authored share values are optional overrides; whenever a share
 * field is missing, empty, or would violate its bound, this module substitutes
 * the corresponding valid base value (document title, meta description, or the
 * default preview image) so the resolved output always satisfies its
 * constraints.
 *
 * Requirements: 7.2, 7.4, 7.5
 */

/** A reference to an image asset with its intrinsic pixel dimensions. */
export interface ImageRef {
  url: string;
  width: number;
  height: number;
}

/** Optional authored overrides for the page's social-sharing metadata. */
export interface ShareMetadataInput {
  shareTitle?: string;
  shareDescription?: string;
  previewImage?: ImageRef;
}

/** Valid base metadata that resolved fields fall back to. */
export interface MetadataBase {
  documentTitle: string;
  metaDescription: string;
  defaultImage: ImageRef;
  lang: string;
}

/**
 * Fully-resolved page metadata. Every field is guaranteed to satisfy its bound:
 * - `documentTitle` — non-empty, contains "PitchMate", ≤ 60 chars
 * - `metaDescription` — 50..160 chars inclusive
 * - `shareTitle` — ≤ 60 chars
 * - `shareDescription` — ≤ 200 chars
 * - `previewImage` — non-empty url, ≥ 1200×630 px
 * - `lang` — a valid BCP-47 language code (e.g. "en")
 */
export interface ResolvedMetadata {
  documentTitle: string;
  metaDescription: string;
  shareTitle: string;
  shareDescription: string;
  previewImage: ImageRef;
  lang: string;
}

/** Minimum width, in CSS pixels, required for a social preview image. */
const MIN_PREVIEW_WIDTH = 1200;
/** Minimum height, in CSS pixels, required for a social preview image. */
const MIN_PREVIEW_HEIGHT = 630;
/** Maximum length, in characters, of a social sharing title. */
const MAX_SHARE_TITLE_LENGTH = 60;
/** Maximum length, in characters, of a social sharing description. */
const MAX_SHARE_DESCRIPTION_LENGTH = 200;

/** True when a string is present and not empty/whitespace-only. */
function isNonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** True when a preview image is present with a non-empty url and ≥ 1200×630 px. */
function isValidPreviewImage(image: ImageRef | undefined): image is ImageRef {
  return (
    image !== undefined &&
    isNonEmpty(image.url) &&
    image.width >= MIN_PREVIEW_WIDTH &&
    image.height >= MIN_PREVIEW_HEIGHT
  );
}

/**
 * Resolve final page metadata from optional share overrides and a valid base.
 *
 * A share field is used only when it is present, non-empty (for strings,
 * ignoring whitespace-only values), and within its bound; otherwise the base
 * value is substituted so the resolved output always satisfies its constraints:
 * - `shareTitle` falls back to `base.documentTitle` when missing/empty or > 60 chars.
 * - `shareDescription` falls back to `base.metaDescription` when missing/empty or > 200 chars.
 * - `previewImage` falls back to `base.defaultImage` when missing, has an empty
 *   url, or is smaller than 1200×630 px.
 *
 * The `documentTitle`, `metaDescription`, and `lang` fields come directly from
 * the (assumed valid) base.
 *
 * Requirements: 7.2, 7.4, 7.5
 */
export function resolveShareMetadata(
  input: ShareMetadataInput,
  base: MetadataBase,
): ResolvedMetadata {
  const shareTitle =
    isNonEmpty(input.shareTitle) &&
    input.shareTitle.length <= MAX_SHARE_TITLE_LENGTH
      ? input.shareTitle
      : base.documentTitle;

  const shareDescription =
    isNonEmpty(input.shareDescription) &&
    input.shareDescription.length <= MAX_SHARE_DESCRIPTION_LENGTH
      ? input.shareDescription
      : base.metaDescription;

  const previewImage = isValidPreviewImage(input.previewImage)
    ? input.previewImage
    : base.defaultImage;

  return {
    documentTitle: base.documentTitle,
    metaDescription: base.metaDescription,
    shareTitle,
    shareDescription,
    previewImage,
    lang: base.lang,
  };
}
