import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  computeHeadingOutline,
  type HeadingNode,
  type OutlineResult,
} from './heading-outline'

/**
 * Reference implementation, computed independently of the code under test, so
 * the property compares two separate derivations of the same specification.
 */
function referenceOutline(headings: HeadingNode[]): OutlineResult {
  let h1Count = 0
  for (const heading of headings) {
    if (heading.level === 1) {
      h1Count += 1
    }
  }

  let skippedAt: number | null = null
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index].level - headings[index - 1].level > 1) {
      skippedAt = index
      break
    }
  }

  return {
    ok: h1Count === 1 && skippedAt === null,
    h1Count,
    skippedAt,
  }
}

describe('computeHeadingOutline', () => {
  it('accepts a well-formed outline: [h1, h2, h3, h2]', () => {
    const headings: HeadingNode[] = [
      { level: 1, text: 'Title' },
      { level: 2, text: 'Section' },
      { level: 3, text: 'Subsection' },
      { level: 2, text: 'Another section' },
    ]
    expect(computeHeadingOutline(headings)).toEqual({
      ok: true,
      h1Count: 1,
      skippedAt: null,
    })
  })

  it('rejects a skipped level: [h1, h3]', () => {
    const headings: HeadingNode[] = [
      { level: 1, text: 'Title' },
      { level: 3, text: 'Skips h2' },
    ]
    const result = computeHeadingOutline(headings)
    expect(result.ok).toBe(false)
    expect(result.skippedAt).toBe(1)
  })

  it('rejects an outline with no h1: [h2, h3]', () => {
    const headings: HeadingNode[] = [
      { level: 2, text: 'No title' },
      { level: 3, text: 'Subsection' },
    ]
    const result = computeHeadingOutline(headings)
    expect(result.ok).toBe(false)
    expect(result.h1Count).toBe(0)
  })

  it('rejects multiple h1s: [h1, h1]', () => {
    const headings: HeadingNode[] = [
      { level: 1, text: 'Title' },
      { level: 1, text: 'Second title' },
    ]
    const result = computeHeadingOutline(headings)
    expect(result.ok).toBe(false)
    expect(result.h1Count).toBe(2)
  })

  it('rejects an empty outline', () => {
    const result = computeHeadingOutline([])
    expect(result.ok).toBe(false)
    expect(result.h1Count).toBe(0)
    expect(result.skippedAt).toBeNull()
  })

  // Feature: web-auth-screens, Property 19: Heading outline is well-formed
  it('is well-formed iff exactly one h1 and no skipped level, matching an independent reference', () => {
    const headingArb: fc.Arbitrary<HeadingNode> = fc.record({
      level: fc.integer({ min: 1, max: 6 }),
      text: fc.string(),
    })

    // Sequences of realistic heading levels, including empty and long ones.
    const headingsArb: fc.Arbitrary<HeadingNode[]> = fc.array(headingArb, {
      minLength: 0,
      maxLength: 30,
    })

    fc.assert(
      fc.property(headingsArb, (headings) => {
        const actual = computeHeadingOutline(headings)
        const expected = referenceOutline(headings)
        expect(actual.h1Count).toBe(expected.h1Count)
        expect(actual.skippedAt).toBe(expected.skippedAt)
        expect(actual.ok).toBe(expected.ok)
      }),
      { numRuns: 200 },
    )
  })
})
