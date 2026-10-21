/**
 * The create-match screen: a location and 1 to 14 candidate days, sent as a
 * match draft. On success it opens the new match's screen, where availability
 * gathering starts.
 *
 * Only organisers are offered the form. Anyone else who addresses the route is
 * told so; the backend refuses the write either way.
 */
import { useCallback, useId, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import type { MatchesApi } from '../api/matchesApi';
import { BackToSquadLink, FailureNotice, LoadingNotice } from '../components/StatusNotices';
import {
  CANDIDATE_DAY_MAX_COUNT,
  LOCATION_MAX_LENGTH,
  validateDraft,
  type DraftProblem,
} from '../lib/matchDays';
import { isOrganiser } from '../lib/matchState';
import {
  ADD_DAY_LABEL,
  CANDIDATE_DAYS_HINT,
  CANDIDATE_DAYS_LEGEND,
  CREATE_MATCH_HEADING,
  DRAFT_PROBLEM_MESSAGES,
  GENERIC_MATCHES_FAILURE,
  LOCATION_LABEL,
  MATCHES_LOADING_LABEL,
  NOT_AN_ORGANISER_STATEMENT,
  REJECTION_MESSAGES,
  SUBMIT_DRAFT_LABEL,
  SUBMITTING_DRAFT_LABEL,
  candidateDayLabel,
  removeDayLabel,
} from '../lib/messages';
import { matchPath } from '../lib/routePaths';
import { useAction } from '../state/useAction';
import { useRemote } from '../state/useRemote';

import '../styles/matches.css';

export interface CreateMatchScreenProps {
  readonly api: MatchesApi;
  /** The clock the future-day check reads; defaults to `Date.now`. */
  readonly now?: () => number;
}

interface DayField {
  readonly id: number;
  readonly value: string;
}

interface Problems {
  readonly location: DraftProblem | null;
  readonly days: DraftProblem | null;
}

const NO_PROBLEMS: Problems = { location: null, days: null };

export function CreateMatchScreen({
  api,
  now = Date.now,
}: CreateMatchScreenProps): ReactElement {
  const { state: authState } = useAuth();
  const navigate = useNavigate();
  const idPrefix = useId();
  usePublishSquadScopeFromRoute();

  const squadId = useParams()[SQUAD_SCOPE_ROUTE_PARAMETER] ?? '';

  const standing = useRemote(
    squadId === '' ? null : squadId,
    useCallback((signal: AbortSignal) => api.getSquadStanding(squadId, signal), [api, squadId]),
    authState,
  );

  const [location, setLocation] = useState('');
  const [days, setDays] = useState<readonly DayField[]>([{ id: 0, value: '' }]);
  const [nextId, setNextId] = useState(1);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const submit = useAction<string>();

  const locationId = `${idPrefix}-location`;
  const locationErrorId = `${idPrefix}-location-error`;
  const daysHintId = `${idPrefix}-days-hint`;
  const daysErrorId = `${idPrefix}-days-error`;

  const addDay = (): void => {
    setDays((current) => [...current, { id: nextId, value: '' }]);
    setNextId((id) => id + 1);
  };

  const removeDay = (id: number): void => {
    setDays((current) => current.filter((day) => day.id !== id));
  };

  const updateDay = (id: number, value: string): void => {
    setDays((current) => current.map((day) => (day.id === id ? { ...day, value } : day)));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const validation = validateDraft(
      { location, days: days.map((day) => day.value) },
      now(),
    );

    if (!validation.ok) {
      setProblems({ location: validation.locationProblem, days: validation.daysProblem });
      return;
    }

    setProblems(NO_PROBLEMS);

    const outcome = await submit.run((signal) =>
      api.createDraft(
        squadId,
        { location: validation.location, candidateDays: validation.candidateDays },
        signal,
      ),
    );

    if (outcome !== null && outcome.kind === 'success') {
      navigate(matchPath(squadId, outcome.value));
    }
  };

  let body: ReactElement;

  if (standing.phase === 'failed') {
    body = <FailureNotice onRetry={standing.reload} />;
  } else if (standing.phase !== 'loaded' && standing.phase !== 'not-found') {
    body = <LoadingNotice label={MATCHES_LOADING_LABEL} />;
  } else if (!isOrganiser(standing.value)) {
    body = <p className="matches-notice">{NOT_AN_ORGANISER_STATEMENT}</p>;
  } else {
    const outcome = submit.outcome;
    const submitError =
      outcome === null || outcome.kind === 'success'
        ? null
        : outcome.kind === 'rejected'
          ? REJECTION_MESSAGES[outcome.reason]
          : GENERIC_MATCHES_FAILURE;

    body = (
      <form className="matches-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <div className="matches-field">
          <label htmlFor={locationId}>{LOCATION_LABEL}</label>
          <input
            id={locationId}
            className="matches-input"
            type="text"
            autoComplete="off"
            maxLength={LOCATION_MAX_LENGTH}
            value={location}
            aria-invalid={problems.location === null ? undefined : true}
            aria-describedby={problems.location === null ? undefined : locationErrorId}
            onChange={(event) => setLocation(event.target.value)}
          />
          {problems.location === null ? null : (
            <p id={locationErrorId} className="matches-error">
              {DRAFT_PROBLEM_MESSAGES[problems.location]}
            </p>
          )}
        </div>

        <fieldset
          className="matches-fieldset"
          aria-describedby={problems.days === null ? daysHintId : `${daysHintId} ${daysErrorId}`}
        >
          <legend>{CANDIDATE_DAYS_LEGEND}</legend>
          <p id={daysHintId} className="matches-hint">
            {CANDIDATE_DAYS_HINT}
          </p>
          <ol className="matches-day-fields">
            {days.map((day, index) => {
              const fieldId = `${idPrefix}-day-${day.id}`;
              return (
                <li key={day.id} className="matches-day-field">
                  <label htmlFor={fieldId}>{candidateDayLabel(index)}</label>
                  <input
                    id={fieldId}
                    className="matches-input"
                    type="datetime-local"
                    value={day.value}
                    aria-invalid={problems.days === null ? undefined : true}
                    onChange={(event) => updateDay(day.id, event.target.value)}
                  />
                  {days.length > 1 ? (
                    <button
                      type="button"
                      className="matches-button"
                      onClick={() => removeDay(day.id)}
                    >
                      {removeDayLabel(index)}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {days.length < CANDIDATE_DAY_MAX_COUNT ? (
            <button type="button" className="matches-button" onClick={addDay}>
              {ADD_DAY_LABEL}
            </button>
          ) : null}
          {problems.days === null ? null : (
            <p id={daysErrorId} className="matches-error">
              {DRAFT_PROBLEM_MESSAGES[problems.days]}
            </p>
          )}
        </fieldset>

        {submitError === null ? null : (
          <p className="matches-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="matches-actions">
          <button
            type="submit"
            className="matches-button matches-button--primary"
            aria-disabled={submit.busy ? true : undefined}
          >
            {submit.busy ? SUBMITTING_DRAFT_LABEL : SUBMIT_DRAFT_LABEL}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="matches-screen">
      <h1 className="matches-heading">{CREATE_MATCH_HEADING}</h1>
      {body}
      <BackToSquadLink squadId={squadId} />
    </div>
  );
}

export default CreateMatchScreen;
