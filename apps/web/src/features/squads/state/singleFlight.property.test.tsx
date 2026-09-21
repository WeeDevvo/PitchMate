/**
 * Property test for single-flight submission (task 7.5).
 *
 * **Property 6: Every submitting control is single-flight.** *For any* sequence
 * of activations of a submitting control — create squad, redeem invite, generate
 * invite, revoke invite, create guest, edit guest, promote, set feature flag —
 * occurring while a call from that control awaits a response, at most one call of
 * that operation is in flight at any instant, the control is rendered disabled
 * while the call is pending, and no second concurrent call for the same operation
 * and target is issued.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | at most one call in flight at any instant | `maxInFlight`, tracked by the recording seam rather than inferred from a final count |
 * | the control reports itself unavailable while pending | {@link SingleFlightDriver.expectPending} |
 * | no second concurrent call for the same operation and target | the call count *and* the recorded targets, which must be the first activation's alone |
 * | the control is available again once the call settles | {@link SingleFlightDriver.expectAvailable}, so the guard is single-flight rather than one-shot |
 *
 * ### Nine subjects, one property
 *
 * Requirement | Operation | Driven through
 * --- | --- | ---
 * 3.5 | `CreateSquad` | the real Create_Squad_Form on the real Squads_Home, clicked with `user-event`
 * 4.5 | `RedeemInvite` from the Join_Code_Form | the real Join_Code_Form on the real Squads_Home, likewise
 * 5.12 | `RedeemInvite` from the Invite_Landing_Route | `useInviteRedemption`, whose retry control is the activation
 * 11.11 | `GenerateInvite`, `RevokeInvite` | `useInviteManager`
 * 12.13 | `CreateGuest`, `EditGuest` | `useGuestManager`
 * 13.6 | `PromoteToAdmin` | `usePromotion`
 * 14.4 | `SetFeatureFlag` | `useFeatureToggles`
 *
 * The split is not a matter of taste. Create-squad and redeem-invite single-flight
 * lives in the **screen** — `SquadsHome`'s one submission slot, plus the
 * `FormPanel`'s refusal to submit while it reports `pending` — because there is no
 * create-or-redeem state hook, so those two are driven by rendering the screen and
 * activating its submit controls. The other seven live in their state hook, whose
 * pending flag *is* the control's disabled state (each hook says so at the field
 * that holds it), and the admin components that will read those flags do not exist
 * yet; driving the hook is therefore the whole of the behaviour rather than a
 * stand-in for it. No test-local component re-states a disabled rule, and no
 * test-local copy of a guard exists: every subject imports the one production
 * implementation.
 *
 * ### Where "the same instant" comes from
 *
 * The operation under test is answered by a promise the test holds open, so every
 * activation of the run happens while the first call is genuinely awaiting a
 * response. The seam counts calls *and* tracks how many are outstanding at once,
 * so a machine that issued a second call and happened to settle it first would
 * fail on `maxInFlight` rather than slip past a final count. Generated sequences
 * cover both a burst — every activation inside one React commit, which is the case
 * a render-derived guard gets wrong — and separate activations with the render
 * settled in between.
 *
 * The incidental calls a success triggers — the further `ListInvites`, the further
 * `ListMySquads` of the Requirement 4.7 fallback — go to their own handlers and are
 * not counted, because they are other operations. What each of them does is
 * Property 7's and the invite lifecycle examples' business.
 *
 * Feature: web-squads-screens, Property 6: Every submitting control is single-flight
 * Validates: Requirements 3.5, 4.5, 5.12, 11.11, 12.13, 13.6, 14.4
 */
import { useEffect, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import type { SquadFeatureValue } from '../lib/enumCodes';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  INVITE_SECRET_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUAD_NAME_LABEL,
} from '../lib/messages';
import type { CreatedGuest } from '../lib/parse/createdGuest';
import type { CreatedSquad } from '../lib/parse/createdSquad';
import type { GeneratedInvite } from '../lib/parse/generatedInvite';
import type { InviteSummary } from '../lib/parse/inviteSummary';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { inviteLandingPath } from '../lib/routePaths';
import {
  DEFAULT_SKILL_TIER_CREATE_OPTION,
  DEFAULT_SKILL_TIER_EDIT_OPTION,
} from '../lib/skillTier';
import { SquadsHome } from '../screens/SquadsHome';
import {
  useFeatureToggles,
  type FeatureTogglesMachine,
} from './useFeatureToggles';
import { useGuestManager, type GuestManagerMachine } from './useGuestManager';
import {
  useInviteManager,
  type InviteManagerMachine,
} from './useInviteManager';
import {
  useInviteRedemption,
  type InviteRedemptionMachine,
} from './useInviteRedemption';
import { usePromotion, type PromotionMachine } from './usePromotion';

// --- The operations under test ----------------------------------------------

/** Every submitting control Property 6 is stated over. */
type OperationName =
  | 'create-squad'
  | 'redeem-invite-form'
  | 'redeem-invite-landing'
  | 'generate-invite'
  | 'revoke-invite'
  | 'create-guest'
  | 'edit-guest'
  | 'promote'
  | 'set-feature-flag';

const OPERATIONS: readonly OperationName[] = [
  'create-squad',
  'redeem-invite-form',
  'redeem-invite-landing',
  'generate-invite',
  'revoke-invite',
  'create-guest',
  'edit-guest',
  'promote',
  'set-feature-flag',
];

// --- Fixed identities and values --------------------------------------------

const SQUAD_ID = '3f2c1a4e-5b6d-4c8e-9f01-2a3b4c5d6e7f';
const MEMBERSHIP_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const OTHER_MEMBERSHIP_ID = '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9';
const INVITE_ID = '2c3d4e5f-6071-4829-83a4-b5c6d7e8f901';
const OTHER_INVITE_ID = '3d4e5f60-7182-493a-84b5-c6d7e8f90123';
const CREATED_SQUAD_ID = '4e5f6071-8293-4a4b-85c6-d7e8f9012345';
const GUEST_MEMBERSHIP_ID = '5f607182-93a4-4b5c-86d7-e8f901234567';

/**
 * The one Squad_Feature the Enum_Code_Map names, so every repeat of the
 * set-feature-flag activation targets the same Feature_Flag by construction —
 * which is the form Requirement 14.4 states the guard in.
 */
const FEATURE: SquadFeatureValue = 'live-match-tracking';

/** The Invite_Secret the Invite_Landing_Route subject renders a path for. */
const LANDING_SECRET = 'abcdef123456';

// --- The recording seam ------------------------------------------------------

/** What the operation under test was asked, and how much of it at once. */
interface OperationRecorder {
  /** How many calls of the operation were issued in total. */
  readonly calls: number;
  /**
   * The greatest number outstanding at any one instant.
   *
   * The sharp form of "at most one call in flight": a machine that issued a
   * second call and settled it before the assertion would still be caught here.
   */
  readonly maxInFlight: number;
  /** The target of each call — an invite or membership identity, or `null`. */
  readonly targets: readonly (string | null)[];
}

/**
 * A handler for the operation under test that records every call and answers none
 * until the test says so.
 *
 * Holding the promise open is what makes every activation of a run concurrent with
 * the first call, which is the condition Property 6 is stated under.
 */
function createRecorder<T>(outcome: CallResult<T>): {
  readonly record: (target?: string | null) => Promise<CallResult<T>>;
  readonly recorder: OperationRecorder;
  readonly settle: () => void;
} {
  const targets: (string | null)[] = [];
  const resolvers: (() => void)[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const record = (target: string | null = null): Promise<CallResult<T>> => {
    targets.push(target);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    return new Promise<CallResult<T>>((resolve) => {
      resolvers.push(() => {
        inFlight -= 1;
        resolve(outcome);
      });
    });
  };

  const recorder: OperationRecorder = {
    get calls(): number {
      return targets.length;
    },
    get maxInFlight(): number {
      return maxInFlight;
    },
    get targets(): readonly (string | null)[] {
      return targets;
    },
  };

  const settle = (): void => {
    for (const resolve of resolvers.splice(0)) {
      resolve();
    }
  };

  return { record, recorder, settle };
}

/**
 * A Squads_Api method no subject reaches.
 *
 * Throwing rather than answering keeps each subject honest: the property does not
 * merely count one operation, it fails outright if a machine reaches for another.
 */
function unreached(method: string): () => never {
  return () => {
    throw new Error(`Property 6 does not reach ${method}`);
  };
}

/** Every method refused, so each subject opts in to exactly what it needs. */
function refusingApi(): SquadsApi {
  return {
    listMySquads: unreached('ListMySquads'),
    getSquad: unreached('GetSquad'),
    getDisplayRatingLeaderboard: unreached('GetSquadLeaderboard'),
    createSquad: unreached('CreateSquad'),
    redeemInvite: unreached('RedeemInvite'),
    previewInvite: unreached('PreviewInvite'),
    listInvites: unreached('ListInvites'),
    generateInvite: unreached('GenerateInvite'),
    revokeInvite: unreached('RevokeInvite'),
    createGuest: unreached('CreateGuest'),
    editGuest: unreached('EditGuest'),
    promoteToAdmin: unreached('PromoteToAdmin'),
    getFeatureFlags: unreached('GetFeatureFlags'),
    setFeatureFlag: unreached('SetFeatureFlag'),
  };
}

/** A `SessionManager` reporting `authenticated`, the only submitting state. */
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

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 24; round += 1) {
      await Promise.resolve();
    }
  });
}

// --- The settled outcome ------------------------------------------------------

/**
 * The arms a Squads_Api call settles on.
 *
 * Every one is generated, because "the control is available again" has to hold
 * whichever way the call went: a success that closes the form, a rejection that
 * keeps it open, and a timeout are three different paths back out of the pending
 * state, and a guard released on only one of them is a stuck control.
 */
type OutcomeKind = CallResult<unknown>['kind'];

const OUTCOME_KINDS: readonly OutcomeKind[] = [
  'success',
  'not-found',
  'auth-failure',
  'rejected-input',
  'timeout',
  'transport-failure',
  'parse-failure',
];

/** The generated outcome, carrying the given parsed value on its success arm. */
function outcomeFor<T>(kind: OutcomeKind, value: T): CallResult<T> {
  switch (kind) {
    case 'success':
      return { kind: 'success', value };
    case 'not-found':
      return { kind: 'not-found' };
    case 'auth-failure':
      return { kind: 'auth-failure' };
    case 'rejected-input':
      return { kind: 'rejected-input', reason: 'conflict' };
    case 'timeout':
      return { kind: 'timeout' };
    case 'transport-failure':
      return { kind: 'transport-failure' };
    case 'parse-failure':
      return { kind: 'parse-failure' };
  }
}

// --- The scenario ------------------------------------------------------------

interface Scenario {
  /** Which submitting control is under test. */
  readonly operation: OperationName;
  /** How many further activations follow the first, all while it is pending. */
  readonly repeats: number;
  /**
   * Whether the repeats happen inside one React commit.
   *
   * The burst is the case a guard derived from rendered state gets wrong, because
   * no render has happened between the activations. The hooks and the Squads_Home
   * both guard against it with a value written at dispatch time rather than at
   * render time, which is what this flag exercises.
   */
  readonly burst: boolean;
  /**
   * Whether the repeats aim at a *different* target where the requirement states
   * the guard per operation rather than per target — `RevokeInvite`
   * (Requirement 11.11) and `EditGuest` (Requirement 12.13).
   */
  readonly alternateTarget: boolean;
  /** How the one call eventually settles. */
  readonly outcome: OutcomeKind;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  operation: fc.constantFrom(...OPERATIONS),
  repeats: fc.integer({ min: 1, max: 4 }),
  burst: fc.boolean(),
  alternateTarget: fc.boolean(),
  outcome: fc.constantFrom(...OUTCOME_KINDS),
});

// --- The driver --------------------------------------------------------------

/** One mounted subject, activated and observed the same way as every other. */
interface SingleFlightDriver {
  /** Activate the submitting control `times` times, optionally within one commit. */
  activate(times: number, burst: boolean): Promise<void>;
  /** The control reports itself unavailable while its call awaits a response. */
  expectPending(): void;
  /** The control is available again once that call has settled. */
  expectAvailable(): void;
  /** Answer the call awaiting a response, and let the update apply. */
  settle(): Promise<void>;
  /** What the operation was asked. */
  readonly recorder: OperationRecorder;
  /** The target the one issued call must carry: the first activation's own. */
  readonly firstTarget: string | null;
}

/** A machine captured from a mounted host, always as of the last commit. */
function createMachineBox<M>(): {
  readonly set: (machine: M) => void;
  readonly get: () => M;
} {
  let current: M | null = null;

  return {
    set: (machine: M): void => {
      current = machine;
    },
    get: (): M => {
      if (current === null) {
        throw new Error('the machine has not been captured yet');
      }
      return current;
    },
  };
}

/** Mount a host that captures its machine, and return the reader for it. */
async function mountHost<M>(
  host: (capture: (machine: M) => void) => ReactElement,
): Promise<() => M> {
  const box = createMachineBox<M>();
  render(host(box.set));
  await flush();
  return box.get;
}

/**
 * A driver over a state hook, whose pending flag is the control's disabled state.
 *
 * The activation is the machine's own method, which is what the admin components
 * will call, so nothing here stands in for production behaviour.
 */
function hookDriver<M>(options: {
  readonly machine: () => M;
  readonly recorder: OperationRecorder;
  readonly settle: () => void;
  readonly activate: (machine: M, index: number) => void;
  readonly pending: (machine: M) => boolean;
  readonly firstTarget: string | null;
}): SingleFlightDriver {
  let activations = 0;

  const activateOnce = (): void => {
    options.activate(options.machine(), activations);
    activations += 1;
  };

  return {
    activate: async (times, burst): Promise<void> => {
      if (burst) {
        // Every activation inside one commit: no render separates them, so the
        // guard cannot have been a rendered value.
        await act(async () => {
          for (let index = 0; index < times; index += 1) {
            activateOnce();
          }
        });
        return;
      }

      for (let index = 0; index < times; index += 1) {
        await act(async () => {
          activateOnce();
        });
      }
    },
    expectPending: (): void => {
      expect(options.pending(options.machine())).toBe(true);
    },
    expectAvailable: (): void => {
      expect(options.pending(options.machine())).toBe(false);
    },
    settle: async (): Promise<void> => {
      options.settle();
      await flush();
    },
    recorder: options.recorder,
    firstTarget: options.firstTarget,
  };
}

/**
 * A driver over one of the Squads_Home's two forms.
 *
 * "Rendered disabled" is asserted as the `FormPanel` states it: `aria-disabled`
 * and `aria-busy` rather than the `disabled` attribute, because a genuinely
 * disabled control would drop the keyboard focus of whoever just activated it
 * (see `FormPanel`). Either spelling is accepted so the assertion is about the
 * control being reported unavailable rather than about which attribute says so.
 */
function formDriver(options: {
  readonly user: UserEvent;
  readonly submitLabel: string;
  readonly recorder: OperationRecorder;
  readonly settle: () => void;
}): SingleFlightDriver {
  const submitControl = (): HTMLElement =>
    screen.getByRole('button', { name: options.submitLabel });

  return {
    activate: async (times): Promise<void> => {
      // Sequential by nature: `user-event` awaits each activation, which is also
      // how a person activates a control twice in quick succession.
      for (let index = 0; index < times; index += 1) {
        await options.user.click(submitControl());
      }
    },
    expectPending: (): void => {
      const control = submitControl();
      const reportedDisabled =
        control.getAttribute('aria-disabled') === 'true' ||
        control.hasAttribute('disabled');

      expect(reportedDisabled).toBe(true);
      expect(control.getAttribute('aria-busy')).toBe('true');
    },
    expectAvailable: (): void => {
      // A successful submission closes the panel, which removes the control
      // altogether — the strongest form of "not stuck pending".
      const control = screen.queryByRole('button', {
        name: options.submitLabel,
      });
      if (control === null) {
        return;
      }

      expect(control.getAttribute('aria-disabled')).toBeNull();
      expect(control.hasAttribute('disabled')).toBe(false);
    },
    settle: async (): Promise<void> => {
      options.settle();
      await flush();
    },
    recorder: options.recorder,
    firstTarget: null,
  };
}

// --- The hosts ---------------------------------------------------------------

/** A `refresh` seam that records nothing: the re-read is another property's. */
const noRefresh = (): void => undefined;

/** A `navigate` seam that records nothing: the destination is Property 7's. */
const noNavigate = (): void => undefined;

function InviteManagerHost({
  api,
  capture,
}: {
  readonly api: SquadsApi;
  readonly capture: (machine: InviteManagerMachine) => void;
}): ReactElement {
  const machine = useInviteManager({ api, squadId: SQUAD_ID });

  useEffect(() => {
    capture(machine);
  }, [capture, machine]);

  return <span data-testid="invite-manager" />;
}

function GuestManagerHost({
  api,
  capture,
}: {
  readonly api: SquadsApi;
  readonly capture: (machine: GuestManagerMachine) => void;
}): ReactElement {
  const machine = useGuestManager({
    api,
    squadId: SQUAD_ID,
    refresh: noRefresh,
  });

  useEffect(() => {
    capture(machine);
  }, [capture, machine]);

  return <span data-testid="guest-manager" />;
}

function PromotionHost({
  api,
  capture,
}: {
  readonly api: SquadsApi;
  readonly capture: (machine: PromotionMachine) => void;
}): ReactElement {
  const machine = usePromotion({ api, squadId: SQUAD_ID, refresh: noRefresh });

  useEffect(() => {
    capture(machine);
  }, [capture, machine]);

  return <span data-testid="promotion" />;
}

function FeatureTogglesHost({
  api,
  capture,
}: {
  readonly api: SquadsApi;
  readonly capture: (machine: FeatureTogglesMachine) => void;
}): ReactElement {
  const machine = useFeatureToggles({
    api,
    squadId: SQUAD_ID,
    refresh: noRefresh,
  });

  useEffect(() => {
    capture(machine);
  }, [capture, machine]);

  return <span data-testid="feature-toggles" />;
}

function InviteRedemptionHost({
  api,
  capture,
}: {
  readonly api: SquadsApi;
  readonly capture: (machine: InviteRedemptionMachine) => void;
}): ReactElement {
  const machine = useInviteRedemption({
    api,
    path: inviteLandingPath(LANDING_SECRET),
    navigate: noNavigate,
    authState: 'authenticated',
  });

  useEffect(() => {
    capture(machine);
  }, [capture, machine]);

  return <span data-testid="invite-redemption">{machine.phase}</span>;
}

// --- Mounting each subject ---------------------------------------------------

/** The `ListInvites` answer the Invite_Manager's mount call needs. */
const LISTED_INVITES: CallResult<readonly InviteSummary[]> = {
  kind: 'success',
  value: [],
};

/** The `ListMySquads` answer the Squads_Home's mount call needs. */
const LISTED_SQUADS: CallResult<readonly SquadSummary[]> = {
  kind: 'success',
  value: [],
};

/**
 * Render the Squads_Home, open one of its two forms, and fill it so that the next
 * activation of its submit control issues a call.
 *
 * The form is driven the way a person drives it — the entry point, the fields,
 * then the submit control — so the panel's own refusal to submit while pending and
 * the screen's submission slot are both exercised, rather than either alone.
 */
async function openSquadsHomeForm(
  api: SquadsApi,
  panel: 'create' | 'join',
): Promise<UserEvent> {
  const user = userEvent.setup();

  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );

  await flush();

  if (panel === 'create') {
    await user.click(screen.getByRole('button', { name: CREATE_SQUAD_HEADING }));
    await user.click(screen.getByLabelText(SQUAD_NAME_LABEL));
    await user.paste('Thursday Ballers');
    await user.click(screen.getByLabelText(CREATOR_DISPLAY_NAME_LABEL));
    await user.paste('Dave');
    return user;
  }

  await user.click(screen.getByRole('button', { name: JOIN_SQUAD_HEADING }));
  await user.click(screen.getByLabelText(INVITE_SECRET_LABEL));
  await user.paste('SHORTCODE1');
  return user;
}

/** Mount the scenario's subject and return the driver for it. */
async function startSubject(scenario: Scenario): Promise<SingleFlightDriver> {
  switch (scenario.operation) {
    // 3.5: the Create_Squad_Form's submit control.
    case 'create-squad': {
      const { record, recorder, settle } = createRecorder<CreatedSquad>(
        outcomeFor(scenario.outcome, {
          squadId: CREATED_SQUAD_ID,
          ownerMembershipId: MEMBERSHIP_ID,
        }),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        listMySquads: () => Promise.resolve(LISTED_SQUADS),
        createSquad: () => record(),
      };

      const user = await openSquadsHomeForm(api, 'create');

      return formDriver({
        user,
        submitLabel: CREATE_SQUAD_SUBMIT_LABEL,
        recorder,
        settle,
      });
    }

    // 4.5: the Join_Code_Form's submit control.
    case 'redeem-invite-form': {
      const { record, recorder, settle } = createRecorder<Redemption>(
        outcomeFor(scenario.outcome, {
          membershipId: MEMBERSHIP_ID,
          outcome: 'joined',
          squadId: null,
        }),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        listMySquads: () => Promise.resolve(LISTED_SQUADS),
        redeemInvite: () => record(),
      };

      const user = await openSquadsHomeForm(api, 'join');

      return formDriver({
        user,
        submitLabel: JOIN_SQUAD_SUBMIT_LABEL,
        recorder,
        settle,
      });
    }

    // 5.12: the Invite_Landing_Route's retry control, activated while the
    // redemption the mount issued is still awaiting a response.
    case 'redeem-invite-landing': {
      const { record, recorder, settle } = createRecorder<Redemption>(
        outcomeFor(scenario.outcome, {
          membershipId: MEMBERSHIP_ID,
          outcome: 'joined',
          squadId: null,
        }),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        redeemInvite: () => record(),
      };

      const machine = await mountHost<InviteRedemptionMachine>((capture) => (
        <InviteRedemptionHost api={api} capture={capture} />
      ));

      // The mount issues the first call, so the activations below are the further
      // ones — which is why the driver is handed a subject already at one call.
      expect(recorder.calls).toBe(1);

      return hookDriver<InviteRedemptionMachine>({
        machine,
        recorder,
        settle,
        activate: (current) => {
          current.retry();
        },
        pending: (current) => current.redeeming && current.busy,
        firstTarget: null,
      });
    }

    // 11.11: the generate control, guarded per operation.
    case 'generate-invite': {
      const { record, recorder, settle } = createRecorder<GeneratedInvite>(
        outcomeFor(scenario.outcome, {
          inviteId: INVITE_ID,
          redeemableLink: `https://pitch-mate.co.uk/join/${LANDING_SECRET}`,
          code: 'SHORTCODE1',
          expiresAtMs: null,
        }),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        listInvites: () => Promise.resolve(LISTED_INVITES),
        generateInvite: () => record(),
      };

      const machine = await mountHost<InviteManagerMachine>((capture) => (
        <InviteManagerHost api={api} capture={capture} />
      ));

      return hookDriver<InviteManagerMachine>({
        machine,
        recorder,
        settle,
        activate: (current) => {
          current.generate({ nonExpiring: true });
        },
        pending: (current) => current.generating,
        firstTarget: null,
      });
    }

    // 11.11: the revoke control. The requirement states the guard per *operation*,
    // so a repeat aimed at a different invite must issue nothing either.
    case 'revoke-invite': {
      const { record, recorder, settle } = createRecorder<void>(
        outcomeFor(scenario.outcome, undefined),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        listInvites: () => Promise.resolve(LISTED_INVITES),
        revokeInvite: (_squadId, inviteId) => record(inviteId),
      };

      const machine = await mountHost<InviteManagerMachine>((capture) => (
        <InviteManagerHost api={api} capture={capture} />
      ));

      return hookDriver<InviteManagerMachine>({
        machine,
        recorder,
        settle,
        activate: (current, index) => {
          current.revoke(
            index === 0 || !scenario.alternateTarget
              ? INVITE_ID
              : OTHER_INVITE_ID,
          );
        },
        pending: (current) => current.revokingInviteId === INVITE_ID,
        firstTarget: INVITE_ID,
      });
    }

    // 12.13: the Guest_Form's submit control while creating.
    case 'create-guest': {
      const { record, recorder, settle } = createRecorder<CreatedGuest>(
        outcomeFor(scenario.outcome, {
          guestMembershipId: GUEST_MEMBERSHIP_ID,
        }),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        createGuest: () => record(),
      };

      const machine = await mountHost<GuestManagerMachine>((capture) => (
        <GuestManagerHost api={api} capture={capture} />
      ));

      return hookDriver<GuestManagerMachine>({
        machine,
        recorder,
        settle,
        activate: (current) => {
          current.create({
            displayName: 'Dave',
            skillTier: DEFAULT_SKILL_TIER_CREATE_OPTION,
            lawfulBasisAcknowledged: true,
          });
        },
        pending: (current) => current.creating,
        firstTarget: null,
      });
    }

    // 12.13: the Guest_Form's submit control while editing, guarded per operation.
    case 'edit-guest': {
      const { record, recorder, settle } = createRecorder<void>(
        outcomeFor(scenario.outcome, undefined),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        editGuest: (_squadId, membershipId) => record(membershipId),
      };

      const machine = await mountHost<GuestManagerMachine>((capture) => (
        <GuestManagerHost api={api} capture={capture} />
      ));

      return hookDriver<GuestManagerMachine>({
        machine,
        recorder,
        settle,
        activate: (current, index) => {
          current.edit({
            membershipId:
              index === 0 || !scenario.alternateTarget
                ? MEMBERSHIP_ID
                : OTHER_MEMBERSHIP_ID,
            displayName: 'Dave',
            skillTier: DEFAULT_SKILL_TIER_EDIT_OPTION,
          });
        },
        pending: (current) => current.editing,
        firstTarget: MEMBERSHIP_ID,
      });
    }

    // 13.6: one Promotion_Control, guarded per membership — so every activation
    // of the run names the same membership.
    case 'promote': {
      const { record, recorder, settle } = createRecorder<void>(
        outcomeFor(scenario.outcome, undefined),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        promoteToAdmin: (_squadId, membershipId) => record(membershipId),
      };

      const machine = await mountHost<PromotionMachine>((capture) => (
        <PromotionHost api={api} capture={capture} />
      ));

      return hookDriver<PromotionMachine>({
        machine,
        recorder,
        settle,
        activate: (current) => {
          current.promote(MEMBERSHIP_ID);
        },
        pending: (current) => current.pending.includes(MEMBERSHIP_ID),
        firstTarget: MEMBERSHIP_ID,
      });
    }

    // 14.4: one Feature_Toggle, guarded per flag. The requested enabled state
    // alternates, so a repeat is a genuine second change of the same toggle.
    case 'set-feature-flag': {
      const { record, recorder, settle } = createRecorder<void>(
        outcomeFor(scenario.outcome, undefined),
      );

      const api: SquadsApi = {
        ...refusingApi(),
        setFeatureFlag: () => record(),
      };

      const machine = await mountHost<FeatureTogglesMachine>((capture) => (
        <FeatureTogglesHost api={api} capture={capture} />
      ));

      return hookDriver<FeatureTogglesMachine>({
        machine,
        recorder,
        settle,
        activate: (current, index) => {
          current.setEnabled(FEATURE, index % 2 === 0);
        },
        pending: (current) => current.pending.includes(FEATURE),
        firstTarget: null,
      });
    }
  }
}

/**
 * How many activations the driver has already had by the time the property starts
 * counting.
 *
 * Only the Invite_Landing_Route arrives with a call already in flight: its
 * redemption is issued by the mount rather than by a control, and the activation
 * under test is the retry (Requirements 5.7, 5.12, 5.13).
 */
function activationsBeforeStart(scenario: Scenario): number {
  return scenario.operation === 'redeem-invite-landing' ? 1 : 0;
}

// --- The property ------------------------------------------------------------

describe('Property 6 — every submitting control is single-flight', () => {
  // Feature: web-squads-screens, Property 6: Every submitting control is single-flight
  // Validates: Requirements 3.5, 4.5, 5.12, 11.11, 12.13, 13.6, 14.4
  it('issues at most one call of an operation at a time, however many times its control is activated', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        try {
          const driver = await startSubject(scenario);
          const { recorder } = driver;

          // The first activation issues exactly one call — so a machine that
          // issued none could not satisfy the property by doing nothing — and the
          // control reports itself unavailable while that call is outstanding.
          await driver.activate(1 - activationsBeforeStart(scenario), false);
          expect(recorder.calls).toBe(1);
          driver.expectPending();

          // Every further activation, while that call still awaits a response,
          // issues nothing: no second call, and never two in flight at once.
          await driver.activate(scenario.repeats, scenario.burst);
          expect(recorder.calls).toBe(1);
          expect(recorder.maxInFlight).toBe(1);
          expect(recorder.targets).toEqual([driver.firstTarget]);
          driver.expectPending();

          // And the guard is single-flight rather than one-shot: once the call
          // settles — whichever arm it settled on — the control is available again
          // and still exactly one call has been issued.
          await driver.settle();
          expect(recorder.calls).toBe(1);
          expect(recorder.maxInFlight).toBe(1);
          driver.expectAvailable();
        } finally {
          cleanup();
        }
      }),
      // Well above the 100-iteration floor, and enough that each of the nine
      // operations is reached many times over rather than by luck of the draw.
      { numRuns: 180 },
    );
  }, 240_000);
});
