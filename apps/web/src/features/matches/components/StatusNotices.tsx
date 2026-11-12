/**
 * The Matches_Feature's boundary states: loading, a failure with its one retry,
 * and the concealed not-found. Each is announced politely where it appears and
 * leaves keyboard focus alone.
 */
import { type ReactElement, type ReactNode } from 'react';

import { Button, EmptyState, buttonClasses } from '../../../ui';
import { Link } from 'react-router-dom';

import { squadPath } from '../../squads';
import {
  BACK_TO_SQUAD_LABEL,
  GENERIC_MATCHES_FAILURE,
  MATCH_NOT_FOUND_HEADING,
  MATCH_NOT_FOUND_STATEMENT,
  RETRY_LABEL,
} from '../lib/messages';

import '../styles/matches.css';

export function LoadingNotice({ label }: { readonly label: string }): ReactElement {
  return (
    <p className="matches-notice" role="status" aria-live="polite" aria-busy="true">
      {label}
    </p>
  );
}

export interface FailureNoticeProps {
  readonly onRetry: () => void;
  readonly children?: ReactNode;
}

/**
 * The one fixed failure statement, carrying nothing of the response: the design
 * system's error state, with no heading of its own as it sits under the
 * screen's.
 */
export function FailureNotice({ onRetry, children }: FailureNoticeProps): ReactElement {
  return (
    <EmptyState
      className="matches-failure"
      tone="error"
      icon="cloudOff"
      bodyProps={{ role: 'status', 'aria-live': 'polite' }}
      action={
        <div className="matches-actions matches-actions--center">
          <Button type="button" variant="secondary" icon="sync" onClick={onRetry}>
            {RETRY_LABEL}
          </Button>
          {children}
        </div>
      }
    >
      {GENERIC_MATCHES_FAILURE}
    </EmptyState>
  );
}

/** The way back to the squad the route names. */
export function BackToSquadLink({ squadId }: { readonly squadId: string }): ReactElement {
  return (
    <Link className="matches-link" to={squadPath(squadId)}>
      {BACK_TO_SQUAD_LABEL}
    </Link>
  );
}

/**
 * One fixed statement for a match that is missing and for one the caller may not
 * see, so the screen discloses neither.
 */
export function MatchNotFound({ squadId }: { readonly squadId: string }): ReactElement {
  return (
    <EmptyState
      className="matches-not-found"
      icon="search"
      headingLevel={1}
      title={MATCH_NOT_FOUND_HEADING}
      bodyProps={{ role: 'status', 'aria-live': 'polite' }}
      action={
        <Link className={buttonClasses({ variant: 'secondary' })} to={squadPath(squadId)}>
          {BACK_TO_SQUAD_LABEL}
        </Link>
      }
    >
      {MATCH_NOT_FOUND_STATEMENT}
    </EmptyState>
  );
}
