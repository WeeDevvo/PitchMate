/**
 * The live tracker over a fake Matches_Api: an organiser of a tracked squad
 * logs goals in two or three taps, the score moves at once, a goal can be
 * undone, the keeper changed, a failed send resent with the same identities,
 * and the match ended. Anyone who may not track the match is told why.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MatchesApi } from '../api/matchesApi';
import type { TrackedEvent } from '../lib/liveTracking';
import {
  BACK_TO_MATCH_LABEL,
  END_MATCH_LABEL,
  GOAL_LABEL,
  KEEPER_LABEL,
  OWN_GOAL_LABEL,
  SEND_AGAIN_LABEL,
  SKIP_SCORER_LABEL,
  SYNC_LABELS,
  TRACKER_NOT_IN_PLAY_STATEMENT,
  TRACKER_NOT_ORGANISER_STATEMENT,
  TRACKER_OFF_STATEMENT,
  UNDO_GOAL_LABEL,
  endAtLabel,
  keeperButtonLabel,
  liveScoreStatement,
  teamGoalButtonLabel,
} from '../lib/messages';
import { MATCH_LIVE_ROUTE, liveTrackerPath, matchPath } from '../lib/routePaths';
import {
  DAY_MS,
  MATCH_ID,
  MEMBER,
  SQUAD_ID,
  fakeMatchesApi,
  matchDetail,
  renderAtRoute,
  success,
  teamSheet,
} from '../testing/matchesFixtures';
import { LiveTrackerScreen } from './LiveTrackerScreen';

vi.mock('../../app-shell', async () => {
  const actual = await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

const SHEET = teamSheet();
const [RED, BLUE] = SHEET.teams;

const IN_PLAY = matchDetail({
  state: 'InProgress',
  confirmedDayMs: DAY_MS[0],
  startedAtMs: Date.now() - 12 * 60_000,
});

/** A tracked squad's match in play, whose server keeps score from the events it is sent. */
function trackedApi(overrides: Partial<MatchesApi> = {}) {
  const recorded: TrackedEvent[] = [];
  const api = fakeMatchesApi({
    getMatch: async () => success(IN_PLAY),
    getLiveTracking: async () => success(true),
    recordEvents: async (_matchId, events) => {
      recorded.push(...events);
      return success(events.map(({ eventId }) => ({ eventId, outcome: 'Applied' as const })));
    },
    getRunningScore: async () => {
      const undone = new Set(recorded.flatMap((event) => (event.kind === 'goal-undo' ? [event.targetEventId] : [])));
      return success(
        SHEET.teams.map(({ teamId }) => ({
          teamId,
          score: recorded.filter((event) => event.kind === 'goal' && event.teamId === teamId && !undone.has(event.eventId)).length,
        })),
      );
    },
    ...overrides,
  });
  return { api, recorded };
}

function renderTracker(api: MatchesApi) {
  return renderAtRoute(<LiveTrackerScreen api={api} />, MATCH_LIVE_ROUTE, liveTrackerPath(SQUAD_ID, MATCH_ID));
}

function scoreIs(red: number, blue: number) {
  return liveScoreStatement([
    { name: RED.teamName, score: red },
    { name: BLUE.teamName, score: blue },
  ]);
}

describe('the live tracker', () => {
  it('logs a goal as team then scorer, at the minute GOAL was pressed', async () => {
    const { api, recorded } = trackedApi();
    renderTracker(api);

    await userEvent.click(await screen.findByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(RED.teamName, RED.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: RED.roster[1].displayName }));

    expect(await screen.findByText(scoreIs(1, 0))).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(SYNC_LABELS.synced)).toBeInTheDocument());
    expect(recorded).toEqual([
      expect.objectContaining({
        kind: 'goal',
        teamId: RED.teamId,
        scorerId: RED.roster[1].membershipId,
        ownGoal: false,
        minute: 12,
      }),
    ]);
    expect(recorded[0].eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('logs a goal with no scorer, and an own goal by the other team', async () => {
    const { api, recorded } = trackedApi();
    renderTracker(api);

    await userEvent.click(await screen.findByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(BLUE.teamName, BLUE.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: SKIP_SCORER_LABEL }));
    await screen.findByText(scoreIs(0, 1));

    await userEvent.click(screen.getByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(BLUE.teamName, BLUE.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: OWN_GOAL_LABEL }));
    // An own goal for Blue is put in by a Red player.
    expect(screen.queryByRole('button', { name: BLUE.roster[0].displayName })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: RED.roster[0].displayName }));

    await screen.findByText(scoreIs(0, 2));
    expect(recorded.map((event) => event.kind === 'goal' && [event.teamId, event.scorerId, event.ownGoal])).toEqual([
      [BLUE.teamId, null, false],
      [BLUE.teamId, RED.roster[0].membershipId, true],
    ]);
  });

  it('undoes the last goal with a retraction that names it', async () => {
    const { api, recorded } = trackedApi();
    renderTracker(api);

    await userEvent.click(await screen.findByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(RED.teamName, RED.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: SKIP_SCORER_LABEL }));
    await screen.findByText(scoreIs(1, 0));

    await userEvent.click(screen.getByRole('button', { name: UNDO_GOAL_LABEL }));

    await screen.findByText(scoreIs(0, 0));
    expect(recorded[1]).toEqual(expect.objectContaining({ kind: 'goal-undo', targetEventId: recorded[0].eventId }));
  });

  it('puts a keeper in goal for their own team', async () => {
    const { api, recorded } = trackedApi();
    renderTracker(api);

    await userEvent.click(await screen.findByRole('button', { name: KEEPER_LABEL }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: keeperButtonLabel(BLUE.roster[2].displayName, BLUE.teamName) }),
    );

    await waitFor(() =>
      expect(recorded).toEqual([
        expect.objectContaining({ kind: 'keeper', teamId: BLUE.teamId, keeperId: BLUE.roster[2].membershipId }),
      ]),
    );
  });

  it('keeps a goal that did not get through, and resends it with the same identity', async () => {
    const sent: (readonly TrackedEvent[])[] = [];
    let online = false;
    const { api } = trackedApi();
    const flaky = fakeMatchesApi({
      ...api,
      recordEvents: async (matchId, events, signal) => {
        sent.push(events);
        return online ? api.recordEvents(matchId, events, signal) : { kind: 'transport-failure' };
      },
    });
    renderTracker(flaky);

    await userEvent.click(await screen.findByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(RED.teamName, RED.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: SKIP_SCORER_LABEL }));

    // The goal counts on screen while it waits to be sent.
    expect(await screen.findByText(scoreIs(1, 0))).toBeInTheDocument();
    expect(await screen.findByText(SYNC_LABELS.unsynced)).toBeInTheDocument();

    online = true;
    await userEvent.click(screen.getByRole('button', { name: SEND_AGAIN_LABEL }));

    await screen.findByText(SYNC_LABELS.synced);
    expect(screen.getByText(scoreIs(1, 0))).toBeInTheDocument();
    expect(sent).toHaveLength(2);
    expect(sent[1].map(({ eventId }) => eventId)).toEqual(sent[0].map(({ eventId }) => eventId));
  });

  it('ends the match at the score shown, then goes back to it', async () => {
    const { api } = trackedApi();
    renderTracker(api);

    await userEvent.click(await screen.findByRole('button', { name: GOAL_LABEL }));
    await userEvent.click(screen.getByRole('button', { name: teamGoalButtonLabel(RED.teamName, RED.bibFlag) }));
    await userEvent.click(screen.getByRole('button', { name: SKIP_SCORER_LABEL }));
    await screen.findByText(SYNC_LABELS.synced);

    await userEvent.click(screen.getByRole('button', { name: END_MATCH_LABEL }));
    await userEvent.click(await screen.findByRole('button', { name: endAtLabel('1–0') }));

    await waitFor(() => expect(api.finaliseTrackedResult).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('location')).toHaveTextContent(matchPath(SQUAD_ID, MATCH_ID));
  });

  it.each([
    ['a member who is not an organiser', { getSquadStanding: async () => success(MEMBER) }, TRACKER_NOT_ORGANISER_STATEMENT],
    ['a match not in play', { getMatch: async () => success({ ...IN_PLAY, state: 'TeamsRolled' as const }) }, TRACKER_NOT_IN_PLAY_STATEMENT],
    ['a squad with tracking off', { getLiveTracking: async () => success(false) }, TRACKER_OFF_STATEMENT],
  ])('tells %s why there is nothing to track', async (_case, overrides, statement) => {
    const { api } = trackedApi(overrides as Partial<MatchesApi>);
    renderTracker(api);

    expect(await screen.findByText(statement)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: GOAL_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: BACK_TO_MATCH_LABEL })).toHaveAttribute('href', matchPath(SQUAD_ID, MATCH_ID));
  });
});
