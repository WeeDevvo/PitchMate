import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { upcomingDates } from '../lib/candidateSlots';
import {
  CREATE_MATCH_HEADING,
  DRAFT_PROBLEM_MESSAGES,
  GENERIC_MATCHES_FAILURE,
  LOCATION_LABEL,
  NOT_AN_ORGANISER_STATEMENT,
  REJECTION_MESSAGES,
  KICK_OFF_MISSING,
  MATCH_FLOW_STEPS_LABEL,
  SUBMIT_DRAFT_LABEL,
  addTimeLabel,
  kickOffLabel,
  removeTimeLabel,
} from '../lib/messages';
import { NEW_MATCH_ROUTE, matchPath, newMatchPath } from '../lib/routePaths';
import {
  MATCH_ID,
  MEMBER,
  NOW_MS,
  SQUAD_ID,
  SQUAD_NAME,
  fakeMatchesApi,
  renderAtRoute,
  success,
} from '../testing/matchesFixtures';
import { CreateMatchScreen } from './CreateMatchScreen';

vi.mock('../../app-shell', async () => {
  const actual = await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

function renderScreen(api = fakeMatchesApi(), nowMs = NOW_MS) {
  renderAtRoute(
    <CreateMatchScreen api={api} now={() => nowMs} />,
    NEW_MATCH_ROUTE,
    newMatchPath(SQUAD_ID),
  );
  return api;
}

/** The tiles as the screen draws them from the fixture clock: today first. */
const TILES = upcomingDates(NOW_MS);
const TOMORROW = TILES[1];
const LATER = TILES[6];

/** Pick a day's tile and give its first kick-off a time. */
async function pickDay(tile: (typeof TILES)[number], time: string): Promise<void> {
  await userEvent.click(await screen.findByRole('checkbox', { name: tile.label }));
  await userEvent.selectOptions(screen.getByLabelText(kickOffLabel(tile.label, 0)), time);
}

async function fillValidDraft(): Promise<void> {
  await userEvent.type(await screen.findByLabelText(LOCATION_LABEL), '  Riverside 5s ');
  await pickDay(TOMORROW, '19:00');
}

/** The local instant of a tile's date at a wall-clock time. */
function instantOf(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

describe('CreateMatchScreen', () => {
  it('tells a member that only admins create matches, and offers no form', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(MEMBER) }));

    expect(await screen.findByText(NOT_AN_ORGANISER_STATEMENT)).toBeTruthy();
    expect(screen.queryByLabelText(LOCATION_LABEL)).toBeNull();
  });

  it('treats a caller outside the squad like a member', async () => {
    renderScreen(fakeMatchesApi({ getSquadStanding: async () => success(null) }));
    expect(await screen.findByText(NOT_AN_ORGANISER_STATEMENT)).toBeTruthy();
  });

  it('states each problem beside its field and sends nothing', async () => {
    const api = renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    const location = screen.getByLabelText(LOCATION_LABEL);
    expect(location.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(DRAFT_PROBLEM_MESSAGES['location-required'])).toBeTruthy();
    expect(screen.getByText(DRAFT_PROBLEM_MESSAGES['day-required'])).toBeTruthy();
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('heads the form with the squad name and marks step 1 of the flow as current', async () => {
    renderScreen();

    expect(await screen.findByRole('heading', { level: 1, name: CREATE_MATCH_HEADING })).toBeTruthy();
    expect(screen.getByText(SQUAD_NAME)).toBeTruthy();
    const steps = screen.getByRole('list', { name: MATCH_FLOW_STEPS_LABEL });
    expect(steps.querySelector('[aria-current="step"]')?.textContent).toBe('1. Where & when');
  });

  it('offers a tile for each of the next four weeks, today first', async () => {
    renderScreen();

    expect(await screen.findByRole('checkbox', { name: TILES[0].label })).toBeTruthy();
    expect(screen.getAllByRole('checkbox')).toHaveLength(TILES.length);
  });

  it('asks for a time on each picked day before sending', async () => {
    const api = renderScreen();

    await userEvent.type(await screen.findByLabelText(LOCATION_LABEL), 'Pitch');
    await userEvent.click(screen.getByRole('checkbox', { name: TOMORROW.label }));
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(screen.getByLabelText(kickOffLabel(TOMORROW.label, 0)).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(KICK_OFF_MISSING)).toBeTruthy();
    expect(screen.getByText(DRAFT_PROBLEM_MESSAGES['time-required'])).toBeTruthy();
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('offers kick-offs on the hour and half hour only, from 07:00 to 22:00', async () => {
    renderScreen();

    await userEvent.click(await screen.findByRole('checkbox', { name: TOMORROW.label }));
    const times = Array.from(
      (screen.getByLabelText(kickOffLabel(TOMORROW.label, 0)) as HTMLSelectElement).options,
    ).map((option) => option.value);

    expect(times[0]).toBe('');
    expect(times[1]).toBe('07:00');
    expect(times.at(-1)).toBe('22:00');
    expect(times.slice(1).every((time) => /^\d{2}:(00|30)$/.test(time))).toBe(true);
  });

  it('rejects a kick-off already past before sending', async () => {
    // Late evening, local time, so this morning's kick-off has gone in every time zone.
    const today = new Date(NOW_MS);
    const lateMs = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 22, 30).getTime();
    const api = renderScreen(fakeMatchesApi(), lateMs);

    await userEvent.type(await screen.findByLabelText(LOCATION_LABEL), 'Pitch');
    await pickDay(upcomingDates(lateMs)[0], '07:00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(screen.getByText(DRAFT_PROBLEM_MESSAGES['day-in-past'])).toBeTruthy();
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('adds a second time to a day, shows the earliest on its tile, and drops the times with the day', async () => {
    renderScreen();

    await pickDay(TOMORROW, '19:30');
    await userEvent.click(screen.getByRole('button', { name: addTimeLabel(TOMORROW.label) }));
    await userEvent.selectOptions(screen.getByLabelText(kickOffLabel(TOMORROW.label, 1)), '18:00');

    expect(screen.getByRole('checkbox', { name: `${TOMORROW.label}, 18:00` })).toBeTruthy();
    // Two times is the most a day takes.
    expect(screen.queryByRole('button', { name: addTimeLabel(TOMORROW.label) })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: removeTimeLabel(TOMORROW.label, 0) }));
    expect(screen.getByRole('checkbox', { name: `${TOMORROW.label}, 19:30` })).toBeTruthy();

    await userEvent.click(screen.getByRole('checkbox', { name: `${TOMORROW.label}, 19:30` }));
    expect(screen.queryByLabelText(kickOffLabel(TOMORROW.label, 0))).toBeNull();
  });

  it('sends the trimmed draft and opens the new match', async () => {
    const api = renderScreen();

    await fillValidDraft();
    await pickDay(LATER, '10:00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(api.createDraft).toHaveBeenCalledWith(
      SQUAD_ID,
      {
        location: 'Riverside 5s',
        candidateDays: [instantOf(TOMORROW.date, '19:00'), instantOf(LATER.date, '10:00')],
      },
      expect.any(AbortSignal),
    );
    expect(await screen.findByTestId('location')).toHaveProperty(
      'textContent',
      matchPath(SQUAD_ID, MATCH_ID),
    );
  });

  it('states a rejection and keeps the form', async () => {
    renderScreen(
      fakeMatchesApi({ createDraft: async () => ({ kind: 'rejected', reason: 'validation' }) }),
    );

    await fillValidDraft();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      REJECTION_MESSAGES.validation,
    );
    expect(screen.getByLabelText(LOCATION_LABEL)).toBeTruthy();
  });

  it('states a failure without disclosing it', async () => {
    renderScreen(fakeMatchesApi({ createDraft: async () => ({ kind: 'timeout' }) }));

    await fillValidDraft();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(GENERIC_MATCHES_FAILURE)).toBeTruthy();
  });

  it('sends one draft however often the button is pressed while it is in flight', async () => {
    let resolve: (value: Awaited<ReturnType<typeof success<string>>>) => void = () => {};
    const api = renderScreen(
      fakeMatchesApi({
        createDraft: () =>
          new Promise((settle) => {
            resolve = settle;
          }),
      }),
    );

    await fillValidDraft();
    const submit = screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL });
    await userEvent.click(submit);
    await userEvent.click(submit);

    expect(api.createDraft).toHaveBeenCalledTimes(1);
    resolve(success(MATCH_ID));
  });
});
