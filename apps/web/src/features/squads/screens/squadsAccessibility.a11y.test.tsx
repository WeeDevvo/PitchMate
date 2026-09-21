/**
 * Automated accessibility audits for every surface the Squads_Feature renders
 * (task 16.1).
 *
 * Requirement 19.11 asks for **zero** automated accessibility violations under
 * `jest-axe`, over the **WCAG 2.1 Level A and Level AA rule set**, with no rule
 * disabled, no violation marked as an accepted exception, and no violation
 * suppressed — for the Squads_Home, the Squad_Screen, and the Invite_Landing_Route.
 * Requirement 19.12 asks for that in **both** the dark Theme and the light Theme,
 * and for the dark Theme to be what renders when no Appearance_Preference is
 * stored.
 *
 * Every state that materially changes the tree is audited, in both Themes:
 *
 * | Surface | States |
 * | --- | --- |
 * | Squads_Home | awaiting the first response, cards, the Squads_Empty_State, the failure, the Create_Squad_Form open, the Join_Code_Form open |
 * | Squad_Screen | awaiting the first response, the failure, the Not_Found_Treatment, the Player_List with ratings and Provisional_Bands, the Player_List with ratings unavailable, the Admin_Section, the Guest_Form open for creation and for an edit, the invite generator open, the revoke confirmation open, the promotion confirmation open |
 * | Invite_Landing_Route | the handover, the handover after a failed preview, redeeming, the unusable invite, the failure, the incomplete link |
 *
 * The set itself lives in `../testing/squadsScreenStates.tsx`, because tasks 16.2,
 * 16.3, and 16.4 make claims about the *same* trees and a second copy of the set
 * would be a second thing to keep in step.
 *
 * ### Audited as composed, not component by component
 *
 * Each state is the real screen, mounted at its real route pattern inside a real
 * router and a real `AuthProvider`, with its own state machines settling real
 * `CallResult` values — so what is assessed is the composition that ships. An
 * audit of a component in isolation would miss exactly the faults that matter
 * here: a second level-one heading, a duplicated landmark, an `aria-controls` with
 * no target, a nested interactive control, a label pointing at nothing. All of
 * those arise from composition rather than from any one component.
 *
 * ### The rule set, and the one thing jsdom cannot judge
 *
 * `runOnly` names the four tags that make up WCAG 2.1 Level A and Level AA
 * (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`). Nothing here disables a rule,
 * filters by impact, or treats a reported violation as expected —
 * {@link expectNoWcagViolations} asserts the whole `violations` array is empty,
 * and additionally that the run was **not vacuous**: a misconfigured tag list
 * would evaluate no rule and report no violation, which would look identical to a
 * clean audit. The first `describe` below pins that by feeding the same
 * configuration markup with two known WCAG 2.1 A faults and requiring both to be
 * reported.
 *
 * One environmental limitation is worth stating plainly rather than leaving to be
 * discovered: `jest-axe` disables axe's colour-category rules on import, because
 * jsdom computes no colour and resolves no `var(--token)`, so a contrast ratio
 * cannot be measured in this environment at all. That is the division the design
 * records — the contrast floors for both Themes are computed from the declared
 * token tables by Property 47 (task 16.4) — and full accessibility validation
 * still requires manual testing with assistive technologies and expert review.
 * This suite establishes the automated floor, not the ceiling.
 *
 * Focus entry and return (Property 46), the heading outlines (Property 43), field
 * labelling (Property 45), and keyboard order (Property 47) are not re-asserted
 * here; each is owned by its own file.
 *
 * Feature: web-squads-screens
 * Validates: Requirements 19.11, 19.12, 20.12
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

import { APPEARANCE_STORAGE_KEY, THEME_ATTRIBUTE } from '../../../theme';
import {
  SCREEN_STATE_CASES,
  THEMES,
  renderSquadsHomeState,
  resetTheme,
  themeAppliedByBootstrap,
} from '../testing/squadsScreenStates';

/**
 * The App_Shell's Squad_Scope publication, replaced by a no-op.
 *
 * `usePublishSquadScopeFromRoute` reads the shell's publish context and throws
 * where none is above it, which is correct for the application — the Squad_Route
 * is a child of the shell's `/app` layout route — and unusable for a screen
 * rendered on its own. The provider is deliberately not part of the shell's public
 * barrel, and reaching past that barrel would breach the module boundary the
 * shell's structural scan enforces, so the one export is stubbed. Everything else
 * of the shell stays the shell's own.
 */
vi.mock('../../app-shell', async () => {
  const actual =
    await vi.importActual<typeof import('../../app-shell')>('../../app-shell');

  return {
    ...actual,
    usePublishSquadScopeFromRoute: (): string | null => null,
  };
});

// --- The rule set (Requirement 19.11) ---------------------------------------

/**
 * The axe tags that together make up the WCAG 2.1 Level A and Level AA rule set:
 * the WCAG 2.0 A and AA rules, plus the rules 2.1 added at each level.
 *
 * Passed as `runOnly`, which *scopes* the run to this rule set. It disables
 * nothing within it — an axe rule outside WCAG 2.1 A/AA (a best-practice rule such
 * as `region` or `page-has-heading-one`) is simply not part of what Requirement
 * 19.11 asks about.
 */
const WCAG_A_AND_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

/**
 * Audit one rendering and require zero violations.
 *
 * No rule is disabled, no violation is filtered by impact, and no reported
 * violation is treated as expected: the assertion is over the entire `violations`
 * array. The second assertion guards against a *vacuous* pass — a misconfigured
 * tag list would evaluate no rule and report no violation, which would look
 * identical to a clean audit.
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

// --- The configured audit itself --------------------------------------------

describe('the configured audit', () => {
  /**
   * The counterpart to every clean audit below: markup with two faults the WCAG
   * 2.1 A rule set names — an image with no text alternative (`image-alt`) and a
   * text input with no label (`label`) — must be *reported*. Without this, a
   * `runOnly` tag list that matched no rule would let every audit in this file
   * pass while proving nothing.
   */
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

// --- Every state, in both Themes (Requirements 19.11, 19.12) ----------------

describe.each(THEMES)('in the %s theme', (theme) => {
  describe.each(SCREEN_STATE_CASES.map((state) => [state.name, state] as const))(
    '%s',
    (_name, state) => {
      // Validates: Requirements 19.11, 19.12, 20.12
      it('has no WCAG 2.1 A or AA violations', async () => {
        const { container } = await state.render(theme);

        expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe(theme);

        await expectNoWcagViolations(container);
      });
    },
  );
});

// --- The dark Theme is the default (Requirement 19.12) ----------------------

describe('with no stored Appearance_Preference', () => {
  // Validates: Requirements 19.12
  it('renders the dark theme, as the production bootstrap resolves it', async () => {
    // Nothing stored, and jsdom reports no explicit light browser preference —
    // which is the arrangement a first-time visitor arrives in.
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBeNull();

    // The decision is the production pre-paint bootstrap's own, evaluated as the
    // injected inline script evaluates it, rather than restated here.
    expect(themeAppliedByBootstrap()).toBe('dark');

    // And the feature renders under it with no violation, so the default Theme is
    // audited as a Theme rather than only as an attribute value.
    const { container } = await renderSquadsHomeState('listed', 'dark');

    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark');
    await expectNoWcagViolations(container);
  });
});
