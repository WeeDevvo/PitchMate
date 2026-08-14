import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  resolveShareMetadata,
  type ImageRef,
  type MetadataBase,
  type ShareMetadataInput,
} from './metadata'

// A fixed, valid base used across every case. Its values already satisfy the
// resolved-metadata bounds, so any fallback inherits a valid value.
const BASE: MetadataBase = {
  documentTitle: 'PitchMate — Fair teams for casual football', // <= 60, contains "PitchMate"
  metaDescription:
    'Organise casual football with friends and get fair, balanced teams every time.', // 50..160
  defaultImage: { url: '/og-default.png', width: 1200, height: 630 },
  lang: 'en',
}

describe('resolveShareMetadata', () => {
  it('uses valid share overrides when they are present and within bounds', () => {
    const input: ShareMetadataInput = {
      shareTitle: 'Play fair football',
      shareDescription: 'Balanced sides for every kickabout.',
      previewImage: { url: '/custom-og.png', width: 1600, height: 900 },
    }

    const resolved = resolveShareMetadata(input, BASE)

    expect(resolved.shareTitle).toBe('Play fair football')
    expect(resolved.shareDescription).toBe('Balanced sides for every kickabout.')
    expect(resolved.previewImage).toEqual({
      url: '/custom-og.png',
      width: 1600,
      height: 900,
    })
    expect(resolved.documentTitle).toBe(BASE.documentTitle)
    expect(resolved.metaDescription).toBe(BASE.metaDescription)
    expect(resolved.lang).toBe('en')
  })

  it('falls back for missing share fields', () => {
    const resolved = resolveShareMetadata({}, BASE)

    expect(resolved.shareTitle).toBe(BASE.documentTitle)
    expect(resolved.shareDescription).toBe(BASE.metaDescription)
    expect(resolved.previewImage).toEqual(BASE.defaultImage)
  })

  it('treats whitespace-only strings as empty and falls back', () => {
    const resolved = resolveShareMetadata(
      { shareTitle: '   ', shareDescription: '\t\n ' },
      BASE,
    )

    expect(resolved.shareTitle).toBe(BASE.documentTitle)
    expect(resolved.shareDescription).toBe(BASE.metaDescription)
  })

  it('falls back for an oversized share title or an undersized preview image', () => {
    const resolved = resolveShareMetadata(
      {
        shareTitle: 'x'.repeat(61),
        previewImage: { url: '/small.png', width: 800, height: 600 },
      },
      BASE,
    )

    expect(resolved.shareTitle).toBe(BASE.documentTitle)
    expect(resolved.previewImage).toEqual(BASE.defaultImage)
  })

  // Feature: marketing-landing-page, Property 6: Resolved metadata satisfies constraints and falls back correctly
  it('always satisfies metadata constraints and falls back for missing/empty share fields', () => {
    // A share string that is either absent, empty/whitespace-only, or a
    // plausible value that may be within or beyond its length bound.
    const optionalShareStringArb = (maxWithinBound: number) =>
      fc.oneof(
        fc.constant(undefined),
        fc.constantFrom('', '   ', '\t\n'), // "empty" per the whitespace rule
        fc.string({ minLength: 1, maxLength: maxWithinBound }), // within bound
        fc.string({ minLength: maxWithinBound + 1, maxLength: maxWithinBound + 40 }), // over bound
      )

    // A preview image that is either absent, has an empty url, or has
    // dimensions above and below the 1200x630 thresholds.
    const optionalImageArb: fc.Arbitrary<ImageRef | undefined> = fc.oneof(
      fc.constant(undefined),
      fc.record({
        url: fc.constantFrom('', '   ', '/img.png', 'https://cdn/og.png'),
        width: fc.integer({ min: 0, max: 4000 }),
        height: fc.integer({ min: 0, max: 4000 }),
      }),
    )

    const inputArb: fc.Arbitrary<ShareMetadataInput> = fc.record({
      shareTitle: optionalShareStringArb(60),
      shareDescription: optionalShareStringArb(200),
      previewImage: optionalImageArb,
    })

    fc.assert(
      fc.property(inputArb, (input) => {
        const resolved = resolveShareMetadata(input, BASE)

        // Document title: non-empty, contains "PitchMate", <= 60 chars.
        expect(resolved.documentTitle.length).toBeGreaterThan(0)
        expect(resolved.documentTitle).toContain('PitchMate')
        expect(resolved.documentTitle.length).toBeLessThanOrEqual(60)

        // Meta description: 50..160 chars inclusive.
        expect(resolved.metaDescription.length).toBeGreaterThanOrEqual(50)
        expect(resolved.metaDescription.length).toBeLessThanOrEqual(160)

        // Share title: <= 60 chars.
        expect(resolved.shareTitle.length).toBeLessThanOrEqual(60)

        // Share description: <= 200 chars.
        expect(resolved.shareDescription.length).toBeLessThanOrEqual(200)

        // Preview image: non-empty url, >= 1200x630.
        expect(resolved.previewImage.url.trim().length).toBeGreaterThan(0)
        expect(resolved.previewImage.width).toBeGreaterThanOrEqual(1200)
        expect(resolved.previewImage.height).toBeGreaterThanOrEqual(630)

        // lang comes from base.
        expect(resolved.lang).toBe(BASE.lang)

        // Fallback correctness: a missing/empty/whitespace-only share string
        // must resolve to the corresponding base value.
        const titleEmpty =
          input.shareTitle === undefined || input.shareTitle.trim().length === 0
        if (titleEmpty) {
          expect(resolved.shareTitle).toBe(BASE.documentTitle)
        }

        const descEmpty =
          input.shareDescription === undefined ||
          input.shareDescription.trim().length === 0
        if (descEmpty) {
          expect(resolved.shareDescription).toBe(BASE.metaDescription)
        }

        // A missing or too-small preview image must resolve to the default.
        const imageInvalid =
          input.previewImage === undefined ||
          input.previewImage.url.trim().length === 0 ||
          input.previewImage.width < 1200 ||
          input.previewImage.height < 630
        if (imageInvalid) {
          expect(resolved.previewImage).toEqual(BASE.defaultImage)
        }
      }),
      { numRuns: 100 },
    )
  })
})
