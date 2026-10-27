/**
 * The Players tab: the design system's filter chips (everyone, members, guests)
 * and "Find a player" search over the squad's Player_List.
 *
 * The filter only narrows which rows reach the list (`lib/playerFilter.ts`); the
 * list still orders whatever it is given by the Player_Order, and every row keeps
 * its own controls. A chip is a toggle (`aria-pressed`) in a labelled group, and
 * its count is part of its name, so "Guests 2" reads the same as it looks.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { Chip, TextField } from '../../../ui';

import { PlayerList, type PlayerListProps } from './PlayerList';
import {
  ALL_PLAYERS_CHIP,
  FIND_PLAYER_LABEL,
  GUESTS_CHIP,
  MEMBERS_CHIP,
  NO_MATCHING_PLAYERS,
  PLAYER_FILTER_LABEL,
} from '../lib/messages';
import { PLAYER_KINDS, filterPlayerRows, playerKindCounts, type PlayerKind } from '../lib/playerFilter';

import '../styles/squadsTokens.css';
import './PlayersPanel.css';

const CHIP_LABELS: Readonly<Record<PlayerKind, string>> = {
  all: ALL_PLAYERS_CHIP,
  members: MEMBERS_CHIP,
  guests: GUESTS_CHIP,
};

/** Everything the Player_List takes, which the panel narrows before handing over. */
export type PlayersPanelProps = Omit<PlayerListProps, 'emptyStatement'>;

export function PlayersPanel({ rows, ...listProps }: PlayersPanelProps): ReactElement {
  const [kind, setKind] = useState<PlayerKind>('all');
  const [query, setQuery] = useState('');
  const groupLabelId = useId();

  const counts = useMemo(() => playerKindCounts(rows), [rows]);
  const shown = useMemo(() => filterPlayerRows(rows, kind, query), [rows, kind, query]);

  return (
    <div className="squads-players-panel">
      <div className="squads-players-panel__filters">
        <span id={groupLabelId} className="pm-sr">
          {PLAYER_FILTER_LABEL}
        </span>
        <div className="squads-players-panel__chips" role="group" aria-labelledby={groupLabelId}>
          {PLAYER_KINDS.map((option) => (
            <Chip
              key={option}
              selected={kind === option}
              icon={option === 'guests' ? 'guest' : undefined}
              onClick={() => setKind(option)}
            >
              {CHIP_LABELS[option]} {counts[option]}
            </Chip>
          ))}
        </div>
        <TextField
          className="squads-players-panel__search"
          label={FIND_PLAYER_LABEL}
          icon="search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="squads-players-panel__list">
        <PlayerList
          {...listProps}
          rows={shown}
          // Only a filter can empty a squad that has players; say so rather
          // than claim the squad has none.
          {...(rows.length > 0 ? { emptyStatement: NO_MATCHING_PLAYERS } : {})}
        />
      </div>
    </div>
  );
}

export default PlayersPanel;
