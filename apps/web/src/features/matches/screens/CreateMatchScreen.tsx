/**
 * The create-match screen, step 1 of the admin's flow ("Where & when"): a
 * location, candidate days picked from tiles for the next four weeks, and a
 * kick-off time for each (a day can have a second). Each day-and-time is one
 * candidate day of the match draft. On success it opens the new match's screen,
 * where availability gathering starts.
 *
 * Only organisers are offered the form. Anyone else who addresses the route is
 * told so; the backend refuses the write either way.
 */
import { useCallback, useId, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { SQUAD_SCOPE_ROUTE_PARAMETER, usePublishSquadScopeFromRoute } from '../../app-shell';
import { useAuth } from '../../auth';
import { squadPath } from '../../squads';
import {
  Banner,
  Button,
  DayPicker,
  IconButton,
  Select,
  Steps,
  TextField,
  buttonClasses,
  type DayOption,
  type SelectOption,
} from '../../../ui';
import type { MatchesApi } from '../api/matchesApi';
import { BackToSquadLink, FailureNotice, LoadingNotice } from '../components/StatusNotices';
import {
  KICK_OFF_TIMES,
  MAX_TIMES_PER_DAY,
  earliestTime,
  pickedDates,
  slotsOn,
  upcomingDates,
  validateSlots,
  type CandidateSlot,
} from '../lib/candidateSlots';
import { CANDIDATE_DAY_MAX_COUNT, LOCATION_MAX_LENGTH, type DraftProblem } from '../lib/matchDays';
import { isOrganiser } from '../lib/matchState';
import {
  ADD_TIME_TEXT,
  BACK_TO_SQUAD_LABEL,
  CANDIDATE_DAYS_HINT,
  CANDIDATE_DAYS_LEGEND,
  CREATE_MATCH_HEADING,
  DRAFT_PROBLEM_MESSAGES,
  GENERIC_MATCHES_FAILURE,
  KICK_OFF_EMPTY_HINT,
  KICK_OFF_MISSING,
  KICK_OFF_LEGEND,
  LOCATION_HINT,
  LOCATION_LABEL,
  MATCHES_LOADING_LABEL,
  MATCH_FLOW_STEPS,
  MATCH_FLOW_STEPS_LABEL,
  NOT_AN_ORGANISER_STATEMENT,
  PICK_A_TIME_LABEL,
  REJECTION_MESSAGES,
  STEP_DONE_LABEL,
  SUBMIT_DRAFT_LABEL,
  SUBMITTING_DRAFT_LABEL,
  addTimeLabel,
  kickOffLabel,
  kickOffText,
  removeTimeLabel,
  slotCountStatement,
} from '../lib/messages';
import { matchPath } from '../lib/routePaths';
import { useAction } from '../state/useAction';
import { useRemote } from '../state/useRemote';

import '../styles/matches.css';

export interface CreateMatchScreenProps {
  readonly api: MatchesApi;
  /** The clock the tiles and the future-day check read; defaults to `Date.now`. */
  readonly now?: () => number;
}

interface Problems {
  readonly location: DraftProblem | null;
  readonly days: DraftProblem | null;
}

const NO_PROBLEMS: Problems = { location: null, days: null };

const TIME_OPTIONS: readonly SelectOption[] = [
  { value: '', label: PICK_A_TIME_LABEL },
  ...KICK_OFF_TIMES.map((time) => ({ value: time, label: time })),
];

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

  // The tiles are fixed when the screen opens, so a long visit never shifts them.
  const [tiles] = useState(() => upcomingDates(now()));
  const [location, setLocation] = useState('');
  const [slots, setSlots] = useState<readonly CandidateSlot[]>([]);
  const [nextId, setNextId] = useState(0);
  const [problems, setProblems] = useState<Problems>(NO_PROBLEMS);
  const submit = useAction<string>();

  const daysHintId = `${idPrefix}-days-hint`;
  const timesNoteId = `${idPrefix}-times-note`;
  const daysErrorId = `${idPrefix}-days-error`;

  const labelOf = useMemo(() => new Map(tiles.map((tile) => [tile.date, tile.label])), [tiles]);
  const atMax = slots.length >= CANDIDATE_DAY_MAX_COUNT;
  const picked = pickedDates(slots);

  const dayOptions: readonly DayOption[] = tiles.map((tile) => {
    const time = earliestTime(slots, tile.date);
    const isPicked = picked.includes(tile.date);
    return {
      id: tile.date,
      dow: tile.dow,
      num: tile.num,
      mon: tile.mon,
      label: time === undefined ? tile.label : `${tile.label}, ${time}`,
      time,
      disabled: atMax && !isPicked,
    };
  });

  const addSlot = (date: string): void => {
    setSlots((current) => [...current, { id: nextId, date, time: '' }]);
    setNextId((id) => id + 1);
  };

  const toggleDay = (date: string, checked: boolean): void => {
    if (checked) {
      addSlot(date);
    } else {
      setSlots((current) => current.filter((slot) => slot.date !== date));
    }
  };

  const removeSlot = (id: number): void => {
    setSlots((current) => current.filter((slot) => slot.id !== id));
  };

  const updateTime = (id: number, time: string): void => {
    setSlots((current) => current.map((slot) => (slot.id === id ? { ...slot, time } : slot)));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const validation = validateSlots(location, slots, now());

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
    body = (
      <FailureNotice onRetry={standing.reload}>
        <BackToSquadLink squadId={squadId} />
      </FailureNotice>
    );
  } else if (standing.phase !== 'loaded' && standing.phase !== 'not-found') {
    body = <LoadingNotice label={MATCHES_LOADING_LABEL} />;
  } else if (!isOrganiser(standing.value)) {
    body = (
      <>
        <p className="matches-notice">{NOT_AN_ORGANISER_STATEMENT}</p>
        <BackToSquadLink squadId={squadId} />
      </>
    );
  } else {
    const outcome = submit.outcome;
    const submitError =
      outcome === null || outcome.kind === 'success'
        ? null
        : outcome.kind === 'rejected'
          ? REJECTION_MESSAGES[outcome.reason]
          : GENERIC_MATCHES_FAILURE;
    const daysError = problems.days === null ? null : DRAFT_PROBLEM_MESSAGES[problems.days];

    body = (
      <form className="matches-form create-match" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <Steps
          label={MATCH_FLOW_STEPS_LABEL}
          steps={MATCH_FLOW_STEPS}
          current={0}
          doneLabel={STEP_DONE_LABEL}
        />

        <TextField
          className="create-match__location"
          label={LOCATION_LABEL}
          hint={LOCATION_HINT}
          icon="pin"
          autoComplete="off"
          maxLength={LOCATION_MAX_LENGTH}
          value={location}
          error={problems.location === null ? null : DRAFT_PROBLEM_MESSAGES[problems.location]}
          onChange={(event) => setLocation(event.target.value)}
        />

        <fieldset className="create-match__group" aria-describedby={daysHintId}>
          <legend className="create-match__legend">{CANDIDATE_DAYS_LEGEND}</legend>
          <p id={daysHintId} className="create-match__hint">
            {CANDIDATE_DAYS_HINT}
          </p>
          <DayPicker days={dayOptions} selected={picked} onToggle={toggleDay} reserveTime />
        </fieldset>

        <fieldset
          className="create-match__group"
          aria-describedby={daysError === null ? timesNoteId : `${timesNoteId} ${daysErrorId}`}
        >
          <legend className="create-match__legend">{KICK_OFF_LEGEND}</legend>
          {picked.length === 0 ? null : (
            <ul className="create-match__days">
              {picked.map((date) => {
                const dayLabel = labelOf.get(date) ?? date;
                const daySlots = slotsOn(slots, date);
                return (
                  <li key={date} className="create-match__day">
                    <span className="create-match__day-name">{dayLabel}</span>
                    <div className="create-match__times">
                      {daySlots.map((slot, index) => (
                        <div key={slot.id} className="create-match__time">
                          <Select
                            id={`${idPrefix}-time-${slot.id}`}
                            label={kickOffText(index)}
                            aria-label={kickOffLabel(dayLabel, index)}
                            options={TIME_OPTIONS}
                            value={slot.time}
                            error={
                              problems.days === 'time-required' && slot.time === ''
                                ? KICK_OFF_MISSING
                                : null
                            }
                            onChange={(event) => updateTime(slot.id, event.target.value)}
                          />
                          <IconButton
                            icon="x"
                            label={removeTimeLabel(dayLabel, index)}
                            onClick={() => removeSlot(slot.id)}
                          />
                        </div>
                      ))}
                      {daySlots.length < MAX_TIMES_PER_DAY && !atMax ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          icon="plus"
                          aria-label={addTimeLabel(dayLabel)}
                          onClick={() => addSlot(date)}
                        >
                          {ADD_TIME_TEXT}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p id={timesNoteId} className="create-match__hint">
            {slots.length === 0 ? KICK_OFF_EMPTY_HINT : slotCountStatement(slots.length)}
          </p>
          {daysError === null ? null : (
            <p id={daysErrorId} className="matches-error">
              {daysError}
            </p>
          )}
        </fieldset>

        {submitError === null ? null : <Banner tone="error">{submitError}</Banner>}

        <div className="create-match__footer">
          <Link className={buttonClasses({ variant: 'ghost' })} to={squadPath(squadId)}>
            {BACK_TO_SQUAD_LABEL}
          </Link>
          <Button
            type="submit"
            iconRight="arrowRight"
            loading={submit.busy}
            aria-disabled={submit.busy ? true : undefined}
          >
            {submit.busy ? SUBMITTING_DRAFT_LABEL : SUBMIT_DRAFT_LABEL}
          </Button>
        </div>
      </form>
    );
  }

  const squadName = standing.phase === 'loaded' ? standing.value?.squadName : undefined;

  return (
    <div className="matches-screen">
      <div className="matches-titles">
        {squadName === undefined ? null : <p className="matches-overline">{squadName}</p>}
        <h1 className="matches-heading">{CREATE_MATCH_HEADING}</h1>
      </div>
      {body}
    </div>
  );
}

export default CreateMatchScreen;
