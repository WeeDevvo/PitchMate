/**
 * Worked examples for the Feature_Toggle set (task 12.8).
 *
 * The generated claims arrive with `FeatureToggles.property.test.tsx`
 * (Property 32). This file pins the concrete facts a reader wants stated rather
 * than inferred from a generator: one switch per flag naming its feature and its
 * state in words, exactly one `SetFeatureFlag` per change carrying the requested
 * state, the rendered state following the backend rather than the request, and the
 * no-optional-features statement for a squad that carries none.
 *
 * Requirements: 10.6, 14.1, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 19.3
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FEATURE_TOGGLE_SELECTOR,
  FEATURE_TOGGLE_STATE_SELECTOR,
  FeatureToggles,
  featureToggleAnnouncement,
} from './FeatureToggles';
import type { CallResult, SquadsApi, SetFeatureFlagRequest } from '../api/squadsApi';
import {
  FEATURE_DISABLED_LABEL,
  FEATURE_ENABLED_LABEL,
  GENERIC_SQUADS_FAILURE,
  LIVE_MATCH_TRACKING_FEATURE_LABEL,
  NO_OPTIONAL_FEATURES_STATEMENT,
} from '../lib/messages';
import type { FeatureFlag } from '../lib/parse/featureFlags';

const SQUAD_ID = '3f1c0b6e-6b1a-7a4e-9d2f-52d0f0a4b111';

/** The one call this surface may issue, recorded per activation. */
interface ToggleApi {
  readonly api: SquadsApi;
  readonly commands: SetFeatureFlagRequest[];
}

/**
 * A Squads_Api answering `setFeatureFlag` with `outcome` and refusing everything
 * else, so a call this surface has no business making fails loudly.
 */
function createToggleApi(
  outcome: CallResult<void> = { kind: 'success', value: undefined },
): ToggleApi {
  const commands: SetFeatureFlagRequest[] = [];

  const refuse = (name: string) => (): never => {
    throw new Error(`unexpected ${name} call`);
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
    getFeatureFlags: refuse('getFeatureFlags'),
    setFeatureFlag: (_squadId: string, command: SetFeatureFlagRequest) => {
      commands.push(command);
      return Promise.resolve(outcome);
    },
  };

  return { api, commands };
}

const TRACKING_OFF: readonly FeatureFlag[] = [
  { feature: 'LiveMatchTracking', isEnabled: false },
];

const TRACKING_ON: readonly FeatureFlag[] = [
  { feature: 'LiveMatchTracking', isEnabled: true },
];

/** The state words rendered beside the switches, in document order. */
function renderedStates(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(FEATURE_TOGGLE_STATE_SELECTOR)].map(
    (state) => state.textContent ?? '',
  );
}

describe('FeatureToggles', () => {
  // Requirements: 10.6, 14.1, 19.3
  it('renders one switch per flag, naming the feature and its state in words', () => {
    const { api } = createToggleApi();

    const { container } = render(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={TRACKING_ON}
        onSquadChanged={() => undefined}
      />,
    );

    expect(container.querySelectorAll(FEATURE_TOGGLE_SELECTOR)).toHaveLength(1);
    expect(
      screen.getByText(LIVE_MATCH_TRACKING_FEATURE_LABEL),
    ).toBeInTheDocument();
    expect(renderedStates(container)).toEqual([FEATURE_ENABLED_LABEL]);

    const toggle = screen.getByRole('switch', {
      name: LIVE_MATCH_TRACKING_FEATURE_LABEL,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  // Requirements: 14.3, 14.5, 14.7
  it('submits exactly one SetFeatureFlag carrying the requested state, and re-reads the squad', async () => {
    const user = userEvent.setup();
    const { api, commands } = createToggleApi();
    const onSquadChanged = vi.fn();

    render(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={TRACKING_OFF}
        onSquadChanged={onSquadChanged}
      />,
    );

    await user.click(
      screen.getByRole('switch', { name: LIVE_MATCH_TRACKING_FEATURE_LABEL }),
    );

    // 14.3: one call, carrying this flag's Wire_Enum_Name and the requested state.
    await waitFor(() => {
      expect(commands).toEqual([{ feature: 'LiveMatchTracking', enabled: true }]);
    });

    // 14.2, 14.5: the refreshed state comes from the `GetSquad` re-read, so no
    // `GetFeatureFlags` call is issued — the refusing seam would have thrown.
    await waitFor(() => {
      expect(onSquadChanged).toHaveBeenCalledTimes(1);
    });

    // 14.5: the announcement names the feature and the accepted state.
    expect(
      screen.getByText(
        featureToggleAnnouncement('LiveMatchTracking', true),
      ),
    ).toBeInTheDocument();
  });

  // Requirements: 14.7
  it('keeps rendering the backend state while a change is in flight, and follows the backend afterwards', async () => {
    const user = userEvent.setup();
    const { api } = createToggleApi();

    const { container, rerender } = render(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={TRACKING_OFF}
        onSquadChanged={() => undefined}
      />,
    );

    await user.click(
      screen.getByRole('switch', { name: LIVE_MATCH_TRACKING_FEATURE_LABEL }),
    );

    // 14.7: no optimistic state — the switch still shows what the backend said.
    expect(renderedStates(container)).toEqual([FEATURE_DISABLED_LABEL]);

    // 14.5, 14.7: the re-read's collection is what moves it, even where the
    // backend reports a state other than the one requested.
    rerender(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={TRACKING_ON}
        onSquadChanged={() => undefined}
      />,
    );

    expect(renderedStates(container)).toEqual([FEATURE_ENABLED_LABEL]);
  });

  // Requirements: 14.6, 17.1, 17.2
  it('leaves the switch on the last backend state and announces the generic failure', async () => {
    const user = userEvent.setup();
    const { api, commands } = createToggleApi({ kind: 'transport-failure' });

    const { container } = render(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={TRACKING_OFF}
        onSquadChanged={() => undefined}
      />,
    );

    const toggle = screen.getByRole('switch', {
      name: LIVE_MATCH_TRACKING_FEATURE_LABEL,
    });

    await user.click(toggle);

    await waitFor(() => {
      expect(screen.getByText(GENERIC_SQUADS_FAILURE)).toBeInTheDocument();
    });

    expect(renderedStates(container)).toEqual([FEATURE_DISABLED_LABEL]);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).not.toHaveAttribute('aria-disabled');

    // 17.4: the control is re-submittable, and nothing retried on its own.
    await user.click(toggle);
    await waitFor(() => {
      expect(commands).toHaveLength(2);
    });
  });

  // Requirements: 14.8
  it('states that the squad has no optional features, and renders no toggle', () => {
    const { api } = createToggleApi();

    const { container } = render(
      <FeatureToggles
        squadId={SQUAD_ID}
        api={api}
        flags={[]}
        onSquadChanged={() => undefined}
      />,
    );

    expect(screen.getByText(NO_OPTIONAL_FEATURES_STATEMENT)).toBeInTheDocument();
    expect(container.querySelectorAll(FEATURE_TOGGLE_SELECTOR)).toHaveLength(0);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
