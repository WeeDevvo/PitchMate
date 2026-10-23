/**
 * The admins' claim list machine: one `ListGuestClaims` read per mount and per
 * reload, and the one-time issuing of claim links.
 *
 * - **The list** is stored with the attempt it answered, so a reload keeps
 *   showing the rows already held until the new answer arrives, and an answer to
 *   a superseded attempt is never shown.
 * - **Issuing a link** is single-flight across the whole list (one link at a
 *   time), abandoned on unmount and on sign-out. A successful link is held for
 *   the one reveal and dropped when the reveal is dismissed or another link is
 *   issued, so the secret lives in this machine for as long as it's on screen
 *   and no longer. The list is re-read after each issue so the row shows its new
 *   expiry.
 *
 * Completing and undoing a claim run through `useMembershipAction` in the
 * component, because they have no value to keep.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { GuestClaimRow, IssuedClaimLink } from '../lib/parse/guestClaim';

/** A link just issued for one guest, held for its one reveal. */
export interface RevealedClaimLink {
  readonly membershipId: string;
  readonly link: IssuedClaimLink;
}

export interface GuestClaimsOptions {
  readonly api: SquadsApi;
  readonly squadId: string;
  readonly authState: AuthState;
}

export interface GuestClaimsMachine {
  /** The claim rows, or `null` while none has been read. */
  readonly claims: readonly GuestClaimRow[] | null;
  /** Whether the latest read failed. */
  readonly failed: boolean;
  /** Read the list again. */
  readonly reload: () => void;
  /** The guest a link is being issued for, or `null`. */
  readonly issuingFor: string | null;
  /** The guest whose last issue attempt failed, or `null`. */
  readonly issueFailedFor: string | null;
  /** The link to reveal, or `null`. */
  readonly revealed: RevealedClaimLink | null;
  /** Issue a link for a guest, unless one is already being issued. */
  readonly issue: (membershipId: string) => void;
  /** Drop the revealed link. */
  readonly dismissReveal: () => void;
}

interface Settled {
  readonly attempt: number;
  readonly result: CallResult<readonly GuestClaimRow[]>;
}

export function useGuestClaims({ api, squadId, authState }: GuestClaimsOptions): GuestClaimsMachine {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [held, setHeld] = useState<readonly GuestClaimRow[] | null>(null);
  const [issuingFor, setIssuingFor] = useState<string | null>(null);
  const [issueFailedFor, setIssueFailedFor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedClaimLink | null>(null);
  const issueControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }

    const controller = new AbortController();

    void api.listGuestClaims(squadId, controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      setSettled({ attempt, result });
      if (result.kind === 'success') {
        setHeld(result.value);
      }
    });

    return () => controller.abort();
  }, [api, attempt, authState, squadId]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  // Leaving the screen or signing out abandons an issue in flight and drops any
  // revealed link, so the secret doesn't outlive the surface that shows it.
  useEffect(() => {
    if (authState !== 'authenticated') {
      issueControllerRef.current?.abort();
      issueControllerRef.current = null;
    }
  }, [authState]);

  useEffect(
    () => () => {
      issueControllerRef.current?.abort();
      issueControllerRef.current = null;
    },
    [],
  );

  const issue = useCallback(
    (membershipId: string): void => {
      if (issueControllerRef.current !== null || authState !== 'authenticated') {
        return;
      }

      const controller = new AbortController();
      issueControllerRef.current = controller;
      setIssuingFor(membershipId);
      setIssueFailedFor(null);
      setRevealed(null);

      const settle = (result: CallResult<IssuedClaimLink> | null): void => {
        if (issueControllerRef.current !== controller) {
          return;
        }
        issueControllerRef.current = null;
        setIssuingFor(null);

        if (result !== null && result.kind === 'success') {
          setRevealed({ membershipId, link: result.value });
          reload();
        } else {
          setIssueFailedFor(membershipId);
        }
      };

      void api.issueClaimLink(squadId, membershipId, controller.signal).then(settle, () => settle(null));
    },
    [api, authState, reload, squadId],
  );

  const dismissReveal = useCallback(() => setRevealed(null), []);

  const current = settled !== null && settled.attempt === attempt ? settled.result : null;
  const signedIn = authState === 'authenticated';

  return {
    claims: signedIn ? held : null,
    failed: current !== null && current.kind !== 'success',
    reload,
    issuingFor,
    issueFailedFor,
    revealed: signedIn ? revealed : null,
    issue,
    dismissReveal,
  };
}
