import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatRatingBand } from './numberFormat';

/**
 * Property tests for the provisional "~" band. For every rating of one hundred
 * or more, the band is the hundreds digits then `xx`, so it never states the
 * last two digits; every rating below one hundred reads `<100`.
 */
describe('formatRatingBand', () => {
  it('shows the hundreds and hides the rest', () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1_000_000 }), (value) => {
        const band = formatRatingBand(value);

        expect(band).toBe(`${String(Math.floor(value / 100))}xx`);
      }),
      { numRuns: 200 },
    );
  });

  it('reads <100 below one hundred', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), (value) => {
        expect(formatRatingBand(value)).toBe('<100');
      }),
      { numRuns: 100 },
    );
  });
});
