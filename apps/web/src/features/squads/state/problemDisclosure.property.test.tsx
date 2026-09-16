/**
 * Property test for the feature's non-disclosure of backend-supplied text
 * (task 7.9).
 *
 * **Property 41: No backend-supplied text reaches the interface.** *For any*
 * problem body carrying a detail message, a title, a status code, a request path,
 * and arbitrary additional content, none of that content appears in any
 * user-facing message of the feature, and every asynchronous outcome is rendered
 * in a region with a programmatically determinable live status **without the
 * active element changing**.
 *
 * ### Three layers, because the claim has three places to fail
 *
 * 1. **The seam.** `createSquadsApi` is driven over the **real** generated
 *    `@pitchmate/api-client` with an injected `fetch` that answers every one of
 *    the fourteen operations with the generated problem body. The settled
 *    {@link CallResult} is then searched for every generated value. This is where
 *    non-disclosure is structural rather than editorial: the union has no field a
 *    `detail`, a `title`, a status, or an `instance` could ride on, and a
 *    rejection carries one of five names this feature declares.
 * 2. **The machines.** The same api is handed to every state machine of the
 *    feature, each is driven to its settled outcome, and the whole of its state is
 *    searched for the same values. A machine that parked the backend's wording
 *    "just for a message" would be caught here even though nothing rendered it.
 * 3. **The surface.** The real Squads_Home renders over the same api — a read that
 *    fails on mount, and a submission that fails after a person activated the
 *    submit control. The rendered text *and every rendered attribute value* are
 *    searched, the outcome message is asserted to be the feature's own fixed copy
 *    inside a region with a determinable live status, and the active element is
 *    asserted to be **the same element** before and after the outcome settled.
 *
 * ### Why each generated value carries a token
 *
 * Every generated string in the problem body embeds a unique `pmx-…` token. The
 * assertions look for those tokens rather than for whole sentences, which makes
 * the containment check exact in both directions: a token cannot occur in fixed
 * copy by accident, and any leak of the value it sits in carries it along. The
 * status code is covered separately and more strictly — the rendered message is
 * asserted to carry **no digit at all**, so no status, count, or identity can
 * have been folded into it.
 *
 * ### What the generators deliberately do and do not cover
 *
 * - **Statuses** are drawn from the ones the backend actually answers with —
 *   `400`, `401`, `403`, `404`, `409`, `410`, `422`, `500`, `503` — plus an
 *   arbitrary `200`–`599`. Statuses below `200` are excluded because `Response`
 *   cannot carry a body with one; the pure classifier's own property beside
 *   `lib/callOutcome.ts` covers those, together with `0` and `NaN`.
 * - **Extension keys** are arbitrary, minus the field names the Response_Parsers
 *   read (see {@link RESERVED_FIELD_NAMES}). A body that accidentally spelled
 *   `message` at a `2xx` would be a *successful* Invite_Preview whose instruction
 *   the Invite_Landing_Route is required to render (Requirement 5.2) — a different
 *   property, and not a disclosure.
 * - **Layers 2 and 3 use failing statuses only.** A `2xx` carrying a problem body
 *   is a parse failure for most operations but Requirement 3.7's create-fallback
 *   for `CreateSquad`, which navigates rather than reporting an outcome; that path
 *   is Property 7's.
 *
 * Feature: web-squads-screens, Property 41: No backend-supplied text reaches the interface
 * Validates: Requirements 17.2, 17.3
 */
import { createApiClient } from '@pitchmate/api-client';
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
import { createSquadsApi, type CallResult, type SquadsApi } from '../api/squadsApi';
import {
  CREATE_SQUAD_FORM_ID,
  CREATE_SQUAD_OUTCOME_REGION_ID,
} from '../components/CreateSquadForm';
import { FAILURE_NOTICE_SELECTOR } from '../components/FailureNotice';
import { JOIN_SQUAD_OUTCOME_REGION_ID } from '../components/JoinSquadForm';
import {
  CREATE_SQUAD_HEADING,
  CREATE_SQUAD_SUBMIT_LABEL,
  CREATOR_DISPLAY_NAME_LABEL,
  GENERIC_SQUADS_FAILURE,
  INVITE_SECRET_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUAD_NAME_LABEL,
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

// --- The generated problem body ---------------------------------------------

/**
 * One generated ProblemDetails body, together with the tokens every one of its
 * strings embeds.
 *
 * `tokens` is what the assertions search for; `body` is what the transport
 * answers with.
 */
interface Problem {
  readonly body: Record<string, unknown>;
  readonly status: number;
  readonly tokens: readonly string[];
}

/**
 * The field names the Response_Parsers read, kept out of the generated extension
 * keys.
 *
 * Not a weakening of "arbitrary additional content": these are the names of
 * *recognised* fields, so a body using them is a differently-shaped response
 * rather than an extension, and one of them — `message` on a `2xx` — is content
 * the Invite_Landing_Route is required to render.
 */
const RESERVED_FIELD_NAMES: readonly string[] = [
  'squadId',
  'name',
  'members',
  'features',
  'membershipId',
  'membershipIds',
  'displayName',
  'role',
  'state',
  'isGuest',
  'entries',
  'value',
  'message',
  'requiresAuthentication',
  'inviteId',
  'inviteState',
  'redeemableLink',
  'code',
  'expiresAt',
  'createdAt',
  'createdBy',
  'outcome',
  'ownerMembershipId',
  'guestMembershipId',
  'feature',
  'isEnabled',
  'statistic',
];

/** A value that cannot occur in the feature's own copy by accident. */
const tokenArb: fc.Arbitrary<string> = fc.uuid().map((id) => `pmx-${id}`);

/**
 * The statuses the problem body is answered with.
 *
 * The named ones are the statuses the squads and stats endpoints actually
 * answer with; the arbitrary one keeps the space open. `204`, `205`, and `304`
 * are excluded because `Response` refuses a body with them, and statuses below
 * `200` because `Response` refuses them outright.
 */
const statusArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(400, 401, 403, 404, 409, 410, 422, 500, 503),
  },
  { weight: 2, arbitrary: fc.constant(200) },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 200, max: 599 })
      .filter((status) => status !== 204 && status !== 205 && status !== 304),
  },
);

/** Every failing status: layers 2 and 3 are stated over these alone. */
const failingStatusArb: fc.Arbitrary<number> = statusArb.filter(
  (status) => status < 200 || status > 299,
);

/** An arbitrary extension key that names no field a parser reads. */
const extensionKeyArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 14 })
  .filter((key) => !RESERVED_FIELD_NAMES.includes(key));

/**
 * A ProblemDetails body carrying a `detail`, a `title`, a `status`, an
 * `instance` request path, the backend's `code` extension, and arbitrary further
 * content — every channel Requirement 17.2 names.
 */
function problemArb(statuses: fc.Arbitrary<number>): fc.Arbitrary<Problem> {
  return fc
    .record({
      status: statuses,
      detailToken: tokenArb,
      titleToken: tokenArb,
      instanceToken: tokenArb,
      typeToken: tokenArb,
      codeToken: tokenArb,
      extensionToken: tokenArb,
      extensionKey: extensionKeyArb,
      // The backend's own codes, plus one it has never sent, so the classifier's
      // fallback to the status is exercised as well as its table.
      problemCode: fc.constantFrom(
        'DisplayNameInUse',
        'InviteUnusable',
        'InviteLimitReached',
        'ValidationFailed',
        'ConcurrencyConflict',
        'SomethingNewTheBackendAdded',
      ),
      includeKnownCode: fc.boolean(),
    })
    .map((raw): Problem => {
      const detail = `Squad ${raw.detailToken} could not be read for member ${raw.detailToken}.`;
      const title = `Conflict ${raw.titleToken}`;
      const instance = `/squads/${raw.instanceToken}/invites`;
      const type = `https://pitch-mate.co.uk/problems/${raw.typeToken}`;

      const body: Record<string, unknown> = {
        type,
        title,
        status: raw.status,
        detail,
        instance,
        // The `code` extension is the one value the classifier reads — and it
        // reads it only to name one of five reasons this feature declares, so
        // even a code the backend has never sent must not travel further.
        code: raw.includeKnownCode ? raw.problemCode : raw.codeToken,
        [raw.extensionKey]: `extension ${raw.extensionToken}`,
        errors: {
          displayName: [`${raw.extensionToken} is already taken`],
        },
      };

      return {
        body,
        status: raw.status,
        tokens: [
          raw.detailToken,
          raw.titleToken,
          raw.instanceToken,
          raw.typeToken,
          raw.extensionToken,
          ...(raw.includeKnownCode ? [] : [raw.codeToken]),
        ],
      };
    });
}

// --- The transport ----------------------------------------------------------

const BASE_URL = 'https://api.test';

/** A Squads_Api over the real generated client, answering `problem` every time. */
function apiAnswering(problem: Problem): SquadsApi {
  const fetchImpl = (() =>
    Promise.resolve(
      new Response(JSON.stringify(problem.body), {
        status: problem.status,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )) as unknown as typeof fetch;

  return createSquadsApi({
    apiClient: createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl }),
  });
}

/** A held-open response, so a surface can be observed while a call is in flight. */
interface Gate {
  readonly api: SquadsApi;
  /** Answer every request awaiting a response, and every later one. */
  open(): void;
}

/** A Squads_Api whose answers wait until {@link Gate.open} is called. */
function gatedApiAnswering(problem: Problem): Gate {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  const fetchImpl = (async (): Promise<Response> => {
    await opened;
    return new Response(JSON.stringify(problem.body), {
      status: problem.status,
      headers: { 'Content-Type': 'application/problem+json' },
    });
  }) as unknown as typeof fetch;

  return {
    api: createSquadsApi({
      apiClient: createApiClient({ baseUrl: BASE_URL, fetch: fetchImpl }),
    }),
    open: release,
  };
}

// --- Searching for the generated content ------------------------------------

/**
 * Assert that none of a problem's tokens occurs in `subject`.
 *
 * `where` names the layer, so a counterexample says which of the three failed
 * rather than only that one did.
 */
function expectNoDisclosure(
  subject: string,
  problem: Problem,
  where: string,
): void {
  for (const token of problem.tokens) {
    if (subject.includes(token)) {
      throw new Error(
        `${where} disclosed backend-supplied content carrying ${token}`,
      );
    }
  }
}

/**
 * Everything the interface presents: the rendered text, and every rendered
 * attribute value.
 *
 * Attributes are included because a `title`, an `aria-label`, a `data-` value, or
 * an `id` derived from a response body would disclose just as much as visible
 * text while passing a text-only check.
 */
function renderedContent(): string {
  const parts: string[] = [document.body.textContent ?? ''];

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      parts.push(attribute.value);
    }
  }

  return parts.join('\n');
}

/** The whole of a machine's state as data — functions dropped by serialisation. */
function stateOf(machine: unknown): string {
  return JSON.stringify(machine) ?? '';
}

/**
 * Every token really is in what the backend answered with.
 *
 * The guard that keeps the containment checks from being vacuous: if a generator
 * change stopped embedding the tokens, "none of them was disclosed" would pass
 * for the wrong reason, and this fails instead.
 */
function expectTokensAreReal(problem: Problem): void {
  const answered = JSON.stringify(problem.body) ?? '';

  expect(problem.tokens.length).toBeGreaterThan(0);
  for (const token of problem.tokens) {
    expect(answered).toContain(token);
  }
}

// --- Fixtures and flushing --------------------------------------------------

const SQUAD_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const MEMBERSHIP_ID = 'a1b2c3d4-e5f6-4718-8a9b-0c1d2e3f4a5b';
const INVITE_ID = '9e107d9d-3728-4c9b-9a5c-58f3e1f0d1a2';
const INVITE_SECRET = 'an-invite-secret';

/** Let every settled call deliver and every resulting React update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 16; round += 1) {
      await Promise.resolve();
    }
  });
}

/**
 * A `SessionManager` reporting `authenticated`. `AuthProvider` reads `getState()`
 * and `subscribe()`, and no case here moves the session, so the rest is inert.
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

/** Render the real Squads_Home over an injected Squads_Api. */
function renderSquadsHome(api: SquadsApi): void {
  render(
    <AuthProvider manager={sessionManager()}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );
}

// --- Layer 1: the seam ------------------------------------------------------

/** One operation of the seam, invoked with well-formed arguments. */
interface SeamOperation {
  readonly name: string;
  invoke(api: SquadsApi): Promise<CallResult<unknown>>;
}

const SEAM_OPERATIONS: readonly SeamOperation[] = [
  { name: 'ListMySquads', invoke: (api) => api.listMySquads() },
  { name: 'GetSquad', invoke: (api) => api.getSquad(SQUAD_ID) },
  {
    name: 'GetSquadLeaderboard',
    invoke: (api) => api.getDisplayRatingLeaderboard(SQUAD_ID),
  },
  {
    name: 'CreateSquad',
    invoke: (api) => api.createSquad({ name: 'Thursday', displayName: 'Dave' }),
  },
  {
    name: 'RedeemInvite',
    invoke: (api) => api.redeemInvite({ presentedSecret: INVITE_SECRET }),
  },
  { name: 'PreviewInvite', invoke: (api) => api.previewInvite() },
  { name: 'ListInvites', invoke: (api) => api.listInvites(SQUAD_ID) },
  {
    name: 'GenerateInvite',
    invoke: (api) => api.generateInvite(SQUAD_ID, { nonExpiring: true }),
  },
  {
    name: 'RevokeInvite',
    invoke: (api) => api.revokeInvite(SQUAD_ID, INVITE_ID),
  },
  {
    name: 'CreateGuest',
    invoke: (api) =>
      api.createGuest(SQUAD_ID, {
        displayName: 'BigDave',
        lawfulBasisAcknowledged: true,
      }),
  },
  {
    name: 'EditGuest',
    invoke: (api) =>
      api.editGuest(SQUAD_ID, MEMBERSHIP_ID, {
        displayName: 'Big Dave',
        updateSkillTier: false,
      }),
  },
  {
    name: 'PromoteToAdmin',
    invoke: (api) => api.promoteToAdmin(SQUAD_ID, MEMBERSHIP_ID),
  },
  { name: 'GetFeatureFlags', invoke: (api) => api.getFeatureFlags(SQUAD_ID) },
  {
    name: 'SetFeatureFlag',
    invoke: (api) => api.setFeatureFlag(SQUAD_ID, { feature: 1, enabled: true }),
  },
];

/** The seven kinds the classification may produce, and no eighth. */
const OUTCOME_KINDS: readonly string[] = [
  'success',
  'not-found',
  'auth-failure',
  'rejected-input',
  'timeout',
  'transport-failure',
  'parse-failure',
];

/** The five rejection reasons this feature declares, and no sixth. */
const REJECTION_REASONS: readonly string[] = [
  'display-name-in-use',
  'invite-unusable',
  'invite-limit-reached',
  'validation',
  'conflict',
];

// --- Layer 2: the machines --------------------------------------------------

/** What one machine held once its outcome settled. */
interface Settled {
  /** The machine's state as data. */
  readonly state: string;
  /**
   * Whether the machine actually reached a settled outcome.
   *
   * Asserted alongside the disclosure check so the check cannot pass by the
   * machine never having received an answer at all.
   */
  readonly settled: boolean;
}

/** One machine of the feature, driven to a settled outcome over a failing api. */
interface MachineCase {
  readonly name: string;
  settle(api: SquadsApi): Promise<Settled>;
}

const MACHINES: readonly MachineCase[] = [
  {
    name: 'useSquadsHome',
    async settle(api) {
      const view = renderHook(() => useSquadsHome({ api }));
      await flush();

      return {
        state: stateOf(view.result.current),
        settled: view.result.current.failed,
      };
    },
  },
  {
    name: 'useSquadScreen',
    async settle(api) {
      const view = renderHook(() => useSquadScreen({ api, squadId: SQUAD_ID }));
      await flush();

      return {
        state: stateOf(view.result.current),
        // 6.4, 6.7: a `403`/`404` is the Not_Found_Treatment and everything else
        // is the generic failure; either is a settled answer.
        settled: view.result.current.failed || view.result.current.notFound,
      };
    },
  },
  {
    name: 'useInviteRedemption',
    async settle(api) {
      const view = renderHook(() =>
        useInviteRedemption({
          api,
          path: inviteLandingPath(INVITE_SECRET),
          navigate: () => undefined,
          authState: 'authenticated',
        }),
      );
      await flush();

      return {
        state: stateOf(view.result.current),
        // 5.10, 5.13: an unusable invite and a failure are both settled.
        settled: view.result.current.failed || view.result.current.unusable,
      };
    },
  },
  {
    name: 'useInviteRedemption while unauthenticated',
    async settle(api) {
      const view = renderHook(() =>
        useInviteRedemption({
          api,
          path: inviteLandingPath(INVITE_SECRET),
          navigate: () => undefined,
          authState: 'unauthenticated',
        }),
      );
      await flush();

      return {
        state: stateOf(view.result.current),
        // 5.6: a failed preview settles on the handover surface, with the fixed
        // instruction standing in for the one it did not supply.
        settled:
          view.result.current.handover &&
          view.result.current.instruction === null,
      };
    },
  },
  {
    name: 'useInviteManager',
    async settle(api) {
      const view = renderHook(() => useInviteManager({ api, squadId: SQUAD_ID }));
      await flush();

      act(() => {
        view.result.current.generate({ nonExpiring: true });
      });
      await flush();

      act(() => {
        view.result.current.revoke(INVITE_ID);
      });
      await flush();

      return {
        state: stateOf(view.result.current),
        settled: view.result.current.failure !== null,
      };
    },
  },
  {
    name: 'useGuestManager',
    async settle(api) {
      const view = renderHook(() =>
        useGuestManager({ api, squadId: SQUAD_ID, refresh: () => undefined }),
      );
      await flush();

      act(() => {
        view.result.current.create({
          displayName: 'BigDave',
          skillTier: DO_NOT_SEED_TIER,
          lawfulBasisAcknowledged: true,
        });
        view.result.current.edit({
          membershipId: MEMBERSHIP_ID,
          displayName: 'Big Dave',
          skillTier: LEAVE_TIER_UNCHANGED,
        });
      });
      await flush();

      return {
        state: stateOf(view.result.current),
        settled:
          view.result.current.createPhase === 'failed' &&
          view.result.current.editPhase === 'failed',
      };
    },
  },
  {
    name: 'usePromotion',
    async settle(api) {
      const view = renderHook(() =>
        usePromotion({ api, squadId: SQUAD_ID, refresh: () => undefined }),
      );
      await flush();

      act(() => {
        view.result.current.promote(MEMBERSHIP_ID);
      });
      await flush();

      return {
        state: stateOf(view.result.current),
        settled: view.result.current.outcome?.kind === 'failed',
      };
    },
  },
  {
    name: 'useFeatureToggles',
    async settle(api) {
      const view = renderHook(() => useFeatureToggles({ api, squadId: SQUAD_ID }));
      await flush();

      act(() => {
        view.result.current.setEnabled('live-match-tracking', true);
      });
      await flush();

      return {
        state: stateOf(view.result.current),
        settled: view.result.current.outcome?.kind === 'failed',
      };
    },
  },
];

// --- The properties ---------------------------------------------------------

describe('Property 41 — no backend-supplied text reaches the interface', () => {
  // Feature: web-squads-screens, Property 41: No backend-supplied text reaches the interface
  // Validates: Requirements 17.2
  it('settles every operation into one of seven kinds carrying none of the problem body', async () => {
    await fc.assert(
      fc.asyncProperty(problemArb(statusArb), async (problem) => {
        expectTokensAreReal(problem);
        const api = apiAnswering(problem);

        for (const operation of SEAM_OPERATIONS) {
          const result = await operation.invoke(api);

          // 17.8: exactly one of the seven kinds, and a rejection names one of
          // the five reasons this feature declares — never the backend's code.
          expect(OUTCOME_KINDS).toContain(result.kind);

          // The transport really answered with the generated problem: a failing
          // status never settles as a success. Stated so a fake that quietly
          // answered nothing at all could not pass the disclosure check below by
          // having nothing to disclose.
          if (problem.status < 200 || problem.status > 299) {
            expect(result.kind).not.toBe('success');
          }

          if (result.kind === 'rejected-input') {
            expect(REJECTION_REASONS).toContain(result.reason);
          }

          // 17.2: nothing of the problem body travels out of the seam.
          expectNoDisclosure(
            JSON.stringify(result) ?? '',
            problem,
            `the ${operation.name} CallResult`,
          );
        }
      }),
      { numRuns: 120 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 41: No backend-supplied text reaches the interface
  // Validates: Requirements 17.2
  it('holds no problem body content in any machine of the feature', async () => {
    await fc.assert(
      fc.asyncProperty(problemArb(failingStatusArb), async (problem) => {
        expectTokensAreReal(problem);

        for (const machine of MACHINES) {
          try {
            const settled = await machine.settle(apiAnswering(problem));

            // The machine received the answer: otherwise there would be nothing
            // for it to have disclosed.
            if (!settled.settled) {
              throw new Error(
                `${machine.name} did not settle on an outcome for status ${problem.status}`,
              );
            }

            expectNoDisclosure(
              settled.state,
              problem,
              `${machine.name}'s state`,
            );
          } finally {
            cleanup();
          }
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 41: No backend-supplied text reaches the interface
  // Validates: Requirements 17.2, 17.3
  it('announces a failed read in a live region without changing the active element', async () => {
    await fc.assert(
      fc.asyncProperty(problemArb(failingStatusArb), async (problem) => {
        try {
          const gate = gatedApiAnswering(problem);
          renderSquadsHome(gate.api);
          await flush();

          // A person is somewhere on the screen while the call is in flight.
          const opener = screen.getByRole('button', {
            name: CREATE_SQUAD_HEADING,
          });
          opener.focus();
          const focusedBefore = document.activeElement;
          expect(focusedBefore).toBe(opener);

          gate.open();
          await flush();

          // 17.3: the outcome is announced where it appears, and keyboard focus
          // is exactly where the person left it.
          expect(document.activeElement).toBe(focusedBefore);

          const notice = document.querySelector<HTMLElement>(
            FAILURE_NOTICE_SELECTOR,
          );
          expect(notice).not.toBeNull();

          const region = notice?.querySelector<HTMLElement>('[role="status"]');
          expect(region).not.toBeNull();
          expect(region?.getAttribute('aria-live')).not.toBeNull();

          // 17.1, 17.2: the feature's own fixed copy, carrying no digit — so no
          // status code reached it — and none of the body's content.
          expect(region?.textContent?.trim()).toBe(GENERIC_SQUADS_FAILURE);
          expect(region?.textContent ?? '').not.toMatch(/\d/);
          expectNoDisclosure(
            renderedContent(),
            problem,
            'the failed Squads_Home',
          );
        } finally {
          cleanup();
        }
      }),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 41: No backend-supplied text reaches the interface
  // Validates: Requirements 17.2, 17.3
  it('announces a failed submission in the form’s live region without changing the active element', async () => {
    await fc.assert(
      fc.asyncProperty(
        problemArb(failingStatusArb),
        fc.constantFrom(CREATE_SQUAD_HEADING, JOIN_SQUAD_HEADING),
        async (problem, panel) => {
          try {
            const gate = gatedApiAnswering(problem);
            renderSquadsHome(gate.api);
            // The listing call is in flight and stays so: this case is about the
            // submission's own outcome, and both share the one answer.
            await flush();

            fireEvent.click(screen.getByRole('button', { name: panel }));

            if (panel === CREATE_SQUAD_HEADING) {
              fireEvent.change(screen.getByLabelText(SQUAD_NAME_LABEL), {
                target: { value: 'Thursday Nights' },
              });
              fireEvent.change(
                screen.getByLabelText(CREATOR_DISPLAY_NAME_LABEL),
                { target: { value: 'Dave' } },
              );
            } else {
              fireEvent.change(screen.getByLabelText(INVITE_SECRET_LABEL), {
                target: { value: INVITE_SECRET },
              });
            }

            const submit = screen.getByRole('button', {
              name:
                panel === CREATE_SQUAD_HEADING
                  ? CREATE_SQUAD_SUBMIT_LABEL
                  : JOIN_SQUAD_SUBMIT_LABEL,
            });
            submit.focus();
            fireEvent.click(submit);

            const focusedBefore = document.activeElement;
            expect(focusedBefore).toBe(submit);

            gate.open();
            await flush();

            // 17.3: announced without the active element moving — the person is
            // still on the control they activated.
            expect(document.activeElement).toBe(focusedBefore);

            // The form is still rendered, so its live region is the one that
            // reports the outcome (Requirements 3.8, 4.9).
            const region =
              panel === CREATE_SQUAD_HEADING
                ? document.getElementById(CREATE_SQUAD_OUTCOME_REGION_ID)
                : document.getElementById(JOIN_SQUAD_OUTCOME_REGION_ID);
            expect(region).not.toBeNull();
            expect(region?.getAttribute('role')).toBe('status');
            expect(region?.getAttribute('aria-live')).not.toBeNull();

            const announced = region?.textContent?.trim() ?? '';
            expect(announced.length).toBeGreaterThan(0);
            // 17.2: whatever the backend said, the announcement is one of this
            // feature's own fixed strings and carries no digit.
            expect(announced).not.toMatch(/\d/);
            expectNoDisclosure(
              renderedContent(),
              problem,
              'the failed submission surface',
            );

            if (panel === CREATE_SQUAD_HEADING) {
              expect(
                document.getElementById(CREATE_SQUAD_FORM_ID),
              ).not.toBeNull();
            }
          } finally {
            cleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
