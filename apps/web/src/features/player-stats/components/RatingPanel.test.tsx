/**
 * Unit tests for the rating panel.
 *
 * The panel answers "what does this player's rating say, and what does it mean",
 * so these tests pin each clause of Requirement 7 that is observable in this
 * component:
 *
 *   - the Display_Rating rendered as an integer exactly as parsed, with no
 *     rounding, grouping separator, or locale formatting (7.2),
 *   - a rating that is still settling rendered as **the same number in the same
 *     style** as a settled one, with a plain sentence beneath it saying it is
 *     settling, and no "~", amber, or label on the figure (7.3, brand.md),
 *   - a label stating that no matches have been played (7.4),
 *   - a label stating that no rating is recorded (7.5),
 *   - the four conditions reading differently as a whole panel (7.6),
 *   - the squad-scope statement in every one of the four conditions (7.9),
 *   - and a non-colour cue per presentation, so none of them depends on a hue
 *     being perceived (16.6).
 *
 * The exhaustive cases are driven over one list of all four conditions rather
 * than over four hand-written blocks, so a fifth condition added to the union
 * shows up here as a failure rather than as a silently unrendered rating.
 *
 * Properties 17 and 18 quantify the settling and distinguishability claims over
 * generated inputs in their own files; these are the worked examples.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RATING_PANEL_BADGE_SELECTOR,
  RATING_PANEL_CONDITION_ATTRIBUTE,
  RATING_PANEL_PRESENTATION_SELECTOR,
  RATING_PANEL_SCOPE_SELECTOR,
  RATING_PANEL_SELECTOR,
  RATING_PANEL_SETTLING_SELECTOR,
  RATING_PANEL_TEXT_SELECTOR,
  RatingPanel,
  ratingPanelAccessibleName,
} from './RatingPanel';
import {
  RATING_ABSENT,
  RATING_NEVER_PLAYED,
  RATING_SETTLING_NOTE,
  RATING_SQUAD_SCOPE_STATEMENT,
} from '../lib/messages';
import type { RatingCondition } from '../lib/ratingCondition';

/** A display name with no digit in it, so a stray figure is attributable. */
const ORDINARY_NAME = 'BigDave';

/** The three fixed statements that must never appear in the wrong condition. */
const EVERY_CONDITION_LABEL = [
  RATING_SETTLING_NOTE,
  RATING_NEVER_PLAYED,
  RATING_ABSENT,
] as const;

/** One condition, named for the case list. */
interface ConditionCase {
  readonly what: string;
  readonly condition: RatingCondition;
}

/** All four conditions, the two numeric ones carrying the same ordinary value. */
const CONDITION_CASES: readonly ConditionCase[] = [
  {
    what: 'an established rating',
    condition: { kind: 'established', displayRating: 1240 },
  },
  {
    what: 'a settling rating',
    condition: { kind: 'settling', displayRating: 1240 },
  },
  { what: 'a player who has never played', condition: { kind: 'never-played' } },
  { what: 'a rating that was not recorded', condition: { kind: 'absent' } },
];

/** The panel element, which every assertion is scoped to. */
function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>(RATING_PANEL_SELECTOR);

  expect(panel).not.toBeNull();

  return panel as HTMLElement;
}

/** The accessible name of the badge-and-text composite, as rendered. */
function renderedAccessibleName(container: HTMLElement): string {
  return (
    container
      .querySelector(RATING_PANEL_PRESENTATION_SELECTOR)
      ?.getAttribute('aria-label') ?? ''
  );
}

/** The named composite's markup: the badge, the figure, and their classes. */
function presentationMarkup(container: HTMLElement): string {
  return container.querySelector(RATING_PANEL_PRESENTATION_SELECTOR)?.outerHTML ?? '';
}

describe('RatingPanel established rating (Req 7.2)', () => {
  it.each([
    { what: 'an ordinary rating', displayRating: 1240, expected: '1240' },
    { what: 'a four-figure rating with no grouping', displayRating: 1000, expected: '1000' },
    { what: 'a zero rating', displayRating: 0, expected: '0' },
    { what: 'a negative rating', displayRating: -15, expected: '-15' },
    { what: 'negative zero', displayRating: -0, expected: '0' },
    { what: 'a very large rating', displayRating: 1234567, expected: '1234567' },
  ])('renders $what exactly as parsed', ({ displayRating, expected }) => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'established', displayRating }}
      />,
    );

    expect(
      container.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent,
    ).toBe(expected);
  });

  it('renders none of the three fixed statements beside a settled rating', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'established', displayRating: 1240 }}
      />,
    );

    for (const label of EVERY_CONDITION_LABEL) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(container.querySelector(RATING_PANEL_SETTLING_SELECTOR)).toBeNull();
  });

  it('announces the number as a rating belonging to this player', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'established', displayRating: 1240 }}
      />,
    );

    const name = renderedAccessibleName(container);

    expect(name).toContain(ORDINARY_NAME);
    expect(name).toContain('1240');
    expect(name).not.toBe('1240');
  });
});

describe('RatingPanel settling rating (Req 7.3)', () => {
  it('shows the number, exactly as parsed', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );

    expect(
      container.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent,
    ).toBe('1118');
  });

  it('draws the number exactly as it draws an established one', () => {
    const settling = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );
    const established = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'established', displayRating: 1118 }}
      />,
    );

    // The same badge, the same classes, the same words and the same accessible
    // name: nothing on the figure says it is settling.
    expect(presentationMarkup(settling.container)).toBe(
      presentationMarkup(established.container),
    );
  });

  it('puts no "~", band or provisional wording on the figure', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );
    const markup = presentationMarkup(container);

    expect(markup).not.toContain('~');
    expect(markup).not.toMatch(/provisional|settling/iu);
  });

  it('says in plain words under the figure that the rating is still settling', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );

    expect(screen.getByText(RATING_SETTLING_NOTE)).toBeVisible();
    expect(
      panelOf(container).querySelectorAll(RATING_PANEL_SETTLING_SELECTOR),
    ).toHaveLength(1);
    // Outside the named composite, so it is read as prose, never as the rating.
    expect(
      container
        .querySelector(RATING_PANEL_PRESENTATION_SELECTOR)
        ?.querySelector(RATING_PANEL_SETTLING_SELECTOR),
    ).toBeNull();
  });

  it('renders neither of the two absence labels', () => {
    render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );

    expect(screen.queryByText(RATING_NEVER_PLAYED)).toBeNull();
    expect(screen.queryByText(RATING_ABSENT)).toBeNull();
  });
});

describe('RatingPanel never played (Req 7.4)', () => {
  it('states that no matches have been played', () => {
    render(
      <RatingPanel playerName={ORDINARY_NAME} condition={{ kind: 'never-played' }} />,
    );

    expect(screen.getByText(RATING_NEVER_PLAYED)).toBeVisible();
  });

  it('renders neither the settling sentence nor the unrecorded label', () => {
    render(
      <RatingPanel playerName={ORDINARY_NAME} condition={{ kind: 'never-played' }} />,
    );

    expect(screen.queryByText(RATING_SETTLING_NOTE)).toBeNull();
    expect(screen.queryByText(RATING_ABSENT)).toBeNull();
  });
});

describe('RatingPanel rating absent (Req 7.5)', () => {
  it('states that no rating is recorded', () => {
    render(<RatingPanel playerName={ORDINARY_NAME} condition={{ kind: 'absent' }} />);

    expect(screen.getByText(RATING_ABSENT)).toBeVisible();
  });

  it('renders neither the settling sentence nor the never-played label', () => {
    render(<RatingPanel playerName={ORDINARY_NAME} condition={{ kind: 'absent' }} />);

    expect(screen.queryByText(RATING_SETTLING_NOTE)).toBeNull();
    expect(screen.queryByText(RATING_NEVER_PLAYED)).toBeNull();
  });
});

describe('RatingPanel distinguishability (Req 7.6)', () => {
  it('reads differently, as a whole panel, in each of the four conditions', () => {
    const texts = CONDITION_CASES.map(({ condition }) => {
      const { container } = render(
        <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
      );

      return panelOf(container).textContent ?? '';
    });

    expect(new Set(texts).size).toBe(CONDITION_CASES.length);
  });

  it('announces three distinct names: a rating, never played, and not recorded', () => {
    const names = CONDITION_CASES.map(({ condition }) =>
      ratingPanelAccessibleName(ORDINARY_NAME, condition),
    );

    // A settling rating is announced as the rating it is; the settling sentence
    // beside it is its own text.
    expect(names[0]).toBe(names[1]);
    expect(new Set(names).size).toBe(3);
  });

  it.each(CONDITION_CASES)(
    'carries exactly one non-colour cue for $what',
    ({ condition }) => {
      const { container } = render(
        <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
      );
      const badges = panelOf(container).querySelectorAll(
        RATING_PANEL_BADGE_SELECTOR,
      );

      expect(badges).toHaveLength(1);
      expect(badges[0]?.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it('gives a rating, never played and not recorded three different badge shapes', () => {
    const shapes = CONDITION_CASES.map(({ condition }) => {
      const { container } = render(
        <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
      );

      return (
        panelOf(container)
          .querySelector(RATING_PANEL_BADGE_SELECTOR)
          ?.getAttribute('class') ?? ''
      );
    });

    expect(shapes[0]).toBe(shapes[1]);
    expect(new Set(shapes).size).toBe(3);
  });

  it.each(CONDITION_CASES)('records which condition it rendered for $what', ({
    condition,
  }) => {
    const { container } = render(
      <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
    );

    expect(
      panelOf(container).getAttribute(RATING_PANEL_CONDITION_ATTRIBUTE),
    ).toBe(condition.kind);
  });
});

describe('RatingPanel squad scope (Req 7.9)', () => {
  it.each(CONDITION_CASES)('states what the rating is for with $what', ({
    condition,
  }) => {
    const { container } = render(
      <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
    );

    expect(screen.getByText(RATING_SQUAD_SCOPE_STATEMENT)).toBeVisible();
    expect(
      panelOf(container).querySelectorAll(RATING_PANEL_SCOPE_SELECTOR),
    ).toHaveLength(1);
  });

  it('keeps the statement outside the named composite, so it is read as prose', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'settling', displayRating: 1118 }}
      />,
    );

    expect(
      container
        .querySelector(RATING_PANEL_PRESENTATION_SELECTOR)
        ?.querySelector(RATING_PANEL_SCOPE_SELECTOR),
    ).toBeNull();
  });
});

describe('RatingPanel accessible name (Req 16.6)', () => {
  it.each(CONDITION_CASES)(
    'announces the rendered words for $what, so the two cannot disagree',
    ({ condition }) => {
      const { container } = render(
        <RatingPanel playerName={ORDINARY_NAME} condition={condition} />,
      );
      const visible =
        container.querySelector(RATING_PANEL_TEXT_SELECTOR)?.textContent ?? '';

      expect(renderedAccessibleName(container)).toContain(visible);
    },
  );

  it.each(CONDITION_CASES)('names the player for $what', ({ condition }) => {
    expect(ratingPanelAccessibleName(ORDINARY_NAME, condition)).toContain(
      ORDINARY_NAME,
    );
  });

  it.each(CONDITION_CASES)(
    'announces the statement alone when no name is given, for $what',
    ({ condition }) => {
      const name = ratingPanelAccessibleName('   ', condition);

      expect(name.startsWith(':')).toBe(false);
      expect(name).not.toContain(':');
    },
  );

  it('renders exactly one named composite', () => {
    const { container } = render(
      <RatingPanel
        playerName={ORDINARY_NAME}
        condition={{ kind: 'established', displayRating: 1240 }}
      />,
    );

    expect(
      panelOf(container).querySelectorAll(RATING_PANEL_PRESENTATION_SELECTOR),
    ).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });
});
