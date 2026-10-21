/**
 * Example tests for the Invite_Landing_Route's redemption machine under React's
 * StrictMode.
 *
 * StrictMode's development-only unmount-and-remount runs the machine's unmount
 * cleanup once on a route that stays mounted, abandoning the redemption the first
 * mount issued. The remount is a fresh arrival that owes exactly one redemption of
 * its own, so the abandoned call's `redeeming` phase must not be left behind for
 * the single-flight guard to refuse it.
 */
import { StrictMode, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { CallResult, RedeemInviteRequest, SquadsApi } from '../api/squadsApi';
import type { Redemption } from '../lib/parse/redemption';
import { inviteLandingPath, squadPath } from '../lib/routePaths';
import {
  useInviteRedemption,
  type InviteRedemptionNavigate,
  type InviteRedemptionOptions,
} from './useInviteRedemption';

const SQUAD_ID = '22222222-2222-4222-8222-222222222222';

const SUCCESS: CallResult<Redemption> = {
  kind: 'success',
  value: { membershipId: null, outcome: 'Joined', squadId: SQUAD_ID },
};

/** A Squads_Api that records each redemption and refuses every other call. */
function recordingApi(): { readonly api: SquadsApi; readonly redeemCommands: RedeemInviteRequest[] } {
  const redeemCommands: RedeemInviteRequest[] = [];
  const api = new Proxy({} as SquadsApi, {
    get: (_target, method) =>
      method === 'redeemInvite'
        ? (command: RedeemInviteRequest) => {
            redeemCommands.push(command);
            return Promise.resolve(SUCCESS);
          }
        : () => {
            throw new Error(`the Invite_Landing_Route must not call ${String(method)}`);
          },
  });
  return { api, redeemCommands };
}

function Harness(props: InviteRedemptionOptions): ReactElement {
  const machine = useInviteRedemption(props);
  return <span data-testid="phase">{machine.phase}</span>;
}

describe('useInviteRedemption under StrictMode', () => {
  it('redeems and navigates once the remount settles, disregarding the abandoned call', async () => {
    const { api, redeemCommands } = recordingApi();
    const navigations: Parameters<InviteRedemptionNavigate>[] = [];

    render(
      <StrictMode>
        <Harness
          api={api}
          path={inviteLandingPath('secret-code')}
          navigate={(path, options) => {
            navigations.push([path, options]);
          }}
          authState="authenticated"
        />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('phase')).toHaveTextContent('redeemed');
    });

    // The first mount's call was abandoned by the cleanup; the remount issued
    // the one redemption this arrival owes, and only it navigated.
    expect(redeemCommands).toEqual([
      { presentedSecret: 'secret-code' },
      { presentedSecret: 'secret-code' },
    ]);
    expect(navigations).toEqual([[squadPath(SQUAD_ID), { replace: true }]]);
  });
});
