import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { areaUnderLine, plotProgression, provisionalBands, ratingTicks, type ChartExtent } from './chartGeometry';
import type { ProgressionPoint } from './parse/playerProfile';

const EXTENT: ChartExtent = { width: 640, height: 200, padding: 12 };
const TOP = EXTENT.padding;
const BOTTOM = EXTENT.height - EXTENT.padding;

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

/**
 * The chart's decoration: the provisional bands cover exactly the stretches the
 * dashed lines run through, left to right and never overlapping; the shaded
 * area closes the line down to the baseline; and the rating axis states round
 * values inside the scale, top to bottom, each at the height the line uses for
 * that rating — never the scale's own ends, which may be a provisional reading.
 */
describe('provisional bands', () => {
  it('span each provisional run to the settled reading after it, left to right', () => {
    fc.assert(
      fc.property(seriesArb, (series) => {
        const points = plotProgression(series, EXTENT).points;
        const bands = provisionalBands(points);

        const expected: { x1: number; x2: number }[] = [];
        points.forEach((plotted, index) => {
          if (!plotted.point.provisional || points[index - 1]?.point.provisional === true) return;
          let last = index;
          while (points[last + 1]?.point.provisional === true) last += 1;
          const end = points[last + 1] ?? points[last]!;
          if (end.x > plotted.x) expected.push({ x1: plotted.x, x2: end.x });
        });

        expect(bands).toEqual(expected);
        bands.forEach((band, index) => {
          expect(band.x2).toBeGreaterThan(band.x1);
          if (index > 0) expect(band.x1).toBeGreaterThanOrEqual(bands[index - 1]!.x2);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('gives none when nothing is provisional', () => {
    fc.assert(
      fc.property(seriesArb, (series) => {
        const settled = series.map((point) => ({ ...point, provisional: false }));
        expect(provisionalBands(plotProgression(settled, EXTENT).points)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

describe('the area under the line', () => {
  it('is the line closed down to the baseline, and absent without a line', () => {
    fc.assert(
      fc.property(seriesArb, (series) => {
        const plot = plotProgression(series, EXTENT);
        const area = areaUnderLine(plot.points, BOTTOM);

        if (plot.polyline === null) {
          expect(area).toBeNull();
          return;
        }

        const pairs = area!.split(' ');
        expect(pairs.slice(1, -1).join(' ')).toBe(plot.polyline);
        expect(pairs[0]!.split(',')[1]).toBe(String(BOTTOM));
        expect(pairs[pairs.length - 1]!.split(',')[1]).toBe(String(BOTTOM));
      }),
      { numRuns: 200 },
    );
  });
});

describe('rating ticks', () => {
  const domainArb = fc
    .tuple(fc.integer({ min: 0, max: 3_000 }), fc.integer({ min: 0, max: 3_000 }))
    .map(([a, b]) => (a <= b ? [a, b] : [b, a]) as const);

  it('are round ratings inside the scale, highest first, each at its height', () => {
    fc.assert(
      fc.property(domainArb, ([floor, ceiling]) => {
        const ticks = ratingTicks(floor, ceiling, TOP, BOTTOM);

        // A scale wide enough to hold a multiple of 10 always gets a label.
        if (Math.floor(ceiling / 10) * 10 >= floor) expect(ticks.length).toBeGreaterThanOrEqual(1);
        expect(ticks.length).toBeLessThanOrEqual(4);
        ticks.forEach((tick, index) => {
          expect(tick.rating % 5).toBe(0);
          expect(tick.y).toBeGreaterThanOrEqual(TOP - 1e-9);
          expect(tick.y).toBeLessThanOrEqual(BOTTOM + 1e-9);
          if (index > 0) {
            expect(tick.rating).toBeLessThan(ticks[index - 1]!.rating);
            expect(tick.y).toBeGreaterThan(ticks[index - 1]!.y);
          }
          if (ceiling > floor) {
            expect(tick.y).toBeCloseTo(BOTTOM - ((tick.rating - floor) / (ceiling - floor)) * (BOTTOM - TOP), 6);
          }
        });
      }),
      { numRuns: 300 },
    );
  });

  it('labels 1,000 to 1,250 in steps of 100', () => {
    expect(ratingTicks(1_000, 1_250, TOP, BOTTOM).map((tick) => tick.rating)).toEqual([1_200, 1_100, 1_000]);
  });
});
