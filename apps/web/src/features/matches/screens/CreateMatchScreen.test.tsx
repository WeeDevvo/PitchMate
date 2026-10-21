import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ADD_DAY_LABEL,
  DRAFT_PROBLEM_MESSAGES,
  GENERIC_MATCHES_FAILURE,
  LOCATION_LABEL,
  NOT_AN_ORGANISER_STATEMENT,
  REJECTION_MESSAGES,
  SUBMIT_DRAFT_LABEL,
  candidateDayLabel,
  removeDayLabel,
} from '../lib/messages';
import { NEW_MATCH_ROUTE, matchPath, newMatchPath } from '../lib/routePaths';
import {
  MATCH_ID,
  MEMBER,
  NOW_MS,
  SQUAD_ID,
  fakeMatchesApi,
  renderAtRoute,
  success,
} from '../testing/matchesFixtures';
import { CreateMatchScreen } from './CreateMatchScreen';

vi.mock('../../app-shell', async () => {
  const actual = await vi.importActual<typeof import('../../app-shell')>('../../app-shell');
  return { ...actual, usePublishSquadScopeFromRoute: (): string | null => null };
});

function renderScreen(api = fakeMatchesApi()) {
  renderAtRoute(
    <CreateMatchScreen api={api} now={() => NOW_MS} />,
    NEW_MATCH_ROUTE,
    newMatchPath(SQUAD_ID),
  );
  return api;
}

async function fillValidDraft(): Promise<void> {
  await userEvent.type(await screen.findByLabelText(LOCATION_LABEL), '  Riverside 5s ');
  await userEvent.type(screen.getByLabelText(candidateDayLabel(0)), '2030-03-02T19:00');
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

  it('rejects a day in the past before sending', async () => {
    const api = renderScreen();

    await userEvent.type(await screen.findByLabelText(LOCATION_LABEL), 'Pitch');
    await userEvent.type(screen.getByLabelText(candidateDayLabel(0)), '2029-12-31T19:00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(screen.getByText(DRAFT_PROBLEM_MESSAGES['day-in-past'])).toBeTruthy();
    expect(api.createDraft).not.toHaveBeenCalled();
  });

  it('adds and removes candidate day fields', async () => {
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: ADD_DAY_LABEL }));
    expect(screen.getByLabelText(candidateDayLabel(1))).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: removeDayLabel(0) }));
    expect(screen.queryByLabelText(candidateDayLabel(1))).toBeNull();
    expect(screen.getByLabelText(candidateDayLabel(0))).toBeTruthy();
  });

  it('sends the trimmed draft and opens the new match', async () => {
    const api = renderScreen();

    await fillValidDraft();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_DRAFT_LABEL }));

    expect(api.createDraft).toHaveBeenCalledWith(
      SQUAD_ID,
      {
        location: 'Riverside 5s',
        candidateDays: [new Date(2030, 2, 2, 19, 0).toISOString()],
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
