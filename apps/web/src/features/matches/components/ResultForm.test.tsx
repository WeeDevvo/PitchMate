import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CallResult } from '../api/matchesApi';
import {
  COMPLETE_MATCH_LABEL,
  CONFIRM_COMPLETE_LABEL,
  SAVE_RESULT_LABEL,
  addGoalLabel,
  completeDialogBody,
  completeDialogTitle,
  removeGoalLabel,
  scoreLabel,
  scoreOutcomeStatement,
} from '../lib/messages';
import { teamSheet } from '../testing/matchesFixtures';
import { CompletePanel } from './CompletePanel';
import { ResultForm } from './ResultForm';

/**
 * Example tests for match-day score entry and completion: each team's counter
 * can be typed or stepped a goal at a time between 0 and 99, the score is said
 * in words once both counters hold one, a save sends the scores in sheet order,
 * and completing asks again in a dialog that names the score and the players.
 */

const ok = async (): Promise<CallResult<void>> => ({ kind: 'success', value: undefined });
const sheet = teamSheet();
const [red, blue] = sheet.teams;

function field(team: typeof red): HTMLInputElement {
  return screen.getByLabelText(scoreLabel(team.teamName, team.bibFlag));
}

describe('ResultForm', () => {
  it('steps a score a goal at a time, never below 0 or above 99', async () => {
    render(<ResultForm sheet={sheet} recordedResult={null} record={vi.fn(ok)} onSettled={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: removeGoalLabel(red.teamName) }));
    expect(field(red).value).toBe('0');
    await userEvent.click(screen.getByRole('button', { name: addGoalLabel(red.teamName) }));
    await userEvent.click(screen.getByRole('button', { name: addGoalLabel(red.teamName) }));
    expect(field(red).value).toBe('2');

    await userEvent.type(field(blue), '99');
    await userEvent.click(screen.getByRole('button', { name: addGoalLabel(blue.teamName) }));
    expect(field(blue).value).toBe('99');
  });

  it('says the score in words once both teams have one, then saves it in sheet order', async () => {
    const record = vi.fn(ok);
    render(<ResultForm sheet={sheet} recordedResult={null} record={record} onSettled={vi.fn()} />);

    await userEvent.type(field(red), '5');
    expect(screen.queryByText(/ win /)).toBeNull();
    await userEvent.type(field(blue), '3');
    expect(
      screen.getByText(
        scoreOutcomeStatement([
          { name: red.teamName, score: 5 },
          { name: blue.teamName, score: 3 },
        ]),
      ),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: SAVE_RESULT_LABEL }));
    expect(record).toHaveBeenCalledWith(
      [
        { teamId: red.teamId, score: 5 },
        { teamId: blue.teamId, score: 3 },
      ],
      expect.any(AbortSignal),
    );
  });

  it('calls a level score a draw', () => {
    expect(
      scoreOutcomeStatement([
        { name: 'A', score: 2 },
        { name: 'B', score: 2 },
      ]),
    ).toMatch(/^It's a draw, 2–2\./);
  });
});

describe('CompletePanel', () => {
  it('asks again in a dialog naming the score and the players before completing', async () => {
    const complete = vi.fn(ok);
    const onSettled = vi.fn();
    render(
      <CompletePanel
        state="InProgress"
        recordedResult={{
          fidelity: 'Basic',
          teamScores: [
            { teamId: blue.teamId, score: 3 },
            { teamId: red.teamId, score: 5 },
          ],
        }}
        sheet={sheet}
        complete={complete}
        onSettled={onSettled}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: COMPLETE_MATCH_LABEL }));
    const dialog = screen.getByRole('dialog', { name: completeDialogTitle('5–3') });
    const players = sheet.teams.reduce((sum, team) => sum + team.roster.length, 0);
    expect(dialog.textContent).toContain(completeDialogBody(players));
    expect(complete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: CONFIRM_COMPLETE_LABEL }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
