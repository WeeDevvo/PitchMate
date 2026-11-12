/**
 * The tracker's timeline: every goal and keeper change logged so far, in minute
 * order, with the score after each goal. A goal can be fixed (a different
 * scorer, team or own goal) or removed, and a keeper change removed. Each fix is
 * a new event: the original stays in the list, struck through and labelled
 * "Taken back", with the correction beneath it.
 */
import { useEffect, useRef, type ReactElement } from 'react';

import { ActionsMenu, Button, EventTimeline, type EventTimelineItem } from '../../../ui';

import { timeline, type GoalEvent, type KeeperEvent, type LoggedEvent, type TimelineEntry } from '../lib/liveTracking';
import {
  BACK_LABEL,
  CHANGE_SCORER_LABEL,
  REMOVE_GOAL_LABEL,
  REMOVE_KEEPER_LABEL,
  SENDING_LABEL,
  TAKEN_BACK_LABEL,
  TIMELINE_EMPTY_STATEMENT,
  TIMELINE_HEADING,
  TIMELINE_HINT,
  correctionSub,
  correctionText,
  minuteText,
  scoreText,
  timelineActionsLabel,
  timelineGoalSub,
  timelineGoalText,
  timelineKeeperText,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface TrackerTimelineProps {
  readonly sheet: TeamSheet;
  readonly log: readonly LoggedEvent[];
  readonly nameOf: (membershipId: string) => string;
  readonly onChangeScorer: (goal: GoalEvent) => void;
  readonly onRemoveGoal: (goal: GoalEvent) => void;
  readonly onRemoveKeeper: (keeper: KeeperEvent) => void;
  readonly onClose: () => void;
}

function withPending(sub: string, pending: boolean): string {
  return pending ? `${sub} · ${SENDING_LABEL}` : sub;
}

export function TrackerTimeline({
  sheet,
  log,
  nameOf,
  onChangeScorer,
  onRemoveGoal,
  onRemoveKeeper,
  onClose,
}: TrackerTimelineProps): ReactElement {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const teamIds = sheet.teams.map((team) => team.teamId);
  const sideOf = (teamId: string): 'a' | 'b' | null => {
    const index = teamIds.indexOf(teamId);
    return index === 0 ? 'a' : index === 1 ? 'b' : null;
  };
  const teamNameOf = (teamId: string): string => sheet.teams.find((team) => team.teamId === teamId)?.teamName ?? '';

  const toItem = (entry: TimelineEntry): EventTimelineItem => {
    if (entry.kind === 'goal') {
      const { event } = entry;
      const text = timelineGoalText(event.scorerId === null ? null : nameOf(event.scorerId), event.ownGoal);
      return {
        key: event.eventId,
        minute: minuteText(event.minute),
        kind: 'goal',
        team: sideOf(event.teamId),
        own: event.ownGoal,
        text,
        sub: withPending(timelineGoalSub(teamNameOf(event.teamId), event.ownGoal), entry.pending),
        score: entry.scoreAfter === null ? undefined : scoreText(entry.scoreAfter),
        void: !entry.standing,
        actions: entry.standing ? (
          <ActionsMenu label={timelineActionsLabel(text, event.minute)}>
            <Button variant="ghost" icon="edit" onClick={() => onChangeScorer(event)}>
              {CHANGE_SCORER_LABEL}
            </Button>
            <Button variant="ghost" icon="trash" onClick={() => onRemoveGoal(event)}>
              {REMOVE_GOAL_LABEL}
            </Button>
          </ActionsMenu>
        ) : undefined,
      };
    }

    if (entry.kind === 'keeper') {
      const { event } = entry;
      const text = timelineKeeperText(nameOf(event.keeperId));
      return {
        key: event.eventId,
        minute: minuteText(event.minute),
        kind: 'keeper',
        text,
        sub: withPending(teamNameOf(event.teamId), entry.pending),
        void: !entry.standing,
        actions: entry.standing ? (
          <ActionsMenu label={timelineActionsLabel(text, event.minute)}>
            <Button variant="ghost" icon="trash" onClick={() => onRemoveKeeper(event)}>
              {REMOVE_KEEPER_LABEL}
            </Button>
          </ActionsMenu>
        ) : undefined,
      };
    }

    const what =
      entry.target.kind === 'keeper' ? 'keeper-removed' : entry.replacement === null ? 'goal-removed' : 'scorer-changed';
    return {
      key: entry.event.eventId,
      minute: minuteText(entry.target.minute),
      kind: 'correction',
      text: correctionText(what),
      sub: withPending(correctionSub(entry.event.minute), entry.pending),
    };
  };

  const items = timeline(teamIds, log).map(toItem);

  return (
    <section className="matches-tracker-step" aria-labelledby="matches-timeline-heading">
      <div className="matches-tracker-step__bar">
        <Button variant="ghost" icon="chevronLeft" onClick={onClose}>
          {BACK_LABEL}
        </Button>
      </div>
      <h2 id="matches-timeline-heading" ref={headingRef} tabIndex={-1} className="matches-subheading">
        {TIMELINE_HEADING}
      </h2>
      {items.length === 0 ? (
        <p className="matches-notice">{TIMELINE_EMPTY_STATEMENT}</p>
      ) : (
        <>
          <p className="matches-hint">{TIMELINE_HINT}</p>
          <EventTimeline events={items} voidLabel={TAKEN_BACK_LABEL} label={TIMELINE_HEADING} />
        </>
      )}
    </section>
  );
}

export default TrackerTimeline;
