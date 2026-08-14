/**
 * Component tests for PageHead metadata presence.
 *
 * The landing page must present complete, valid discovery and social-sharing
 * metadata on load: a document title, a meta description, Open Graph tags, and
 * a declared primary language of English.
 *
 * React 19 hoists `<title>` and `<meta>` rendered anywhere in the tree up into
 * `document.head` (asynchronously), so we query `document.head` — using
 * `waitFor` where needed — rather than the render container. The `<html lang>`
 * attribute is applied via an effect on `document.documentElement`.
 *
 * Feature: marketing-landing-page
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { PageHead } from './PageHead'
import {
  landingMetadataBase,
  landingShareInput,
} from '../content/landingMetadata'
import { resolveShareMetadata } from '../lib/metadata'

const expected = resolveShareMetadata(landingShareInput, landingMetadataBase)

describe('PageHead metadata presence', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('lang')
  })

  // Validates: Requirements 7.1, 7.2
  it('renders a document title containing "PitchMate"', async () => {
    render(<PageHead />)

    await waitFor(() => {
      const title = document.head.querySelector('title')
      expect(title).not.toBeNull()
    })

    const title = document.head.querySelector('title')
    expect(title?.textContent).toContain('PitchMate')
    expect(title?.textContent).toBe(expected.documentTitle)
  })

  // Validates: Requirements 7.1, 7.3
  it('renders a non-empty meta description', async () => {
    render(<PageHead />)

    await waitFor(() => {
      const description = document.head.querySelector('meta[name="description"]')
      expect(description).not.toBeNull()
    })

    const description = document.head.querySelector('meta[name="description"]')
    const content = description?.getAttribute('content') ?? ''
    expect(content.trim().length).toBeGreaterThan(0)
    expect(content).toBe(expected.metaDescription)
  })

  // Validates: Requirements 7.1, 7.4
  it('renders Open Graph title, description, and image tags', async () => {
    render(<PageHead />)

    await waitFor(() => {
      expect(
        document.head.querySelector('meta[property="og:title"]'),
      ).not.toBeNull()
    })

    const ogTitle = document.head.querySelector('meta[property="og:title"]')
    const ogDescription = document.head.querySelector(
      'meta[property="og:description"]',
    )
    const ogImage = document.head.querySelector('meta[property="og:image"]')

    expect(ogTitle?.getAttribute('content')).toBe(expected.shareTitle)
    expect(ogDescription?.getAttribute('content')).toBe(
      expected.shareDescription,
    )

    const imageContent = ogImage?.getAttribute('content') ?? ''
    expect(imageContent.trim().length).toBeGreaterThan(0)
    // OG consumers require an absolute URL for the preview image.
    expect(imageContent).toMatch(/^https?:\/\//)
  })

  // Validates: Requirements 7.6
  it('declares the primary language as English on <html>', async () => {
    render(<PageHead />)

    await waitFor(() => {
      expect(document.documentElement.getAttribute('lang')).toBe('en')
    })
  })
})
