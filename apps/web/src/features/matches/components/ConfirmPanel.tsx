/**
 * The organiser's confirm step: choose any candidate day from radio cards, each
 * saying how many can make it with the best-attended starred, then confirm it in
 * a dialog that says what confirming does and warns when there are too few to
 * roll teams yet. There is no minimum: availability is a guide, not a gate.
 * Everyone who marked that day becomes a player; others join or are added
 * afterwards.
 */
import { useId, useState, type ReactElement } from 'react';

import { Badge, Banner, Button, Dialog, OptionCard } from '../../../ui';
import type { CallResult } from '../api/matchesApi';
import { mostAvailableDays, type DayCount } from '../lib/availability';
import { dayParts, formatDay } from '../lib/matchDays';
import {
  CONFIRM_DAY_BUTTON_LABEL,
  CONFIRM_DAY_LEGEND,
  CONFIRM_FEW_PLAYERS_WARNING,
  CONFIRM_HEADING,
  CONFIRM_HINT,
  CONFIRM_LABEL,
  CONFIRMING_LABEL,
  GENERIC_MATCHES_FAILURE,
  MOST_PLAYERS_LABEL,
  NOT_YET_LABEL,
  REJECTION_MESSAGES,
  confirmDialogBody,
  confirmDialogTitle,
  tallyCountLabel,
} from '../lib/messages';
import { ROLL_MIN_PARTICIPANTS } from '../lib/teams';
import { useAction } from '../state/useAction';

export interface ConfirmPanelProps {
  readonly dayCounts: readonly DayCount[];
  readonly confirm: (day: string, signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a confirm settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

export function ConfirmPanel({
  dayCounts,
  confirm,
  onSettled,
}: ConfirmPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;

  // The organiser's pick while it is still a candidate day; otherwise the
  // best-attended day, the earliest of any tie.
  const [picked, setChosen] = useState<number | null>(null);
  const chosen = dayCounts.some((day) => day.dayMs === picked)
    ? picked
    : dayCounts.length === 0
      ? null
      : dayCounts.reduce((best, day) => (day.count > best.count ? day : best)).dayMs;
  const chosenCount = dayCounts.find((day) => day.dayMs === chosen)?.count ?? 0;
  const best = mostAvailableDays(dayCounts);
  const [asking, setAsking] = useState(false);
  const action = useAction<void>();

  const handleConfirm = async (): Promise<void> => {
    if (chosen === null || action.busy) return;
    const outcome = await action.run((signal) => confirm(new Date(chosen).toISOString(), signal));
    if (outcome !== null && outcome.kind !== 'success') setAsking(false);
    if (outcome !== null) onSettled();
  };

  const outcome = action.outcome;
  const failure =
    outcome === null || outcome.kind === 'success'
      ? null
      : outcome.kind === 'rejected'
        ? REJECTION_MESSAGES[outcome.reason]
        : GENERIC_MATCHES_FAILURE;

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {CONFIRM_HEADING}
      </h2>
      {dayCounts.length === 0 ? null : (
        <>
          <fieldset className="matches-fieldset">
            <legend className="matches-legend">{CONFIRM_DAY_LEGEND}</legend>
            <p className="matches-hint">{CONFIRM_HINT}</p>
            <ul className="matches-day-options">
              {dayCounts.map(({ dayMs, count }) => {
                const parts = dayParts(dayMs);
                return (
                  <li key={dayMs}>
                    <OptionCard
                      compact
                      name={`${idPrefix}-day`}
                      value={String(dayMs)}
                      checked={chosen === dayMs}
                      onChange={() => setChosen(dayMs)}
                      title={formatDay(dayMs)}
                      leading={
                        <span className="pm-datebox" aria-hidden="true">
                          <small>{parts.dow}</small>
                          <b className="pm-num">{parts.num}</b>
                          <small>{parts.mon}</small>
                        </span>
                      }
                      description={tallyCountLabel(count)}
                      badge={
                        best.has(dayMs) ? (
                          <Badge tone="info" icon="star">
                            {MOST_PLAYERS_LABEL}
                          </Badge>
                        ) : undefined
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="matches-actions">
            <Button type="button" icon="calendar" onClick={() => setAsking(true)}>
              {CONFIRM_DAY_BUTTON_LABEL}
            </Button>
          </div>
        </>
      )}
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
      {chosen === null ? null : (
        <Dialog
          open={asking}
          title={confirmDialogTitle(formatDay(chosen))}
          icon="calendar"
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setAsking(false)}>
                {NOT_YET_LABEL}
              </Button>
              <Button
                icon="check"
                aria-disabled={action.busy ? true : undefined}
                onClick={() => void handleConfirm()}
              >
                {action.busy ? CONFIRMING_LABEL : CONFIRM_LABEL}
              </Button>
            </>
          }
        >
          <p className="pm-dialog__body">{confirmDialogBody(chosenCount)}</p>
          {chosenCount < ROLL_MIN_PARTICIPANTS ? (
            <Banner tone="warn" announce={false}>
              {CONFIRM_FEW_PLAYERS_WARNING}
            </Banner>
          ) : null}
        </Dialog>
      )}
    </section>
  );
}

export default ConfirmPanel;
