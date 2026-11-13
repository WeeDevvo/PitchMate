import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  RATING_PANEL_PRESENTATION_SELECTOR,
  RATING_PANEL_SELECTOR,
  RATING_PANEL_SETTLING_SELECTOR,
  RATING_PANEL_TEXT_SELECTOR,
  RatingPanel,
} from './RatingPanel';
import { RATING_SETTLING_NOTE } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { RatingSummary } from '../lib/parse/playerProfile';
import { resolveRatingCondition } from '../lib/ratingCondition';

/**
 * Property test for the settling rating, from the wire summary to the rendered
 * panel.
 *
 * The claim (product.md "Ratings", brand.md): *every player shows a rating
 * number from their first match. A rating that is still settling shows the
 * number the backend sent, drawn exactly as an established rating draws it — no
 * "~", no amber, no label on the figure — and the fact that it is settling is
 * said in words beside it.*
 *
 * It is generated rather than enumerated because the number is a parameter: an
 * example can show that 1118 looks right, and only a property can show that no
 * value changes how a settling figure is drawn.
 */

/** A Display_Rating the backend could send: a whole number on the friendly scale. */
const displayRatingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 0, max: 5000 }) },
  { weight: 2, arbitrary: fc.constantFrom(0, 800, 1000, 1200, 1234567) },
);

/** A count of appearances with at least one match played. */
const playedArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 500 });

/** A player name with no digit, so every digit rendered is the rating's. */
const nameArb: fc.Arbitrary<string> = fc.constantFrom(
  'Dave',
  'BigDave',
  "O'Neill",
  'Former player',
  'Síofra',
);

/** What one render of the panel shows. */
interface Rendered {
  readonly figure: string;
  readonly presentation: string;
  readonly settlingSentences: readonly string[];
  readonly panelText: string;
}

function renderSummary(
  playerName: string,
  rating: RatingSummary,
  appearances: number,
): Rendered {
  try {
    const { container } = render(
      <RatingPanel
        playerName={playerName}
        condition={resolveRatingCondition(rating, appearances)}
      />,
    );
    const panel = container.querySelector<HTMLElement>(RATING_PANEL_SELECTOR);

    if (panel === null) {
      throw new Error('the rating panel did not render');
    }

    return {
      figure: panel.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent ?? '',
      presentation:
        panel.querySelector(RATING_PANEL_PRESENTATION_SELECTOR)?.outerHTML ?? '',
      settlingSentences: Array.from(
        panel.querySelectorAll(RATING_PANEL_SETTLING_SELECTOR),
        (element) => element.textContent ?? '',
      ),
      panelText: panel.textContent ?? '',
    };
  } finally {
    cleanup();
  }
}

describe('a settling rating resolves to a condition that carries its number', () => {
  it('carries the number the summary carried, for any settling summary and positive count', () => {
    fc.assert(
      fc.property(displayRatingArb, playedArb, (displayRating, appearances) => {
        const condition = resolveRatingCondition(
          { state: 'Provisional', displayRating },
          appearances,
        );

        expect(condition).toEqual({ kind: 'settling', displayRating });
      }),
      { numRuns: 500 },
    );
  });
});

describe('a settling rating is drawn exactly as an established one', () => {
  it('shows the number as sent, whatever it is', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, playedArb, (name, displayRating, appearances) => {
        const rendered = renderSummary(
          name,
          { state: 'Provisional', displayRating },
          appearances,
        );

        expect(rendered.figure).toBe(formatCount(displayRating));
      }),
      { numRuns: 200 },
    );
  });

  it('renders the same badge, classes, words and accessible name as the settled figure', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, playedArb, (name, displayRating, appearances) => {
        const settling = renderSummary(
          name,
          { state: 'Provisional', displayRating },
          appearances,
        );
        const established = renderSummary(
          name,
          { state: 'Established', displayRating },
          appearances,
        );

        expect(settling.presentation).toBe(established.presentation);
      }),
      { numRuns: 200 },
    );
  });

  it('puts no "~" and no settling or provisional wording on the figure', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, playedArb, (name, displayRating, appearances) => {
        const { presentation } = renderSummary(
          name,
          { state: 'Provisional', displayRating },
          appearances,
        );

        expect(presentation).not.toContain('~');
        expect(presentation).not.toMatch(/provisional|settling/iu);
      }),
      { numRuns: 200 },
    );
  });
});

describe('the settling sentence says what the figure does not', () => {
  it('appears once for a settling rating and never for an established one', () => {
    fc.assert(
      fc.property(nameArb, displayRatingArb, playedArb, (name, displayRating, appearances) => {
        const settling = renderSummary(
          name,
          { state: 'Provisional', displayRating },
          appearances,
        );
        const established = renderSummary(
          name,
          { state: 'Established', displayRating },
          appearances,
        );

        expect(settling.settlingSentences).toEqual([RATING_SETTLING_NOTE]);
        expect(established.settlingSentences).toEqual([]);
        expect(established.panelText).not.toContain(RATING_SETTLING_NOTE);
      }),
      { numRuns: 200 },
    );
  });

  it('carries no digit, so it never reads as a second rating', () => {
    expect(RATING_SETTLING_NOTE).not.toMatch(/\p{Nd}/u);
  });
});
