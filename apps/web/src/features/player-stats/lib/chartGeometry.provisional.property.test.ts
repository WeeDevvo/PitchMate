import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { plotProgression, provisionalLines, type ChartExtent } from './chartGeometry';
import type { ProgressionPoint } from './parse/playerProfile';

const EXTENT: ChartExtent = { width: 640, height: 200, padding: 12 };

const seriesArb = fc
  .array(
    fc.record({
      gapMs: fc.integer({ min: 1, max: 1_000_000_000 }),
      displayRating: fc.integer({ min: 0, max: 3_000 }),
      provisional: fc.boolean(),
    }),
    { maxLength: 30 },
  )
  .map((steps): readonly ProgressionPoint[] => {
    let at = 0;
    return steps.map((step) => {
      at += step.gapMs;
      return { completedAtMs: at, displayRating: step.displayRating, provisional: step.provisional };
    });
  });

function pairsOf(polyline: string): readonly string[] {
  return polyline.split(' ');
}

/**
 * For every series of distinct instants, the points sit one even step apart
 * across the drawing box whatever the time between matches; and the dashed
 * provisional lines are exactly the stretches through each provisional run,
 * reaching one settled neighbour on each side where there is one.
 */
describe('match spacing and provisional lines', () => {
  it('spaces matches evenly, whatever the time between them', () => {
    fc.assert(
      fc.property(seriesArb.filter((series) => series.length >= 2), (series) => {
        const xs = plotProgression(series, EXTENT).points.map((plotted) => plotted.x);
        const step = (EXTENT.width - 2 * EXTENT.padding) / (series.length - 1);

        xs.forEach((x, index) => {
          expect(x).toBeCloseTo(EXTENT.padding + index * step, 2);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('dashes exactly the stretches through provisional runs', () => {
    fc.assert(
      fc.property(seriesArb, (series) => {
        const plot = plotProgression(series, EXTENT);
        const all = plot.polyline === null ? [] : pairsOf(plot.polyline);

        const expected: string[] = [];
        series.forEach((point, index) => {
          if (!point.provisional || series[index - 1]?.provisional === true) {
            return;
          }
          let end = index;
          while (series[end + 1]?.provisional === true) {
            end += 1;
          }
          const stretch = all.slice(Math.max(0, index - 1), end + 2);
          if (stretch.length >= 2) {
            expected.push(stretch.join(' '));
          }
        });

        expect(provisionalLines(plot.points)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });
});
