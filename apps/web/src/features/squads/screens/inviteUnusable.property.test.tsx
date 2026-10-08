/**
 * Property test for the unusable-invite message on both surfaces (task 14.4).
 *
 * **Property 12: An unusable invite yields one message on either surface.** *For
 * any* outcome in which the presented Invite_Secret matches no invite, is
 * revoked, or is expired, and for either the Join_Code_Form surface or the
 * Invite_Landing_Route surface, the rendered outcome message is identical across
 * all three outcomes, the rendering contains no squad name, no squad identity,
 * and no player display name, and the landing surface presents a control
 * navigating to the Squads_Home.
 *
 * | Clause | Where it is asserted |
 * | --- | --- |
 * | 4.8 — one message for all three outcomes on the Join_Code_Form | {@link expectOneMessageEverywhere} over the three form observations |
 * | 5.10 — one message for all three on the Invite_Landing_Route, naming nothing | {@link expectOneMessageEverywhere} and {@link expectNoDisclosure} |
 * | 5.10 — and a control to the Squads_Home | {@link expectSquadsHomeControl} |
 *
 * ### Why "identical" is asserted against a named message rather than only itself
 *
 * "The same message for all three outcomes" is satisfied trivially by a screen
 * that renders the Generic_Squads_Failure for everything, which would be a
 * regression rather than the requirement: an unusable invite is a settled answer
 * about the invite, not a failure to get one, and it carries its own wording plus
 * a way onward. So every observation is held to three things at once — the six
 * rendered messages are mutually identical, each **is**
 * {@link INVITE_UNUSABLE}, and none **is** {@link GENERIC_SQUADS_FAILURE}.
 *
 * The message is also read *non-circularly*. Neither surface is queried by the
 * text the property expects; each observation waits for the busy indication to
 * clear and then reads whatever single live region the surface settled on — the
 * unusable paragraph and the `FailureNotice` message both being `role="status"`
 * regions, a screen that collapsed to the failure surface reports its own wording
 * into the comparison rather than merely failing to be found.
 *
 * ### The three outcomes are three *wire answers*, classified for real
 *
 * The feature cannot distinguish "matches no invite" from "revoked" from
 * "expired", and that is the point of Requirement 4.8 — the backend answers all
 * three with `410 InviteUnusable`, and a non-member read is concealed as
 * `403`/`404`. Hand-picking a `CallResult` kind per outcome would therefore
 * assert nothing about the mapping, so each generated outcome draws a wire answer
 * from the pool of non-disclosing answers **independently** and that answer is
 * put through the real {@link classifyOutcome}. The property then holds in its
 * stronger form: the message stays identical even when the three outcomes came
 * back as different statuses.
 *
 * ### What makes the non-disclosure clause bite
 *
 * A rendering "containing no squad name" is vacuous unless the screen actually
 * holds one. Both surfaces are therefore given the generated values to leak:
 *
 * - the **Join_Code_Form** surface lists a squad carrying the generated name and
 *   identity, and the generated Player_Display_Name is typed into the form's own
 *   field before submitting — so a message that echoed either would be caught.
 *   The check is scoped to the outcome region, because the card legitimately
 *   renders the squad name and Requirement 4.9 requires the entered value to stay
 *   in its field;
 * - the **Invite_Landing_Route** surface is, on some runs, handed an
 *   Invite_Preview whose wording carries the squad name, the squad identity, and
 *   the display name, and the run asserts that wording *was* rendered on the
 *   handover surface before the session arrived. The machine keeps that
 *   instruction on its state across the redemption, so the unusable surface not
 *   showing it is a real fact about the rendering rather than an absence of
 *   anything to show. Here the whole surface is checked, not just the message,
 *   since nothing on this route is entered by a person.
 *
 * That hostile preview is a deliberate fake: the real anonymous endpoint answers
 * generic wording, and "no backend text reaches the interface" in general is
 * Property 41's claim, not this one.
 *
 * Deliberately **not** claimed here: that the Invite_Secret is excluded from the
 * rendering (Requirement 4.10, its own sibling file), the surface-selection and
 * handover behaviour of the landing route, and the retry path of the generic
 * failure.
 *
 * Feature: web-squads-screens, Property 12: An unusable invite yields one message on either surface
 * Validates: Requirements 4.8, 5.10
 */
import { describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { MemoryRouter } from 'react-router-dom';

import { HOME_ROUTE } from '../../app-shell';
import { AuthProvider, type AuthState, type SessionManager } from '../../auth';
import type { CallResult, SquadsApi } from '../api/squadsApi';
import { JOIN_SQUAD_OUTCOME_REGION_ID } from '../components/JoinSquadForm';
import { LOADING_INDICATION_SELECTOR } from '../components/LoadingIndication';
import { classifyOutcome } from '../lib/callOutcome';
import {
  GENERIC_SQUADS_FAILURE,
  INVITE_SECRET_LABEL,
  INVITE_UNUSABLE,
  JOIN_DISPLAY_NAME_LABEL,
  JOIN_SQUAD_HEADING,
  JOIN_SQUAD_SUBMIT_LABEL,
  SQUADS_HOME_CONTROL_LABEL,
} from '../lib/messages';
import type { InvitePreview } from '../lib/parse/invitePreview';
import type { Redemption } from '../lib/parse/redemption';
import type { SquadSummary } from '../lib/parse/squadSummary';
import { inviteLandingPath } from '../lib/routePaths';
import {
  INVITE_HANDOVER_SELECTOR,
  INVITE_LANDING_SELECTOR,
  InviteLandingScreen,
} from './InviteLandingScreen';
import { SquadsHome } from './SquadsHome';

// --- The three outcomes, and the answers they arrive as ----------------------

/**
 * The three outcomes Requirements 4.8 and 5.10 name, which the interface must
 * not tell apart.
 */
type UnusableOutcome = 'matches-no-invite' | 'revoked' | 'expired';

const UNUSABLE_OUTCOMES: readonly UnusableOutcome[] = [
  'matches-no-invite',
  'revoked',
  'expired',
];

/** One non-disclosing answer the backend may give about an unusable invite. */
interface WireAnswer {
  readonly status: number;
  readonly problemCode: string | null;
}

/**
 * Every shape a "you cannot use this invite" answer reaches the client as.
 *
 * `410 InviteUnusable` is what the backend sends for all three outcomes alike;
 * `410` with no `code` extension is the same status with the body a proxy may
 * have stripped; and `404`/`403` are the concealment an existence-sensitive read
 * answers with, which the feature folds in beside it because it is the same
 * non-disclosing answer about the same invite.
 *
 * The pool is shared by all three outcomes on purpose: drawing from it
 * independently per outcome is what lets the property assert the message stays
 * identical *even when the three answers differ*.
 */
const NON_DISCLOSING_ANSWERS: readonly WireAnswer[] = [
  { status: 410, problemCode: 'InviteUnusable' },
  { status: 410, problemCode: null },
  { status: 404, problemCode: null },
  { status: 403, problemCode: null },
  { status: 404, problemCode: 'NotAMember' },
];

/**
 * The settled outcome a wire answer classifies to, through the feature's real
 * classifier rather than a hand-picked kind.
 *
 * The two accepted kinds are asserted here as well, so a change to
 * `classifyOutcome` that stopped mapping one of these answers onto the
 * invite-unusable branch reports itself as a failure of the mapping rather than
 * as a mysteriously wrong message.
 */
function settledAnswer(answer: WireAnswer): CallResult<Redemption> {
  const outcome = classifyOutcome({
    status: answer.status,
    timedOut: false,
    problemCode: answer.problemCode,
    parsed: false,
  });

  if (outcome.kind === 'success') {
    throw new Error(
      `a non-disclosing answer must not classify as a success: ${JSON.stringify(answer)}`,
    );
  }

  const namesAnUnusableInvite =
    outcome.kind === 'not-found' ||
    (outcome.kind === 'rejected-input' && outcome.reason === 'invite-unusable');

  if (!namesAnUnusableInvite) {
    throw new Error(
      `a non-disclosing answer must classify as an unusable invite, but ${JSON.stringify(answer)} classified as ${outcome.kind}`,
    );
  }

  return outcome;
}

// --- Generators --------------------------------------------------------------

/** The characters generated identifiers and names are drawn from. */
const TOKEN_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split('');

/**
 * A distinctive token, long enough that its appearance in a rendering is
 * evidence of a leak rather than a coincidence of ordinary English.
 */
const tokenArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TOKEN_CHARACTERS), { minLength: 10, maxLength: 14 })
  .map((characters) => characters.join(''));

/** An Invite_Secret that survives `inviteLandingPath` and the extraction. */
const secretArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TOKEN_CHARACTERS), { minLength: 6, maxLength: 10 })
  .map((characters) => characters.join(''));

const wireAnswerArb: fc.Arbitrary<WireAnswer> = fc.constantFrom(
  ...NON_DISCLOSING_ANSWERS,
);

/** One wire answer per outcome, drawn independently of each other. */
const answersPerOutcomeArb: fc.Arbitrary<
  Readonly<Record<UnusableOutcome, WireAnswer>>
> = fc.record({
  'matches-no-invite': wireAnswerArb,
  revoked: wireAnswerArb,
  expired: wireAnswerArb,
});

/** The values that must not reach a rendering, and the squad they describe. */
interface DisclosureCase {
  readonly squadName: string;
  readonly squadId: string;
  readonly displayName: string;
}

const disclosureCaseArb: fc.Arbitrary<DisclosureCase> = fc.record({
  squadName: tokenArb.map((token) => `Squad-${token}`),
  squadId: fc.uuid(),
  displayName: tokenArb.map((token) => `Player-${token}`),
});

/** The values a rendering of an unusable invite must not contain. */
function disclosableValues(
  disclosure: DisclosureCase,
): readonly [string, string, string] {
  return [disclosure.squadName, disclosure.squadId, disclosure.displayName];
}

// --- The seams ---------------------------------------------------------------

/** A Squads_Api method neither surface has any business calling. */
function unavailable(method: string): () => never {
  return () => {
    throw new Error(`Property 12 does not permit a ${method} call`);
  };
}

/** A Squads_Api with every method refused, to be overridden selectively. */
function refusingApi(): SquadsApi {
  return {
    listMySquads: unavailable('listMySquads'),
    getSquad: unavailable('getSquad'),
    getDisplayRatingLeaderboard: unavailable('getDisplayRatingLeaderboard'),
    createSquad: unavailable('createSquad'),
    redeemInvite: unavailable('redeemInvite'),
    previewInvite: unavailable('previewInvite'),
    listInvites: unavailable('listInvites'),
    generateInvite: unavailable('generateInvite'),
    revokeInvite: unavailable('revokeInvite'),
    createGuest: unavailable('createGuest'),
    editGuest: unavailable('editGuest'),
    promoteToAdmin: unavailable('promoteToAdmin'),
    getFeatureFlags: unavailable('getFeatureFlags'),
    setFeatureFlag: unavailable('setFeatureFlag'),
  };
}

/** A `SessionManager` whose reported Auth_State can be moved from a test. */
interface ControllableSession {
  readonly manager: SessionManager;
  /** Report a new Auth_State and notify the provider, as a real session does. */
  advanceTo(state: AuthState): void;
}

/**
 * A `SessionManager` reporting one Auth_State and publishing transitions.
 *
 * `AuthProvider` seeds from `getState()` and stays in step through `subscribe`,
 * so notifying a listener is exactly how a session arriving mid-render reaches
 * the Invite_Landing_Route in the application.
 */
function controllableSession(initial: AuthState): ControllableSession {
  let state = initial;
  const listeners = new Set<(next: AuthState) => void>();

  return {
    manager: {
      bootstrap: () => state,
      establish: () => undefined,
      getState: () => state,
      getAccessTokenForRequest: () => Promise.resolve({ token: 'test-token' }),
      signOut: () => Promise.resolve(),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    advanceTo: (next) => {
      state = next;
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
  };
}

// --- Reading a settled surface ----------------------------------------------

/**
 * The text of the single live region a settled surface renders, read without
 * looking for the message the property expects.
 *
 * Both candidate surfaces announce through `role="status"` — the unusable
 * paragraph and the `FailureNotice` message alike — so whichever the screen
 * settled on is what enters the comparison. The busy indication is waited out
 * first, since it carries `role="status"` too while a call is in flight.
 */
async function settledMessageWithin(container: HTMLElement): Promise<string> {
  await waitFor(() => {
    expect(container.querySelector(LOADING_INDICATION_SELECTOR)).toBeNull();
    expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
    expect(
      container.querySelector('[role="status"], [role="alert"]')?.textContent ?? '',
    ).not.toBe('');
  });

  const region = container.querySelector('[role="status"], [role="alert"]');
  return region?.textContent ?? '';
}

// --- The Join_Code_Form surface ---------------------------------------------

/** What one submission of the Join_Code_Form settled into. */
interface FormObservation {
  /** The message the form's outcome region settled on. */
  readonly message: string;
  /** The full text of that region, for the non-disclosure check. */
  readonly regionText: string;
  /** Whether the form is still rendered with the submitted secret retained. */
  readonly formRetained: boolean;
}

/**
 * Open the Join_Code_Form on the Squads_Home, submit the generated secret and
 * display name, and read the outcome the given answer produces.
 *
 * The listing carries the generated squad name and identity, so the screen holds
 * both while it renders the outcome — which is what makes "the message names
 * neither" a claim about the rendering rather than about an empty screen.
 */
async function observeFormOutcome(options: {
  readonly answer: WireAnswer;
  readonly secret: string;
  readonly disclosure: DisclosureCase;
}): Promise<FormObservation> {
  const { answer, secret, disclosure } = options;

  const summary: SquadSummary = {
    squadId: disclosure.squadId,
    name: disclosure.squadName,
    role: 'Owner',
    state: 'Active',
  };

  const api: SquadsApi = {
    ...refusingApi(),
    listMySquads: () =>
      Promise.resolve<CallResult<readonly SquadSummary[]>>({
        kind: 'success',
        value: [summary],
      }),
    redeemInvite: () => Promise.resolve(settledAnswer(answer)),
  };

  const user = userEvent.setup({ delay: null });

  render(
    <AuthProvider manager={controllableSession('authenticated').manager}>
      <MemoryRouter initialEntries={[HOME_ROUTE]}>
        <SquadsHome api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );

  await user.click(screen.getByRole('button', { name: JOIN_SQUAD_HEADING }));
  await user.type(screen.getByLabelText(INVITE_SECRET_LABEL), secret);
  await user.type(screen.getByLabelText(JOIN_DISPLAY_NAME_LABEL), disclosure.displayName);
  await user.click(screen.getByRole('button', { name: JOIN_SQUAD_SUBMIT_LABEL }));

  const region = await waitFor(() => {
    const found = document.getElementById(JOIN_SQUAD_OUTCOME_REGION_ID);
    expect(found).not.toBeNull();
    expect(found?.textContent ?? '').not.toBe('');
    return found as HTMLElement;
  });

  const secretField = screen.queryByLabelText(INVITE_SECRET_LABEL);

  return {
    message: region.textContent ?? '',
    regionText: region.textContent ?? '',
    // 4.9: an unusable invite leaves the form where it was, with its values.
    formRetained: secretField !== null && (secretField as HTMLInputElement).value === secret,
  };
}

// --- The Invite_Landing_Route surface ---------------------------------------

/** What the Invite_Landing_Route settled into for one answer. */
interface LandingObservation {
  /** The message the route's live region settled on. */
  readonly message: string;
  /** The whole rendered surface's text, for the non-disclosure check. */
  readonly surfaceText: string;
  /** The `href` of every control offering the Squads_Home. */
  readonly homeControlTargets: readonly (string | null)[];
  /** Whether the handover surface is gone, as the unusable phase requires. */
  readonly handoverGone: boolean;
}

/**
 * Render the Invite_Landing_Route for the generated secret and read the outcome
 * the given answer produces.
 *
 * `previewMessage` chooses between the two ways the route reaches a redemption:
 * `null` mounts already authenticated, so no `PreviewInvite` is issued at all;
 * anything else mounts unauthenticated, asserts that wording reached the
 * handover surface, and then lets the session arrive — so the redemption settles
 * with a preview instruction still on the machine's state.
 */
async function observeLandingOutcome(options: {
  readonly answer: WireAnswer;
  readonly secret: string;
  readonly previewMessage: string | null;
}): Promise<LandingObservation> {
  const { answer, secret, previewMessage } = options;

  const session = controllableSession(
    previewMessage === null ? 'authenticated' : 'unauthenticated',
  );

  const api: SquadsApi = {
    ...refusingApi(),
    previewInvite: () => {
      if (previewMessage === null) {
        throw new Error(
          'a mount that was already authenticated must issue no PreviewInvite',
        );
      }

      return Promise.resolve<CallResult<InvitePreview>>({
        kind: 'success',
        value: { requiresAuthentication: true, message: previewMessage },
      });
    },
    redeemInvite: () => Promise.resolve(settledAnswer(answer)),
  };

  render(
    <AuthProvider manager={session.manager}>
      <MemoryRouter initialEntries={[inviteLandingPath(secret)]}>
        <InviteLandingScreen api={api} />
      </MemoryRouter>
    </AuthProvider>,
  );

  if (previewMessage !== null) {
    // The preview's own wording reaches the handover surface first, so its
    // later absence is a fact about the unusable rendering.
    await waitFor(() => {
      const handover = document.querySelector(INVITE_HANDOVER_SELECTOR);
      expect(handover).not.toBeNull();
      expect(handover?.textContent ?? '').toContain(previewMessage);
    });

    await act(async () => {
      session.advanceTo('authenticated');
    });
  }

  const landing = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(INVITE_LANDING_SELECTOR);
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });

  const message = await settledMessageWithin(landing);

  const homeControls = within(landing).queryAllByRole('link', {
    name: SQUADS_HOME_CONTROL_LABEL,
  });

  return {
    message,
    surfaceText: landing.textContent ?? '',
    homeControlTargets: homeControls.map((control) =>
      control.getAttribute('href'),
    ),
    handoverGone: landing.querySelector(INVITE_HANDOVER_SELECTOR) === null,
  };
}

// --- The assertions ----------------------------------------------------------

/**
 * Requirements 4.8 and 5.10: one message, the same one, wherever and whichever
 * of the three outcomes produced it.
 *
 * Stated three ways deliberately. Mutual identity alone would be satisfied by a
 * screen that rendered the Generic_Squads_Failure for everything, so the message
 * is also pinned to {@link INVITE_UNUSABLE} and held apart from
 * {@link GENERIC_SQUADS_FAILURE} — an unusable invite is a settled answer about
 * the invite, not a failure to obtain one.
 */
function expectOneMessageEverywhere(messages: readonly string[]): void {
  expect(messages.length).toBeGreaterThan(0);

  const distinct = new Set(messages);
  expect([...distinct]).toEqual([INVITE_UNUSABLE]);
  expect(distinct.has(GENERIC_SQUADS_FAILURE)).toBe(false);
}

/**
 * Requirement 5.10: no Squad_Name, no squad identity, and no
 * Player_Display_Name in the rendering.
 *
 * Compared case-insensitively, so a rendering that merely recased a leaked value
 * is caught too.
 */
function expectNoDisclosure(
  rendering: string,
  disclosure: DisclosureCase,
): void {
  const haystack = rendering.toLowerCase();

  for (const value of disclosableValues(disclosure)) {
    expect(haystack).not.toContain(value.toLowerCase());
  }
}

/**
 * Requirement 5.10: the landing surface presents a control navigating to the
 * Squads_Home — exactly one, and at the App_Shell's own `HOME_ROUTE`.
 */
function expectSquadsHomeControl(
  observation: LandingObservation,
): void {
  expect(observation.homeControlTargets).toEqual([HOME_ROUTE]);
  // 5.12: the handover surface belongs to a route still waiting for a session;
  // a settled unusable answer replaces it rather than sitting beside it.
  expect(observation.handoverGone).toBe(true);
}

/**
 * Observe one surface and report the message it settled on, unmounting it
 * whatever happened — so a failed assertion on the first surface cannot leave a
 * rendered tree behind for the second.
 */
async function messageOf(
  observe: () => Promise<{ readonly message: string }>,
): Promise<string> {
  try {
    return (await observe()).message;
  } finally {
    cleanup();
  }
}

// --- The property ------------------------------------------------------------

describe('Property 12 — an unusable invite yields one message on either surface', () => {
  // Feature: web-squads-screens, Property 12: An unusable invite yields one message on either surface
  // Validates: Requirements 4.8, 5.10
  it('renders one identical message on the Join_Code_Form for all three outcomes, naming nothing', async () => {
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        disclosureCaseArb,
        answersPerOutcomeArb,
        async (secret, disclosure, answers) => {
          const messages: string[] = [];

          for (const outcome of UNUSABLE_OUTCOMES) {
            try {
              const observation = await observeFormOutcome({
                answer: answers[outcome],
                secret,
                disclosure,
              });

              messages.push(observation.message);

              // 5.10 as it applies to this surface: the message names neither
              // the squad the screen is listing nor the name that was typed.
              expectNoDisclosure(observation.regionText, disclosure);
              // 4.9: the form is still there, with the submitted secret in it.
              expect(observation.formRetained).toBe(true);
            } finally {
              cleanup();
            }
          }

          // 4.8: one message, identical across matches-no-invite, revoked, and
          // expired — even though the three answers may have differed.
          expectOneMessageEverywhere(messages);
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 12: An unusable invite yields one message on either surface
  // Validates: Requirements 5.10
  it('renders one identical message on the Invite_Landing_Route for all three outcomes, naming nothing, with a control to the Squads_Home', async () => {
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        disclosureCaseArb,
        answersPerOutcomeArb,
        fc.boolean(),
        async (secret, disclosure, answers, authenticatedAtMount) => {
          // The hostile preview: generic in production, and here carrying every
          // value the unusable surface must not disclose, so its absence
          // afterwards is a fact about the rendering.
          const previewMessage = authenticatedAtMount
            ? null
            : `Sign in to join ${disclosure.squadName} (${disclosure.squadId}) as ${disclosure.displayName}.`;

          const messages: string[] = [];

          for (const outcome of UNUSABLE_OUTCOMES) {
            try {
              const observation = await observeLandingOutcome({
                answer: answers[outcome],
                secret,
                previewMessage,
              });

              messages.push(observation.message);

              // 5.10: no Squad_Name, no squad identity, no display name — over
              // the whole surface, nothing here having been entered by a person.
              expectNoDisclosure(observation.surfaceText, disclosure);
              expectSquadsHomeControl(observation);
            } finally {
              cleanup();
            }
          }

          expectOneMessageEverywhere(messages);
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);

  // Feature: web-squads-screens, Property 12: An unusable invite yields one message on either surface
  // Validates: Requirements 4.8, 5.10
  it('renders the same message on both surfaces for the same answer', async () => {
    await fc.assert(
      fc.asyncProperty(
        secretArb,
        disclosureCaseArb,
        wireAnswerArb,
        async (secret, disclosure, answer) => {
          const formMessage = await messageOf(() =>
            observeFormOutcome({ answer, secret, disclosure }),
          );
          const landingMessage = await messageOf(() =>
            observeLandingOutcome({ answer, secret, previewMessage: null }),
          );

          // The surface a person happened to arrive through changes nothing
          // about what they are told (Requirements 4.8, 5.10).
          expect(landingMessage).toBe(formMessage);
          expectOneMessageEverywhere([formMessage, landingMessage]);
        },
      ),
      { numRuns: 100 },
    );
  }, 300_000);
});
