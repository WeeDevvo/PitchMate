import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { PROHIBITED_TERMS, findProhibitedTerms } from './content-validation'

// Clean words that provably contain none of the prohibited substrings
// ('rating', 'algorithm', 'openskill', 'μ', 'σ', 'rsvp', 'event log').
// Kept deliberately plain and benefit-focused, mirroring the landing copy.
const CLEAN_WORDS = [
  'fair',
  'teams',
  'friends',
  'football',
  'match',
  'play',
  'balanced',
  'sides',
  'organise',
  'games',
  'goals',
  'squad',
  'kickabout',
  'weekly',
  'together',
  'stats',
  'progress',
  'leaderboard',
  'winners',
  'pitch',
] as const

// Sanity guard: the clean-word list must never accidentally contain a
// prohibited substring, otherwise the "clean text" assertions would be bogus.
const CLEAN_WORDS_ARE_CLEAN = CLEAN_WORDS.every(
  (word) => findProhibitedTerms(word).length === 0,
)

/** Randomly re-case each character of a string (fast-check driven). */
function randomCasing(term: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: term.length, maxLength: term.length })
    .map((flags) =>
      term
        .split('')
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    )
}

describe('findProhibitedTerms', () => {
  it('guards that the clean-word generator vocabulary contains no prohibited substrings', () => {
    expect(CLEAN_WORDS_ARE_CLEAN).toBe(true)
  })

  it('returns [] for the empty string', () => {
    expect(findProhibitedTerms('')).toEqual([])
  })

  it('flags "rating" case-insensitively (lower, Title, UPPER)', () => {
    expect(findProhibitedTerms('rating')).toEqual(['rating'])
    expect(findProhibitedTerms('Rating')).toEqual(['rating'])
    expect(findProhibitedTerms('RATING')).toEqual(['rating'])
  })

  it('flags the two-word term "event log" including within a sentence', () => {
    expect(findProhibitedTerms('we keep an Event Log of goals')).toEqual([
      'event log',
    ])
  })

  it('flags the Greek terms μ and σ in both letter cases', () => {
    expect(findProhibitedTerms('μ')).toEqual(['μ'])
    expect(findProhibitedTerms('Μ')).toEqual(['μ'])
    expect(findProhibitedTerms('σ')).toEqual(['σ'])
    expect(findProhibitedTerms('Σ')).toEqual(['σ'])
  })

  it('returns matched canonical terms in declaration order without duplicates', () => {
    expect(findProhibitedTerms('algorithm rating rating OpenSkill')).toEqual([
      'rating',
      'algorithm',
      'openskill',
    ])
  })

  // Feature: marketing-landing-page, Property 3: No prohibited technical vocabulary in visible content
  it('flags every injected prohibited term case-insensitively, and returns [] for clean-only text', () => {
    const cleanWordArb = fc.constantFrom(...CLEAN_WORDS)

    // A prohibited term paired with a randomly-cased rendering of itself.
    const injectedTermArb = fc
      .constantFrom(...PROHIBITED_TERMS)
      .chain((term) =>
        randomCasing(term).map((cased) => ({ canonical: term, cased })),
      )

    fc.assert(
      fc.property(
        fc.array(cleanWordArb, { minLength: 0, maxLength: 8 }),
        fc.array(injectedTermArb, { minLength: 1, maxLength: 4 }),
        fc.array(cleanWordArb, { minLength: 0, maxLength: 8 }),
        (leading, injected, trailing) => {
          // Compose clean words interspersed with randomly-cased prohibited
          // terms. Separators are spaces so multi-word terms stay intact.
          const tokens = [
            ...leading,
            ...injected.map((i) => i.cased),
            ...trailing,
          ]
          // Shuffle-free interleave is fine: presence is what matters here.
          const text = tokens.join(' ')

          const found = findProhibitedTerms(text)

          // Every injected term's canonical form must be reported.
          for (const { canonical } of injected) {
            expect(found).toContain(canonical)
          }

          // Result carries no duplicates and stays in declaration order.
          expect(new Set(found).size).toBe(found.length)
          const declarationOrder = PROHIBITED_TERMS.filter((t) =>
            found.includes(t),
          )
          expect(found).toEqual(declarationOrder)
        },
      ),
      { numRuns: 200 },
    )
  })

  // Feature: marketing-landing-page, Property 3: No prohibited technical vocabulary in visible content
  it('returns [] for any text built solely from clean/allowed vocabulary', () => {
    const cleanWordArb = fc.constantFrom(...CLEAN_WORDS)

    fc.assert(
      fc.property(
        fc.array(cleanWordArb, { minLength: 1, maxLength: 16 }),
        (words) => {
          const text = words.join(' ')
          expect(findProhibitedTerms(text)).toEqual([])
        },
      ),
      { numRuns: 200 },
    )
  })
})
