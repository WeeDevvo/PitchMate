/**
 * Automated accessibility audits for every condition the Player_Stats_Screen can
 * be in (task 14.1).
 *
 * Requirement 16.7 asks for **zero** violations of the **WCAG 2.1 Level A and
 * Level AA rule set** under an automated audit of the screen, in every condition
 * it can be in and in **both** Themes, with no rule disabled — and no violation
 * marked as an accepted exception or otherwise suppressed. Requirement 16.8 asks
 * for that audit to come with a control demonstrating it reports violations for
 * deliberately inaccessible markup.
 *
 * Every condition that materially changes the tree is audited, in both Themes:
 *
 * | Group | Conditions |
 * | --- | --- |
 * | no profile rendered | loading, not-found, an unidentifiable subject, failed, failed with the retry activated, failed with a retry pending |
 * | Rating_Condition | established, provisional, never played, absent |
 * | tracking | disabled, empty, present |
 * | progression | empty, a single point, populated |
 * | Pairwise_Sections | empty, populated |
 * | membership facts | a guest, a Former_Player, no membership state recorded, a zero Appearance_Count |
 *
 * The set itself lives in `../testing/playerStatsScreenStates.tsx`, because
 * tasks 14.2 and 14.3 make claims about the *same* trees and a second copy of
 * the set would be a second thing to keep in step.
 *
 * ### Audited as composed, not component by component
 *
 * Each condition is the real screen, mounted at its real route pattern inside a
 * real router and a real `AuthProvider`, with its own load machine settling real
 * `CallResult` values — so what is assessed is the composition that ships. An
 * audit of a component in isolation would miss exactly the faults that matter
 * here: a second level-one heading, a duplicated landmark, an `aria-labelledby`
 * with no target, a nested interactive control, a table header pointing at
 * nothing. All of those arise from composition rather than from any one
 * component.
 *
 * One condition in the set is the exception, and says so: the pending-retry
 * failure surface. The screen hands the load machine's busy flag to the failure
 * notice, and the machine's `failed` phase and its busy phases are mutually
 * exclusive — a failure clears the held profile, so activating the retry moves
 * the screen to the loading body. Both trees are audited: the one the screen
 * really reaches after a retry, and the `aria-disabled` retry markup the notice
 * ships for the case a caller does hold both.
 *
 * ### The rule set, and the one thing jsdom cannot judge
 *
 * `runOnly` names the four tags that make up WCAG 2.1 Level A and Level AA
 * (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`). Nothing here disables a rule,
 * filters by impact, or treats a reported violation as expected —
 * {@link expectNoWcagViolations} asserts the whole `violations` array is empty,
 * and additionally that the run was **not vacuous**: a misconfigured tag list
 * would evaluate no rule and report no violation, which would look identical to
 * a clean audit. The first `describe` below pins that by feeding the same
 * configuration markup with two known WCAG 2.1 A faults and requiring both to be
 * reported (Requirement 16.8).
 *
 * One environmental limitation is worth stating plainly rather than leaving to
 * be discovered: `jest-axe` disables axe's colour-category rules on import,
 * because jsdom computes no colour and resolves no `var(--token)`, so a contrast
 * ratio cannot be measured in this environment at all. That is the division the
 * design records — the contrast floors for both Themes are computed from the
 * declared token tables by Property 35 (task 14.4) — and full accessibility
 * validation still requires manual testing with assistive technologies and
 * expert review. This suite establishes the automated floor, not the ceiling.
 *
 * The heading outlines (Property 33), keyboard reachability and focus
 * (Property 34), the token tables and contrast (Property 35), and the green
 * painting rule (Property 36) are not re-asserted here; each is owned by its own
 * file.
 *
 * Feature: web-player-stats-screen
 * Validates: Requirements 16.7, 16.8
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

import { APPEARANCE_STORAGE_KEY, THEME_ATTRIBUTE } from '../../../theme';
import {
  SCREEN_STATE_CASES,
  THEMES,
  ratingConditionsCovered,
  renderLoadedState,
  profileWith,
  resetTheme,
  themeAppliedByBootstrap,
  trackingConditionsCovered,
} from '../testing/playerStatsScreenStates';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the
 * Player_Stats_Route is a child of the shell's `/app` layout route — and
 * unusable for a screen rendered on its own. The provider is deliberately not
 * part of the shell's public barrel, and reaching past that barrel would breach
 * the module boundary the shell's structural scan enforces, so the one export is
 * stubbed. Everything else of the shell stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

// --- The rule set (Requirement 16.7) ----------------------------------------

/**
 * The axe tags that together make up the WCAG 2.1 Level A and Level AA rule set:
 * the WCAG 2.0 A and AA rules, plus the rules 2.1 added at each level.
 *
 * Passed as `runOnly`, which *scopes* the run to this rule set. It disables
 * nothing within it — an axe rule outside WCAG 2.1 A/AA (a best-practice rule
 * such as `region` or `page-has-heading-one`) is simply not part of what
 * Requirement 16.7 asks about.
 */
const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Audit one rendering and require zero violations.
 *
 * No rule is disabled, no violation is filtered by impact, and no reported
 * violation is treated as expected: the assertion is over the entire
 * `violations` array. The second assertion guards against a *vacuous* pass — a
 * misconfigured tag list would evaluate no rule and report no violation, which
 * would look identical to a clean audit.
 */
async function expectNoWcagViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container, {
    runOnly: { type: 'tag', values: [...WCAG_A_AND_AA_TAGS] },
  });

  const evaluated =
    results.passes.length + results.incomplete.length + results.violations.length;
  expect(evaluated).toBeGreaterThan(0);

  expect(results).toHaveNoViolations();
}

beforeEach(() => {
  localStorage.clear();
  resetTheme();
});

afterEach(() => {
  localStorage.clear();
  // The applied Theme lives on the document element, which outlives an unmount.
  resetTheme();
});

// --- The configured audit itself (Requirement 16.8) -------------------------

describe('the configured audit', () => {
  /**
   * The counterpart to every clean audit below: markup with two faults the WCAG
   * 2.1 A rule set names — an image with no text alternative (`image-alt`) and a
   * text input with no label (`label`) — must be *reported*. Without this, a
   * `runOnly` tag list that matched no rule would let every audit in this file
   * pass while proving nothing.
   */
  // Validates: Requirements 16.8
  it('reports violations for markup that breaks WCAG 2.1 A rules', async () => {
    const { container } = render(
      <div>
        <img src="/badge.png" />
        <input type="text" />
      </div>,
    );

    const results = await axe(container, {
      runOnly: { type: 'tag', values: [...WCAG_A_AND_AA_TAGS] },
    });

    expect(results.violations.map((violation) => violation.id).sort()).toEqual([
      'image-alt',
      'label',
    ]);
  });
});

// --- The condition set is the set it claims to be ---------------------------

describe('the condition set', () => {
  it('covers each of the four Rating_Conditions once', () => {
    // Resolved through `resolveRatingCondition` from the very profiles the
    // loaded cases present, rather than taken from their names — so a case whose
    // overrides stopped producing its condition shrinks this set and fails here
    // instead of auditing the same tree four times.
    expect([...ratingConditionsCovered()].sort()).toEqual([
      'absent',
      'established',
      'never-played',
      'provisional',
    ]);
  });

  it('covers each of the three tracking conditions once', () => {
    expect([...trackingConditionsCovered()].sort()).toEqual([
      'disabled',
      'empty',
      'present',
    ]);
  });

  it('names every condition exactly once', () => {
    const names = SCREEN_STATE_CASES.map((state) => state.name);

    expect(new Set(names).size).toBe(names.length);
  });
});

// --- Every condition, in both Themes (Requirement 16.7) ---------------------

describe.each(THEMES)('in the %s theme', (theme) => {
  describe.each(SCREEN_STATE_CASES.map((state) => [state.name, state] as const))(
    '%s',
    (_name, state) => {
      // Validates: Requirements 16.7
      it('has no WCAG 2.1 A or AA violations', async () => {
        const { container } = await state.render(theme);

        expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(theme);

        await expectNoWcagViolations(container);
      });
    },
  );
});

// --- The dark Theme is the default (Requirement 16.7) -----------------------

describe('with no stored Appearance_Preference', () => {
  // Validates: Requirements 16.7
  it('renders the dark theme, as the production bootstrap resolves it', async () => {
    // Nothing stored, and jsdom reports no explicit light browser preference —
    // which is the arrangement a first-time visitor arrives in.
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();

    // The decision is the production pre-paint bootstrap's own, evaluated as the
    // injected inline script evaluates it, rather than restated here.
    expect(themeAppliedByBootstrap()).toBe('dark');

    // And the screen renders under it with no violation, so the default Theme is
    // audited as a Theme rather than only as an attribute value.
    const { container } = await renderLoadedState(
      'dark',
      profileWith({}),
      'the default theme',
    );

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    await expectNoWcagViolations(container);
  });
});
