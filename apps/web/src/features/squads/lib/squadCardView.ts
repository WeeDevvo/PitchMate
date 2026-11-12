/**
 * What a squad card on the Squads_Home shows beyond the name and the role: the
 * player count, the next match, and the viewer's form. Pure, total and
 * exception-free, like every module under `lib/`; the card component maps the
 * result onto the design system's `SquadCard`.
 *
 * | Fact | Shown as |
 * | --- | --- |
 * | `playerCount` | "1 player", "14 players" |
 * | a confirmed next match | its state, "Sun 9 Nov · 10:00", and the place |
 * | a next match still gathering availability | its state, "Pick a day", and "3 candidate days" |
 * | no next match | `null`: the card says `SQUAD_CARD_NO_NEXT_MATCH` |
 * | `recentForm` | W / D / L letters, oldest first |
 *
 * A day is shown in the viewer's own time zone unless one is given, so the card
 * agrees with the viewer's clock.
 */

import { SQUAD_CARD_PICK_A_DAY } from './messages';
import type { SquadNextMatch, SquadSummary } from './parse/squadSummary';
import type { MatchState, PlayerResult } from './wireEnums';

/** The design system's name for a match state, as its state chip takes it. */
export type CardMatchState = 'gathering' | 'confirmed' | 'rolled' | 'live' | 'completed' | 'cancelled';

/** A result as the card's form guide shows it. */
export type CardResultLetter = 'W' | 'D' | 'L';

/** The next match as the card shows it. */
export interface CardNextMatch {
  readonly state: CardMatchState;
  readonly title: string;
  readonly sub: string;
}

/** Everything the card shows beyond the name and the role. */
export interface SquadCardView {
  readonly players: string;
  readonly next: CardNextMatch | null;
  readonly form: readonly CardResultLetter[];
}

const CARD_STATES: Readonly<Record<MatchState, CardMatchState>> = {
  GatheringAvailability: 'gathering',
  Confirmed: 'confirmed',
  TeamsRolled: 'rolled',
  InProgress: 'live',
  Completed: 'completed',
  Cancelled: 'cancelled',
};

const RESULT_LETTERS: Readonly<Record<PlayerResult, CardResultLetter>> = {
  Win: 'W',
  Draw: 'D',
  Loss: 'L',
};

/** "1 player", "14 players". */
export function playerCountLabel(count: number): string {
  return count === 1 ? '1 player' : `${count} players`;
}

/** "1 candidate day", "3 candidate days". */
export function candidateDaysLabel(count: number): string {
  return count === 1 ? '1 candidate day' : `${count} candidate days`;
}

/**
 * "Sun 9 Nov · 10:00": the weekday, the day and month, and the 24-hour time,
 * in `timeZone` or the viewer's own.
 */
export function matchDayLabel(instantMs: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(instantMs);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('weekday')} ${part('day')} ${part('month')} · ${part('hour')}:${part('minute')}`;
}

/** The next match as the card shows it. */
export function nextMatchView(next: SquadNextMatch, timeZone?: string): CardNextMatch {
  return next.scheduledAtMs === null
    ? {
        state: CARD_STATES[next.state],
        title: SQUAD_CARD_PICK_A_DAY,
        sub: candidateDaysLabel(next.candidateDayCount),
      }
    : {
        state: CARD_STATES[next.state],
        title: matchDayLabel(next.scheduledAtMs, timeZone),
        sub: next.place,
      };
}

/** Everything a squad card shows beyond the name and the role. */
export function squadCardView(
  summary: Pick<SquadSummary, 'playerCount' | 'nextMatch' | 'recentForm'>,
  timeZone?: string,
): SquadCardView {
  return {
    players: playerCountLabel(summary.playerCount),
    next: summary.nextMatch === null ? null : nextMatchView(summary.nextMatch, timeZone),
    form: summary.recentForm.map((result) => RESULT_LETTERS[result]),
  };
}
