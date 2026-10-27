import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { findProhibitedTerms } from '../lib/content-validation'
import { landingContent, type BenefitModel } from './landingContent'

/**
 * A benefit is complete when it has a non-empty (trimmed) heading and a
 * description containing at least one sentence of supporting text. A "sentence"
 * is some visible text followed by sentence-terminating punctuation.
 */
function hasAtLeastOneSentence(text: string): boolean {
  return /[A-Za-z0-9][^.!?]*[.!?]/.test(text.trim())
}

function isBenefitComplete(benefit: BenefitModel): boolean {
  return benefit.heading.trim().length > 0 && hasAtLeastOneSentence(benefit.description)
}

/** Keys whose values are destinations or wiring, never shown as text. */
const NON_VISIBLE_KEYS = new Set(['href', 'id', 'kind', 'icon', 'tone'])

/**
 * Collect every visible string in the content model for vocabulary scanning:
 * a walk of the whole model, so new copy (and the example squad) is covered
 * without this list needing to know about it.
 */
function collectVisibleStrings(value: unknown = landingContent, key = ''): string[] {
  if (typeof value === 'string') return NON_VISIBLE_KEYS.has(key) ? [] : [value]
  if (Array.isArray(value)) return value.flatMap((item) => collectVisibleStrings(item, key))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectVisibleStrings(v, k))
  }
  return []
}

// Clean vocabulary that contains none of the prohibited substrings, used to
// build well-shaped generated benefits without tripping the vocabulary rule.
const CLEAN_WORDS = [
  'fair',
  'teams',
  'friends',
  'match',
  'play',
  'games',
  'stats',
  'squad',
  'balanced',
  'weekly',
] as const

describe('Property 4: benefit completeness', () => {
  const wordArb = fc.constantFrom(...CLEAN_WORDS)
  const headingArb = fc
    .array(wordArb, { minLength: 1, maxLength: 5 })
    .map((words) => words.join(' '))
  const sentenceArb = fc
    .array(wordArb, { minLength: 2, maxLength: 12 })
    .chain((words) =>
      fc.constantFrom('.', '!', '?').map((end) => words.join(' ') + end),
    )
  const descriptionArb = fc
    .array(sentenceArb, { minLength: 1, maxLength: 3 })
    .map((sentences) => sentences.join(' '))
  const benefitArb: fc.Arbitrary<BenefitModel> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    heading: headingArb,
    description: descriptionArb,
  })

  // Feature: marketing-landing-page, Property 4: Every benefit section is complete
  it('every well-shaped benefit in any 3–8 length array is complete', () => {
    fc.assert(
      fc.property(
        fc.array(benefitArb, { minLength: 3, maxLength: 8 }),
        (benefits) => {
          expect(benefits.length).toBeGreaterThanOrEqual(3)
          expect(benefits.length).toBeLessThanOrEqual(8)
          for (const benefit of benefits) {
            expect(isBenefitComplete(benefit)).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('landingContent (real content model)', () => {
  it('has between 3 and 8 benefit sections inclusive', () => {
    expect(landingContent.benefits.length).toBeGreaterThanOrEqual(3)
    expect(landingContent.benefits.length).toBeLessThanOrEqual(8)
  })

  it('has a complete heading and ≥1-sentence description for every benefit', () => {
    for (const benefit of landingContent.benefits) {
      expect(benefit.heading.trim().length).toBeGreaterThan(0)
      expect(hasAtLeastOneSentence(benefit.description)).toBe(true)
      expect(isBenefitComplete(benefit)).toBe(true)
    }
  })

  // Reinforces Property 3: no prohibited technical vocabulary in visible content.
  it('uses no prohibited technical vocabulary in any visible string', () => {
    for (const text of collectVisibleStrings()) {
      expect(findProhibitedTerms(text)).toEqual([])
    }
  })

  it('sets a green accent that ends the hero headline', () => {
    expect(landingContent.hero.headline.endsWith(landingContent.hero.headlineAccent)).toBe(true)
  })

  it('keeps the hero subheadline within 160 characters', () => {
    expect(landingContent.hero.subheadline.length).toBeLessThanOrEqual(160)
  })
})
