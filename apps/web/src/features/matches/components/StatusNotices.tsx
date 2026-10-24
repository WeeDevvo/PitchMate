/**
 * The Matches_Feature's boundary states: loading, a failure with its one retry,
 * and the concealed not-found. Each is announced politely where it appears and
 * leaves keyboard focus alone.
 */
import { type ReactElement, type ReactNode } from 'react';
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

/** The one fixed failure statement, carrying nothing of the response. */
export function FailureNotice({ onRetry, children }: FailureNoticeProps): ReactElement {
  return (
    <div className="matches-failure">
      <p className="matches-notice" role="status" aria-live="polite">
        {GENERIC_MATCHES_FAILURE}
      </p>
      <div className="matches-actions">
        <button type="button" className="matches-button" onClick={onRetry}>
          {RETRY_LABEL}
        </button>
        {children}
      </div>
    </div>
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
    <div className="matches-not-found">
      <h1 className="matches-heading">{MATCH_NOT_FOUND_HEADING}</h1>
      <p className="matches-notice" role="status" aria-live="polite">
        {MATCH_NOT_FOUND_STATEMENT}
      </p>
      <BackToSquadLink squadId={squadId} />
    </div>
  );
}
