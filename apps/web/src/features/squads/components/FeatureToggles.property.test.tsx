/**
 * Property test for the Feature_Toggle set (task 12.9).
 *
 * **Property 32: Feature toggles reflect the backend and never an optimistic
 * guess.** *For any* parsed Feature_Flag collection, exactly one Feature_Toggle is
 * rendered per flag, each carrying a persistently visible label naming the feature
 * and a text label stating whether it is enabled; *for any* flag and requested
 * state a change submits exactly one `SetFeatureFlag` call carrying that flag and
 * that state; *for any* state the backend reports on success the toggle renders
 * that state even where it differs from the requested one; and *for any* failure
 * outcome the toggle renders the state last accepted from the backend, so no
 * rendered toggle state contradicts the last backend-supplied value at any instant
 * after the call settles.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 14.1 — one toggle per flag, each naming its feature and its state in words | {@link expectStructure} |
 * | 14.3 — exactly one `SetFeatureFlag`, carrying that flag and that state | {@link expectOneCommand} |
 * | 14.5 — the success announcement names the feature and its new state | the success property |
 * | 14.6 — every failure arm: one generic message, the last backend state, available again | the failure property |
 * | 14.7 — no optimistic state, in flight or after settling | {@link expectStates}, both interaction properties |
 * | 19.3 — the state is in text, not in the accent alone | {@link expectStructure} |
 *
 * ### Why a *differing* backend report is the load-bearing generator
 *
 * The naive implementation of a switch writes the requested state locally and
 * corrects itself later, and every case where the backend agrees with the request
 * hides that. So the success property generates three reports for the changed
 * flag — the requested state, the state it already had (a backend that declined to
 * move), and an arbitrary one — and asserts the rendered state follows the
 * collection rather than the click in all three. An optimistic component passes the
 * first and fails the second.
 *
 * The same claim is asserted *during* the call as well as after it: with the
 * response withheld, every switch must still read exactly what it read before the
 * activation. That is the "no optimistic state outlives its call" half of
 * Requirement 14.7 at the one instant it can be observed.
 *
 * ### Every failure arm, not a sample
 *
 * The failure property generates all six non-success arms of {@link CallResult} —
 * transport failure, timeout, parse failure, auth failure, not-found, and a
 * rejection carrying each {@link RejectionReason} — and asserts one presentation
 * across all of them: the single {@link GENERIC_SQUADS_FAILURE}, the switch left on
 * the last backend-supplied state, and one further activation issuing one further
 * call. A surface that told any arm apart would fail on that arm. The generated
 * rejection reason is also asserted absent from the announcement, so the arm that
 * *does* carry a discriminator cannot leak it.
 *
 * ### Repeated flags are generated on purpose
 *
 * The Generated_Enum_Union names one Squad_Feature, so a collection of more than one flag
 * necessarily repeats it — which is what the wire can carry and what the component
 * renders positionally rather than rejecting. Generating those collections is how
 * "one toggle per flag" is checked as a count over the collection rather than over
 * the set of distinct features, and how the per-flag single-flight guard is
 * exercised against a second row of the same feature.
 *
 * Every seam is injected: the fake Squads_Api answers `setFeatureFlag` with a
 * {@link CallResult} on demand, so no transport, no `fetch`, and no clock is
 * involved and a timeout is the arm rather than an advanced clock. `onSquadChanged`
 * is always supplied, as the Squad_Screen supplies it, so no `GetFeatureFlags` call
 * is owed — and the fake counts that read so the property can say it was never
 * issued (Requirement 14.2).
 *
 * Feature: web-squads-screens, Property 32: Feature toggles reflect the backend and never an optimistic guess
 * Validates: Requirements 14.1, 14.3, 14.5, 14.6, 14.7, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import fc from 'fast-check';

import {
  FEATURE_TOGGLE_FEATURE_ATTRIBUTE,
  FEATURE_TOGGLE_SELECTOR,
  FEATURE_TOGGLE_STATE_SELECTOR,
  FEATURE_TOGGLE_SWITCH_SELECTOR,
  FEATURE_TOGGLES_OUTCOME_REGION_ID,
  FEATURE_TOGGLES_SELECTOR,
  FeatureToggles,
  NO_OPTIONAL_FEATURES_SELECTOR,
  featureStateLabel,
  featureToggleAnnouncement,
  featureToggleLabel,
} from './FeatureToggles';
import type {
  CallResult,
  SetFeatureFlagRequest,
  SquadsApi,
} from '../api/squadsApi';
import type { RejectionReason } from '../lib/callOutcome';
import type { SquadFeature } from '../lib/wireEnums';
import {
  GENERIC_SQUADS_FAILURE,
  NO_OPTIONAL_FEATURES_STATEMENT,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';

const SQUAD_ID = '0198e2a7-1c8e-7a5e-9c2f-6b1d4a5e7f01';

// --- The fake seam ------------------------------------------------------------

/** The `SetFeatureFlag` calls this surface issued, and how each one settles. */
interface Transport {
  readonly api: SquadsApi;
  /** Every command the surface sent, in order, exactly as it sent it. */
  readonly commands: SetFeatureFlagRequest[];
  /** How many fallback `GetFeatureFlags` reads were issued — always none here. */
  flagReads(): number;
  /** Settle the oldest call awaiting a response. */
  settle(result: CallResult<void>): void;
}

/**
 * A Squads_Api that records every `SetFeatureFlag` command, withholds its response
 * until {@link Transport.settle}, and refuses every other operation.
 *
 * The withholding is what makes the in-flight half of Requirement 14.7
 * observable, and the refusal is what makes "no other call is issued" a real
 * claim rather than an unchecked assumption. `getFeatureFlags` is counted rather
 * than refused: it is a call the machine could legitimately make in another
 * arrangement, so the property asserts its absence instead of relying on a throw
 * inside a promise chain.
 */
function createTransport(): Transport {
  const commands: SetFeatureFlagRequest[] = [];
  const waiting: ((result: CallResult<void>) => void)[] = [];
  let flagReads = 0;

  const refuse = (name: string) => (): never => {
    throw new Error(`no case of Property 32 issues ${name}`);
  };

  const api: SquadsApi = {
    listMySquads: refuse('listMySquads'),
    getSquad: refuse('getSquad'),
    getDisplayRatingLeaderboard: refuse('getDisplayRatingLeaderboard'),
    createSquad: refuse('createSquad'),
    redeemInvite: refuse('redeemInvite'),
    previewInvite: refuse('previewInvite'),
    listInvites: refuse('listInvites'),
    generateInvite: refuse('generateInvite'),
    revokeInvite: refuse('revokeInvite'),
    createGuest: refuse('createGuest'),
    editGuest: refuse('editGuest'),
    promoteToAdmin: refuse('promoteToAdmin'),
    getFeatureFlags: () => {
      flagReads += 1;
      // Never settles: the point is that this call is not owed at all.
      return new Promise(() => undefined);
    },
    setFeatureFlag: (_squadId: string, command: SetFeatureFlagRequest) => {
      commands.push(command);
      return new Promise<CallResult<void>>((resolve) => {
        waiting.push(resolve);
      });
    },
  };

  return {
    api,
    commands,
    flagReads: () => flagReads,
    settle: (result) => {
      const resolve = waiting.shift();

      expect(resolve, 'no SetFeatureFlag call is awaiting a response').not.toBe(
        undefined,
      );

      resolve?.(result);
    },
  };
}

/** Let a settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
    }
  });
}

// --- Generators ---------------------------------------------------------------

/**
 * The one Squad_Feature the Generated_Enum_Union names — so a collection longer than one
 * repeats it, which is a shape the wire can carry and the component renders
 * positionally.
 */
const FEATURE: SquadFeature = 'LiveMatchTracking';

/** A Feature_Flag collection, empty included, each flag in either state. */
const flagsArb = (minLength: number): fc.Arbitrary<readonly FeatureFlag[]> =>
  fc
    .array(fc.boolean(), { minLength, maxLength: 3 })
    .map((states) =>
      states.map((isEnabled) => ({ feature: FEATURE, isEnabled })),
    );

/** The six non-success arms, every one of which is the same presentation. */
const failureArb: fc.Arbitrary<CallResult<void>> = fc.oneof(
  fc.constant<CallResult<void>>({ kind: 'transport-failure' }),
  fc.constant<CallResult<void>>({ kind: 'timeout' }),
  fc.constant<CallResult<void>>({ kind: 'parse-failure' }),
  fc.constant<CallResult<void>>({ kind: 'auth-failure' }),
  fc.constant<CallResult<void>>({ kind: 'not-found' }),
  fc
    .constantFrom<RejectionReason>(
      'display-name-in-use',
      'invite-unusable',
      'invite-limit-reached',
      'validation',
      'conflict',
    )
    .map<CallResult<void>>((reason) => ({ kind: 'rejected-input', reason })),
);

/** What the backend reports for the changed flag once it has accepted the call. */
type BackendReport = 'requested' | 'unchanged' | 'arbitrary';

const backendReportArb = fc.constantFrom<BackendReport>(
  'requested',
  'unchanged',
  'arbitrary',
);

/**
 * The collection the post-change `GetSquad` re-read supplies.
 *
 * Same length as the collection rendered before the change, because this property
 * is about which *state* a toggle shows rather than about a collection changing
 * shape. `unchanged` is the case that fails an optimistic component: the backend
 * reports the state the flag already had, so the requested state and the backend's
 * differ.
 */
function reportedFlags(
  flags: readonly FeatureFlag[],
  index: number,
  report: BackendReport,
  arbitraryStates: readonly boolean[],
): readonly FeatureFlag[] {
  return flags.map((flag, position) => {
    if (report === 'arbitrary') {
      return {
        feature: flag.feature,
        isEnabled: arbitraryStates[position] ?? flag.isEnabled,
      };
    }

    if (position !== index) {
      return flag;
    }

    return {
      feature: flag.feature,
      // `requested` is the opposite of what the flag showed; `unchanged` is what
      // it showed, which no optimistic switch would ever render.
      isEnabled: report === 'requested' ? !flag.isEnabled : flag.isEnabled,
    };
  });
}

// --- Reading what is rendered -------------------------------------------------

/** Every rendered toggle, in document order. */
function toggles(container: HTMLElement): readonly HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FEATURE_TOGGLE_SELECTOR)];
}

/** Every rendered switch control, in document order. */
function switches(container: HTMLElement): readonly HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(FEATURE_TOGGLE_SWITCH_SELECTOR),
  ];
}

/** The state each toggle states in words, in document order. */
function stateWords(container: HTMLElement): readonly string[] {
  return [
    ...container.querySelectorAll<HTMLElement>(FEATURE_TOGGLE_STATE_SELECTOR),
  ].map((state) => state.textContent ?? '');
}

/** The state each switch conveys programmatically, in document order. */
function checkedStates(container: HTMLElement): readonly (string | null)[] {
  return switches(container).map((control) =>
    control.getAttribute('aria-checked'),
  );
}

/** What the one outcome live region announces, or `null` while it holds nothing. */
function announcement(): string | null {
  const region = document.getElementById(FEATURE_TOGGLES_OUTCOME_REGION_ID);

  expect(region, 'the outcome region is always present').not.toBeNull();
  expect(region?.getAttribute('role')).toBe('status');
  expect(region?.getAttribute('aria-live')).not.toBeNull();

  const text = region?.textContent?.trim() ?? '';

  return text.length === 0 ? null : text;
}

// --- Assertions ---------------------------------------------------------------

/**
 * Requirements 14.1, 14.7, 19.3: one toggle per flag, each naming its feature and
 * stating its state in words, and each carrying the state the collection supplied
 * both in text and programmatically.
 *
 * The text carriers are read from `textContent`, which survives a greyscale
 * rendering and every stylesheet, so the state cannot be resting on the accent hue
 * alone (Requirement 19.3).
 */
function expectStructure(
  container: HTMLElement,
  flags: readonly FeatureFlag[],
): void {
  expect(container.querySelectorAll(FEATURE_TOGGLES_SELECTOR)).toHaveLength(1);

  const rendered = toggles(container);

  // 14.1: exactly one per flag, counted over the collection — repeats included.
  expect(rendered).toHaveLength(flags.length);
  expect(switches(container)).toHaveLength(flags.length);

  // 14.8: the statement stands exactly where the collection is empty.
  expect(container.querySelectorAll(NO_OPTIONAL_FEATURES_SELECTOR)).toHaveLength(
    flags.length === 0 ? 1 : 0,
  );

  if (flags.length === 0) {
    expect(container.textContent).toContain(NO_OPTIONAL_FEATURES_STATEMENT);
  }

  rendered.forEach((toggle, index) => {
    const flag = flags[index];
    const control = toggle.querySelector<HTMLElement>(
      FEATURE_TOGGLE_SWITCH_SELECTOR,
    );

    expect(toggle.getAttribute(FEATURE_TOGGLE_FEATURE_ATTRIBUTE)).toBe(
      flag.feature,
    );

    // 14.1: the label naming the feature, persistently visible in the row's own
    // text and the switch's accessible name — one node, so they cannot diverge.
    expect(toggle.textContent).toContain(featureToggleLabel(flag.feature));
    expect(control).toHaveAccessibleName(featureToggleLabel(flag.feature));

    // 14.1, 19.3: the state as a word, beside the control's own state.
    expect(toggle.textContent).toContain(featureStateLabel(flag.isEnabled));
    expect(
      toggle
        .querySelector(FEATURE_TOGGLE_STATE_SELECTOR)
        ?.getAttribute('data-squads-feature-state'),
    ).toBe(flag.isEnabled ? 'enabled' : 'disabled');
    expect(control?.getAttribute('role')).toBe('switch');
    expect(control?.getAttribute('aria-checked')).toBe(String(flag.isEnabled));
  });
}

/**
 * Requirement 14.7: every rendered state is exactly the collection's, in words and
 * programmatically.
 */
function expectStates(
  container: HTMLElement,
  flags: readonly FeatureFlag[],
): void {
  expect(stateWords(container)).toEqual(
    flags.map((flag) => featureStateLabel(flag.isEnabled)),
  );
  expect(checkedStates(container)).toEqual(
    flags.map((flag) => String(flag.isEnabled)),
  );
}

/**
 * Requirement 14.3: the calls issued so far are exactly the given requested
 * states, each carrying its flag and its state and nothing else.
 */
function expectOneCommand(
  transport: Transport,
  requested: readonly boolean[],
): void {
  expect(transport.commands).toHaveLength(requested.length);

  transport.commands.forEach((command, index) => {
    expect(Object.keys(command).sort()).toEqual(['enabled', 'feature']);
    expect(command.feature).toBe(FEATURE);
    expect(command.enabled).toBe(requested[index]);
  });

  // 14.2: the `GetSquad` re-read supplies the refreshed state, so the separate
  // feature read is never owed.
  expect(transport.flagReads()).toBe(0);
}

/** Whether a switch is available for a further change (Requirements 14.4, 14.6). */
function expectAvailable(control: HTMLElement): void {
  expect(control.getAttribute('aria-disabled')).toBeNull();
  expect(control.getAttribute('aria-busy')).toBeNull();
  expect(control).not.toBeDisabled();
  expect(control.tabIndex).toBeGreaterThanOrEqual(0);
}

// --- Rendering one case -------------------------------------------------------

interface Rendered {
  readonly container: HTMLElement;
  readonly transport: Transport;
  readonly onSquadChanged: ReturnType<typeof vi.fn>;
  show(flags: readonly FeatureFlag[]): void;
}

/**
 * Render the Feature_Toggle set over the fake seam, as the Admin_Section renders
 * it: with the `onSquadChanged` re-read supplied.
 */
function renderToggles(flags: readonly FeatureFlag[]): Rendered {
  const transport = createTransport();
  const onSquadChanged = vi.fn();

  const element = (collection: readonly FeatureFlag[]) => (
    <FeatureToggles
      squadId={SQUAD_ID}
      api={transport.api}
      flags={collection}
      onSquadChanged={onSquadChanged}
    />
  );

  const { container, rerender } = render(element(flags));

  return {
    container,
    transport,
    onSquadChanged,
    show: (collection) => {
      rerender(element(collection));
    },
  };
}

// --- The properties -----------------------------------------------------------

describe('Property 32 — feature toggles reflect the backend and never an optimistic guess', () => {
  // Feature: web-squads-screens, Property 32: Feature toggles reflect the backend and never an optimistic guess
  // Validates: Requirements 14.1, 14.7, 19.3
  it('renders one toggle per flag, naming the feature and stating its state in words', () => {
    fc.assert(
      fc.property(flagsArb(0), (flags) => {
        const { container } = renderToggles(flags);

        try {
          expectStructure(container, flags);
          expectStates(container, flags);
          // Nothing has settled, so nothing is announced.
          expect(announcement()).toBeNull();
          expect(container.textContent).not.toContain(GENERIC_SQUADS_FAILURE);
        } finally {
          cleanup();
        }
      }),
      { numRuns: 200 },
    );
  }, 120_000);

  // Feature: web-squads-screens, Property 32: Feature toggles reflect the backend and never an optimistic guess
  // Validates: Requirements 14.3, 14.5, 14.7
  it('submits one SetFeatureFlag carrying the requested state, then renders the state the backend reports', async () => {
    await fc.assert(
      fc.asyncProperty(
        flagsArb(1),
        fc.nat(),
        backendReportArb,
        fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
        async (flags, offset, report, arbitraryStates) => {
          const index = offset % flags.length;
          const flag = flags[index];
          const requested = !flag.isEnabled;
          const { container, transport, onSquadChanged, show } =
            renderToggles(flags);

          try {
            fireEvent.click(switches(container)[index]);

            // 14.3: exactly one call, carrying this flag and the requested state.
            expectOneCommand(transport, [requested]);

            // 14.7: with the response withheld, nothing has moved — not the word,
            // not `aria-checked`, not any other row.
            expectStates(container, flags);
            expect(announcement()).toBeNull();

            // 14.4: the changing toggle is busy, and a second activation of the
            // same flag issues nothing.
            const control = switches(container)[index];
            expect(control.getAttribute('aria-disabled')).toBe('true');
            expect(control.getAttribute('aria-busy')).toBe('true');
            fireEvent.click(control);
            expectOneCommand(transport, [requested]);

            transport.settle({ kind: 'success', value: undefined });
            await flush();

            // 14.5: the re-read is what supplies the refreshed state.
            expect(onSquadChanged).toHaveBeenCalledTimes(1);

            // 14.5: the announcement names the feature and its new state.
            expect(announcement()).toBe(
              featureToggleAnnouncement(flag.feature, requested),
            );

            // 14.7: still the pre-change collection, because the accepted call is
            // not itself a state — only the backend's next collection is.
            expectStates(container, flags);
            expectAvailable(switches(container)[index]);

            const backendFlags = reportedFlags(
              flags,
              index,
              report,
              arbitraryStates,
            );
            show(backendFlags);

            // 14.5, 14.7: the backend's collection, even where it reports a state
            // other than the one requested.
            expectStructure(container, backendFlags);
            expectStates(container, backendFlags);
            expectOneCommand(transport, [requested]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 180_000);

  // Feature: web-squads-screens, Property 32: Feature toggles reflect the backend and never an optimistic guess
  // Validates: Requirements 14.6, 14.7, 19.3
  it('announces only the generic failure on every failure outcome, leaving the last backend state rendered', async () => {
    await fc.assert(
      fc.asyncProperty(
        flagsArb(1),
        fc.nat(),
        failureArb,
        async (flags, offset, outcome) => {
          const index = offset % flags.length;
          const requested = !flags[index].isEnabled;
          const { container, transport, onSquadChanged } = renderToggles(flags);

          try {
            fireEvent.click(switches(container)[index]);
            expectOneCommand(transport, [requested]);

            transport.settle(outcome);
            await flush();

            // 14.6, 17.1, 17.2: one message for all six arms, carrying no status,
            // no backend wording, and not even the arm's own discriminator.
            expect(announcement()).toBe(GENERIC_SQUADS_FAILURE);
            expect(announcement()).not.toContain(outcome.kind);
            if (outcome.kind === 'rejected-input') {
              expect(announcement()).not.toContain(outcome.reason);
            }

            // 14.6, 14.7: the state last accepted from the backend, unmoved — the
            // requested state reached no toggle at any instant.
            expectStructure(container, flags);
            expectStates(container, flags);

            // A failure is no evidence about the squad, so nothing is re-read.
            expect(onSquadChanged).not.toHaveBeenCalled();

            // 14.6, 17.4: available again, and one activation owes one call —
            // carrying the same requested state, because nothing moved.
            const control = switches(container)[index];
            expectAvailable(control);
            fireEvent.click(control);
            expectOneCommand(transport, [requested, requested]);
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 180_000);
});
