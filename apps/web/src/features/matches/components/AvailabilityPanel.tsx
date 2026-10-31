/**
 * Who can play, while availability is being gathered: the design system's
 * availability grid, with a column per candidate day, the caller's own row, a
 * row per guest for an organiser (guests have no account, so an admin answers
 * for them), and how many can make each day, the best one highlighted.
 *
 * The caller ticks their own row, an organiser the guests' rows too, and one
 * save sends each answer that changed. The days are sent back as the exact
 * instants the backend listed, so each one names a candidate day rather than a
 * near miss. Availability is a guide to the best day, not a gate.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import {
  AvailabilityGrid,
  AvailabilityKey,
  Banner,
  Button,
  IconButton,
  type AvailabilityGridRow,
} from '../../../ui';
import type { CallResult } from '../api/matchesApi';
import { answersFor, countsByDay, mostAvailableDays, sameDays } from '../lib/availability';
import { chronological, dayParts, formatDay } from '../lib/matchDays';
import {
  AVAILABILITY_ANSWER_LABELS,
  AVAILABILITY_CLEARED_STATEMENT,
  AVAILABILITY_GRID_CAPTION,
  AVAILABILITY_HINT,
  AVAILABILITY_SAVED_STATEMENT,
  AVAILABILITY_UNCHANGED_STATEMENT,
  CLEAR_AVAILABILITY_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUESTS_LOADING_LABEL,
  GUEST_AVAILABILITY_NO_GUESTS,
  GUEST_LABEL,
  MOST_PLAYERS_LABEL,
  ORGANISER_AVAILABILITY_HINT,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  SAVING_AVAILABILITY_LABEL,
  TALLY_HEADING,
  TALLY_HINT,
  TOTALS_LABEL,
  YOU_LABEL,
  availabilityCellLabel,
  bestDayStatement,
  clearGuestAvailabilityLabel,
  tallyCountLabel,
} from '../lib/messages';
import type { CallerAvailability, GuestAvailability } from '../lib/parse/matchDetail';
import type { DayTally } from '../lib/parse/responses';
import type { SquadGuest } from '../lib/parse/teams';
import { useAction, type ActionOutcome } from '../state/useAction';

/** An organiser's view of the guests: who they are, and what was marked for each. */
export interface GuestAnswers {
  /** The squad's active guests, `null` while loading, or `'failed'`. */
  readonly guests: readonly SquadGuest[] | null | 'failed';
  /** What was marked before; a guest absent here has nothing marked. */
  readonly marked: readonly GuestAvailability[];
  readonly submit: (
    guestMembershipId: string,
    markedDays: readonly string[],
    signal: AbortSignal,
  ) => Promise<CallResult<void>>;
  readonly clear: (guestMembershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
}

export interface AvailabilityPanelProps {
  readonly candidateDaysMs: readonly number[];
  readonly availability: CallerAvailability;
  /** How many can make each day, or `null` until it is read. */
  readonly tally: readonly DayTally[] | null;
  readonly submit: (markedDays: readonly string[], signal: AbortSignal) => Promise<CallResult<void>>;
  readonly clear: (signal: AbortSignal) => Promise<CallResult<void>>;
  /** Present for an organiser only. */
  readonly guests?: GuestAnswers;
  /** Called after a write settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

type LastWrite = 'saved' | 'cleared' | 'unchanged' | null;

function outcomeMessage(outcome: ActionOutcome<void> | null, last: LastWrite): string | null {
  if (last === 'unchanged') return AVAILABILITY_UNCHANGED_STATEMENT;
  if (outcome === null) return null;
  if (outcome.kind === 'success') {
    return last === 'cleared' ? AVAILABILITY_CLEARED_STATEMENT : AVAILABILITY_SAVED_STATEMENT;
  }
  if (outcome.kind === 'rejected') return REJECTION_MESSAGES[outcome.reason];
  return GENERIC_MATCHES_FAILURE;
}

function toggled(current: ReadonlySet<number>, dayMs: number, checked: boolean): ReadonlySet<number> {
  const next = new Set(current);
  if (checked) next.add(dayMs);
  else next.delete(dayMs);
  return next;
}

function asInstants(marked: ReadonlySet<number>): readonly string[] {
  return chronological([...marked]).map((dayMs) => new Date(dayMs).toISOString());
}

const SUCCESS: CallResult<void> = { kind: 'success', value: undefined };

export function AvailabilityPanel({
  candidateDaysMs,
  availability,
  tally,
  submit,
  clear,
  guests,
  onSettled,
}: AvailabilityPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const hintId = `${idPrefix}-hint`;

  const days = chronological(candidateDaysMs);
  const dayLabels = days.map((dayMs) => formatDay(dayMs));

  // The caller's own answer, and each guest's, as ticked here since the last save.
  const [own, setOwn] = useState<ReadonlySet<number>>(() => new Set(availability.markedDaysMs));
  const [ownTouched, setOwnTouched] = useState(false);
  const [guestMarks, setGuestMarks] = useState<ReadonlyMap<string, ReadonlySet<number>>>(() => new Map());
  const [last, setLast] = useState<LastWrite>(null);
  const write = useAction<void>();

  const storedFor = new Map((guests?.marked ?? []).map((entry) => [entry.membershipId.toLowerCase(), entry]));
  const guestList = guests !== undefined && Array.isArray(guests.guests) ? guests.guests : [];
  const marksOf = (guest: SquadGuest): ReadonlySet<number> =>
    guestMarks.get(guest.membershipId) ??
    new Set(storedFor.get(guest.membershipId.toLowerCase())?.markedDaysMs ?? []);

  const changedGuests = guestList.filter((guest) => {
    const current = guestMarks.get(guest.membershipId);
    if (current === undefined) return false;
    const stored = storedFor.get(guest.membershipId.toLowerCase());
    return stored === undefined ? current.size > 0 : !sameDays(current, stored.markedDaysMs);
  });
  const ownChanged =
    ownTouched && (!availability.hasStoredResponse || !sameDays(own, availability.markedDaysMs));

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (write.busy) return;
    if (!ownChanged && changedGuests.length === 0) {
      setLast('unchanged');
      return;
    }
    setLast('saved');
    const outcome = await write.run(async (signal) => {
      if (ownChanged) {
        const result = await submit(asInstants(own), signal);
        if (result.kind !== 'success') return result;
      }
      for (const guest of guests === undefined ? [] : changedGuests) {
        const result = await guests?.submit(guest.membershipId, asInstants(marksOf(guest)), signal);
        if (result !== undefined && result.kind !== 'success') return result;
      }
      return SUCCESS;
    });
    if (outcome !== null && outcome.kind === 'success') {
      setOwnTouched(false);
      setGuestMarks(new Map());
    }
    if (outcome !== null) onSettled();
  };

  const handleClearOwn = async (): Promise<void> => {
    if (write.busy) return;
    setLast('cleared');
    const outcome = await write.run(clear);
    if (outcome !== null && outcome.kind === 'success') {
      setOwn(new Set());
      setOwnTouched(false);
    }
    if (outcome !== null) onSettled();
  };

  const handleClearGuest = async (guest: SquadGuest): Promise<void> => {
    if (write.busy || guests === undefined) return;
    setLast('cleared');
    const outcome = await write.run((signal) => guests.clear(guest.membershipId, signal));
    if (outcome !== null && outcome.kind === 'success') {
      setGuestMarks((current) => {
        const next = new Map(current);
        next.delete(guest.membershipId);
        return next;
      });
    }
    if (outcome !== null) onSettled();
  };

  const rows: AvailabilityGridRow[] = [
    {
      id: 'you',
      name: YOU_LABEL,
      cells: answersFor(days, own, availability.hasStoredResponse || ownTouched).map((answer, index) => ({
        answer,
        label: availabilityCellLabel(YOU_LABEL, dayLabels[index]),
      })),
      onToggle: (index, checked) => {
        if (write.busy) return;
        setOwn((current) => toggled(current, days[index], checked));
        setOwnTouched(true);
      },
    },
    ...guestList.map((guest): AvailabilityGridRow => {
      const stored = storedFor.get(guest.membershipId.toLowerCase());
      const marks = marksOf(guest);
      return {
        id: guest.membershipId,
        name: (
          <span className="matches-grid-name">
            {guest.displayName}
            <small>{GUEST_LABEL}</small>
          </span>
        ),
        cells: answersFor(days, marks, stored !== undefined || guestMarks.has(guest.membershipId)).map(
          (answer, index) => ({ answer, label: availabilityCellLabel(guest.displayName, dayLabels[index]) }),
        ),
        onToggle: (index, checked) => {
          if (write.busy) return;
          setGuestMarks((current) => new Map(current).set(guest.membershipId, toggled(marks, days[index], checked)));
        },
        action:
          stored === undefined ? undefined : (
            <IconButton
              icon="x"
              label={clearGuestAvailabilityLabel(guest.displayName)}
              aria-disabled={write.busy ? true : undefined}
              onClick={() => void handleClearGuest(guest)}
            />
          ),
      };
    }),
  ];

  const counts = tally === null ? null : countsByDay(days, tally);
  const best = counts === null ? new Set<number>() : mostAvailableDays(counts);
  const message = outcomeMessage(write.outcome, last);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {TALLY_HEADING}
      </h2>
      <p className="matches-hint">{TALLY_HINT}</p>
      {counts === null ? null : (
        <Banner tone="info" icon="calendar" announce={false}>
          {bestDayStatement(days.filter((dayMs) => best.has(dayMs)).map((dayMs) => formatDay(dayMs)))}
        </Banner>
      )}
      <form className="matches-availability" noValidate onSubmit={(event) => void handleSave(event)}>
        <p id={hintId} className="matches-hint">
          {guests === undefined ? AVAILABILITY_HINT : ORGANISER_AVAILABILITY_HINT}
        </p>
        <AvailabilityGrid
          caption={AVAILABILITY_GRID_CAPTION}
          days={days.map((dayMs) => {
            const parts = dayParts(dayMs);
            return { id: String(dayMs), dow: parts.dow, date: `${parts.num} ${parts.mon}`, time: parts.time };
          })}
          rows={rows}
          answerLabels={AVAILABILITY_ANSWER_LABELS}
          totals={counts?.map(({ dayMs, count }) => ({
            value: count,
            label: tallyCountLabel(count),
            best: best.has(dayMs),
          }))}
          totalsLabel={TOTALS_LABEL}
          bestLabel={MOST_PLAYERS_LABEL}
        />
        <AvailabilityKey labels={AVAILABILITY_ANSWER_LABELS} />
        {guests === undefined ? null : guests.guests === 'failed' ? (
          <p className="matches-hint">{GENERIC_MATCHES_FAILURE}</p>
        ) : guests.guests === null ? (
          <p className="matches-hint" role="status">
            {GUESTS_LOADING_LABEL}
          </p>
        ) : guests.guests.length === 0 ? (
          <p className="matches-hint">{GUEST_AVAILABILITY_NO_GUESTS}</p>
        ) : null}
        <div className="matches-actions">
          <Button type="submit" aria-disabled={write.busy ? true : undefined}>
            {write.busy && last === 'saved' ? SAVING_AVAILABILITY_LABEL : SAVE_AVAILABILITY_LABEL}
          </Button>
          {availability.hasStoredResponse ? (
            <Button
              type="button"
              variant="ghost"
              aria-disabled={write.busy ? true : undefined}
              onClick={() => void handleClearOwn()}
            >
              {CLEAR_AVAILABILITY_LABEL}
            </Button>
          ) : null}
        </div>
        <p className="matches-notice" role="status" aria-live="polite">
          {message}
        </p>
      </form>
    </section>
  );
}

export default AvailabilityPanel;
