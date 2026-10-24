/**
 * The Claim_Landing_Route's machine: for a signed-in player and a readable
 * secret, one `PreviewGuestClaim` call (per secret and per retry), then at most
 * one `AcceptGuestClaim` call per activation.
 *
 * Every rejection, and a concealed not-found, is the one `unusable` phase: the
 * backend answers every unusable link, and a player who already belongs to the
 * squad, the same way, so the page has nothing finer to say. A transport
 * failure, a timeout or an unreadable body is `failed`, with a retry. A secret
 * is sent in request bodies only, and this machine keeps no copy of it beyond
 * the value it was handed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AuthState } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { AcceptedGuestClaim, GuestClaimPreview } from '../lib/parse/guestClaim';

export type ClaimAcceptancePhase =
  | 'signed-out'
  | 'previewing'
  | 'ready'
  | 'accepting'
  | 'accepted'
  | 'unusable'
  | 'failed';

export interface ClaimAcceptanceMachine {
  readonly phase: ClaimAcceptancePhase;
  /** What the link is for, once previewed. */
  readonly preview: GuestClaimPreview | null;
  /** The squad named after accepting. */
  readonly accepted: AcceptedGuestClaim | null;
  /** Accept the link; a no-op unless the phase is `ready`. */
  readonly accept: () => void;
  /** Read the link again after a failure. */
  readonly retry: () => void;
}

/** The phase a failed call settles the page in. */
function failurePhase(result: CallResult<unknown>): 'unusable' | 'failed' {
  return result.kind === 'rejected-input' || result.kind === 'not-found' ? 'unusable' : 'failed';
}

export function useClaimAcceptance(
  api: SquadsApi,
  secret: string,
  authState: AuthState,
): ClaimAcceptanceMachine {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<ClaimAcceptancePhase>('previewing');
  const [preview, setPreview] = useState<GuestClaimPreview | null>(null);
  const [accepted, setAccepted] = useState<AcceptedGuestClaim | null>(null);
  const acceptControllerRef = useRef<AbortController | null>(null);
  const signedIn = authState === 'authenticated';

  useEffect(() => {
    if (!signedIn) {
      return undefined;
    }

    const controller = new AbortController();

    void api.previewGuestClaim(secret, controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.kind === 'success') {
        setPreview(result.value);
        setPhase('ready');
      } else {
        setPhase(failurePhase(result));
      }
    });

    return () => controller.abort();
  }, [api, attempt, secret, signedIn]);

  useEffect(
    () => () => {
      acceptControllerRef.current?.abort();
      acceptControllerRef.current = null;
    },
    [],
  );

  const accept = useCallback((): void => {
    if (phase !== 'ready' || acceptControllerRef.current !== null || !signedIn) {
      return;
    }

    const controller = new AbortController();
    acceptControllerRef.current = controller;
    setPhase('accepting');

    const settle = (result: CallResult<AcceptedGuestClaim> | null): void => {
      if (acceptControllerRef.current !== controller) {
        return;
      }
      acceptControllerRef.current = null;

      if (result !== null && result.kind === 'success') {
        setAccepted(result.value);
        setPhase('accepted');
      } else {
        setPhase(result === null ? 'failed' : failurePhase(result));
      }
    };

    void api.acceptGuestClaim(secret, controller.signal).then(settle, () => settle(null));
  }, [api, phase, secret, signedIn]);

  const retry = useCallback((): void => {
    setPhase('previewing');
    setAttempt((current) => current + 1);
  }, []);

  return {
    phase: signedIn ? phase : 'signed-out',
    preview,
    accepted,
    accept,
    retry,
  };
}
