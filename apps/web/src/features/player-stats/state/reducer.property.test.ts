// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { PlayerProfile } from '../lib/parse/playerProfile';
import { subjectKey } from '../lib/subject';
import {
  FULL_PROFILE_FIXTURE,
  MINIMAL_PROFILE_FIXTURE,
  playerProfileArb,
  SAMPLE_IDENTITY,
} from '../testing/playerProfileFixtures';
import {
  initialPlayerStatsState,
  reducePlayerStats,
  type PlayerStatsAction,
  type PlayerStatsState,
  type ProfilePhase,
} from './usePlayerStatsScreen';

/**
 * Property tests for the Player_Stats_Screen's load machine, exercised as what
 * Requirement 2.7 asks it to be: a pure, total reducer that can be driven by
 * folding actions over it with no browser, no timers, and no transport in
 * sight. Nothing in this file renders, mounts, or awaits — if any of it needed
 * to, the requirement would not be met.
 *
 * ## Why this property, and what would break without it
 *
 * The machine is the only thing between a settled `GetPlayerProfile` call and
 * what a person reads on the screen, and three of the feature's presentation
 * requirements are stated as facts about *which state holds a profile*:
 *
 *  - Requirement 2.2's bare loading indication is the `loading` phase, which
 *    holds none;
 *  - Requirement 2.3's "keep the profile on screen while re-reading it" is the
 *    `refreshing` phase, which holds one;
 *  - Requirements 3.1 and 4.1 forbid a boundary presentation from rendering a
 *    profile value, so `notFound` and `failed` must hold none.
 *
 * A reducer that let a profile linger behind a failure, or that entered
 * `loading` while one was held, would not make the screen crash: it would make
 * the screen render a stale profile beside a failure notice, or blank a profile
 * that was still perfectly good to look at. Neither defect is visible in a
 * single-transition unit test of the arm that caused it — both are properties of
 * *sequences*. So this file quantifies over sequences.
 *
 * ## The three halves of Property 29
 *
 * 1. **Totality and exception-freedom.** Folding any generated action sequence
 *    from any generated state raises nothing — including from states no real run
 *    could reach, and including actions outside the declared union, which is the
 *    one input the `default` arm exists for.
 * 2. **Purity.** The same fold of the same sequence from the same state yields
 *    the same result, twice over and with another scenario's fold interleaved;
 *    and the state handed in is never written to, which is asserted by handing
 *    in a **frozen** one so a write would throw rather than merely be noticed.
 * 3. **The profile invariant.** A folded state whose phase is `idle`,
 *    `notFound`, or `failed` holds no profile; and a `requested` action enters
 *    `refreshing` exactly when a profile is held, and `loading` exactly when
 *    none is.
 *
 * ## The oracle runs the sequence backwards
 *
 * The agreement claim ({@link oracleFold}) is held against an independently
 * written model that reaches the same answer by the opposite route: rather than
 * folding forward, it scans the sequence **from the end** for the last action
 * that *determines* each of the three fields, and falls back to the start state
 * where no action does. Which actions determine the held profile
 * ({@link PROFILE_DETERMINING}) and which determine the described subject
 * ({@link SUBJECT_DETERMINING}) is written out as data, so a failure means the
 * requirement is broken rather than that the switch statement was transcribed
 * twice. The model's own shape is the thing worth reading: `requested` appears
 * in neither list, because carrying the profile and the subject through a
 * re-read is exactly what Requirement 2.3 asks for.
 *
 * ## What is deliberately generated
 *
 * - **Sequences long enough to interleave.** Up to 24 actions drawn from a
 *   small pool of profiles and subject keys, so the same profile object and the
 *   same subject recur and a reference-equality claim means something.
 * - **Start states that are reachable, and start states that are not.** The
 *   invariant is asserted over folds from reachable states (where it holds for
 *   the empty sequence too) and over folds of at least one action from *any*
 *   state, including incoherent ones like `{ phase: 'idle', profile: … }` that
 *   no run produces. The second form is the sharper claim: it says the reducer
 *   restores the invariant rather than merely preserving it.
 * - **Profiles the Response_Parser can actually produce.** Held profiles come
 *   from the shared fixtures, so a profile here is one the parser yields rather
 *   than a shape invented for this file.
 *
 * ## Not claimed here
 *
 * That exactly one call is issued per subject (Property 30), that an
 * unidentifiable route renders identically to a concealed absence
 * (Property 31), and that leaving the screen abandons a call in flight
 * (Property 32). All three are claims about the hook and the screen around this
 * reducer; each consumes these transitions and none re-decides them.
 */

/* -------------------------------------------------------------------------- */
/* The two unions, pinned                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every phase the machine can be in.
 *
 * Pinned from both directions: the tuple must consist of phases
 * ({@link ProfilePhase} via `satisfies`), and {@link PHASE_COVERAGE} must
 * account for every phase — so a seventh phase added to the union lands here at
 * compile time rather than slipping past a generator that never produced it.
 */
const PROFILE_PHASES = [
  'idle',
  'loading',
  'refreshing',
  'loaded',
  'notFound',
  'failed',
] as const satisfies readonly ProfilePhase[];

/** Each phase accounted for, so a new one cannot be added unnoticed. */
const PHASE_COVERAGE: Record<ProfilePhase, (typeof PROFILE_PHASES)[number]> = {
  idle: 'idle',
  loading: 'loading',
  refreshing: 'refreshing',
  loaded: 'loaded',
  notFound: 'notFound',
  failed: 'failed',
};

/** The name of one action of the machine. */
type ActionType = PlayerStatsAction['type'];

/**
 * Every action the machine declares, pinned the same way as the phases.
 *
 * A seventh action would have to be listed here — and, being listed, would be
 * generated into every sequence below, which is the point: a transition added
 * without a thought for the profile invariant is caught by the invariant rather
 * than by a reviewer.
 */
const ACTION_TYPES = [
  'unidentifiable',
  'requested',
  'accepted',
  'notFound',
  'failed',
  'discarded',
] as const satisfies readonly ActionType[];

/** Each action accounted for, so a new one cannot be added unnoticed. */
const ACTION_TYPE_COVERAGE: Record<ActionType, true> = {
  unidentifiable: true,
  requested: true,
  accepted: true,
  notFound: true,
  failed: true,
  discarded: true,
};

/**
 * The phases Requirement 2.7's invariant names: the three in which the screen
 * presents no Player_Profile value at all, and so in which the machine must be
 * holding none.
 *
 * `idle` is the state before the first call and after a `discarded`
 * (Requirement 2.5); `notFound` is the Not_Found_Treatment (Requirement 3.1);
 * `failed` is the Generic_Profile_Failure (Requirement 4.1).
 */
const PROFILE_FREE_PHASES = [
  'idle',
  'notFound',
  'failed',
] as const satisfies readonly ProfilePhase[];

/* -------------------------------------------------------------------------- */
/* The oracle                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The actions that decide what profile is held afterwards, and what they decide
 * it to be: `accepted` installs the one it carries, and the four settled
 * non-successes each clear it.
 *
 * `requested` is absent, and that absence is Requirement 2.3: a re-read carries
 * the held profile through rather than replacing it, which is the only reason
 * `refreshing` can render one.
 */
const PROFILE_DETERMINING = [
  'accepted',
  'unidentifiable',
  'notFound',
  'failed',
  'discarded',
] as const satisfies readonly ActionType[];

/**
 * The actions that decide what subject is described afterwards: `requested`
 * records the one it was issued for, and the two actions that describe no
 * subject at all clear it.
 *
 * `accepted`, `notFound`, and `failed` are absent because an outcome pertains to
 * whatever was asked for — the subject is read from the request, never from the
 * response.
 */
const SUBJECT_DETERMINING = [
  'requested',
  'unidentifiable',
  'discarded',
] as const satisfies readonly ActionType[];

/** Whether an action decides the held profile. */
function decidesProfile(type: ActionType): boolean {
  return (PROFILE_DETERMINING as readonly ActionType[]).includes(type);
}

/** Whether an action decides the described subject. */
function decidesSubject(type: ActionType): boolean {
  return (SUBJECT_DETERMINING as readonly ActionType[]).includes(type);
}

/**
 * The profile held after the first `count` actions, by scanning backwards for
 * the last action that decided one.
 *
 * The reference is carried, never copied, so a caller can compare with `toBe`
 * and know the reducer passed the parsed value through rather than
 * reconstructing it.
 */
function oracleProfile(
  start: PlayerStatsState,
  actions: readonly PlayerStatsAction[],
  count: number,
): PlayerProfile | null {
  for (let index = count - 1; index >= 0; index -= 1) {
    const action = actions[index];

    if (action.type === 'accepted') {
      return action.profile;
    }

    if (decidesProfile(action.type)) {
      return null;
    }
  }

  return start.profile;
}

/** The subject described after the first `count` actions, scanning backwards. */
function oracleSubjectKey(
  start: PlayerStatsState,
  actions: readonly PlayerStatsAction[],
  count: number,
): string | null {
  for (let index = count - 1; index >= 0; index -= 1) {
    const action = actions[index];

    if (action.type === 'requested') {
      return action.subjectKey;
    }

    if (decidesSubject(action.type)) {
      return null;
    }
  }

  return start.subjectKey;
}

/**
 * The phase after the first `count` actions.
 *
 * Every action but one settles the phase on its own name; `requested` is the
 * exception, and it asks the only question the machine really asks — *was a
 * profile held?* (Requirements 2.2, 2.3).
 */
function oraclePhase(
  start: PlayerStatsState,
  actions: readonly PlayerStatsAction[],
  count: number,
): ProfilePhase {
  if (count === 0) {
    return start.phase;
  }

  const last = actions[count - 1];

  switch (last.type) {
    case 'unidentifiable':
      return 'notFound';
    case 'notFound':
      return 'notFound';
    case 'failed':
      return 'failed';
    case 'discarded':
      return 'idle';
    case 'accepted':
      return 'loaded';
    case 'requested':
      return oracleProfile(start, actions, count - 1) === null
        ? 'loading'
        : 'refreshing';
  }
}

/** The whole state after folding `actions`, derived without folding. */
function oracleFold(
  start: PlayerStatsState,
  actions: readonly PlayerStatsAction[],
): PlayerStatsState {
  return {
    phase: oraclePhase(start, actions, actions.length),
    profile: oracleProfile(start, actions, actions.length),
    subjectKey: oracleSubjectKey(start, actions, actions.length),
  };
}

/* -------------------------------------------------------------------------- */
/* Folding                                                                    */
/* -------------------------------------------------------------------------- */

/** The reducer folded over a sequence, which is all the hook ever does to it. */
function fold(
  start: PlayerStatsState,
  actions: readonly PlayerStatsAction[],
): PlayerStatsState {
  return actions.reduce(
    (state, action) => reducePlayerStats(state, action),
    start,
  );
}

/**
 * A shallow frozen copy of a state.
 *
 * Handed to the reducer so that a write to any of its three fields throws —
 * under ES module strictness, assigning to a frozen property is a `TypeError`,
 * which turns "the reducer does not mutate its argument" from something a test
 * has to look for into something it cannot miss.
 */
function frozen(state: PlayerStatsState): PlayerStatsState {
  return Object.freeze({ ...state });
}

/** The three fields, for a comparison that ignores object identity. */
function triple(state: PlayerStatsState): {
  phase: ProfilePhase;
  profile: PlayerProfile | null;
  subjectKey: string | null;
} {
  return {
    phase: state.phase,
    profile: state.profile,
    subjectKey: state.subjectKey,
  };
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A profile the machine could be holding.
 *
 * Drawn from the shared fixtures, so every value is one the Response_Parser can
 * actually yield. The two fixed samples carry most of the weight because the
 * reducer never looks inside a profile — what matters here is that the *same
 * object* recurs often enough for a reference-equality claim to bite — while the
 * generated shapes keep the empty, singleton, and 200-by-500 extremes in the
 * input space rather than quietly out of it.
 */
const heldProfileArb: fc.Arbitrary<PlayerProfile> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.constantFrom(
      MINIMAL_PROFILE_FIXTURE.parsed,
      FULL_PROFILE_FIXTURE.parsed,
    ),
  },
  { weight: 2, arbitrary: playerProfileArb },
);

/**
 * A subject key, mostly as `subjectKey` builds one from a well-formed pair.
 *
 * The reducer treats the key as an opaque string, so the degenerate spellings
 * are in the space too: the machine must not acquire an opinion about a value
 * whose only job is to be compared for equality elsewhere.
 */
const subjectKeyArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc
      .tuple(fc.uuid(), fc.uuid())
      .map(([squadId, membershipId]) =>
        subjectKey({ squadId, membershipId }),
      ),
  },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      subjectKey({ squadId: SAMPLE_IDENTITY, membershipId: SAMPLE_IDENTITY }),
      '',
      ' ',
      'not-a-subject-key',
    ),
  },
);

/**
 * One action, named and paired with an index into the scenario's pools.
 *
 * Drafting an action as a name plus an index is what lets a whole sequence draw
 * from a *small* pool of profiles and subject keys: a sequence that accepted a
 * freshly generated profile every time would never exercise "the same profile
 * arrived twice", and would cost a 500-point progression per action.
 */
interface ActionDraft {
  readonly type: ActionType;
  readonly index: number;
}

/**
 * An action draft, weighted towards the two that carry a value.
 *
 * `requested` and `accepted` are the transitions with any arithmetic in them;
 * the other four are constants, and a uniform draw would spend two thirds of
 * every sequence on them.
 */
const actionDraftArb: fc.Arbitrary<ActionDraft> = fc.record({
  type: fc.oneof(
    { weight: 4, arbitrary: fc.constant<ActionType>('requested') },
    { weight: 4, arbitrary: fc.constant<ActionType>('accepted') },
    { weight: 2, arbitrary: fc.constant<ActionType>('notFound') },
    { weight: 2, arbitrary: fc.constant<ActionType>('failed') },
    { weight: 1, arbitrary: fc.constant<ActionType>('unidentifiable') },
    { weight: 1, arbitrary: fc.constant<ActionType>('discarded') },
  ),
  index: fc.nat({ max: 15 }),
});

/** The values a scenario's actions are drawn from. */
interface ActionPools {
  readonly profiles: readonly PlayerProfile[];
  readonly subjectKeys: readonly string[];
}

/** One draft turned into the action the hook would dispatch. */
function materialise(
  draft: ActionDraft,
  pools: ActionPools,
): PlayerStatsAction {
  switch (draft.type) {
    case 'requested':
      return {
        type: 'requested',
        subjectKey:
          pools.subjectKeys[draft.index % pools.subjectKeys.length],
      };
    case 'accepted':
      return {
        type: 'accepted',
        profile: pools.profiles[draft.index % pools.profiles.length],
      };
    default:
      return { type: draft.type };
  }
}

/** A sequence of actions, with the pool it was drawn from. */
interface Scenario {
  readonly pools: ActionPools;
  readonly actions: readonly PlayerStatsAction[];
}

/** A sequence of the given length, drawn from a small pool of values. */
function scenarioArb(
  bounds: { minLength?: number; maxLength?: number } = {},
): fc.Arbitrary<Scenario> {
  return fc
    .record({
      profiles: fc.array(heldProfileArb, { minLength: 1, maxLength: 3 }),
      subjectKeys: fc.array(subjectKeyArb, { minLength: 1, maxLength: 3 }),
      drafts: fc.array(actionDraftArb, {
        minLength: bounds.minLength ?? 0,
        maxLength: bounds.maxLength ?? 24,
      }),
    })
    .map(({ profiles, subjectKeys, drafts }) => {
      const pools: ActionPools = { profiles, subjectKeys };

      return {
        pools,
        actions: drafts.map((draft) => materialise(draft, pools)),
      };
    });
}

/** Any sequence at all, the empty one included. */
const anyScenarioArb: fc.Arbitrary<Scenario> = scenarioArb();

/** A sequence of at least one action. */
const actingScenarioArb: fc.Arbitrary<Scenario> = scenarioArb({ minLength: 1 });

/**
 * A state the machine can actually be in: the initial state with some sequence
 * folded into it.
 *
 * This is the population the invariant holds over *unconditionally*, the empty
 * sequence included — which is what makes the stronger claim below (that a fold
 * of one action restores the invariant from even an incoherent state) worth
 * stating separately rather than instead.
 */
const reachableStateArb: fc.Arbitrary<PlayerStatsState> = anyScenarioArb.map(
  (scenario) => fold(initialPlayerStatsState(), scenario.actions),
);

/**
 * Any triple of the three field types, coherent or not — `{ phase: 'idle',
 * profile: … }` and `{ phase: 'loaded', profile: null }` included.
 *
 * No run produces these. They are generated because totality and purity are
 * claims about the function rather than about its reachable inputs, and because
 * a reducer that *restores* the invariant is a stronger thing than one that
 * merely never breaks it.
 */
const freeStateArb: fc.Arbitrary<PlayerStatsState> = fc.record({
  phase: fc.constantFrom(...PROFILE_PHASES),
  profile: fc.option(heldProfileArb, { nil: null }),
  subjectKey: fc.option(subjectKeyArb, { nil: null }),
});

/** The reducer's whole input domain for a start state. */
const startStateArb: fc.Arbitrary<PlayerStatsState> = fc.oneof(
  { weight: 5, arbitrary: reachableStateArb },
  { weight: 4, arbitrary: freeStateArb },
  { weight: 1, arbitrary: fc.constant(initialPlayerStatsState()) },
);

/**
 * Values that are not actions of this machine: a name from a future version, an
 * empty name, a missing name, and shapes a dispatch could never produce but a
 * total function must still answer for.
 *
 * The one cast in this file, and the reason the reducer has a `default` arm at
 * all. Each is handed in as an action so that the arm is exercised rather than
 * merely trusted.
 */
const UNKNOWN_ACTIONS: readonly PlayerStatsAction[] = [
  { type: 'succeeded' },
  { type: 'notfound' },
  { type: 'NOTFOUND' },
  { type: '' },
  { type: 42 },
  { type: null },
  {},
  [],
].map((value) => value as unknown as PlayerStatsAction);

/* -------------------------------------------------------------------------- */
/* The unions are the unions                                                  */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('the machine declares exactly the phases and actions this suite folds', () => {
  it('accounts for every phase', () => {
    // Pinned from both directions, so a phase added to the union without being
    // generated here fails the build rather than going unexercised.
    expect(Object.keys(PHASE_COVERAGE).toSorted()).toEqual(
      [...PROFILE_PHASES].toSorted(),
    );
  });

  it('accounts for every action', () => {
    expect(Object.keys(ACTION_TYPE_COVERAGE).toSorted()).toEqual(
      [...ACTION_TYPES].toSorted(),
    );
  });

  it('names the profile-free phases as a subset of the phases', () => {
    for (const phase of PROFILE_FREE_PHASES) {
      expect(PROFILE_PHASES).toContain(phase);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Total                                                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('reducePlayerStats — folding any sequence from any state raises nothing', () => {
  it('raises nothing for any start state and any action sequence', () => {
    fc.assert(
      fc.property(startStateArb, anyScenarioArb, (start, scenario) => {
        // Requirement 2.7's "total": there is no state and no sequence of
        // actions for which the machine has no answer, so no dispatch order the
        // hook could produce can fault the screen.
        expect(() => fold(frozen(start), scenario.actions)).not.toThrow();
      }),
      { numRuns: 600 },
    );
  });

  it('yields one of the declared phases, for any start state and sequence', () => {
    fc.assert(
      fc.property(startStateArb, anyScenarioArb, (start, scenario) => {
        const result = fold(frozen(start), scenario.actions);

        // Single-valued as well as total: the phase is always one the screen
        // knows how to render, so there is no state it would fall through.
        expect(PROFILE_PHASES).toContain(result.phase);
      }),
      { numRuns: 600 },
    );
  });

  it('yields a state whose three fields are of their declared types', () => {
    fc.assert(
      fc.property(startStateArb, anyScenarioArb, (start, scenario) => {
        const result = fold(frozen(start), scenario.actions);

        expect(typeof result.phase).toBe('string');
        expect(
          result.profile === null || typeof result.profile === 'object',
        ).toBe(true);
        expect(
          result.subjectKey === null || typeof result.subjectKey === 'string',
        ).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('returns the state unchanged for an action it does not declare', () => {
    fc.assert(
      fc.property(
        startStateArb,
        fc.constantFrom(...UNKNOWN_ACTIONS),
        (start, action) => {
          const state = frozen(start);

          // The `default` arm: a value that is not one of the six actions moves
          // nothing. Asserted by reference, because returning an equal copy
          // would still re-render the screen for no reason.
          expect(reducePlayerStats(state, action)).toBe(state);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('raises nothing for an undeclared action in the middle of a sequence', () => {
    fc.assert(
      fc.property(
        startStateArb,
        actingScenarioArb,
        fc.constantFrom(...UNKNOWN_ACTIONS),
        fc.nat(),
        (start, scenario, unknown, position) => {
          const at = position % (scenario.actions.length + 1);
          const spliced = [
            ...scenario.actions.slice(0, at),
            unknown,
            ...scenario.actions.slice(at),
          ];

          // An inert action is inert *in context* too: the fold reaches the same
          // state it would have reached without it.
          expect(triple(fold(frozen(start), spliced))).toEqual(
            triple(fold(frozen(start), scenario.actions)),
          );
        },
      ),
      { numRuns: 400 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Pure                                                                       */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('reducePlayerStats — the same fold yields the same state, and writes nothing', () => {
  it('yields the same result on a repeated fold of the same sequence', () => {
    fc.assert(
      fc.property(startStateArb, anyScenarioArb, (start, scenario) => {
        const state = frozen(start);
        const first = fold(state, scenario.actions);
        const second = fold(state, scenario.actions);

        // Requirement 2.7's "pure": no clock, no counter, and no module state,
        // so the hook's `stateRef` fold and React's own reducer call cannot
        // disagree about where the machine got to.
        expect(triple(second)).toEqual(triple(first));
        expect(second.profile).toBe(first.profile);
      }),
      { numRuns: 600 },
    );
  });

  it('is unaffected by another scenario folded in between', () => {
    fc.assert(
      fc.property(
        startStateArb,
        anyScenarioArb,
        startStateArb,
        anyScenarioArb,
        (start, scenario, otherStart, otherScenario) => {
          const state = frozen(start);
          const before = fold(state, scenario.actions);

          // Two screens' worth of folding in one process: a Pairwise_Link
          // navigation runs a second subject's actions through the same
          // function, and the first subject's answer must not shift under it.
          fold(frozen(otherStart), otherScenario.actions);

          const after = fold(state, scenario.actions);

          expect(triple(after)).toEqual(triple(before));
          expect(after.profile).toBe(before.profile);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves the state it was handed exactly as it was', () => {
    fc.assert(
      fc.property(startStateArb, actingScenarioArb, (start, scenario) => {
        const state = frozen(start);
        const before = triple(state);

        fold(state, scenario.actions);

        // Frozen, so a write would already have thrown; compared as well, so a
        // silent failure to throw is still caught.
        expect(triple(state)).toEqual(before);
      }),
      { numRuns: 400 },
    );
  });

  it('agrees with a model that scans the sequence backwards', () => {
    fc.assert(
      fc.property(startStateArb, anyScenarioArb, (start, scenario) => {
        const state = frozen(start);
        const result = fold(state, scenario.actions);
        const expected = oracleFold(state, scenario.actions);

        // The whole transition table, by a different route: the last action
        // that decided each field rather than a forward fold. The profile is
        // compared by reference, so the parsed value must have been carried
        // through rather than rebuilt.
        expect(result.phase).toBe(expected.phase);
        expect(result.subjectKey).toBe(expected.subjectKey);
        expect(result.profile).toBe(expected.profile);
      }),
      { numRuns: 1000 },
    );
  });

  it('yields a fresh state value rather than the one it was handed', () => {
    fc.assert(
      fc.property(startStateArb, actingScenarioArb, (start, scenario) => {
        const state = frozen(start);

        // Every declared action produces a new object, which is what lets React
        // see the change. (An undeclared action does not, and is claimed above.)
        expect(fold(state, scenario.actions)).not.toBe(state);
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Never holds a profile it should not                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('reducePlayerStats — idle, notFound, and failed hold no profile', () => {
  it('holds no profile in a profile-free phase, folding from a reachable state', () => {
    fc.assert(
      fc.property(reachableStateArb, anyScenarioArb, (start, scenario) => {
        const result = fold(frozen(start), scenario.actions);

        // The population the screen actually meets, the empty sequence
        // included: a state the machine can reach whose phase renders no
        // profile value is holding none (Requirements 3.1, 4.1).
        if ((PROFILE_FREE_PHASES as readonly ProfilePhase[]).includes(result.phase)) {
          expect(result.profile).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('restores the invariant from any state at all, after one action', () => {
    fc.assert(
      fc.property(freeStateArb, actingScenarioArb, (start, scenario) => {
        const result = fold(frozen(start), scenario.actions);

        // The sharper form: even starting from an incoherent state no run
        // produces — `{ phase: 'idle', profile: … }` — one action is enough to
        // put the machine back inside the invariant. So the guarantee does not
        // depend on the hook's dispatch order being right.
        if ((PROFILE_FREE_PHASES as readonly ProfilePhase[]).includes(result.phase)) {
          expect(result.profile).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('clears the held profile on each settled non-success, from any state', () => {
    fc.assert(
      fc.property(
        startStateArb,
        fc.constantFrom<PlayerStatsAction>(
          { type: 'notFound' },
          { type: 'failed' },
          { type: 'unidentifiable' },
          { type: 'discarded' },
        ),
        (start, action) => {
          // Stated per action as well as over sequences, so a regression names
          // the arm that caused it: no boundary presentation can render a
          // partially populated profile beside it.
          expect(reducePlayerStats(frozen(start), action).profile).toBeNull();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never holds a profile the sequence did not deliver', () => {
    fc.assert(
      fc.property(reachableStateArb, anyScenarioArb, (start, scenario) => {
        const result = fold(frozen(start), scenario.actions);

        if (result.profile === null) return;

        const delivered = scenario.actions
          .filter((action) => action.type === 'accepted')
          .map((action) => action.profile);

        // "Never holds a profile it should not", in its strongest form: a held
        // profile is, by reference, one an `accepted` action carried — or the
        // one the start state already held. Nothing is synthesised, defaulted,
        // or merged.
        expect(
          delivered.includes(result.profile) ||
            result.profile === start.profile,
        ).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('holds no profile while loading, over every reachable state', () => {
    fc.assert(
      fc.property(reachableStateArb, (state) => {
        // A corollary of the request rule rather than a separate decision, and
        // the fact Requirement 2.2 rests on: `loading` is reachable only from a
        // request made with nothing held, so the loading indication never
        // appears beside a profile it is about to replace.
        if (state.phase === 'loading') {
          expect(state.profile).toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* A request refreshes exactly when a profile is held                         */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('reducePlayerStats — a request enters refreshing exactly when a profile is held', () => {
  it('chooses between loading and refreshing by whether a profile is held', () => {
    fc.assert(
      fc.property(startStateArb, subjectKeyArb, (start, key) => {
        const result = reducePlayerStats(frozen(start), {
          type: 'requested',
          subjectKey: key,
        });

        // The biconditional, both directions at once. Which busy phase a
        // request enters is decided by the held profile and by nothing else —
        // not by the previous phase, and not by which control issued it — which
        // is why the mount effect, the subject-change effect, and the retry
        // control need no phase knowledge of their own (Requirements 2.2, 2.3).
        expect(result.phase === 'refreshing').toBe(start.profile !== null);
        expect(result.phase === 'loading').toBe(start.profile === null);
      }),
      { numRuns: 1000 },
    );
  });

  it('carries the held profile through the refresh, by reference', () => {
    fc.assert(
      fc.property(startStateArb, subjectKeyArb, (start, key) => {
        const result = reducePlayerStats(frozen(start), {
          type: 'requested',
          subjectKey: key,
        });

        // Requirement 2.3 renders the previously accepted profile beside a busy
        // state, so the re-read must carry the very value — not a copy, and not
        // a reduced summary.
        expect(result.profile).toBe(start.profile);
      }),
      { numRuns: 600 },
    );
  });

  it('records the subject the request was issued for', () => {
    fc.assert(
      fc.property(startStateArb, subjectKeyArb, (start, key) => {
        const result = reducePlayerStats(frozen(start), {
          type: 'requested',
          subjectKey: key,
        });

        // The key the screen compares against to tell "this state describes the
        // subject on screen" from "this state describes the subject we just
        // left" (Requirement 2.4). Taken from the request, because no other
        // action carries a subject.
        expect(result.subjectKey).toBe(key);
      }),
      { numRuns: 600 },
    );
  });

  it('enters refreshing after an acceptance and loading after a failure', () => {
    fc.assert(
      fc.property(
        startStateArb,
        heldProfileArb,
        subjectKeyArb,
        fc.constantFrom<PlayerStatsAction>(
          { type: 'failed' },
          { type: 'notFound' },
          { type: 'discarded' },
          { type: 'unidentifiable' },
        ),
        (start, profile, key, clearing) => {
          const request: PlayerStatsAction = { type: 'requested', subjectKey: key };

          // The two sequences the requirement is really about, stated as
          // sequences: a re-read of a loaded profile refreshes, and a retry
          // after a failure loads — because the failure took the profile with
          // it (Requirement 2.8).
          expect(
            fold(frozen(start), [{ type: 'accepted', profile }, request]).phase,
          ).toBe('refreshing');
          expect(fold(frozen(start), [clearing, request]).phase).toBe(
            'loading',
          );
        },
      ),
      { numRuns: 600 },
    );
  });

  it('settles a request into loaded on acceptance, keeping the subject', () => {
    fc.assert(
      fc.property(startStateArb, subjectKeyArb, heldProfileArb, (start, key, profile) => {
        const result = fold(frozen(start), [
          { type: 'requested', subjectKey: key },
          { type: 'accepted', profile },
        ]);

        // An outcome pertains to what was asked for, so the subject survives
        // the response that answers it.
        expect(result.phase).toBe('loaded');
        expect(result.profile).toBe(profile);
        expect(result.subjectKey).toBe(key);
      }),
      { numRuns: 600 },
    );
  });

  it('returns a discard to exactly the initial state', () => {
    fc.assert(
      fc.property(startStateArb, (start) => {
        // Requirement 2.5: an ended session or a departed screen displays no
        // profile value, and describes no subject either — the latch closes on
        // the state the machine started in.
        expect(reducePlayerStats(frozen(start), { type: 'discarded' })).toEqual(
          initialPlayerStatsState(),
        );
      }),
      { numRuns: 400 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Non-vacuity                                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 29: The reducer is pure, total, and never holds a profile it should not
// Validates: Requirements 2.7
describe('the generated sequences reach every phase and both sides of the request rule', () => {
  it('reaches every declared phase by folding from the initial state', () => {
    const reached = new Set(
      fc
        .sample(anyScenarioArb, { numRuns: 400, seed: 29 })
        .map(
          (scenario) =>
            fold(initialPlayerStatsState(), scenario.actions).phase,
        ),
    );

    // Without this, a reducer that answered `notFound` to everything would
    // satisfy the invariant against a generator that never reached `loaded`.
    for (const phase of PROFILE_PHASES) {
      expect({ phase, reached: reached.has(phase) }).toEqual({
        phase,
        reached: true,
      });
    }
  });

  it('produces states both holding and not holding a profile', () => {
    const states = fc.sample(reachableStateArb, { numRuns: 400, seed: 2 });

    // Both sides of the request rule have to occur, or the biconditional above
    // would be half-tested.
    expect(states.some((state) => state.profile !== null)).toBe(true);
    expect(states.some((state) => state.profile === null)).toBe(true);
  });

  it('produces sequences that accept a profile and then clear it', () => {
    const scenarios = fc.sample(actingScenarioArb, { numRuns: 400, seed: 41 });

    const acceptedThenCleared = scenarios.some((scenario) => {
      const acceptedAt = scenario.actions.findIndex(
        (action) => action.type === 'accepted',
      );

      return (
        acceptedAt >= 0 &&
        scenario.actions
          .slice(acceptedAt + 1)
          .some(
            (action) =>
              action.type !== 'accepted' && decidesProfile(action.type),
          )
      );
    });

    // The sequence that the "no profile behind a failure" claim exists for.
    expect(acceptedThenCleared).toBe(true);
  });

  it('produces sequences that re-request an already held profile', () => {
    const scenarios = fc.sample(actingScenarioArb, { numRuns: 400, seed: 23 });

    const refreshed = scenarios.some(
      (scenario) =>
        fold(initialPlayerStatsState(), scenario.actions).phase ===
        'refreshing',
    );

    expect(refreshed).toBe(true);
  });

  it('produces sequences long enough to interleave, over a pool of few profiles', () => {
    const scenarios = fc.sample(anyScenarioArb, { numRuns: 400, seed: 7 });

    // Short sequences would never exercise an interleaving, and a fresh profile
    // per action would make the reference-equality claims vacuous.
    expect(scenarios.some((scenario) => scenario.actions.length >= 8)).toBe(
      true,
    );
    expect(
      scenarios.some((scenario) => scenario.pools.profiles.length === 1),
    ).toBe(true);
  });
});
