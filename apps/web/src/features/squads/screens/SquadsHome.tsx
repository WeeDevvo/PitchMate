/**
 * The Squads_Home — the App_Shell's injected Home_Slot content: one Squad_Card
 * per squad the signed-in person belongs to, with the Create_Squad and
 * Join_Squad entry points beside them.
 *
 * Everything this screen renders was built before it, so it composes and decides
 * rather than implements. What it owns is exactly the three things no component
 * below it can:
 *
 * 1. **Which of the load states is rendered**, read from `useSquadsHome` — the
 *    one place a `ListMySquads` call is issued (Requirements 1.1, 1.10, 1.15,
 *    2.1, 2.5, 2.6).
 * 2. **Navigation**, through `useNavigate` and `squadPath` — a Squad_Card
 *    activation, and where a successful creation or redemption lands
 *    (Requirements 1.8, 3.6, 3.7, 4.6, 4.7).
 * 3. **Which fixed message a settled submission shows**, mapped from the
 *    `CallResult` kind and, for a rejection, its `RejectionReason`
 *    (Requirements 3.8, 3.9, 4.8, 4.9).
 *
 * ### The frame is the shell's, and the heading is this screen's
 *
 * Requirement 1.12 has this screen supplied as the Home_Slot content and
 * rendering **no shell chrome of its own**: no banner, no navigation, no
 * notification surface, and no landmark. The wrapper is therefore a plain
 * `<div>` rather than a named `<section>` — a named region would join the
 * landmark set the App_Shell frame owns, which is the same reason
 * {@link FormPanel} renders a named group rather than a `form` landmark.
 *
 * What it does own is exactly one `h1`, naming the squads listing (Requirement
 * 1.9). Every other heading on the screen belongs to an open Form_Panel, which
 * takes `h2` — one level down, so the outline skips nothing (Requirement 19.1).
 *
 * ### Both entry points, in every load state
 *
 * The two entry-point controls are rendered *outside* the load-state branch, so
 * "both are reachable while cards are rendered, while the empty state is
 * rendered, while a call is awaiting a response, and while the failure is
 * rendered" is a structural fact rather than four separate cases that could
 * drift apart (Requirements 2.2, 2.3, 2.5). Each is one native `<button>`,
 * keyboard-operable, named after the form it opens.
 *
 * At most one panel is open at a time: opening one closes the other. Both forms
 * are ordinary controls of one screen and neither is modal, so this is a tidiness
 * choice rather than a requirement — it also means one submission can be in
 * flight at a time, which is what makes the single-flight guard below a single
 * latch rather than one per operation.
 *
 * A closed Form_Panel renders nothing at all, so a form's entered values are
 * kept only while it stays open. That is deliberate on both sides: a *failed*
 * submission keeps the panel open and every value with it (Requirements 3.8,
 * 4.9), and a successful one closes it, which is also what stops the submitted
 * form being the rendered surface afterwards.
 *
 * ### What "reaching the created or joined squad" means today
 *
 * A successful `CreateSquad` carries a squad identity, so creation navigates
 * straight to that Squad_Route (Requirement 3.6). A redemption **does not**: the
 * backend's `RedeemInviteResult` carries only the membership and the outcome, and
 * the already-a-member no-op carries an empty body, so the parser yields a
 * Redemption with `squadId === null` and the Requirement 4.7 fallback —
 * navigate to the Squads_Home and issue exactly one further `ListMySquads` — is
 * the **normal** path rather than an edge case (design.md → contract realities).
 * The identity-bearing branch stays implemented because the parser reads a
 * `squadId` the backend may later add.
 *
 * Creation reaches that same fallback by a different route. `parseCreatedSquad`
 * *requires* a well-formed `squadId`, so a `2xx` response the parser cannot get
 * one from settles as `parse-failure` rather than as a success without an
 * identity. Requirement 3.7 describes precisely that case, and the transport seam
 * only ever produces `parse-failure` for a `2xx` response — the squad was
 * created — so it is treated as the fallback rather than as a failure that keeps
 * the form open. A redemption's `parse-failure`, by contrast, means a body that
 * *was* malformed rather than one that simply carried no identity, so it stays a
 * failure with its outcome message.
 *
 * ### Nothing of the backend's own wording reaches the screen
 *
 * Every string here comes from `lib/messages.ts`, and every message it holds
 * takes no interpolation parameter, so no squad name, status code, ProblemDetails
 * detail, or Invite_Secret has a seam to travel through (Requirements 4.10,
 * 17.2). The only backend-derived value this screen reads at all is the
 * `RejectionReason` — a name this feature declares — and it reads it solely to
 * pick which fixed message to show.
 *
 * ### Leaving the screen, and losing the session
 *
 * `useSquadsHome` aborts and discards its own `ListMySquads` call on unmount and
 * on an Auth_State transition to `unauthenticated` (Requirements 1.11, 17.5).
 * This screen does the same for the `CreateSquad` and `RedeemInvite` calls *it*
 * issues: one controller, aborted on both events, plus a token so a response
 * that arrives late changes nothing.
 *
 * Requirements: 1.2, 1.9, 1.12, 2.2, 2.3, 2.6, 3.5, 3.6, 3.7, 3.8, 3.9, 4.5,
 * 4.6, 4.7, 4.8, 4.9
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { useAuth } from '../../auth';
import type {
  CreateSquadRequest,
  RedeemInviteRequest,
  SquadsApi,
} from '../api/squadsApi';
import { CREATE_SQUAD_FORM_ID, CreateSquadForm } from '../components/CreateSquadForm';
import { FailureNotice } from '../components/FailureNotice';
import { JOIN_SQUAD_FORM_ID, JoinSquadForm } from '../components/JoinSquadForm';
import { LoadingIndication } from '../components/LoadingIndication';
import { SquadCard } from '../components/SquadCard';
import { SquadsEmptyState } from '../components/SquadsEmptyState';
import {
  CREATE_SQUAD_HEADING,
  DISPLAY_NAME_UNAVAILABLE,
  GENERIC_SQUADS_FAILURE,
  INVITE_UNUSABLE,
  JOIN_SQUAD_HEADING,
  SQUADS_HOME_HEADING,
  SQUADS_LOADING_LABEL,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import { squadPath } from '../lib/routePaths';
import { useSquadsHome } from '../state/useSquadsHome';

// The feature token table, so the screen resolves its own custom properties
// whether or not the App_Shell frame around it declared them. No colour value is
// written in either file (Requirement 18.9).
import '../styles/squadsTokens.css';
import './SquadsHome.css';

/**
 * The selector of the Squads_Home wrapper, so a test can scope a query to the
 * screen without depending on the shell frame that usually surrounds it.
 */
export const SQUADS_HOME_SELECTOR = '[data-squads-home="true"]';

/** The settled outcome of a `CreateSquad` call, as the Squads_Api reports it. */
type CreateSquadResult = Awaited<ReturnType<SquadsApi['createSquad']>>;

/** The settled outcome of a `RedeemInvite` call, as the Squads_Api reports it. */
type RedeemInviteResult = Awaited<ReturnType<SquadsApi['redeemInvite']>>;

/** Which of the two entry-point panels is open, if either. */
type OpenPanel = 'none' | 'create' | 'join';

/**
 * The fixed message for a `CreateSquad` outcome that neither created a reachable
 * squad nor reached the Requirement 3.7 fallback.
 *
 * `null` stands for a rejected promise — the Squads_Api settles every outcome
 * into a `CallResult`, so it is defence against a seam that throws rather than an
 * expected path.
 *
 * The only rejection given a message of its own is a display name the backend
 * would not take, because that is the one rejection this screen can state
 * usefully without repeating anything the backend said (Requirement 3.9).
 * Everything else — a rejected Squad_Name, a conflict, a lapsed
 * Squad_Call_Timeout, a transport failure, an ended session — is the one generic
 * message, which is what keeps a squad the caller cannot see indistinguishable
 * from a network that dropped (Requirements 3.8, 17.1).
 *
 * Requirements: 3.8, 3.9
 */
function createOutcomeMessage(result: CreateSquadResult | null): string {
  if (
    result !== null &&
    result.kind === 'rejected-input' &&
    result.reason === 'display-name-in-use'
  ) {
    return DISPLAY_NAME_UNAVAILABLE;
  }

  return GENERIC_SQUADS_FAILURE;
}

/**
 * The fixed message for a `RedeemInvite` outcome that joined no squad.
 *
 * Two rejections are named, and the rest are not:
 *
 * - **An invite that matches nothing, is revoked, or is expired** is one single
 *   message, identical for all three, so the response reveals nothing about
 *   which invites exist (Requirement 4.8). The backend answers all three with
 *   `410 InviteUnusable`, which the Squads_Api classifies as a rejection with the
 *   `invite-unusable` reason; `not-found` is folded in beside it because a `403`
 *   or `404` is the same non-disclosing answer about the same invite.
 * - **A rejected Player_Display_Name** states that the name cannot be used in
 *   that squad, with the form still rendered and re-submittable (Req 4.9).
 *
 * Everything else is the one generic message. No branch here takes the presented
 * Invite_Secret, and no message it can return has a parameter, so the secret
 * cannot travel out through an outcome (Requirement 4.10).
 *
 * Requirements: 4.8, 4.9, 4.10
 */
function joinOutcomeMessage(result: RedeemInviteResult | null): string {
  if (result === null) {
    return GENERIC_SQUADS_FAILURE;
  }

  if (result.kind === 'not-found') {
    return INVITE_UNUSABLE;
  }

  if (result.kind === 'rejected-input') {
    if (result.reason === 'invite-unusable') {
      return INVITE_UNUSABLE;
    }

    if (result.reason === 'display-name-in-use') {
      return DISPLAY_NAME_UNAVAILABLE;
    }
  }

  return GENERIC_SQUADS_FAILURE;
}

export interface SquadsHomeProps {
  /**
   * The Squads_Api facade — the feature's only transport seam, constructed by
   * `appRouter.tsx` from the Authenticated_Api_Client and handed in as a prop
   * (Requirement 16.2). This screen holds no client and builds none.
   */
  readonly api: SquadsApi;
}

/**
 * Render the Squads_Home.
 *
 * Requirements: 1.2, 1.9, 1.12, 2.2, 2.3, 2.6, 3.6, 3.7, 4.6, 4.7
 */
export function SquadsHome({ api }: SquadsHomeProps): ReactElement {
  const { state: authState } = useAuth();
  const navigate = useNavigate();
  const machine = useSquadsHome({ api, authState });

  const [openPanel, setOpenPanel] = useState<OpenPanel>('none');
  const [pending, setPending] = useState<OpenPanel>('none');
  const [createOutcome, setCreateOutcome] = useState<string | null>(null);
  const [joinOutcome, setJoinOutcome] = useState<string | null>(null);

  // The openers, so each Form_Panel can return focus to the control that opened
  // it rather than searching the DOM for something that looks like it
  // (Requirement 19.7).
  const createOpenerRef = useRef<HTMLButtonElement>(null);
  const joinOpenerRef = useRef<HTMLButtonElement>(null);

  /** The submission awaiting a response, so it can be aborted (Req 1.11, 17.5). */
  const controllerRef = useRef<AbortController | null>(null);
  /**
   * The token of the most recently issued submission. Abandoning bumps it, so a
   * response arriving after this screen was left, or after the session ended,
   * changes nothing at all — no navigation, and no outcome message.
   */
  const tokenRef = useRef(0);
  /** Which submission awaits a response, read without a render's delay. */
  const pendingRef = useRef<OpenPanel>('none');
  /** Closed by the unmount cleanup, so nothing is applied after it. */
  const leftRef = useRef(false);

  /**
   * Abandon the submission awaiting a response: abort it, and make its outcome —
   * and that of any earlier one — unacceptable.
   *
   * Idempotent, so the unmount cleanup and a lost session doing it in the same
   * tick do the work once.
   */
  const abandonSubmission = useCallback((): void => {
    tokenRef.current += 1;

    controllerRef.current?.abort();
    controllerRef.current = null;

    pendingRef.current = 'none';
  }, []);

  // 1.11, 17.5: the two triggers the requirement names — leaving the screen, and
  // the Auth_State ceasing to be `authenticated` — both abort the submission
  // awaiting a response and disregard its outcome, leaving the submit control
  // available again. Both are this effect's *cleanup*, which React runs on an
  // unmount and on a dependency change alike, so the two cases cannot fall out of
  // step. A mount that was never authenticated registers no cleanup, because it
  // has nothing in flight to abandon. The listing's own call is abandoned by
  // `useSquadsHome`, which owns it.
  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }

    return () => {
      abandonSubmission();
      setPending('none');
    };
  }, [abandonSubmission, authState]);

  // 1.11: the latch that makes every later outcome inapplicable. Closed only by
  // an unmount — a lost session returns the screen to a usable state rather than
  // to an inert one, and the Route_Guard is what decides whether it stays.
  useEffect(() => {
    return () => {
      leftRef.current = true;
    };
  }, []);

  /**
   * Claim the single submission slot, or refuse.
   *
   * Refusing is what makes a second concurrent `CreateSquad` or `RedeemInvite`
   * impossible (Requirements 3.5, 4.5). The Form_Panel also blocks a submission
   * while it reports `pending`; this is the half that holds even if a caller
   * without that discipline submitted twice in one tick.
   */
  const beginSubmission = useCallback(
    (kind: 'create' | 'join'): { controller: AbortController; token: number } | null => {
      if (leftRef.current || pendingRef.current !== 'none') {
        return null;
      }

      const token = tokenRef.current + 1;
      tokenRef.current = token;

      const controller = new AbortController();
      controllerRef.current = controller;

      pendingRef.current = kind;
      setPending(kind);

      return { controller, token };
    },
    [],
  );

  /**
   * Release the submission slot, and report whether this outcome is still the
   * one being awaited.
   *
   * `false` means the response belongs to an abandoned submission — the screen
   * was left, or the session ended — in which case nothing is applied.
   */
  const endSubmission = useCallback(
    (token: number, controller: AbortController): boolean => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }

      if (leftRef.current || token !== tokenRef.current) {
        return false;
      }

      pendingRef.current = 'none';
      setPending('none');

      return true;
    },
    [],
  );

  /** Close both panels and clear both outcome messages. */
  const closePanels = useCallback((): void => {
    setOpenPanel('none');
    setCreateOutcome(null);
    setJoinOutcome(null);
  }, []);

  /**
   * Open a squad's Squad_Screen.
   *
   * The one navigation seam a Squad_Card activation reaches (Requirement 1.8),
   * and where a creation or redemption carrying a squad identity lands
   * (Requirements 3.6, 4.6). The router's push adds exactly one history entry and
   * performs no full-document reload, because no `href` and no `location`
   * assignment is involved.
   */
  const openSquad = useCallback(
    (squadId: string): void => {
      navigate(squadPath(squadId));
    },
    [navigate],
  );

  /**
   * The fallback destination of a successful submission that yielded no squad
   * identity: the Squads_Home itself, plus exactly one further `ListMySquads` so
   * the new squad is listed without the person re-entering anything
   * (Requirements 3.7, 4.7).
   *
   * Navigating to a path already rendered remounts nothing, so the further call
   * has to be issued deliberately — `machine.retry()` is that one call, and it is
   * a consequence of a person's submission rather than of a re-render
   * (Requirement 17.4).
   */
  const reachHomeAndRelist = useCallback((): void => {
    closePanels();
    navigate(HOME_ROUTE);
    machine.retry();
  }, [closePanels, machine, navigate]);

  const handleCreateSubmit = useCallback(
    (command: CreateSquadRequest): void => {
      const started = beginSubmission('create');
      if (started === null) {
        return;
      }

      // A new attempt clears the previous attempt's outcome, so a message never
      // outlives the submission it was about.
      setCreateOutcome(null);

      const settle = (result: CreateSquadResult | null): void => {
        if (!endSubmission(started.token, started.controller)) {
          return;
        }

        // 3.6: straight to the created squad.
        if (result !== null && result.kind === 'success') {
          closePanels();
          openSquad(result.value.squadId);
          return;
        }

        // 3.7: a `2xx` the parser could get no squad identity from. The squad was
        // created, so this is a fallback to the listing rather than a failure.
        if (result !== null && result.kind === 'parse-failure') {
          reachHomeAndRelist();
          return;
        }

        // 3.8, 3.9: the form stays open with every entered value, and the outcome
        // is announced in its live region.
        setCreateOutcome(createOutcomeMessage(result));
      };

      void api
        .createSquad(command, started.controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [api, beginSubmission, closePanels, endSubmission, openSquad, reachHomeAndRelist],
  );

  const handleJoinSubmit = useCallback(
    (command: RedeemInviteRequest): void => {
      const started = beginSubmission('join');
      if (started === null) {
        return;
      }

      setJoinOutcome(null);

      const settle = (result: RedeemInviteResult | null): void => {
        if (!endSubmission(started.token, started.controller)) {
          return;
        }

        if (result !== null && result.kind === 'success') {
          const squadId = result.value.squadId;

          // 4.6 where the redemption carried an identity; 4.7 otherwise, which is
          // every redemption the backend performs today.
          if (squadId === null) {
            reachHomeAndRelist();
            return;
          }

          closePanels();
          openSquad(squadId);
          return;
        }

        // 4.8, 4.9: one message for an unusable invite whatever made it unusable,
        // and a distinct one for a display name the squad would not take.
        setJoinOutcome(joinOutcomeMessage(result));
      };

      void api
        .redeemInvite(command, started.controller.signal)
        .then(settle, () => {
          settle(null);
        });
    },
    [api, beginSubmission, closePanels, endSubmission, openSquad, reachHomeAndRelist],
  );

  /**
   * Open one panel, which closes the other, and clear the outcome of whatever was
   * open — an outcome message belongs to a submission, not to the screen.
   */
  const openCreatePanel = useCallback((): void => {
    setCreateOutcome(null);
    setJoinOutcome(null);
    setOpenPanel((current) => (current === 'create' ? 'none' : 'create'));
  }, []);

  const openJoinPanel = useCallback((): void => {
    setCreateOutcome(null);
    setJoinOutcome(null);
    setOpenPanel((current) => (current === 'join' ? 'none' : 'join'));
  }, []);

  const summaries = machine.summaries ?? [];

  /**
   * Exactly one of the load states, and never two.
   *
   * - `failed` — the generic failure and its retry control, and **no** card and
   *   **no** empty state (Requirement 2.5).
   * - `loading` — the busy indication alone, because no collection is held
   *   (Requirement 1.10).
   * - `refreshing` — the busy indication *and* the held cards (Requirement 1.15).
   * - `listed` — one Squad_Card per parsed Squad_Summary, already ordered by
   *   `orderSquadSummaries` inside the machine, or the Squads_Empty_State for an
   *   accepted empty collection (Requirements 1.2, 1.3, 2.1).
   * - `idle` — nothing has been requested yet: the tick before the mount effect
   *   runs, and a mount made while the Auth_State is `unauthenticated`, which
   *   issues no call at all (Requirement 1.13). Nothing is rendered from it —
   *   a busy indication would claim a call that was never made.
   */
  let loadState: ReactNode = null;

  if (machine.failed) {
    loadState = (
      <FailureNotice
        retryLabel={SQUADS_RETRY_LABEL}
        // 2.6: one activation, one further `ListMySquads`, and the failure is
        // replaced by the loading indication because the machine holds no
        // collection after a failure.
        onRetry={machine.retry}
        retryBusy={machine.busy}
      />
    );
  } else if (machine.phase === 'listed' && summaries.length === 0) {
    loadState = <SquadsEmptyState />;
  } else if (machine.busy || summaries.length > 0) {
    loadState = (
      <>
        {machine.busy ? <LoadingIndication label={SQUADS_LOADING_LABEL} /> : null}
        {summaries.length > 0 ? (
          <ul className="squads-home__cards">
            {summaries.map((summary) => (
              <li className="squads-home__card" key={summary.squadId}>
                <SquadCard summary={summary} onOpen={openSquad} />
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  return (
    <div className="squads-home" data-squads-home="true">
      {/* 1.9: the screen's one level-one heading. */}
      <h1 className="squads-home__heading">{SQUADS_HOME_HEADING}</h1>

      {/* 2.2, 2.3: both entry points, outside the load-state branch, so each is
          rendered as exactly one keyboard-operable control in every state. */}
      <div className="squads-home__entry-points">
        <button
          type="button"
          className="squads-home__entry-point"
          ref={createOpenerRef}
          aria-expanded={openPanel === 'create'}
          aria-controls={CREATE_SQUAD_FORM_ID}
          onClick={openCreatePanel}
        >
          {CREATE_SQUAD_HEADING}
        </button>
        <button
          type="button"
          className="squads-home__entry-point"
          ref={joinOpenerRef}
          aria-expanded={openPanel === 'join'}
          aria-controls={JOIN_SQUAD_FORM_ID}
          onClick={openJoinPanel}
        >
          {JOIN_SQUAD_HEADING}
        </button>
      </div>

      {/* 3.1, 3.5, 3.8: the panel sits under the screen's `h1`, so it takes `h2`.
          A closed panel renders nothing, which is what returns focus to its
          opener and keeps its fields out of the focus order. */}
      <CreateSquadForm
        open={openPanel === 'create'}
        openerRef={createOpenerRef}
        onSubmit={handleCreateSubmit}
        onClose={closePanels}
        pending={pending === 'create'}
        outcomeMessage={createOutcome}
        headingLevel={2}
      />

      {/* 4.1, 4.5, 4.9: likewise for the Join_Code_Form. */}
      <JoinSquadForm
        open={openPanel === 'join'}
        openerRef={joinOpenerRef}
        onSubmit={handleJoinSubmit}
        onClose={closePanels}
        pending={pending === 'join'}
        outcomeMessage={joinOutcome}
        headingLevel={2}
      />

      {loadState}
    </div>
  );
}

export default SquadsHome;
