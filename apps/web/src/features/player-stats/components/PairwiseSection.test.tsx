/**
 * Unit tests for a Pairwise_Section.
 *
 * The generated property beside this file (Property 37, task 10.9) quantifies
 * the navigation claim over every parsed profile and every entry of all four
 * collections. This file pins what a reader wants stated plainly, one clause of
 * Requirement 10 at a time:
 *
 *   - the heading is rendered, and is the section's single level-two heading
 *     naming what the section measures (10.1),
 *   - one entry per parsed entry, **in the order given** — the ranking is the
 *     backend's, so a section fed descending counts and a section fed ascending
 *     ones both render exactly what they were handed (10.2),
 *   - a co-appearance entry shows its name and its count as text (10.3),
 *   - a paired-stat entry shows its name, its Win_Percentage with one decimal
 *     place and an explicit percentage indication, and its qualifying-match
 *     count (10.4),
 *   - each entry carries exactly one keyboard-operable control named by that
 *     entry's own display name (10.5),
 *   - activating one navigates to the Player_Stats_Route the squads barrel's
 *     `playerStatsPath` builds for the route's squad and that entry's
 *     membership, client-side and once (10.6),
 *   - an empty section renders its heading with the nothing-to-show-yet
 *     statement and no entry at all (10.7),
 *   - an entry whose name is the Anonymised_Placeholder is presented as a
 *     Former_Player and **keeps its control** (10.8).
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router-dom';

import {
  PAIRWISE_COUNT_SELECTOR,
  PAIRWISE_EMPTY_SELECTOR,
  PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE,
  PAIRWISE_ENTRY_SELECTOR,
  PAIRWISE_FORMER_PLAYER_SELECTOR,
  PAIRWISE_LINK_PATH_ATTRIBUTE,
  PAIRWISE_LINK_SELECTOR,
  PAIRWISE_QUALIFYING_HEADING,
  PAIRWISE_QUALIFYING_SELECTOR,
  PAIRWISE_SECTION_SELECTOR,
  PAIRWISE_SECTION_VARIANT_ATTRIBUTE,
  PAIRWISE_VALUE_SELECTOR,
  PAIRWISE_COUNT_HEADING,
  PAIRWISE_PLAYER_HEADING,
  PairwiseSection,
  type PairwiseSectionProps,
} from './PairwiseSection';
import { PLAYER_STATS_ROUTE, playerStatsPath } from '../../squads';
import { ANONYMISED_PLACEHOLDER } from '../lib/anonymisedName';
import {
  BEST_PARTNERSHIPS_HEADING,
  FORMER_PLAYER_LABEL,
  MOST_PLAYED_WITH_HEADING,
  PAIRWISE_NOTHING_YET_STATEMENT,
  WIN_PERCENTAGE_LABEL,
} from '../lib/messages';
import type {
  CoAppearanceEntry,
  PairedStatEntry,
} from '../lib/parse/playerProfile';

/** The squad the route is standing in — every link is built inside it. */
const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

/** The subject of the screen the section is rendered on. */
const SUBJECT_MEMBERSHIP_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f02';

/** A test id on the node wrapping the routed content, to prove node identity. */
const LAYOUT_TEST_ID = 'player-stats-layout-stand-in';

/** Three co-appearance entries, deliberately **not** in count order. */
const CO_APPEARANCE_ENTRIES: readonly CoAppearanceEntry[] = [
  {
    membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f11',
    displayName: 'Dave',
    count: 14,
  },
  {
    membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f12',
    displayName: 'BigDave',
    count: 21,
  },
  {
    membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f13',
    displayName: 'Ömer',
    count: 0,
  },
];

/** Two paired-stat entries, including a whole-number percentage. */
const PAIRED_STAT_ENTRIES: readonly PairedStatEntry[] = [
  {
    membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f21',
    displayName: 'Grace',
    value: 66.66666666666667,
    qualifyingMatches: 12,
  },
  {
    membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f22',
    displayName: 'Sam',
    value: 50,
    qualifyingMatches: 4,
  },
];

/** A co-appearance entry whose person has been erased (Requirement 10.8). */
const ERASED_ENTRY: CoAppearanceEntry = {
  membershipId: '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f31',
  displayName: ANONYMISED_PLACEHOLDER,
  count: 7,
};

/** The default co-appearance props, so each test states only its difference. */
const coAppearanceProps = (
  entries: readonly CoAppearanceEntry[] = CO_APPEARANCE_ENTRIES,
): PairwiseSectionProps => ({
  heading: MOST_PLAYED_WITH_HEADING,
  squadId: SQUAD_ID,
  variant: 'co-appearance',
  entries,
});

/** The default paired-stat props. */
const pairedStatProps = (
  entries: readonly PairedStatEntry[] = PAIRED_STAT_ENTRIES,
): PairwiseSectionProps => ({
  heading: BEST_PARTNERSHIPS_HEADING,
  squadId: SQUAD_ID,
  variant: 'paired-stat',
  entries,
});

/**
 * Mount a section at a Player_Stats_Route path behind a real client-side router.
 *
 * The destination of every Pairwise_Link is the **same route pattern** the
 * section is rendered at — which is the whole point of the subject-keyed load
 * machine — so one route serves both ends of the journey, and arrival is read
 * from the router's own location.
 */
function renderSection(props: PairwiseSectionProps) {
  const routes: RouteObject[] = [
    { path: PLAYER_STATS_ROUTE, element: <PairwiseSection {...props} /> },
  ];

  const router = createMemoryRouter(routes, {
    initialEntries: [playerStatsPath(SQUAD_ID, SUBJECT_MEMBERSHIP_ID)],
  });

  const rendered = render(
    <div data-testid={LAYOUT_TEST_ID}>
      <RouterProvider router={router} />
    </div>,
  );

  return { router, ...rendered };
}

/** The rendered entries, in document order. */
function entryRows(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(PAIRWISE_ENTRY_SELECTOR),
  );
}

/** One entry's single control. */
function entryLink(row: HTMLElement): HTMLElement {
  const links = row.querySelectorAll<HTMLElement>(PAIRWISE_LINK_SELECTOR);

  expect(links).toHaveLength(1);

  return links[0];
}

describe('PairwiseSection heading (Reqs 10.1, 16.1, 16.2)', () => {
  it('renders the heading naming what the section measures', () => {
    renderSection(coAppearanceProps());

    expect(
      screen.getByRole('heading', { name: MOST_PLAYED_WITH_HEADING }),
    ).toBeVisible();
  });

  it('renders that heading at level two, and no other heading', () => {
    renderSection(coAppearanceProps());

    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      MOST_PLAYED_WITH_HEADING,
    );
  });

  it('exposes the section as a region named by its heading', () => {
    renderSection(pairedStatProps());

    expect(
      screen.getByRole('region', { name: BEST_PARTNERSHIPS_HEADING }),
    ).toBeVisible();
  });

  it('states which variant it rendered', () => {
    const { container } = renderSection(pairedStatProps());

    expect(
      container
        .querySelector(PAIRWISE_SECTION_SELECTOR)
        ?.getAttribute(PAIRWISE_SECTION_VARIANT_ATTRIBUTE),
    ).toBe('paired-stat');
  });
});

describe('PairwiseSection entries (Req 10.2)', () => {
  it('renders exactly one entry per parsed entry', () => {
    const { container } = renderSection(coAppearanceProps());

    expect(entryRows(container)).toHaveLength(CO_APPEARANCE_ENTRIES.length);
  });

  it('renders them in the order the profile carries them, not in count order', () => {
    const { container } = renderSection(coAppearanceProps());

    const names = entryRows(container).map((row) => entryLink(row).textContent);

    expect(names).toEqual(['Dave', 'BigDave', 'Ömer']);
  });

  it('renders no entry for any other membership', () => {
    const { container } = renderSection(coAppearanceProps());

    const identities = entryRows(container).map((row) =>
      row.getAttribute(PAIRWISE_ENTRY_MEMBERSHIP_ID_ATTRIBUTE),
    );

    expect(identities).toEqual(CO_APPEARANCE_ENTRIES.map((e) => e.membershipId));
  });

  it('renders a table with a header per column', () => {
    renderSection(coAppearanceProps());

    expect(
      screen.getByRole('columnheader', { name: PAIRWISE_PLAYER_HEADING }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: PAIRWISE_COUNT_HEADING }),
    ).toBeVisible();
  });
});

describe('PairwiseSection co-appearance entry (Req 10.3)', () => {
  it('renders each entry’s display name as text', () => {
    renderSection(coAppearanceProps());

    for (const entry of CO_APPEARANCE_ENTRIES) {
      expect(screen.getByText(entry.displayName)).toBeVisible();
    }
  });

  it('renders each entry’s count exactly as parsed, zero included', () => {
    const { container } = renderSection(coAppearanceProps());

    const counts = entryRows(container).map(
      (row) => row.querySelector(PAIRWISE_COUNT_SELECTOR)?.textContent,
    );

    expect(counts).toEqual(['14', '21', '0']);
  });

  it('renders no percentage column for this variant', () => {
    const { container } = renderSection(coAppearanceProps());

    expect(container.querySelector(PAIRWISE_VALUE_SELECTOR)).toBeNull();
    expect(container.querySelector(PAIRWISE_QUALIFYING_SELECTOR)).toBeNull();
  });
});

describe('PairwiseSection paired-stat entry (Req 10.4)', () => {
  it('renders the win percentage with exactly one decimal place and a percentage sign', () => {
    const { container } = renderSection(pairedStatProps());

    const values = entryRows(container).map(
      (row) => row.querySelector(PAIRWISE_VALUE_SELECTOR)?.textContent,
    );

    expect(values).toEqual(['66.7%', '50.0%']);
  });

  it('renders the count of qualifying matches', () => {
    const { container } = renderSection(pairedStatProps());

    const qualifying = entryRows(container).map(
      (row) => row.querySelector(PAIRWISE_QUALIFYING_SELECTOR)?.textContent,
    );

    expect(qualifying).toEqual(['12', '4']);
  });

  it('names both figure columns', () => {
    renderSection(pairedStatProps());

    expect(
      screen.getByRole('columnheader', { name: WIN_PERCENTAGE_LABEL }),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: PAIRWISE_QUALIFYING_HEADING }),
    ).toBeVisible();
  });

  it('renders no co-appearance count for this variant', () => {
    const { container } = renderSection(pairedStatProps());

    expect(container.querySelector(PAIRWISE_COUNT_SELECTOR)).toBeNull();
  });
});

describe('PairwiseSection link (Reqs 10.5, 10.6, 1.7)', () => {
  it('renders exactly one control per entry', () => {
    const { container } = renderSection(coAppearanceProps());

    expect(container.querySelectorAll(PAIRWISE_LINK_SELECTOR)).toHaveLength(
      CO_APPEARANCE_ENTRIES.length,
    );
    expect(screen.getAllByRole('button')).toHaveLength(
      CO_APPEARANCE_ENTRIES.length,
    );
  });

  it('names each control by that entry’s own display name', () => {
    renderSection(coAppearanceProps());

    for (const entry of CO_APPEARANCE_ENTRIES) {
      expect(
        screen.getByRole('button', { name: entry.displayName }),
      ).toHaveAccessibleName(entry.displayName);
    }
  });

  it('targets the path the squads barrel builds for the route squad and that entry', () => {
    const { container } = renderSection(coAppearanceProps());

    const targets = entryRows(container).map((row) =>
      entryLink(row).getAttribute(PAIRWISE_LINK_PATH_ATTRIBUTE),
    );

    expect(targets).toEqual(
      CO_APPEARANCE_ENTRIES.map((entry) =>
        playerStatsPath(SQUAD_ID, entry.membershipId),
      ),
    );
  });

  it('navigates client-side on a pointer activation, adding exactly one history entry', async () => {
    const user = userEvent.setup();
    const { router } = renderSection(coAppearanceProps());

    const layoutBefore = screen.getByTestId(LAYOUT_TEST_ID);
    const keyBefore = router.state.location.key;

    await user.click(screen.getByRole('button', { name: 'BigDave' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        playerStatsPath(SQUAD_ID, CO_APPEARANCE_ENTRIES[1].membershipId),
      );
    });
    expect(router.state.location.key).not.toBe(keyBefore);
    // The wrapping node survived, so nothing performed a full-document reload.
    expect(screen.getByTestId(LAYOUT_TEST_ID)).toBe(layoutBefore);
  });

  it('is reachable and operable by Enter', async () => {
    const user = userEvent.setup();
    const { router } = renderSection(coAppearanceProps());

    await user.tab();
    expect(screen.getByRole('button', { name: 'Dave' })).toHaveFocus();

    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        playerStatsPath(SQUAD_ID, CO_APPEARANCE_ENTRIES[0].membershipId),
      );
    });
  });

  it('is operable by Space, which an anchor would not be', async () => {
    const user = userEvent.setup();
    const { router } = renderSection(coAppearanceProps());

    screen.getByRole('button', { name: 'Ömer' }).focus();
    await user.keyboard(' ');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        playerStatsPath(SQUAD_ID, CO_APPEARANCE_ENTRIES[2].membershipId),
      );
    });
  });

  it('stays inside the squad the section was rendered for', () => {
    const { container } = renderSection(pairedStatProps());

    for (const row of entryRows(container)) {
      expect(entryLink(row).getAttribute(PAIRWISE_LINK_PATH_ATTRIBUTE)).toContain(
        SQUAD_ID,
      );
    }
  });
});

describe('PairwiseSection with no entry (Req 10.7)', () => {
  it('renders the heading together with the nothing-to-show-yet statement', () => {
    renderSection(coAppearanceProps([]));

    expect(
      screen.getByRole('heading', { name: MOST_PLAYED_WITH_HEADING }),
    ).toBeVisible();
    expect(screen.getByText(PAIRWISE_NOTHING_YET_STATEMENT)).toBeVisible();
  });

  it('renders no entry, no table, and no control', () => {
    const { container } = renderSection(pairedStatProps([]));

    expect(entryRows(container)).toHaveLength(0);
    expect(container.querySelector(PAIRWISE_LINK_SELECTOR)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the same statement for both variants', () => {
    const first = renderSection(coAppearanceProps([]));
    const firstText = first.container.querySelector(PAIRWISE_EMPTY_SELECTOR)
      ?.textContent;
    first.unmount();

    const second = renderSection(pairedStatProps([]));
    const secondText = second.container.querySelector(PAIRWISE_EMPTY_SELECTOR)
      ?.textContent;

    expect(firstText).toBe(PAIRWISE_NOTHING_YET_STATEMENT);
    expect(secondText).toBe(firstText);
  });
});

describe('PairwiseSection former player (Req 10.8)', () => {
  it('presents an erased entry as a former player', () => {
    const { container } = renderSection(coAppearanceProps([ERASED_ENTRY]));

    expect(
      container.querySelector(PAIRWISE_FORMER_PLAYER_SELECTOR)?.textContent,
    ).toBe(FORMER_PLAYER_LABEL);
  });

  it('keeps that entry’s control, named by the placeholder as parsed', () => {
    const { container } = renderSection(coAppearanceProps([ERASED_ENTRY]));

    const link = entryLink(entryRows(container)[0]);

    expect(link).toHaveAccessibleName(ANONYMISED_PLACEHOLDER);
    expect(link.getAttribute(PAIRWISE_LINK_PATH_ATTRIBUTE)).toBe(
      playerStatsPath(SQUAD_ID, ERASED_ENTRY.membershipId),
    );
  });

  it('keeps that entry’s figures, because erasure strips the name and nothing else', () => {
    const { container } = renderSection(coAppearanceProps([ERASED_ENTRY]));

    expect(
      container.querySelector(PAIRWISE_COUNT_SELECTOR)?.textContent,
    ).toBe('7');
  });

  it('labels only the erased entry', () => {
    const { container } = renderSection(
      coAppearanceProps([...CO_APPEARANCE_ENTRIES, ERASED_ENTRY]),
    );

    expect(
      container.querySelectorAll(PAIRWISE_FORMER_PLAYER_SELECTOR),
    ).toHaveLength(1);
  });
});
