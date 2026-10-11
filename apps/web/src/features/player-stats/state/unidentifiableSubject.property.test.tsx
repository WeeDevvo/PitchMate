// Feature: web-player-stats-screen, Property 31: An unidentifiable subject is indistinguishable from a concealed absence
// Validates: Requirements 3.3

import { useEffect, type JSX } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CallResult, PlayerStatsApi } from '../api/playerStatsApi';
import { classifyOutcome } from '../lib/callOutcome';
import { isPlayerStatsIdentifier } from '../lib/identifiers';
import {
  GENERIC_PROFILE_FAILURE,
  NOT_FOUND_TREATMENT_HEADING,
  NOT_FOUND_TREATMENT_STATEMENT,
  PLAYER_STATS_HEADING,
  PROFILE_LOADING_LABEL,
  RETRY_LABEL,
} from '../lib/messages';
import type { PlayerProfile } from '../lib/parse/playerProfile';
import { readSubject, type Subject } from '../lib/subject';
import { playerProfileFixtureArb } from '../testing/playerProfileFixtures';
import {
  usePlayerStatsScreen,
  type PlayerStatsScreenMachine,
} from './usePlayerStatsScreen';

/**
 * Property tests for the one claim that makes a mistyped path safe: a route the
 * Player_Stats_Feature **cannot even read** must be presented exactly as a route
 * it read perfectly and was refused.
 *
 * ## What is claimed, and why it matters
 *
 * `GetPlayerProfile` answers `404` for five quite different situations — a squad
 * that does not exist, a membership that does not exist, a membership belonging
 * to another squad, a caller who is not an active member, and a missing,
 * malformed, or expired token — and the feature renders one Not_Found_Treatment
 * for all five (Requirement 3.2). Requirement 3.3 extends that concealment
 * *below* the transport: where either route identity is not a well-formed
 * identifier, **no call is issued at all**, and the screen still renders the
 * same treatment. Without this, the screen would answer a probe: a malformed
 * identity would come back instantly and a well-formed inaccessible one would
 * come back after a round trip and perhaps with different wording, which between
 * them would let someone sift real identities out of invented ones.
 *
 * So two things are asserted together per generated route, and neither is
 * sufficient alone:
 *
 * | Clause | Assertion |
 * | --- | --- |
 * | no call is issued | the injected {@link PlayerStatsApi} records **zero** calls, from the mount effect and from the retry control alike |
 * | the output is identical | the rendered surface, as normalised markup, equals byte-for-byte the surface rendered for a concealed not-found at a *different* route |
 *
 * ## Why a harness component, and what it is faithful to
 *
 * The Player_Stats_Screen does not exist yet — it is a later task — so the
 * surface below renders from `usePlayerStatsScreen`'s exposed state through
 * exactly the four-way condition selection the design's screen table fixes:
 * not-found, failed, nothing-held, otherwise the profile. That selection is the
 * whole mechanism under test. The machine exposes `notFound` as a single boolean
 * that is true for a concealed absence *and* for an unidentifiable subject, so
 * **any** renderer driven by this state renders the two identically; what the
 * property has to rule out is a tell reaching the surface by some *other* field
 * — a residual profile, a busy flag still set, a failure flag also set, a
 * subject key rendered as a value.
 *
 * Two deliberate exclusions from the compared surface, both stated rather than
 * quietly dropped:
 *
 * 1. **The route-derived control to the squad.** The Not_Found_Treatment also
 *    presents a control navigating to the Squad_Path of the route's squad
 *    identity (Requirement 3.5). Its target is a function of the *route*, not of
 *    the *cause*, and the two legs of this comparison necessarily sit at
 *    different routes — so including it would compare two paths rather than two
 *    presentations of one outcome. The control is claimed by the
 *    Not_Found_Treatment component's own tests and by the heading-outline and
 *    keyboard properties; what is claimed *here* is that nothing else about the
 *    surface varies, and the identity checks below additionally require that
 *    neither route's identities reach the markup at all.
 * 2. **`subjectKey`.** It is `null` for an unidentifiable subject and the
 *    requested subject's key for a concealed absence, because the machine uses
 *    it to tell "this state describes the subject on screen" from "this state
 *    describes the subject we just left" (Requirement 2.4). It is an internal
 *    correspondence marker, never user-facing copy — so it is asserted to differ
 *    and asserted *not* to reach the markup, which is the stronger pair of
 *    claims.
 *
 * ## Non-vacuity
 *
 * A surface that rendered the same markup in every condition would satisfy the
 * equality trivially. The final suite therefore shows the harness is sensitive:
 * the loading, failed, and loaded surfaces each differ from the not-found
 * surface, and the failed surface in particular — the one a careless machine
 * would send a malformed route to — differs visibly.
 *
 * ## Not claimed here
 *
 * That the classifier conceals `401`, `403`, and `404` behind one kind (Property
 * 2), that `readSubject` admits a subject exactly when both identities are well
 * formed (`lib/subject.property.test.ts`), that one call is issued per subject
 * (Property 30), and that leaving the screen abandons everything (Property 32).
 * Each is its own file; nothing below re-decides any of them.
 */

/* -------------------------------------------------------------------------- */
/* Driving React                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How many microtask turns {@link flush} drains.
 *
 * A settled call runs through several chained `then`s — the stub's promise, the
 * hook's `settle` path, React's update — so one turn is not enough. Sixteen is
 * comfortably more than the deepest chain and costs nothing, since draining an
 * empty queue is free.
 */
const MICROTASK_ROUNDS = 16;

/** Let every resolved promise deliver and every resulting update apply. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < MICROTASK_ROUNDS; round += 1) {
      await Promise.resolve();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* The recording Player_Stats_Api                                             */
/* -------------------------------------------------------------------------- */

/** One `GetPlayerProfile` call the hook issued. */
interface RecordedCall {
  readonly squadId: string;
  readonly membershipId: string;
}

/** A Player_Stats_Api that records every call and answers each the same way. */
interface StubApi {
  /** The facade to hand to the surface. */
  readonly api: PlayerStatsApi;
  /** Every call issued, in the order issued. */
  readonly calls: readonly RecordedCall[];
}

/**
 * Create a Player_Stats_Api answering every call with `answer`, or never
 * answering at all when `answer` is `null`.
 *
 * The never-answering form is how the loading surface is reached for the
 * non-vacuity comparison: the call simply stays in flight, so no timer and no
 * faked clock is needed anywhere in this file.
 */
function createStubApi(answer: CallResult<PlayerProfile> | null): StubApi {
  const calls: RecordedCall[] = [];

  return {
    calls,
    api: {
      getPlayerProfile(squadId, membershipId) {
        calls.push({ squadId, membershipId });

        return answer === null
          ? new Promise<CallResult<PlayerProfile>>(() => undefined)
          : Promise.resolve(answer);
      },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The rendered surface                                                       */
/* -------------------------------------------------------------------------- */

/** Marks the region whose markup is compared. */
const SURFACE_TEST_ID = 'player-stats-surface';

/** What {@link ProfileSurface} needs: the seam, the subject, and a peephole. */
interface ProfileSurfaceProps {
  readonly api: PlayerStatsApi;
  readonly subject: Subject | null;
  /**
   * Receives the machine on every render, so a run can activate the retry
   * control.
   *
   * A plain mutable box rather than a rendered control, because a control would
   * become part of the compared markup — and the retry control is a *failure*
   * affordance that the Not_Found_Treatment deliberately does not present
   * (Requirement 4.3).
   */
  readonly machineRef: { current: PlayerStatsScreenMachine | null };
}

/**
 * The Player_Stats_Screen's condition selection, and nothing else.
 *
 * The four branches are the design's screen table in order of precedence:
 * not-found first, then failed, then nothing-held, then the profile. Every
 * string comes from `lib/messages.ts`, as the real screen's will, so no wording
 * is invented here.
 */
function ProfileSurface({
  api,
  subject,
  machineRef,
}: ProfileSurfaceProps): JSX.Element {
  const machine = usePlayerStatsScreen({ api, subject });

  // Published after the commit rather than during the render, so the surface
  // stays a pure function of its props and the box always holds the machine the
  // document was rendered from. No dependency list, so every commit republishes.
  useEffect(() => {
    machineRef.current = machine;
  });

  return (
    <main data-testid={SURFACE_TEST_ID}>
      {machine.notFound ? (
        // 3.1, 3.3: the Not_Found_Treatment and nothing else. The route-derived
        // control to the squad sits outside the compared surface; see the module
        // comment.
        <section>
          <h1>{NOT_FOUND_TREATMENT_HEADING}</h1>
          <p>{NOT_FOUND_TREATMENT_STATEMENT}</p>
        </section>
      ) : machine.failed ? (
        // 4.1, 4.3: the generic failure and its retry control, never the
        // Not_Found_Treatment.
        <section>
          <h1>{PLAYER_STATS_HEADING}</h1>
          <p>{GENERIC_PROFILE_FAILURE}</p>
          <button type="button">{RETRY_LABEL}</button>
        </section>
      ) : machine.profile === null ? (
        // 2.2: no profile held, so a bare loading indication.
        <section>
          <h1>{PLAYER_STATS_HEADING}</h1>
          <p>{machine.busy ? PROFILE_LOADING_LABEL : null}</p>
        </section>
      ) : (
        // 2.3: a held profile renders, beside a busy indication while it is
        // being re-read. Enough of the profile to make a residual value visible
        // in the markup.
        <section>
          <h1>{machine.profile.displayName}</h1>
          <p>{machine.profile.membershipId}</p>
          <p>{String(machine.profile.record.appearances)}</p>
          <p>{machine.busy ? PROFILE_LOADING_LABEL : null}</p>
        </section>
      )}
    </main>
  );
}

/** React-generated `useId` values, which differ between two mounts. */
const REACT_GENERATED_ID = /:r[0-9a-z]+:/gi;

/**
 * The markup of a surface, with the one incidental per-mount difference
 * neutralised.
 *
 * Nothing else is normalised — not whitespace, not attribute order, not text —
 * because every other difference between two renderings of this surface is
 * exactly the kind of difference the property exists to forbid.
 */
function normaliseMarkup(markup: string): string {
  return markup.replace(REACT_GENERATED_ID, '«generated-id»');
}

/** One mounted surface. */
interface Mounted {
  /** The compared region's markup, normalised. */
  markup(): string;
  /** The machine as of the last commit. */
  machine(): PlayerStatsScreenMachine;
  /** Activate the retry control, as a person would. */
  activateRetry(): Promise<void>;
  /** Leave the screen and clear the document. */
  unmount(): void;
}

/** Mount the surface over a stub seam and settle its mount effects. */
async function mountSurface(
  api: PlayerStatsApi,
  subject: Subject | null,
): Promise<Mounted> {
  const machineRef: { current: PlayerStatsScreenMachine | null } = {
    current: null,
  };

  const rendered = render(
    <ProfileSurface api={api} subject={subject} machineRef={machineRef} />,
  );

  await flush();

  const machine = (): PlayerStatsScreenMachine => {
    const current = machineRef.current;

    if (current === null) {
      throw new Error('the surface rendered without driving the machine');
    }

    return current;
  };

  return {
    markup: () =>
      normaliseMarkup(rendered.getByTestId(SURFACE_TEST_ID).innerHTML),
    machine,
    activateRetry: async (): Promise<void> => {
      await act(async () => {
        machine().retry();
        await Promise.resolve();
      });
      await flush();
    },
    unmount: () => {
      rendered.unmount();
      cleanup();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Generated routes                                                           */
/* -------------------------------------------------------------------------- */

/** A well-formed route identity, in both letter cases. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc.uuid().map((identity) => identity.toUpperCase()),
);

/**
 * The shapes of a route identity that is **not** an identifier.
 *
 * Every form the task names is here, plus the ones a real mistyped or
 * hand-edited URL produces. They matter separately because each would defeat a
 * differently-written check: `unhyphenated` defeats a check that strips
 * separators, `leading-whitespace` and `trailing-whitespace` defeat one that
 * trims, `braced` and `urn` defeat one that searches for an identity inside the
 * segment, `over-long` defeats one that matches a prefix, and `blank` defeats
 * one that treats a non-empty segment as present.
 */
const MALFORMED_FORMS = [
  'absent',
  'empty',
  'blank',
  'unhyphenated',
  'braced',
  'parenthesised',
  'urn',
  'leading-whitespace',
  'trailing-whitespace',
  'too-short',
  'over-long',
  'non-hexadecimal',
  'underscored',
  'word',
  'arbitrary-text',
] as const;

/** One shape of a route identity that is not an identifier. */
type MalformedForm = (typeof MALFORMED_FORMS)[number];

/** Values of the named malformed form. */
function malformedValueArb(
  form: MalformedForm,
): fc.Arbitrary<string | undefined> {
  switch (form) {
    case 'absent':
      return fc.constant(undefined);
    case 'empty':
      return fc.constant('');
    case 'blank':
      return fc.constantFrom(' ', '   ', '\t', '\n', '\u00a0');
    case 'unhyphenated':
      return identityArb.map((identity) => identity.replaceAll('-', ''));
    case 'braced':
      return identityArb.map((identity) => `{${identity}}`);
    case 'parenthesised':
      return identityArb.map((identity) => `(${identity})`);
    case 'urn':
      return identityArb.map((identity) => `urn:uuid:${identity}`);
    case 'leading-whitespace':
      return identityArb.map((identity) => ` ${identity}`);
    case 'trailing-whitespace':
      return identityArb.map((identity) => `${identity} `);
    case 'too-short':
      return identityArb.chain((identity) =>
        fc
          .integer({ min: 1, max: 20 })
          .map((dropped) => identity.slice(0, identity.length - dropped)),
      );
    case 'over-long':
      return identityArb.chain((identity) =>
        fc
          .integer({ min: 1, max: 200 })
          .map((extra) => `${identity}${'a'.repeat(extra)}`),
      );
    case 'non-hexadecimal':
      return identityArb.chain((identity) =>
        fc
          .integer({ min: 0, max: identity.length - 1 })
          .filter((position) => identity[position] !== '-')
          .map(
            (position) =>
              `${identity.slice(0, position)}z${identity.slice(position + 1)}`,
          ),
      );
    case 'underscored':
      return identityArb.map((identity) => identity.replaceAll('-', '_'));
    case 'word':
      return fc.constantFrom(
        'me',
        'players',
        'profile',
        'undefined',
        'null',
        'NaN',
        '0',
        '..',
      );
    case 'arbitrary-text':
      return fc.string({ maxLength: 60 });
  }
}

/** A malformed route identity, paired with the form it was drawn from. */
interface MalformedIdentity {
  readonly form: MalformedForm;
  readonly value: string | undefined;
}

/**
 * A route identity that is not an identifier, in any of its shapes.
 *
 * Filtered through the feature's own check as a backstop: a generator that
 * happened to produce a well-formed identity would make the run test the
 * *valid* path while claiming to test the invalid one, and the filter rules that
 * out without the generators having to be provably exhaustive.
 */
const malformedIdentityArb: fc.Arbitrary<MalformedIdentity> = fc
  .constantFrom(...MALFORMED_FORMS)
  .chain((form) =>
    malformedValueArb(form)
      .filter((value) => !isPlayerStatsIdentifier(value))
      .map((value) => ({ form, value })),
  );

/** Which of the route's two identities is malformed. */
const MALFORMED_SIDES = ['squad', 'membership', 'both'] as const;

/** Which of the route's two identities is malformed. */
type MalformedSide = (typeof MALFORMED_SIDES)[number];

/**
 * A route the feature cannot read, and the well-formed route whose concealed
 * not-found it must be indistinguishable from.
 *
 * The comparison route's identities are generated **independently**, so the two
 * legs sit at genuinely different routes. That is deliberate: a surface that
 * rendered either route's identity — in text, in an attribute, in a `title` —
 * would fail the markup equality rather than slipping through a comparison of
 * two renders at the same path.
 */
interface RouteScenario {
  /** Which identity of the unreadable route is malformed. */
  readonly side: MalformedSide;
  /** The malformed route's squad identity, as the route carried it. */
  readonly squadId: string | undefined;
  /** The malformed route's membership identity, as the route carried it. */
  readonly membershipId: string | undefined;
  /** The forms the malformed identities were drawn from, for the counterexample. */
  readonly forms: readonly MalformedForm[];
  /** The well-formed route the concealed not-found is read at. */
  readonly concealed: Subject;
  /**
   * The status the backend concealed the absence behind — one of the three the
   * classifier collapses into `not-found`.
   */
  readonly concealedStatus: number;
  /** Whether that response's body parsed, which must not change the outcome. */
  readonly concealedParsed: boolean;
}

/** The three statuses `GetPlayerProfile` conceals an absence behind. */
const CONCEALED_STATUSES = [401, 403, 404] as const;

/**
 * A well-formed subject, built through `readSubject` so it is a pair the route
 * really resolves rather than one invented here.
 */
function requireSubject(squadId: string, membershipId: string): Subject {
  const subject = readSubject(squadId, membershipId);

  if (subject === null) {
    throw new Error(
      `the generated pair ${squadId}/${membershipId} is not a valid subject`,
    );
  }

  return subject;
}

const routeScenarioArb: fc.Arbitrary<RouteScenario> = fc
  .record({
    side: fc.constantFrom(...MALFORMED_SIDES),
    malformedSquad: malformedIdentityArb,
    malformedMembership: malformedIdentityArb,
    validSquad: identityArb,
    validMembership: identityArb,
    concealedSquad: identityArb,
    concealedMembership: identityArb,
    concealedStatus: fc.constantFrom(...CONCEALED_STATUSES),
    concealedParsed: fc.boolean(),
  })
  .map((drawn) => {
    const squadMalformed = drawn.side !== 'membership';
    const membershipMalformed = drawn.side !== 'squad';

    return {
      side: drawn.side,
      squadId: squadMalformed
        ? drawn.malformedSquad.value
        : drawn.validSquad,
      membershipId: membershipMalformed
        ? drawn.malformedMembership.value
        : drawn.validMembership,
      forms: [
        ...(squadMalformed ? [drawn.malformedSquad.form] : []),
        ...(membershipMalformed ? [drawn.malformedMembership.form] : []),
      ],
      concealed: requireSubject(
        drawn.concealedSquad,
        drawn.concealedMembership,
      ),
      concealedStatus: drawn.concealedStatus,
      concealedParsed: drawn.concealedParsed,
    };
  });

/* -------------------------------------------------------------------------- */
/* Shared assertions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The route values whose appearance in the markup would be a disclosure.
 *
 * Short and whitespace-only values are dropped, because `''` is a substring of
 * every string and `' '` of every indented fragment — asserting their absence
 * would fail for reasons that have nothing to do with disclosure.
 */
function disclosableValues(
  scenario: RouteScenario,
): readonly string[] {
  return [
    scenario.squadId,
    scenario.membershipId,
    scenario.concealed.squadId,
    scenario.concealed.membershipId,
  ].filter(
    (value): value is string =>
      typeof value === 'string' && value.trim().length >= 4,
  );
}

/** Assert that no route identity reached the markup, in any form. */
function expectNoIdentityDisclosed(
  markup: string,
  scenario: RouteScenario,
): void {
  const lowered = markup.toLowerCase();

  for (const value of disclosableValues(scenario)) {
    expect(lowered).not.toContain(value.toLowerCase());
  }
}

/* -------------------------------------------------------------------------- */
/* The property                                                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 31: An unidentifiable subject is indistinguishable from a concealed absence
// Validates: Requirements 3.3
describe('Property 31 — an unidentifiable subject issues no call and renders a concealed absence', () => {
  it('renders markup identical to a concealed not-found, having issued nothing', async () => {
    await fc.assert(
      fc.asyncProperty(routeScenarioArb, async (scenario) => {
        // The premise: the route's two parameters resolve to no subject at all.
        // One well-formed identity beside one malformed one is not a partial
        // subject — there is nothing to call for.
        const subject = readSubject(scenario.squadId, scenario.membershipId);
        expect(subject).toBeNull();

        // --- the unreadable route -----------------------------------------
        const unreadableApi = createStubApi({ kind: 'not-found' });
        const unreadable = await mountSurface(unreadableApi.api, subject);

        let unreadableMarkup: string;

        try {
          // 3.3: no call is issued. Not one deferred, not one aborted — none.
          expect(unreadableApi.calls).toHaveLength(0);

          const machine = unreadable.machine();
          expect(machine.phase).toBe('notFound');
          expect(machine.notFound).toBe(true);
          expect(machine.failed).toBe(false);
          expect(machine.busy).toBe(false);
          expect(machine.profile).toBeNull();

          // 3.3: and nothing issues one later either. The retry control is the
          // one remaining entry point into the issue site, and it has nothing to
          // call for.
          await unreadable.activateRetry();
          expect(unreadableApi.calls).toHaveLength(0);
          expect(unreadable.machine().phase).toBe('notFound');

          unreadableMarkup = unreadable.markup();
        } finally {
          unreadable.unmount();
        }

        // --- the well-formed, inaccessible route --------------------------
        // The backend's concealment, read through the classifier rather than
        // asserted here: whichever of the three statuses it sent, and whether or
        // not its body parsed, the feature learns only `not-found`.
        const outcome = classifyOutcome({
          status: scenario.concealedStatus,
          timedOut: false,
          parsed: scenario.concealedParsed,
        });
        expect(outcome.kind).toBe('not-found');

        const concealedApi = createStubApi({ kind: 'not-found' });
        const concealed = await mountSurface(
          concealedApi.api,
          scenario.concealed,
        );

        let concealedMarkup: string;

        try {
          // The comparison leg is the real thing: a call was issued, for the
          // route's own pair, and refused.
          expect(concealedApi.calls).toHaveLength(1);
          expect(concealedApi.calls[0].squadId).toBe(
            scenario.concealed.squadId,
          );
          expect(concealedApi.calls[0].membershipId).toBe(
            scenario.concealed.membershipId,
          );

          const machine = concealed.machine();
          expect(machine.phase).toBe('notFound');
          expect(machine.notFound).toBe(true);
          expect(machine.failed).toBe(false);
          expect(machine.busy).toBe(false);
          expect(machine.profile).toBeNull();

          concealedMarkup = concealed.markup();
        } finally {
          concealed.unmount();
        }

        // 3.3: the claim itself. Identical markup, from two different routes,
        // one of which was never read and one of which was read and refused.
        expect(unreadableMarkup).toBe(concealedMarkup);

        // Stronger than the equality, and not implied by it: neither route's
        // identities reached the surface at all, so the markup cannot encode
        // which route produced it.
        expectNoIdentityDisclosed(unreadableMarkup, scenario);
        expectNoIdentityDisclosed(concealedMarkup, scenario);
      }),
      // Comfortably above the 100-run floor, and enough that each of the fifteen
      // malformed forms is met on each side many times over.
      { numRuns: 150 },
    );
  }, 180_000);

  it('records a subject key for the concealed absence and none for the unreadable route, and renders neither', async () => {
    await fc.assert(
      fc.asyncProperty(routeScenarioArb, async (scenario) => {
        // The one state field that *does* differ between the two legs, asserted
        // deliberately rather than left as a surprise. It is the machine's
        // internal marker for "the state describes the subject on screen"
        // (Requirement 2.4) — never copy, never part of a request — so what
        // matters is that it stays out of the markup.
        const unreadableApi = createStubApi({ kind: 'not-found' });
        const unreadable = await mountSurface(
          unreadableApi.api,
          readSubject(scenario.squadId, scenario.membershipId),
        );

        try {
          expect(unreadable.machine().subjectKey).toBeNull();
        } finally {
          unreadable.unmount();
        }

        const concealedApi = createStubApi({ kind: 'not-found' });
        const concealed = await mountSurface(
          concealedApi.api,
          scenario.concealed,
        );

        try {
          const key = concealed.machine().subjectKey;

          expect(key).not.toBeNull();
          expect(concealed.markup()).not.toContain(key ?? '');
        } finally {
          concealed.unmount();
        }
      }),
      { numRuns: 100 },
    );
  }, 120_000);
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity: the surface is sensitive to the condition                     */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 31: An unidentifiable subject is indistinguishable from a concealed absence
// Validates: Requirements 3.3
describe('Property 31 — the compared surface distinguishes every other condition', () => {
  /** A fixed well-formed subject; this suite varies the outcome, not the route. */
  const SUBJECT = requireSubject(
    '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b',
    '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5c',
  );

  /** The not-found markup every other condition is compared against. */
  async function notFoundMarkup(): Promise<string> {
    const stub = createStubApi({ kind: 'not-found' });
    const mounted = await mountSurface(stub.api, SUBJECT);

    try {
      return mounted.markup();
    } finally {
      mounted.unmount();
    }
  }

  it('renders the failed condition differently from the not-found condition', async () => {
    const baseline = await notFoundMarkup();

    for (const kind of ['timeout', 'transport-failure', 'parse-failure'] as const) {
      const stub = createStubApi({ kind });
      const mounted = await mountSurface(stub.api, SUBJECT);

      try {
        expect(mounted.machine().failed).toBe(true);
        expect(mounted.markup()).not.toBe(baseline);
        expect(mounted.markup()).toContain(GENERIC_PROFILE_FAILURE);
      } finally {
        mounted.unmount();
      }
    }
  });

  it('renders the loading condition differently from the not-found condition', async () => {
    const baseline = await notFoundMarkup();

    const stub = createStubApi(null);
    const mounted = await mountSurface(stub.api, SUBJECT);

    try {
      expect(mounted.machine().busy).toBe(true);
      expect(mounted.markup()).not.toBe(baseline);
      expect(mounted.markup()).toContain(PROFILE_LOADING_LABEL);
    } finally {
      mounted.unmount();
    }
  });

  it('renders a loaded profile differently from the not-found condition', async () => {
    const baseline = await notFoundMarkup();

    await fc.assert(
      fc.asyncProperty(
        playerProfileFixtureArb({
          pairwise: { minLength: 0, maxLength: 2 },
          progression: { minLength: 0, maxLength: 3 },
        }).map((fixture) => fixture.parsed),
        async (profile) => {
          const stub = createStubApi({ kind: 'success', value: profile });
          const mounted = await mountSurface(stub.api, SUBJECT);

          try {
            expect(mounted.machine().profile).toBe(profile);
            expect(mounted.markup()).not.toBe(baseline);
          } finally {
            mounted.unmount();
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120_000);
});
