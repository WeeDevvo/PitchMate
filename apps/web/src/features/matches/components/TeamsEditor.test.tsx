import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../../auth';
import {
  DRAW_LABEL,
  LOCK_TEAMS_LABEL,
  NO_PREDICTION_STATEMENT,
  NO_TEAMS_STATEMENT,
  REJECTION_MESSAGES,
  RELOCK_TEAMS_LABEL,
  REROLL_TEAMS_LABEL,
  ROLL_TEAMS_LABEL,
  SAVE_TEAM_NAME_LABEL,
  lockProblemMessage,
  moveToLabel,
  teamNameLabel,
  wearsBibsLabel,
} from '../lib/messages';
import {
  MATCH_ID,
  NO_TEAMS,
  TEAM_IDS,
  fakeMatchesApi,
  participants,
  playerId,
  sessionManagerReporting,
  success,
  workingTeam,
  workingTeams,
} from '../testing/matchesFixtures';
import { TeamsEditor } from './TeamsEditor';

function renderEditor(api = fakeMatchesApi(), { locked = false, onLocked = vi.fn() } = {}) {
  render(
    <AuthProvider manager={sessionManagerReporting('authenticated')}>
      <TeamsEditor
        api={api}
        matchId={MATCH_ID}
        participants={participants(11)}
        locked={locked}
        authState="authenticated"
        onLocked={onLocked}
      />
    </AuthProvider>,
  );
  return { api, onLocked };
}

function team(name: string): HTMLElement {
  return screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('section') as HTMLElement;
}

describe('TeamsEditor before a roll', () => {
  it('offers to roll teams, and re-reads them once rolled', async () => {
    const getWorkingTeams = vi
      .fn()
      .mockResolvedValueOnce(success(NO_TEAMS))
      .mockResolvedValue(success(workingTeams()));
    const { api } = renderEditor(fakeMatchesApi({ getWorkingTeams }));

    expect(await screen.findByText(NO_TEAMS_STATEMENT)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: ROLL_TEAMS_LABEL }));

    expect(api.rerollTeams).toHaveBeenCalledWith(MATCH_ID, expect.any(AbortSignal));
    expect(await screen.findByRole('heading', { name: /^Red Wolves/ })).toBeTruthy();
  });

  it('states a roll the backend refuses', async () => {
    renderEditor(
      fakeMatchesApi({
        getWorkingTeams: async () => success(NO_TEAMS),
        rerollTeams: async () => ({ kind: 'rejected', reason: 'validation' }),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: ROLL_TEAMS_LABEL }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      REJECTION_MESSAGES.validation,
    );
  });
});

describe('TeamsEditor with teams', () => {
  it('names each team with its size and players, and the predicted result in words', async () => {
    renderEditor();

    await screen.findByRole('heading', { name: 'Red Wolves (5 players)' });
    expect(within(team('Blue Herons')).getByText('Player 2')).toBeTruthy();

    const prediction = screen.getByRole('heading', { name: 'Predicted result' }).closest(
      'section',
    ) as HTMLElement;
    const lines = within(prediction)
      .getAllByRole('term')
      .map((term) => `${term.textContent} ${term.nextElementSibling?.textContent}`);
    // The fairness meter reads each side either side of the draw, as it is drawn.
    expect(lines).toEqual(['Red Wolves 46%', `${DRAW_LABEL} 10%`, 'Blue Herons 44%']);
  });

  it('says when there is no prediction to show', async () => {
    renderEditor(fakeMatchesApi({ getWorkingTeams: async () => success(workingTeams({ prediction: null })) }));
    expect(await screen.findByText(NO_PREDICTION_STATEMENT)).toBeTruthy();
  });

  it('moves a player to the other team with one button, then re-reads', async () => {
    const { api } = renderEditor();

    await userEvent.click(
      await screen.findByRole('button', { name: moveToLabel('Player 1', 'Blue Herons') }),
    );

    expect(api.moveParticipant).toHaveBeenCalledWith(
      MATCH_ID,
      playerId(0),
      TEAM_IDS[1],
      expect.any(AbortSignal),
    );
    await expect.poll(() => api.getWorkingTeams.mock.calls.length).toBe(2);
  });

  it('places an unassigned player, named from the participants', async () => {
    const { api } = renderEditor(
      fakeMatchesApi({
        getWorkingTeams: async () => success(workingTeams({ unassigned: [playerId(10)] })),
      }),
    );

    await userEvent.click(
      await screen.findByRole('button', { name: moveToLabel('Player 11', 'Red Wolves') }),
    );
    expect(api.moveParticipant).toHaveBeenCalledWith(
      MATCH_ID,
      playerId(10),
      TEAM_IDS[0],
      expect.any(AbortSignal),
    );
    expect(screen.getByText(lockProblemMessage({ kind: 'unassigned', count: 1 }))).toBeTruthy();
  });

  it('renames a team, and asks for a generated name when left blank', async () => {
    const { api } = renderEditor();

    const red = await screen.findByRole('heading', { name: /^Red Wolves/ });
    const form = within(red.closest('section') as HTMLElement);
    const input = form.getByLabelText(teamNameLabel('Red Wolves'));

    await userEvent.clear(input);
    await userEvent.type(input, '  The Reds ');
    await userEvent.click(form.getByRole('button', { name: SAVE_TEAM_NAME_LABEL }));
    expect(api.setTeamName).toHaveBeenLastCalledWith(
      MATCH_ID,
      TEAM_IDS[0],
      'The Reds',
      expect.any(AbortSignal),
    );

    await userEvent.clear(input);
    await userEvent.click(form.getByRole('button', { name: SAVE_TEAM_NAME_LABEL }));
    await expect.poll(() => api.setTeamName.mock.calls.at(-1)?.[2]).toBe(null);
  });

  it('moves the bibs to the chosen team', async () => {
    const { api } = renderEditor();

    const red = await screen.findByRole('radio', { name: wearsBibsLabel('Red Wolves') });
    expect((red as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: wearsBibsLabel('Blue Herons') }));
    expect(api.setBibTeam).toHaveBeenCalledWith(MATCH_ID, TEAM_IDS[1], expect.any(AbortSignal));
  });

  it('lists what stands in the way of a lock', async () => {
    renderEditor(
      fakeMatchesApi({
        getWorkingTeams: async () =>
          success(
            workingTeams({
              teams: [workingTeam(0, [0, 1, 2, 3], false), workingTeam(1, [4, 5, 6, 7, 8, 9], false)],
            }),
          ),
      }),
    );

    expect(
      await screen.findByText(
        lockProblemMessage({ kind: 'team-size', teamName: 'Red Wolves', size: 4 }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(lockProblemMessage({ kind: 'bib-count', count: 0 }))).toBeTruthy();
  });

  it('locks, then tells the screen', async () => {
    const { api, onLocked } = renderEditor();

    await userEvent.click(await screen.findByRole('button', { name: LOCK_TEAMS_LABEL }));

    expect(api.lockTeams).toHaveBeenCalledWith(MATCH_ID, expect.any(AbortSignal));
    await expect.poll(() => onLocked.mock.calls.length).toBe(1);
  });

  it('does not tell the screen about a refused lock', async () => {
    const { onLocked } = renderEditor(
      fakeMatchesApi({ lockTeams: async () => ({ kind: 'rejected', reason: 'validation' }) }),
    );

    await userEvent.click(await screen.findByRole('button', { name: LOCK_TEAMS_LABEL }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('offers to re-roll, and words the lock as a re-lock once locked', async () => {
    const { api } = renderEditor(fakeMatchesApi(), { locked: true });

    expect(await screen.findByRole('button', { name: RELOCK_TEAMS_LABEL })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: REROLL_TEAMS_LABEL }));
    expect(api.rerollTeams).toHaveBeenCalledTimes(1);
  });
});
