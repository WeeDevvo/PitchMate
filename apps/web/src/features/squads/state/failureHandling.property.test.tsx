/**
 * Property test for the one failure surface every Squads_Api call collapses to
 * (task 7.9).
 *
 * **Property 40: Every failed call presents one generic outcome, retains state,
 * and waits for a person.** *For any* Squads_Api call and any of a transport
 * failure, a timeout, and a parse failure: the rendered user-facing message is
 * the single {@link GENERIC_SQUADS_FAILURE}, that message names no squad, no
 * membership, and no invite, the value the surface last accepted is rendered
 * unchanged, a manual retry or re-submittable control is rendered, and **no
 * further call for that operation is issued until that control is activated**.
 *
 * ### Every operation, one at a time, exhaustively
 *
 * The operations are not sampled. Each generated case drives **every** entry in
 * {@link OPERATIONS} — the two reads of the Squads_Home and the Squad_Screen, the
 * two submissions of the Squads_Home's forms, the redemption of the
 * Invite_Landing_Route, the three invite operations, the two guest operations,
 * the promotion, and the feature change — so a run that passes has passed for all
 * of them at that failure arm and that fixture, rather than for a randomly chosen
 * subset. What is generated is the failure arm, the fixture values the surfaces
 * hold, and how many microtask ticks each call takes to settle.
 *
 * ### Three arms, and why exactly these three
 *
 * `transport-failure`, `timeout`, and `parse-failure` are the three
 * Requirement 17.1 names, and they are indistinguishable by design: the
 * assertions below are written over all three at once, so a surface that told
 * them apart would fail on the arm it treated differently. `not-found` and
 * `auth-failure` are deliberately **not** among them — the first is its own
 * non-disclosing presentation (Requirement 6.4, Property 13) and the second is
 * the Auth_Feature's outcome to own (Requirement 17.6).
 *
 * ### Two operations present no failure message at all, deliberately
 *
 * - **`GetSquadLeaderboard`** (Requirement 7.10). A leaderboard that does not
 *   arrive costs the rows their rating and nothing else, so the screen renders no
 *   Generic_Squads_Failure and no Not_Found_Treatment. What Property 40 still
 *   claims of it is the rest: the Player_List the successful `GetSquad` produced
 *   is rendered unchanged, and no further leaderboard call is issued until a
 *   person asks for one.
 * - **`PreviewInvite`** (Requirement 5.6). A failed preview is not a dead end:
 *   the route renders the fixed handover instruction and keeps the sign-up and
 *   log-in controls, which is what a person acts on instead of a retry. Its
 *   claim here is that nothing is re-issued at all.
 *
 * `GetFeatureFlags` is the one operation with no case of its own: it is a
 * fallback read reached only where no `refresh` seam was supplied, Requirement
 * 14.7 gives it no surface and no control, and a read that yields nothing leaves
 * the last backend-supplied collection rendering. Its non-disclosure is carried
 * by Property 41 beside it.
 *
 * ### What "waits for a person" is asserted as
 *
 * After the failure settles, the run is left **idle** — every pending microtask
 * drained plus a macrotask turn — and the operation's call count is asserted
 * unchanged. Only then is the manual control activated, and only then does a
 * second call appear. That is the shape of Requirement 17.4: nothing re-issues
 * itself, and one activation yields exactly one call.
 *
 * Every seam is injected, so no transport, no `fetch`, and no clock is involved:
 * the fake Squads_Api answers with {@link CallResult} values directly, and a
 * method no case reaches throws rather than answering. The 10-second
 * Squad_Call_Timeout belongs to `api/squadsApi.ts` and is tested beside it, so a
 * timeout is modelled as the `CallResult` arm rather than by advancing a clock.
 *
 * Feature: web-squads-screens, Property 40: Every failed call presents one generic outcome, retains state, and waits for a person
 * Validates: Requirements 2.5, 6.7, 7.10, 11.12, 12.12, 13.7, 17.1, 17.4
 */
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import {
  CREATE_SQUAD_FORM_ID,
  CREATE_SQUAD_OUTCOME_REGION_ID,
} from '../components/CreateSquadForm';
import { FailureNotice } from '../components/FailureNotice';
import {
  JOIN_SQUAD_FORM_ID,
  JOIN_SQUAD_OUTCOME_REGION_ID,
} from '../components/JoinSquadForm';
import type { FeatureFlag } from '../lib/parse/featureFlags';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import type { DisplayRatingLeaderboard } from '../lib/parse/leaderboard';
import type { SquadDetail, SquadMember } from '../lib/parse/squadDetail';
import type { SquadSummary } from '../lib/parse/squadSummary';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  GENERIC_SQUADS_FAILURE,
  INVITE_SECRET_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUAD_NAME_LABEL,
  SQUADS_RETRY_LABEL,
} from '../lib/messages';
import { inviteLandingPath } from '../lib/routePaths';
import { DO_NOT_SEED_TIER, LEAVE_TIER_UNCHANGED } from '../lib/skillTier';
import { SquadsHome } from '../screens/SquadsHome';
import { useFeatureToggles } from './useFeatureToggles';
import { useGuestManager } from './useGuestManager';
import { useInviteManager } from './useInviteManager';
import { useInviteRedemption } from './useInviteRedemption';
import { usePromotion } from './usePromotion';
import { useSquadScreen } from './useSquadScreen';
import { useSquadsHome } from './useSquadsHome';

// --- The three failure arms --------------------------------------------------

/** The three arms Requirement 17.1 names, which no surface may tell apart. */
type FailureArm = 'transport-failure' | 'timeout' | 'parse-failure';

const FAILURE_ARMS: readonly FailureArm[] = [
  'transport-failure',
  'timeout',
  'parse-failure',
];

const failureArmArb = fc.constantFrom(...FAILURE_ARMS);

/** The failing outcome of one settled call, carrying nothing but its arm. */
function failure(arm: FailureArm): CallResult<never> {
  return { kind: arm };
}

/** A successful outcome carrying one parsed value. */
function success<T>(value: T): CallResult<T> {
  return { kind: 'success', value };
}

// --- The fake Squads_Api ----------------------------------------------------

/** Every method of the seam, so each case can count and answer by name. */
type MethodName = keyof SquadsApi;

/**
 * What the fake answers for one method: a settled outcome, or nothing at all.
 *
 * A method with no answer configured **throws**, which is what makes each case's
 * call claim total: the property does not merely count the operation under test,
 * it fails outright if a machine reaches for an operation the case did not set up.
 */
type Answer = CallResult<unknown> | 'never-settles';

/** The fake seam, its per-method counters, and its configurable answers. */
interface Transport {
  readonly api: SquadsApi;
  /** How many requests one method has received so far. */
  count(method: MethodName): number;
  /** The answer each method gives next, changed freely between activations. */
  readonly answers: Map<MethodName, Answer>;
}

/** Settle with `result` after `ticks` microtasks, so concurrent calls interleave. */
async function settleAfter<T>(ticks: number, result: T): Promise<T> {
  for (let tick = 0; tick < ticks; tick += 1) {
    await Promise.resolve();
  }

  return result;
}

/**
 * A Squads_Api that counts every request, answers from {@link Transport.answers},
 * and refuses anything a case did not configure.
 *
 * No transport, no `fetch`, no generated client, and no timer: this property is
 * about what a machine does with a settled outcome, not about how one is
 * produced.
 */
function createTransport(ticks: number): Transport {
  const counts = new Map<MethodName, number>();
  const answers = new Map<MethodName, Answer>();

  /**
   * Record one request for `method` and answer it.
   *
   * Typed as `CallResult<never>`, which is assignable to every method's own
   * `CallResult<T>` — the one place the fake's loose answers meet the seam's
   * fourteen value types, so no call site needs a cast of its own.
   */
  const respond = (method: MethodName): Promise<CallResult<never>> => {
    counts.set(method, (counts.get(method) ?? 0) + 1);

    const answer = answers.get(method);
    if (answer === undefined) {
      throw new Error(`no case of Property 40 issues ${method}`);
    }

    if (answer === 'never-settles') {
      return new Promise<CallResult<never>>(() => {});
    }

    return settleAfter(ticks, answer as CallResult<never>);
  };

  const api: SquadsApi = {
    listMySquads: () => respond('listMySquads'),
    getSquad: () => respond('getSquad'),
    getDisplayRatingLeaderboard: () => respond('getDisplayRatingLeaderboard'),
    createSquad: () => respond('createSquad'),
    redeemInvite: () => respond('redeemInvite'),
    previewInvite: () => respond('previewInvite'),
    listInvites: () => respond('listInvites'),
    generateInvite: () => respond('generateInvite'),
    revokeInvite: () => respond('revokeInvite'),
    createGuest: () => respond('createGuest'),
    editGuest: () => respond('editGuest'),
    promoteToAdmin: () => respond('promoteToAdmin'),
    getFeatureFlags: () => respond('getFeatureFlags'),
    setFeatureFlag: () => respond('setFeatureFlag'),
  };

  return { api, count: (method) => counts.get(method) ?? 0, answers };
}

// --- Flushing ---------------------------------------------------------------

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 16; round += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * Let the machine be **idle**: every pending microtask drained *and* a macrotask
 * turn taken.
 *
 * This is what makes "no further call until a person asks" a claim rather than a
 * coincidence of timing — a retry scheduled on a timer, a promise chain, or a
 * microtask would have run by the time this returns (Requirement 17.4).
 */
async function idle(): Promise<void> {
  await flush();
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await flush();
}

// --- The generic failure surface, as every failing screen renders it ---------

/**
 * The Generic_Squads_Failure surface, rendered exactly as the screens render it:
 * {@link FailureNotice}, which holds the one fixed message in a live region and
 * the one manual retry control beside it.
 *
 * Rendered from the machine's own failure flag rather than from the case's
 * expectation, so a machine that failed to reach its failure phase renders no
 * message and fails the property.
 */
function GenericFailureSurface({
  shown,
  onRetry,
}: {
  readonly shown: boolean;
  readonly onRetry: () => void;
}): ReactElement | null {
  return shown ? (
    <FailureNotice retryLabel={SQUADS_RETRY_LABEL} onRetry={onRetry} />
  ) : null;
}

/** The message text of a live region, or `null` when it holds none. */
function liveRegionMessage(region: HTMLElement | null): string | null {
  const text = region?.textContent?.trim() ?? '';
  return text.length === 0 ? null : text;
}

/** Whether an element announces its content without keyboard focus moving to it. */
function announcesLive(region: HTMLElement | null): boolean {
  if (region === null) {
    return false;
  }

  const role = region.getAttribute('role');
  const live = region.getAttribute('aria-live');

  return (role === 'status' || role === 'alert') && live !== null;
}

/** What a settled failure left on screen, and what can still be done about it. */
interface Settled {
  /** The user-facing message the surface shows, or `null` when it shows none. */
  readonly message: string | null;
  /** Whether that message sits in a region with a determinable live status. */
  readonly announcedLive: boolean;
  /** Whether the value the surface last accepted is held unchanged. */
  readonly retainedUnchanged: boolean;
  /** Whether a manual retry or re-submittable control is rendered and usable. */
  readonly manualControlAvailable: boolean;
  /** How many calls of the failing operation have been issued since setup. */
  calls(): number;
  /** Activate the manual control — a person's act, and the only one. */
  activate(): void;
}

/**
 * Render the Generic_Squads_Failure surface for a machine that reports failure,
 * and read what a person now sees and can do.
 *
 * The returned `activate` clicks the retry control where one is rendered, and
 * falls back to the machine's own action where the surface renders no control —
 * which is how the leaderboard's re-read, a person's act with no failure surface
 * of its own, is still exercised.
 */
function observeGenericFailure(
  shown: boolean,
  action: () => void,
): Pick<
  Settled,
  'message' | 'announcedLive' | 'manualControlAvailable' | 'activate'
> {
  render(<GenericFailureSurface shown={shown} onRetry={action} />);

  const region = screen.queryByRole('status');
  const control = screen.queryByRole('button', { name: SQUADS_RETRY_LABEL });

  return {
    message: liveRegionMessage(region),
    announcedLive: announcesLive(region),
    manualControlAvailable:
      control !== null && control.getAttribute('aria-disabled') !== 'true',
    activate: () => {
      if (control === null) {
        action();
        return;
      }

      fireEvent.click(control);
    },
  };
}

// --- Fixtures ---------------------------------------------------------------

/**
 * The values the surfaces hold while the failure lands, generated per run.
 *
 * The identities are what the non-disclosure half of the property is checked
 * against: a UUID and a URL-safe secret cannot occur inside fixed copy by
 * accident, so asserting the rendered message contains none of them is a real
 * check that the message names no squad, no membership, and no invite.
 */
interface Fixture {
  readonly squadId: string;
  readonly membershipId: string;
  readonly inviteId: string;
  readonly inviteSecret: string;
  readonly squadName: string;
  readonly memberName: string;
  readonly summaries: readonly SquadSummary[];
  readonly detail: SquadDetail;
  readonly leaderboard: DisplayRatingLeaderboard;
  readonly invites: readonly InviteSummary[];
}

const SECRET_CHARACTERS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_'.split('');

const inviteSecretArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...SECRET_CHARACTERS), { minLength: 8, maxLength: 24 })
  .map((characters) => characters.join(''));

/** A Player_Display_Name, including the shapes the requirements name. */
const nameArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'Dave',
      'dave',
      'Big Dave',
      'Former player',
      '🙈 keeper',
    ),
  },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 20 }) },
);

/**
 * A name a person could actually submit: non-blank after trimming and within the
 * backend's column.
 *
 * The forms validate before they call (Requirement 3.3), so a whitespace-only or
 * over-long value would issue no call at all — a different property (Property 5,
 * beside `lib/nameValidation.ts`) and not this one. The leading character is
 * always non-blank by construction, so every generated value submits.
 */
const submittableNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('T', 'd', 'Big ', 'Ω', '🙈'),
    fc.string({ maxLength: 18 }),
  )
  .map(([head, rest]) => `${head}${rest}`);

/** The one Feature_Flag the Enum_Code_Map names, switched either way. */
const featuresArb: fc.Arbitrary<readonly FeatureFlag[]> = fc
  .boolean()
  .map((isEnabled) => [{ feature: 'live-match-tracking', isEnabled }] as const);

const fixtureArb: fc.Arbitrary<Fixture> = fc
  .record({
    squadId: fc.uuid(),
    membershipId: fc.uuid(),
    otherMembershipId: fc.uuid(),
    inviteId: fc.uuid(),
    inviteSecret: inviteSecretArb,
    // The two values a form case types in, so every generated run submits.
    squadName: submittableNameArb,
    memberName: submittableNameArb,
    // The parsed collections carry arbitrary display names, blank ones included.
    otherMemberName: nameArb,
    role: fc.constantFrom('owner' as const, 'admin' as const, 'member' as const),
    state: fc.constantFrom('active' as const, 'inactive' as const),
    features: featuresArb,
    ratingValue: fc.integer({ min: -2000, max: 3000 }),
    createdAtMs: fc.integer({ min: 0, max: 4_000_000_000_000 }),
  })
  .map((raw) => {
    const members: readonly SquadMember[] = [
      {
        membershipId: raw.membershipId,
        displayName: raw.memberName,
        role: raw.role,
        state: raw.state,
        isGuest: false,
      },
      {
        membershipId: raw.otherMembershipId,
        displayName: raw.otherMemberName,
        role: null,
        state: 'active',
        isGuest: true,
      },
    ];

    return {
      squadId: raw.squadId,
      membershipId: raw.membershipId,
      inviteId: raw.inviteId,
      inviteSecret: raw.inviteSecret,
      squadName: raw.squadName,
      memberName: raw.memberName,
      summaries: [
        {
          squadId: raw.squadId,
          name: raw.squadName,
          role: raw.role,
          state: raw.state,
        },
      ],
      detail: {
        squadId: raw.squadId,
        name: raw.squadName,
        members,
        features: raw.features,
      },
      leaderboard: {
        entries: [
          {
            membershipId: raw.membershipId,
            displayName: raw.memberName,
            value: raw.ratingValue,
          },
        ],
      },
      invites: [
        {
          inviteId: raw.inviteId,
          state: 'active' as const,
          createdAtMs: raw.createdAtMs,
          createdBy: null,
          expiresAtMs: null,
        },
      ],
    };
  });

/** How many microtask ticks a fake call waits before settling. */
const settleTicksArb: fc.Arbitrary<number> = fc.integer({ min: 0, max: 3 });

// --- The Squads_Home screen's two submissions -------------------------------

/**
 * A `SessionManager` reporting `authenticated` — the only Auth_State in which the
 * Squads_Home submits anything at all. `AuthProvider` reads `getState()` and
 * `subscribe()`, and no case here moves the session, so the rest is inert.
 */
function sessionManager(): SessionManager {
  return {
    bootstrap: () => 'authenticated',
    establish: () => undefined,
    getState: () => 'authenticated',
    getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
    signOut: () => Promise.resolve(),
    subscribe: () => () => undefined,
  };
}

/**
 * Render the real Squads_Home over the fake seam.
 *
 * The real `MemoryRouter` and `AuthProvider` are supplied because the screen
 * calls `useNavigate()` and `useAuth()`; nothing else is stubbed, so the form,
 * its live region, and its submit control are the production ones.
 */
async function renderSquadsHome(api: SquadsApi): Promise<void> {
  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );

  await flush();
}

/** Set a form field's value the way a person entering it does. */
function enter(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Whether an entered value survived the failure, still in its own field. */
function fieldHolds(label: string, value: string): boolean {
  const field = screen.getByLabelText(label);
  return field instanceof HTMLInputElement && field.value === value;
}

/** Whether a submit control is rendered and available for a further submission. */
function submitAvailable(label: string): boolean {
  const control = screen.queryByRole('button', { name: label });

  return (
    control instanceof HTMLButtonElement &&
    !control.disabled &&
    control.getAttribute('aria-disabled') !== 'true'
  );
}

// --- The operations ---------------------------------------------------------

/**
 * One operation of the feature, with what Property 40 expects of its surface.
 *
 * `expectedMessage` is `null` for the two operations the requirements
 * deliberately give no failure message — see the module note — and
 * {@link GENERIC_SQUADS_FAILURE} for every other.
 */
interface OperationCase {
  /** The operation, named as the requirements name it. */
  readonly name: string;
  /** The seam method whose call count the "waits for a person" claim is about. */
  readonly method: MethodName;
  /**
   * The arms this operation is held to, where fewer than all three apply.
   *
   * One operation needs this. A `parse-failure` on **`CreateSquad`** is not a
   * failure at all: the transport seam produces it only for a `2xx`, so the squad
   * *was* created and the body simply carried no identity the parser could read,
   * which is precisely Requirement 3.7's fallback — navigate to the Squads_Home
   * and issue one further `ListMySquads`. That path is claimed by Property 7
   * (task 7.6), so it is excluded here rather than asserted as a failure.
   */
  readonly arms?: readonly FailureArm[];
  /** The message the surface must show, or `null` where it shows none. */
  readonly expectedMessage: string | null;
  /** Whether a manual retry or re-submittable control must be rendered. */
  readonly manualControl: boolean;
  /** Whether activating that control owes exactly one further call. */
  readonly activationIssuesCall: boolean;
  /** Drive the operation to its failure and report what the surface shows. */
  run(
    arm: FailureArm,
    fixture: Fixture,
    ticks: number,
  ): Promise<Settled> | Settled;
}

const OPERATIONS: readonly OperationCase[] = [
  {
    // 2.5, 2.6: the listing failed, so the failure surface renders — with no
    // Squad_Card and no Squads_Empty_State behind it — and its retry control
    // issues exactly one further `ListMySquads`.
    name: 'ListMySquads on the Squads_Home',
    method: 'listMySquads',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, _fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listMySquads', failure(arm));

      const view = renderHook(() => useSquadsHome({ api: transport.api }));
      await flush();

      const machine = (): ReturnType<typeof useSquadsHome> =>
        view.result.current;

      return {
        ...observeGenericFailure(machine().failed, () => {
          machine().retry();
        }),
        // 2.5: the failure surface renders no Squad_Card, so nothing is held —
        // which is exactly what "the value it last accepted" amounts to here,
        // because it accepted none.
        retainedUnchanged: machine().summaries === null,
        calls: () => transport.count('listMySquads'),
      };
    },
  },
  {
    // 6.7: the Generic_Squads_Failure and a retry control, and **never** the
    // Not_Found_Treatment, however the call failed.
    name: 'GetSquad on the Squad_Screen',
    method: 'getSquad',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('getSquad', failure(arm));
      transport.answers.set(
        'getDisplayRatingLeaderboard',
        success(fixture.leaderboard),
      );

      const view = renderHook(() =>
        useSquadScreen({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useSquadScreen> =>
        view.result.current;

      return {
        ...observeGenericFailure(machine().failed, () => {
          machine().retry();
        }),
        // 6.7, 7.11: no partially populated Squad_Detail, no Player_Row, and no
        // Not_Found_Treatment — a failure is not evidence about existence.
        retainedUnchanged:
          machine().detail === null &&
          machine().players.length === 0 &&
          !machine().notFound,
        calls: () => transport.count('getSquad'),
      };
    },
  },
  {
    // 7.10: the one operation whose failure is not the screen's. The Player_List
    // the successful `GetSquad` produced keeps rendering, every row reading
    // Rating_Unavailable, and no further leaderboard call is issued until asked.
    name: 'GetSquadLeaderboard beside a successful GetSquad',
    method: 'getDisplayRatingLeaderboard',
    expectedMessage: null,
    manualControl: false,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('getSquad', success(fixture.detail));
      transport.answers.set('getDisplayRatingLeaderboard', failure(arm));

      const view = renderHook(() =>
        useSquadScreen({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useSquadScreen> =>
        view.result.current;

      return {
        // The surface is asked for a failure it must not show: `failed` is
        // false, so `FailureNotice` renders nothing at all.
        ...observeGenericFailure(machine().failed, () => {
          machine().retry();
        }),
        // 7.10: the rows are still there, and every one of them carries no
        // leaderboard entry — which is what the Rating_Unavailable label reads.
        retainedUnchanged:
          machine().detail === fixture.detail &&
          machine().players.length === fixture.detail.members.length &&
          machine().players.every((row) => !row.leaderboardObtained) &&
          !machine().failed &&
          !machine().notFound,
        calls: () => transport.count('getDisplayRatingLeaderboard'),
      };
    },
  },
  {
    // 3.8: the Create_Squad_Form stays rendered with every entered value, the
    // outcome is announced in its live region, and the submit control is
    // available for a further submission.
    name: 'CreateSquad from the Create_Squad_Form',
    method: 'createSquad',
    arms: ['transport-failure', 'timeout'],
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listMySquads', success(fixture.summaries));
      transport.answers.set('createSquad', failure(arm));

      await renderSquadsHome(transport.api);

      fireEvent.click(
        screen.getByRole('button', { name: CREATE_SQUAD_HEADING }),
      );
      enter(SQUAD_NAME_LABEL, fixture.squadName);
      enter(CREATOR_DISPLAY_NAME_LABEL, fixture.memberName);
      fireEvent.click(
        screen.getByRole('button', { name: CREATE_SQUAD_SUBMIT_LABEL }),
      );
      await flush();

      const region = document.getElementById(CREATE_SQUAD_OUTCOME_REGION_ID);

      return {
        message: liveRegionMessage(region),
        announcedLive: announcesLive(region),
        // 3.8: the form is still there, and it still holds what was typed.
        retainedUnchanged:
          document.getElementById(CREATE_SQUAD_FORM_ID) !== null &&
          fieldHolds(SQUAD_NAME_LABEL, fixture.squadName) &&
          fieldHolds(CREATOR_DISPLAY_NAME_LABEL, fixture.memberName),
        manualControlAvailable: submitAvailable(CREATE_SQUAD_SUBMIT_LABEL),
        calls: () => transport.count('createSquad'),
        activate: () => {
          fireEvent.click(
            screen.getByRole('button', { name: CREATE_SQUAD_SUBMIT_LABEL }),
          );
        },
      };
    },
  },
  {
    // 4.9, 4.10: likewise for the Join_Code_Form — and the presented
    // Invite_Secret is in no message, which the assertions below check against
    // the generated secret itself.
    name: 'RedeemInvite from the Join_Code_Form',
    method: 'redeemInvite',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listMySquads', success(fixture.summaries));
      transport.answers.set('redeemInvite', failure(arm));

      await renderSquadsHome(transport.api);

      fireEvent.click(screen.getByRole('button', { name: JOIN_SQUAD_HEADING }));
      enter(INVITE_SECRET_LABEL, fixture.inviteSecret);
      fireEvent.click(
        screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }),
      );
      await flush();

      const region = document.getElementById(JOIN_SQUAD_OUTCOME_REGION_ID);

      return {
        message: liveRegionMessage(region),
        announcedLive: announcesLive(region),
        retainedUnchanged:
          document.getElementById(JOIN_SQUAD_FORM_ID) !== null &&
          fieldHolds(INVITE_SECRET_LABEL, fixture.inviteSecret),
        manualControlAvailable: submitAvailable(JOIN_SQUAD_SUBMIT_LABEL),
        calls: () => transport.count('redeemInvite'),
        activate: () => {
          fireEvent.click(
            screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }),
          );
        },
      };
    },
  },
  {
    // 5.13: the landing route's redemption failed, so the Generic_Squads_Failure
    // and a retry control — and the retry issues exactly one further
    // `RedeemInvite` for the same secret, past the at-most-once latch, because a
    // person activating a control is neither a re-render nor a transition.
    name: 'RedeemInvite on the Invite_Landing_Route',
    method: 'redeemInvite',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('redeemInvite', failure(arm));

      const navigations: string[] = [];
      const view = renderHook(() =>
        useInviteRedemption({
          api: transport.api,
          path: inviteLandingPath(fixture.inviteSecret),
          navigate: (path) => {
            navigations.push(path);
          },
          authState: 'authenticated',
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteRedemption> =>
        view.result.current;

      return {
        ...observeGenericFailure(machine().failed, () => {
          machine().retry();
        }),
        // 5.13: the route stays where it is. A failure navigates nowhere, so the
        // secret-bearing path is still the rendered one and the retry has
        // something to retry.
        retainedUnchanged: navigations.length === 0 && !machine().unusable,
        calls: () => transport.count('redeemInvite'),
      };
    },
  },
  {
    // 5.6: the one read whose failure is answered by the handover surface rather
    // than by a failure message. Nothing is re-issued at all.
    name: 'PreviewInvite on the Invite_Landing_Route',
    method: 'previewInvite',
    expectedMessage: null,
    manualControl: false,
    activationIssuesCall: false,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('previewInvite', failure(arm));

      const view = renderHook(() =>
        useInviteRedemption({
          api: transport.api,
          path: inviteLandingPath(fixture.inviteSecret),
          navigate: () => undefined,
          authState: 'unauthenticated',
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteRedemption> =>
        view.result.current;

      return {
        ...observeGenericFailure(machine().failed, () => {
          machine().retry();
        }),
        // 5.6: the handover surface, with the fixed instruction standing in for
        // the one the preview did not supply — `instruction: null` is exactly
        // that, and it is never set from a failing call.
        retainedUnchanged:
          machine().handover &&
          machine().instruction === null &&
          !machine().busy,
        calls: () => transport.count('previewInvite'),
      };
    },
  },
  {
    // 11.12: the first `ListInvites` had nothing to keep, so the failure surface
    // renders with a retry control.
    name: 'ListInvites on its first load',
    method: 'listInvites',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listInvites', failure(arm));

      const view = renderHook(() =>
        useInviteManager({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteManager> =>
        view.result.current;

      return {
        ...observeGenericFailure(machine().listPhase === 'failed', () => {
          machine().retry();
        }),
        retainedUnchanged:
          machine().invites === null && machine().failure === 'list',
        calls: () => transport.count('listInvites'),
      };
    },
  },
  {
    // 11.12 in its sharp form: a *refresh* that failed leaves the listing last
    // accepted rendering unchanged, and the failure is reported beside it.
    name: 'ListInvites refreshing over a held listing',
    method: 'listInvites',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listInvites', success(fixture.invites));

      const view = renderHook(() =>
        useInviteManager({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteManager> =>
        view.result.current;
      const accepted = machine().invites;
      const baseline = transport.count('listInvites');

      transport.answers.set('listInvites', failure(arm));
      act(() => {
        machine().retry();
      });
      await flush();

      return {
        ...observeGenericFailure(machine().failure === 'list', () => {
          machine().retry();
        }),
        // The very same accepted collection, by identity: nothing re-ordered it
        // and nothing replaced it.
        retainedUnchanged:
          machine().invites === accepted &&
          accepted !== null &&
          machine().listPhase === 'listed',
        calls: () => transport.count('listInvites') - baseline,
      };
    },
  },
  {
    // 11.12: a failed generate leaves the listing alone, reveals nothing, and
    // makes the control available for a further attempt.
    name: 'GenerateInvite in the Invite_Manager',
    method: 'generateInvite',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listInvites', success(fixture.invites));
      transport.answers.set('generateInvite', failure(arm));

      const view = renderHook(() =>
        useInviteManager({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteManager> =>
        view.result.current;
      const accepted = machine().invites;

      act(() => {
        machine().generate({ nonExpiring: true });
      });
      await flush();

      return {
        ...observeGenericFailure(machine().failure === 'generate', () => {
          machine().generate({ nonExpiring: true });
        }),
        // 11.7: no reveal from a call that generated nothing, and the held
        // listing untouched.
        retainedUnchanged:
          machine().invites === accepted &&
          machine().reveal === null &&
          !machine().generating,
        calls: () => transport.count('generateInvite'),
      };
    },
  },
  {
    // 11.12: a failed revoke likewise — the listing stands, and the control is
    // available again.
    name: 'RevokeInvite in the Invite_Manager',
    method: 'revokeInvite',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('listInvites', success(fixture.invites));
      transport.answers.set('revokeInvite', failure(arm));

      const view = renderHook(() =>
        useInviteManager({ api: transport.api, squadId: fixture.squadId }),
      );
      await flush();

      const machine = (): ReturnType<typeof useInviteManager> =>
        view.result.current;
      const accepted = machine().invites;

      act(() => {
        machine().revoke(fixture.inviteId);
      });
      await flush();

      return {
        ...observeGenericFailure(machine().failure === 'revoke', () => {
          machine().revoke(fixture.inviteId);
        }),
        retainedUnchanged:
          machine().invites === accepted && machine().revokingInviteId === null,
        calls: () => transport.count('revokeInvite'),
      };
    },
  },
  {
    // 12.12: a failed `CreateGuest` keeps the form's values (which live in the
    // form, not here), triggers **no** re-read, and leaves the operation
    // submittable again.
    name: 'CreateGuest in the Guest_Manager',
    method: 'createGuest',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('createGuest', failure(arm));

      const refreshes: number[] = [];
      const view = renderHook(() =>
        useGuestManager({
          api: transport.api,
          squadId: fixture.squadId,
          refresh: () => {
            refreshes.push(1);
          },
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof useGuestManager> =>
        view.result.current;
      const submission = {
        displayName: 'Dave',
        skillTier: DO_NOT_SEED_TIER,
        lawfulBasisAcknowledged: true,
      };

      act(() => {
        machine().create(submission);
      });
      await flush();

      return {
        ...observeGenericFailure(machine().createPhase === 'failed', () => {
          machine().create(submission);
        }),
        // 12.12: the Player_List last accepted is rendered unchanged, which at
        // this seam means the re-read was not triggered at all.
        retainedUnchanged:
          refreshes.length === 0 &&
          machine().createFailure === 'generic' &&
          !machine().creating,
        calls: () => transport.count('createGuest'),
      };
    },
  },
  {
    // 12.12: and the same for an edit, which likewise re-reads nothing.
    name: 'EditGuest in the Guest_Manager',
    method: 'editGuest',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('editGuest', failure(arm));

      const refreshes: number[] = [];
      const view = renderHook(() =>
        useGuestManager({
          api: transport.api,
          squadId: fixture.squadId,
          refresh: () => {
            refreshes.push(1);
          },
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof useGuestManager> =>
        view.result.current;
      const submission = {
        membershipId: fixture.membershipId,
        displayName: 'Dave',
        skillTier: LEAVE_TIER_UNCHANGED,
      };

      act(() => {
        machine().edit(submission);
      });
      await flush();

      return {
        ...observeGenericFailure(machine().editPhase === 'failed', () => {
          machine().edit(submission);
        }),
        retainedUnchanged:
          refreshes.length === 0 &&
          machine().editFailure === 'generic' &&
          !machine().editing,
        calls: () => transport.count('editGuest'),
      };
    },
  },
  {
    // 13.7: a failed promotion leaves the Player_List last accepted unchanged —
    // no re-read, no assumed admin label — and the control available again.
    name: 'PromoteToAdmin from a Promotion_Control',
    method: 'promoteToAdmin',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('promoteToAdmin', failure(arm));

      const refreshes: number[] = [];
      const view = renderHook(() =>
        usePromotion({
          api: transport.api,
          squadId: fixture.squadId,
          refresh: () => {
            refreshes.push(1);
          },
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof usePromotion> => view.result.current;

      act(() => {
        machine().promote(fixture.membershipId);
      });
      await flush();

      return {
        ...observeGenericFailure(machine().outcome?.kind === 'failed', () => {
          machine().promote(fixture.membershipId);
        }),
        retainedUnchanged:
          refreshes.length === 0 &&
          machine().outcome?.membershipId === fixture.membershipId &&
          !machine().isPending(fixture.membershipId),
        calls: () => transport.count('promoteToAdmin'),
      };
    },
  },
  {
    // 14.6: a failed change leaves the toggle on the last state the backend
    // supplied — this machine writes none of its own — and available again.
    name: 'SetFeatureFlag from a Feature_Toggle',
    method: 'setFeatureFlag',
    expectedMessage: GENERIC_SQUADS_FAILURE,
    manualControl: true,
    activationIssuesCall: true,
    async run(arm, fixture, ticks) {
      const transport = createTransport(ticks);
      transport.answers.set('setFeatureFlag', failure(arm));

      const refreshes: number[] = [];
      const view = renderHook(() =>
        useFeatureToggles({
          api: transport.api,
          squadId: fixture.squadId,
          refresh: () => {
            refreshes.push(1);
          },
        }),
      );
      await flush();

      const machine = (): ReturnType<typeof useFeatureToggles> =>
        view.result.current;

      act(() => {
        machine().setEnabled('live-match-tracking', true);
      });
      await flush();

      return {
        ...observeGenericFailure(machine().outcome?.kind === 'failed', () => {
          machine().setEnabled('live-match-tracking', true);
        }),
        // 14.7: no optimistic state outlives the call — `flags` holds only a
        // backend-supplied collection, and no read supplied one here.
        retainedUnchanged:
          refreshes.length === 0 &&
          machine().flags === null &&
          !machine().isPending('live-match-tracking'),
        calls: () => transport.count('setFeatureFlag'),
      };
    },
  },
];

// --- The shared claims ------------------------------------------------------

/**
 * The identity-bearing values of a fixture, none of which can occur inside fixed
 * copy by accident.
 *
 * Requirement 17.1's "names no squad, no membership, and no invite" is checked
 * against these rather than against the generated display names: a name may
 * legitimately be a substring of ordinary English, while a UUID or a generated
 * secret may not, so these are the values whose absence is evidence.
 */
function disclosableValues(fixture: Fixture): readonly string[] {
  return [
    fixture.squadId,
    fixture.membershipId,
    fixture.inviteId,
    fixture.inviteSecret,
  ];
}

/**
 * The whole of Property 40 for one settled failure.
 *
 * Written once and applied to every operation, so no operation is held to a
 * softer standard than its neighbours.
 */
async function expectPropertyForty(
  operation: OperationCase,
  fixture: Fixture,
  settled: Settled,
): Promise<void> {
  // 17.1, 17.2: the one fixed message, or none at all for the two operations the
  // requirements answer differently — never a third thing, and never a message
  // that varies with which arm failed.
  expect(settled.message).toBe(operation.expectedMessage);

  if (settled.message !== null) {
    // 17.3: announced where it appears, without keyboard focus being moved to
    // it.
    expect(settled.announcedLive).toBe(true);

    // 17.1: it names no squad, no membership, and no invite, and carries no
    // digit — so no status code, count, or identity was folded into it.
    expect(settled.message).not.toMatch(/\d/);
    for (const value of disclosableValues(fixture)) {
      expect(settled.message).not.toContain(value);
    }
  }

  // 2.5, 6.7, 7.10, 11.12, 12.12, 13.7: whatever the surface last accepted is
  // still exactly what it holds.
  expect(settled.retainedUnchanged).toBe(true);

  // 17.4: a manual retry, or a re-submittable control, wherever a failure
  // message is shown.
  expect(settled.manualControlAvailable).toBe(operation.manualControl);

  // 17.4: exactly the one call that failed…
  expect(settled.calls()).toBe(1);

  // …and nothing re-issues it while the machine is left alone.
  await idle();
  expect(settled.calls()).toBe(1);

  // One activation by a person, one further call — and only then.
  await act(async () => {
    settled.activate();
  });
  await flush();

  expect(settled.calls()).toBe(operation.activationIssuesCall ? 2 : 1);
}

// --- The property -----------------------------------------------------------

describe('Property 40 — every failed call presents one generic outcome, retains state, and waits for a person', () => {
  // Feature: web-squads-screens, Property 40: Every failed call presents one generic outcome, retains state, and waits for a person
  // Validates: Requirements 2.5, 6.7, 7.10, 11.12, 12.12, 13.7, 17.1, 17.4
  it('holds for every operation against a transport failure, a timeout, and a parse failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        failureArmArb,
        fixtureArb,
        settleTicksArb,
        async (arm, fixture, ticks) => {
          for (const operation of OPERATIONS) {
            if (operation.arms !== undefined && !operation.arms.includes(arm)) {
              continue;
            }

            try {
              const settled = await operation.run(arm, fixture, ticks);
              await expectPropertyForty(operation, fixture, settled);
            } catch (failed) {
              // Naming the operation turns a shrunk counterexample into a
              // report about one surface rather than about the whole feature.
              throw new Error(
                `${operation.name} (${operation.method}, ${arm}): ${
                  failed instanceof Error ? failed.message : String(failed)
                }`,
                { cause: failed },
              );
            } finally {
              cleanup();
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
