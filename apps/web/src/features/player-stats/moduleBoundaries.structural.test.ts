/**
 * Structural source scan: module containment, the public barrel, and import
 * direction (task 15.1).
 *
 * Requirement 14.6 makes this file part of the product rather than a courtesy
 * check. The rules it enforces are stated as universals and prohibitions —
 * "place every module it adds under `apps/web/src/features/player-stats/`, and
 * expose exactly one barrel module as its public entry point" (14.1), "export
 * only the route registration, the screen, the Player_Stats_Api factory, and
 * their option and dependency types" (14.2), "resolve no import outside its own
 * root other than to the App_Shell barrel, the Squads_Feature barrel, the
 * Auth_Feature barrel, and the shared `src/theme` module" (14.4) — and neither a
 * universal over a directory nor a prohibition can be demonstrated by an
 * example. So the source tree is read and classified, following the mechanism
 * the App_Shell established and the Squads_Feature consolidated into
 * `structural/sourceScan.ts`: read each file's text, strip comments and string
 * literals through one shared state machine, and fail naming the offending file
 * and specifier.
 *
 * ### The four invariants
 *
 * 1. **Containment** (Requirement 14.1). The feature is rooted at
 *    `apps/web/src/features/player-stats/`, every module and directory the
 *    design's layout names is present inside it, the one token table is there,
 *    and no module of the feature resolves an in-app import to a path outside
 *    that root other than the five admitted edges: the four Requirement 14.4
 *    names (the App_Shell barrel, the Squads_Feature barrel, the Auth_Feature
 *    barrel, and the shared `src/theme` module) plus the shared `src/wire`
 *    barrel. So no part of the feature is assembled from a module
 *    living elsewhere, and the dependency direction stays `app` → `player-stats`
 *    → (`app-shell`, `squads`, `auth`, `theme`, `wire`) — nothing here reaches back into
 *    `src/app/`, and nothing reaches into another feature's internals.
 * 2. **One public barrel** (Requirement 14.1). `index.ts` exists at the feature
 *    root and nowhere else beneath it, re-exports feature modules only, declares
 *    nothing of its own, and star-exports nothing — it is re-exports and nothing
 *    else, so the surface can be read off the source rather than inferred.
 * 3. **The barrel carries exactly what a consumer needs** (Requirement 14.2). It
 *    names the three modules the design admits, names no module of `lib/`,
 *    `lib/parse/`, `state/`, `components/`, `styles/`, the test harnesses, or the
 *    scan support, and carries out of `lib/` and `api/` exactly the transport
 *    facade and its two types. The last check is *computed* rather than listed —
 *    every exported name of every module under `lib/` and `api/` is collected,
 *    intersected with the barrel's surface, and the intersection must equal that
 *    set. So adding an export to the Response_Parser, the outcome classifier, the
 *    rating-condition resolver, or the facade cannot widen the public surface
 *    without failing here.
 * 4. **The barrel is the only way in** (Requirement 14.7). Every file outside the
 *    feature that imports it imports the barrel, never a deeper path, and every
 *    such file lives under `src/app/` — the one application router.
 * 5. **The route path is obtained, never declared** (Requirements 1.2, 1.7,
 *    14.7). No module of the feature writes a literal path string matching the
 *    Player_Stats_Route or the Squad_Route, in either the absolute form or the
 *    relative form a child of the shell's `/app` layout route takes — both
 *    patterns and both builders come from the Squads_Feature's barrel, which
 *    declares them once. And `src/app/` declares no path string of *this*
 *    feature: it nests the feature's table through the barrel and names no
 *    pattern of it.
 *
 * ### Non-vacuity
 *
 * Requirement 14.6 asks for more than a green scan: each scan is "accompanied by
 * a control demonstrating that it detects a deliberate violation". A rule that
 * passes because its detector matches nothing is indistinguishable from a rule
 * that passes because the code complies, so every rule below is stated as a
 * function over sources and run twice: once over the real feature, and once over
 * a synthetic module or barrel written here that violates it. The outward-import
 * rule gets a second kind of control — each of its five admitted edges is
 * asserted to be *reached*, so an empty offender list means the boundary is
 * clean rather than that specifier resolution broke.
 *
 * Requirements: 1.2, 1.7, 14.1, 14.2, 14.4, 14.6, 14.7
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HOME_ROUTE } from '../app-shell';
import { PLAYER_STATS_ROUTE, SQUAD_ROUTE } from '../squads';
import {
  appShellRoot,
  appWiringRoot,
  authRoot,
  collectProductionSources,
  declaredExportNames,
  exportedNamesOf,
  inAppImports,
  inAppImportsOf,
  isTestFile,
  isWithin,
  norm,
  playerStatsModules,
  playerStatsRoot,
  playerStatsSources,
  playerStatsStyles,
  reExports,
  relTo,
  resolveWithinSrc,
  squadsRoot,
  srcRoot,
  srcSources,
  stripComments,
  stripCommentsAndStrings,
  targetsBarrelOf,
  themeRoot,
  wireRoot,
  uiRoot,
} from './structural/sourceScan';

// --- The scanned sets --------------------------------------------------------

/** The feature's production modules — the set every rule below binds. */
const featureModules = playerStatsModules();
/** Every file under the root, tests and scan support included. */
const featureSources = playerStatsSources();
/** Everything in `apps/web/src` that is not part of the feature. */
const outsideSources = srcSources().filter(
  (file) => !isWithin(playerStatsRoot, file),
);

const barrelPath = join(playerStatsRoot, 'index.ts');
const barrelSource = readFileSync(barrelPath, 'utf8');
const barrelReExports = reExports(barrelSource);
const barrelSpecifiers = barrelReExports.map(({ specifier }) => specifier);
const barrelExportedNames = barrelReExports.flatMap(({ names }) => names);

/** Path relative to the feature root, in forward-slash form, for messages. */
function featureRel(path: string): string {
  return relTo(playerStatsRoot, path);
}

/** A module of the feature, as the rules below read one: its path and its text. */
interface ScannedModule {
  /** Absolute path — a synthetic control supplies one that need not exist. */
  readonly file: string;
  /** The module's source text. */
  readonly source: string;
}

/** The real feature, read once. */
const scannedModules: readonly ScannedModule[] = featureModules.map((file) => ({
  file,
  source: readFileSync(file, 'utf8'),
}));

/** A synthetic module, placed inside the feature so only its imports differ. */
function control(relativePath: string, source: string): ScannedModule {
  return { file: join(playerStatsRoot, ...relativePath.split('/')), source };
}

// --- Invariant 0: the scan sees the feature ----------------------------------

describe('the containment scan sees the Player_Stats_Feature', () => {
  it('is rooted at apps/web/src/features/player-stats', () => {
    expect(norm(playerStatsRoot).endsWith('apps/web/src/features/player-stats')).toBe(
      true,
    );
  });

  it('discovers the feature modules, the files outside it, and no test file', () => {
    // A vacuous scan would satisfy every invariant below, so it is ruled out
    // first: the feature is large, the application around it is not empty, and
    // no test file may leak into a production set.
    expect(featureModules.length).toBeGreaterThan(30);
    expect(outsideSources.length).toBeGreaterThan(0);
    expect(featureModules.map(featureRel).filter(isTestFile)).toEqual([]);
  });

  it('excludes the scan-support directory from the production set', () => {
    // `structural/` holds the machinery these scans share. It is imported by no
    // module of the feature and named by no export of the barrel, so holding it
    // to the feature's own boundary rules would assert something about the scans
    // rather than about the product.
    const scanSupport = featureModules
      .map(featureRel)
      .filter((file) => file.startsWith('structural/'));
    expect(scanSupport).toEqual([]);

    // It does exist, though — otherwise this exclusion is hiding nothing and the
    // strippers every scan depends on have gone missing.
    expect(featureSources.map(featureRel)).toContain('structural/sourceScan.ts');
  });
});

// --- Invariant 1: containment (Requirements 14.1, 14.4) ----------------------

/**
 * Every module the design's layout names, relative to the feature root.
 *
 * The feature may hold more than this — `testing/playerStatsScreenStates.tsx`
 * arrived during implementation — but it may hold no *less*, and none of these
 * may live anywhere else. A module of the feature found outside the root fails
 * the import check below; a module of the feature missing from inside it fails
 * here.
 */
const DESIGNED_MODULES: readonly string[] = [
  'index.ts',
  'playerStatsRoutes.tsx',

  'lib/identifiers.ts',
  'lib/subject.ts',
  'lib/wireEnums.ts',
  'lib/callOutcome.ts',
  'lib/messages.ts',
  'lib/anonymisedName.ts',
  'lib/ratingCondition.ts',
  'lib/progression.ts',
  'lib/chartGeometry.ts',
  'lib/duration.ts',
  'lib/numberFormat.ts',
  'lib/instantFormat.ts',
  'lib/richStats.ts',
  'lib/headingOutline.ts',

  'lib/parse/primitives.ts',
  'lib/parse/playerProfile.ts',

  'api/playerStatsApi.ts',

  'state/usePlayerStatsScreen.ts',

  'screens/PlayerStatsScreen.tsx',

  'components/PlayerIdentityHeader.tsx',
  'components/StatSection.tsx',
  'components/RecordPanel.tsx',
  'components/ResultBreakdown.tsx',
  'components/RatingPanel.tsx',
  'components/ProgressionChart.tsx',
  'components/ProgressionTable.tsx',
  'components/StreakPanel.tsx',
  'components/BibAppearances.tsx',
  'components/PairwiseSection.tsx',
  'components/RichStatsPanel.tsx',
  'components/NotFoundTreatment.tsx',
  'components/FailureNotice.tsx',
  'components/LoadingIndication.tsx',
  'components/surfaceFocus.ts',

  'testing/playerProfileFixtures.ts',
];

/** The directories the design's layout names, each of which must hold a module. */
const DESIGNED_DIRECTORIES: readonly string[] = [
  'lib',
  'lib/parse',
  'api',
  'state',
  'screens',
  'components',
  'styles',
  'testing',
  'structural',
];

/** The modules of `designed` that `present` does not hold. */
function missingFrom(
  present: ReadonlySet<string>,
  designed: readonly string[],
): string[] {
  return designed.filter((file) => !present.has(file));
}

/** The directories of `designed` that no file of `files` lives under. */
function emptyDirectories(
  files: readonly string[],
  designed: readonly string[],
): string[] {
  return designed.filter(
    (directory) => !files.some((file) => file.startsWith(`${directory}/`)),
  );
}

/**
 * True when a resolved target is one of the five admitted outward edges: the
 * four Requirement 14.4 names, plus the shared wire barrel.
 *
 * Both features and the Auth_Feature are admitted **at their barrel only**, so a
 * deeper path into any of them is an offender: `screens/PlayerStatsScreen.tsx`
 * takes `HOME_ROUTE`, `SQUAD_SCOPE_ROUTE_PARAMETER`, and
 * `usePublishSquadScopeFromRoute` from the App_Shell barrel and `useAuth` from
 * the Auth_Feature barrel; `playerStatsRoutes.tsx` and the pairwise links take
 * `PLAYER_STATS_ROUTE`, `playerStatsPath`, and `squadPath` from the
 * Squads_Feature barrel, which published them for exactly this purpose
 * (Requirement 1.2). The shared Theme module is admitted throughout, because
 * Requirement 15.1 puts the one appearance store, bootstrap, and resolution
 * function there and forbids this feature from resolving a Theme of its own.
 * The shared wire module is admitted at its barrel, which
 * `lib/parse/primitives.ts` re-exports beside the feature's own duration reader.
 */
function isAdmittedOutwardTarget(target: string): boolean {
  return (
    targetsBarrelOf(appShellRoot, target) ||
    targetsBarrelOf(squadsRoot, target) ||
    targetsBarrelOf(authRoot, target) ||
    isWithin(themeRoot, target) ||
    targetsBarrelOf(wireRoot, target) ||
    // The shared component library, at its barrel (ADR 0004).
    targetsBarrelOf(uiRoot, target)
  );
}

/** Every import of `modules` that escapes the feature root by a non-admitted edge. */
function outwardOffenders(
  modules: readonly ScannedModule[],
): Array<{ module: string; specifier: string }> {
  const offenders: Array<{ module: string; specifier: string }> = [];

  for (const { file, source } of modules) {
    for (const { specifier, target } of inAppImportsOf(source, file)) {
      if (isWithin(playerStatsRoot, target)) continue;
      if (isAdmittedOutwardTarget(target)) continue;
      offenders.push({ module: featureRel(file), specifier });
    }
  }

  return offenders;
}

/**
 * Every import of `modules` that reaches the application wiring or another
 * feature's internals.
 *
 * A subset of {@link outwardOffenders} named separately, because the two rules
 * fail for different reasons: one says "this module was assembled from
 * somewhere else", the other says "the dependency direction reversed".
 */
function wiringAndInternalsOffenders(
  modules: readonly ScannedModule[],
): Array<{ module: string; specifier: string }> {
  const featuresRoot = norm(join(srcRoot, 'features'));
  const offenders: Array<{ module: string; specifier: string }> = [];

  for (const { file, source } of modules) {
    for (const { specifier, target } of inAppImportsOf(source, file)) {
      if (isWithin(playerStatsRoot, target)) continue;
      if (isAdmittedOutwardTarget(target)) continue;
      if (
        isWithin(appWiringRoot, target) ||
        target.startsWith(`${featuresRoot}/`)
      ) {
        offenders.push({ module: featureRel(file), specifier });
      }
    }
  }

  return offenders;
}

describe('every module of the feature lives under features/player-stats/ (Requirement 14.1)', () => {
  const present = new Set(featureModules.map(featureRel));

  it('houses every module the design layout names', () => {
    expect(missingFrom(present, DESIGNED_MODULES)).toEqual([]);
  });

  it('detects a module the design names and the tree does not hold', () => {
    // Control: the same comparison, over a designed set carrying one module that
    // was never written. A scan that reported nothing missing here would report
    // nothing missing ever.
    expect(
      missingFrom(present, [...DESIGNED_MODULES, 'lib/neverWritten.ts']),
    ).toEqual(['lib/neverWritten.ts']);
  });

  it('houses every directory the design layout names', () => {
    const files = [
      ...featureSources.map(featureRel),
      ...playerStatsStyles().map(featureRel),
    ];
    expect(emptyDirectories(files, DESIGNED_DIRECTORIES)).toEqual([]);
  });

  it('detects a directory the design names and the tree does not hold', () => {
    const files = featureSources.map(featureRel);
    expect(emptyDirectories(files, ['lib', 'lib/neverCreated'])).toEqual([
      'lib/neverCreated',
    ]);
  });

  it('houses the one feature token table', () => {
    // The single stylesheet the design names by path, and the only file of the
    // feature permitted to contain a colour value (Requirement 15.2). The
    // per-component sheets beside it are free to come and go.
    const stylesheets = playerStatsStyles().map(featureRel);
    expect(stylesheets).toContain('styles/playerStatsTokens.css');

    // Control: the same membership test, for a table that does not exist — so
    // the assertion above is distinguishing a present file from an absent one
    // rather than passing on an unconditionally true comparison.
    expect(stylesheets).not.toContain('styles/playerStatsTokens.scss');
  });

  it('resolves no import outside the root beyond the five admitted edges (Requirement 14.4)', () => {
    expect(outwardOffenders(scannedModules)).toEqual([]);
  });

  it('detects an import that escapes the root by a non-admitted edge', () => {
    // Control: four deliberate violations, one per shape the rule exists to
    // catch — a sibling feature's internals, a sibling feature's barrel that is
    // not one of the three admitted, a *deep* path into an otherwise admitted
    // feature, and the application wiring the direction forbids.
    const offenders = outwardOffenders([
      control(
        'components/ControlModule.tsx',
        "import { LandingHero } from '../../landing/LandingHero';",
      ),
      control(
        'components/ControlModule.tsx',
        "import LandingPage from '../../landing/LandingPage';",
      ),
      control(
        'components/ControlModule.tsx',
        "import { PLAYER_STATS_ROUTE } from '../../squads/lib/routePaths';",
      ),
      control(
        'state/ControlModule.ts',
        "import { createAppRouter } from '../../../app/appRouter';",
      ),
    ]);

    expect(offenders.map(({ specifier }) => specifier)).toEqual([
      '../../landing/LandingHero',
      '../../landing/LandingPage',
      '../../squads/lib/routePaths',
      '../../../app/appRouter',
    ]);
  });

  it('admits an import of each of the five edges', () => {
    // The other half of the control: the rule must *not* fire on the edges
    // Requirement 14.4 admits, or the clean result above would be an accident of
    // an over-broad predicate.
    expect(
      outwardOffenders([
        control(
          'screens/ControlModule.tsx',
          "import { HOME_ROUTE } from '../../app-shell';",
        ),
        control(
          'screens/ControlModule.tsx',
          "import { squadPath } from '../../squads';",
        ),
        control(
          'screens/ControlModule.tsx',
          "import { useAuth } from '../../auth';",
        ),
        control(
          'screens/ControlModule.tsx',
          "import type { Theme } from '../../../theme';",
        ),
        control(
          'lib/parse/ControlModule.ts',
          "import { readUuid } from '../../../../wire';",
        ),
      ]),
    ).toEqual([]);
  });

  it('reaches the App_Shell, the Squads_Feature, the Auth_Feature, and the shared theme and wire modules at all', () => {
    // Non-vacuity of the allowance itself: all five edges are in fact used, so
    // the empty offender list above means the boundary is clean rather than that
    // specifier resolution broke or that an allowance is dead.
    const targets = featureModules.flatMap((file) =>
      inAppImports(file).map(({ target }) => target),
    );

    expect(targets.some((target) => targetsBarrelOf(appShellRoot, target))).toBe(
      true,
    );
    expect(targets.some((target) => targetsBarrelOf(squadsRoot, target))).toBe(
      true,
    );
    expect(targets.some((target) => targetsBarrelOf(authRoot, target))).toBe(true);
    expect(targets.some((target) => isWithin(themeRoot, target))).toBe(true);
    expect(targets.some((target) => targetsBarrelOf(wireRoot, target))).toBe(true);
    expect(targets.some((target) => targetsBarrelOf(uiRoot, target))).toBe(true);
  });

  it('imports nothing from the application wiring or another feature internal', () => {
    // The direction runs one way. `src/app/` composes this feature; this feature
    // knows nothing of it, and it reaches into no feature's interior — not the
    // marketing landing feature, not the App_Shell's or the Squads_Feature's
    // modules behind their barrels, and not a feature added later.
    expect(wiringAndInternalsOffenders(scannedModules)).toEqual([]);
  });

  it('detects an import of the application wiring and of another feature internal', () => {
    const offenders = wiringAndInternalsOffenders([
      control(
        'state/ControlModule.ts',
        "import { appRoutePaths } from '../../../app/appRoutePaths';",
      ),
      control(
        'components/ControlModule.tsx',
        "import { PlayerRow } from '../../squads/components/PlayerRow';",
      ),
    ]);

    expect(offenders.map(({ specifier }) => specifier)).toEqual([
      '../../../app/appRoutePaths',
      '../../squads/components/PlayerRow',
    ]);
  });
});

// --- Invariant 2: one public barrel (Requirement 14.1) ----------------------

/** Every `index.ts`/`index.tsx` among `files`, barrel or not. */
function barrelsAmong(files: readonly string[]): string[] {
  return files.filter((file) => /(?:^|\/)index\.tsx?$/.test(file));
}

/** True when a module declares anything of its own rather than only re-exporting. */
function declaresLocally(source: string): boolean {
  return /\b(?:function|class|interface|enum|const|let|var)\b/.test(
    stripCommentsAndStrings(source),
  );
}

/** Every specifier of a barrel that resolves outside the feature root. */
function escapingReExports(source: string, barrelFile: string): string[] {
  return inAppImportsOf(source, barrelFile)
    .filter(({ target }) => !isWithin(playerStatsRoot, target))
    .map(({ specifier }) => specifier);
}

describe('the feature exposes exactly one public barrel (Requirement 14.1)', () => {
  it('carries index.ts at the root and no second barrel beneath it', () => {
    expect(barrelSource.length).toBeGreaterThan(0);
    expect(barrelsAmong(featureSources.map(featureRel))).toEqual(['index.ts']);
  });

  it('detects a second barrel beneath the root', () => {
    // Control: the same detector, over a tree carrying a nested barrel. Both are
    // found, so the single-element result above is a fact about the tree.
    expect(
      barrelsAmong([
        'index.ts',
        'components/StatSection.tsx',
        'components/index.ts',
        'lib/index.tsx',
      ]),
    ).toEqual(['index.ts', 'components/index.ts', 'lib/index.tsx']);
  });

  it('re-exports feature modules only', () => {
    expect(escapingReExports(barrelSource, barrelPath)).toEqual([]);
  });

  it('detects a barrel re-exporting from outside the feature', () => {
    // Control: a barrel that forwards another feature's seam would make this
    // feature a second declaration site for it (Requirement 1.2 puts the
    // Player_Stats_Route's declaration in the Squads_Feature's barrel alone).
    expect(
      escapingReExports(
        "export { PLAYER_STATS_ROUTE, squadPath } from '../squads';",
        barrelPath,
      ),
    ).toEqual(['../squads']);
  });

  it('declares nothing of its own and star-exports nothing', () => {
    // A barrel that only re-exports has a surface readable from its source. A
    // local declaration, or an `export *`, would widen it without saying by what.
    expect(declaresLocally(barrelSource)).toBe(false);
    expect(barrelReExports.filter(({ isStar }) => isStar)).toEqual([]);

    // Every export statement of the file is an `export … from`, so the parsed
    // re-exports below are the whole surface rather than part of it.
    const exportStatements =
      stripCommentsAndStrings(barrelSource).match(/\bexport\b/g) ?? [];
    expect(exportStatements).toHaveLength(barrelReExports.length);
  });

  it('detects a local declaration and a star export in a barrel', () => {
    expect(
      declaresLocally(
        "export { PlayerStatsScreen } from './screens/PlayerStatsScreen';\n" +
          "const PLAYER_STATS_PATH = '/app/squads/:squadId/players/:membershipId';",
      ),
    ).toBe(true);

    const starred = reExports("export * from './lib/messages';");
    expect(starred).toHaveLength(1);
    expect(starred[0].isStar).toBe(true);
    expect(starred[0].names).toEqual([]);
  });
});

// --- Invariant 3: the barrel's surface (Requirement 14.2) -------------------

/**
 * The four modules the design admits into the barrel.
 *
 * The route table, the screen, the transport seam, and the squad leaderboards —
 * the registration a consumer nests, the element of that table, the facade
 * `appRouter.tsx` builds from the Authenticated_Api_Client and threads in, and
 * the stats section body it injects into the squad screen.
 */
const ADMITTED_BARREL_MODULES: readonly string[] = [
  './api/playerStatsApi',
  './playerStatsRoutes',
  './screens/PlayerStatsScreen',
  './screens/SquadLeaderboards',
];

/**
 * The directories whose modules Requirement 14.2 keeps inside: the pure logic and
 * its parse sub-directory, the load machine, the sub-screen components, the token
 * table, the test harnesses, and the scan support.
 */
const INTERNAL_DIRECTORY =
  /^\.\/(?:lib\/|state\/|components\/|styles\/|testing\/|structural\/)/;

/** The specifiers of `specifiers` that name an internal directory. */
function internalSpecifiers(specifiers: readonly string[]): string[] {
  return specifiers.filter((specifier) => INTERNAL_DIRECTORY.test(specifier));
}

/**
 * The names of `lib/` and `api/` Requirement 14.2 admits across the boundary.
 *
 * The Player_Stats_Api factory, its interface, and its dependency type, because
 * `src/app/appRouter.tsx` constructs the facade once from the
 * Authenticated_Api_Client and hands the instance to the route table
 * (Requirement 12.1). Nothing else in either directory is a consumer's business:
 * no parser, no printer, no outcome classifier, no formatter, no message.
 */
const PERMITTED_LIB_AND_API_EXPORTS: readonly string[] = [
  'PlayerStatsApi',
  'PlayerStatsApiDependencies',
  'createPlayerStatsApi',
];

/** The two internal directories whose surface Requirement 14.2 constrains. */
const libModules = collectProductionSources(join(playerStatsRoot, 'lib'));
const apiModules = collectProductionSources(join(playerStatsRoot, 'api'));

/** Every name exported by any module of `lib/` or `api/`. */
const internalNames = new Set(
  [...libModules, ...apiModules].flatMap(declaredExportNames),
);

/** The names of `surface` that also belong to `internal`. */
function crossingNames(
  surface: readonly string[],
  internal: ReadonlySet<string>,
): string[] {
  return [...new Set(surface.filter((name) => internal.has(name)))].sort();
}

describe('the barrel exports the registration, the screen, and the facade only (Requirement 14.2)', () => {
  it('names exactly the four modules the design admits', () => {
    expect([...new Set(barrelSpecifiers)].sort()).toEqual([
      ...ADMITTED_BARREL_MODULES,
    ]);
  });

  it('names no module of lib/, lib/parse/, state/, components/, styles/, or the scan support', () => {
    expect(internalSpecifiers(barrelSpecifiers)).toEqual([]);
  });

  it('detects a barrel naming an internal module', () => {
    // Control: one specifier per kept-inside directory, mixed in with the three
    // admitted ones. Only the internal ones are reported.
    expect(
      internalSpecifiers([
        ...ADMITTED_BARREL_MODULES,
        './lib/subject',
        './lib/parse/playerProfile',
        './state/usePlayerStatsScreen',
        './components/RatingPanel',
        './styles/playerStatsTokens.css',
        './testing/playerProfileFixtures',
        './structural/sourceScan',
      ]),
    ).toEqual([
      './lib/subject',
      './lib/parse/playerProfile',
      './state/usePlayerStatsScreen',
      './components/RatingPanel',
      './styles/playerStatsTokens.css',
      './testing/playerProfileFixtures',
      './structural/sourceScan',
    ]);
  });

  it('carries out of lib/ and api/ exactly the facade and its types', () => {
    // Computed rather than listed: every export of every module in the two
    // directories is collected, and the barrel's surface may intersect it only at
    // the permitted names. So adding an export to the Response_Parser, the
    // outcome classifier, the rating-condition resolver, or the facade cannot
    // widen the public surface silently.
    //
    // Non-vacuity: the internal surface is large, and holds the very things
    // Requirement 14.2 keeps inside.
    expect(internalNames.size).toBeGreaterThan(50);
    for (const internal of [
      'parsePlayerProfile',
      'printPlayerProfile',
      'classifyOutcome',
      'resolveRatingCondition',
      'toProgressionSeries',
      'plotProgression',
      'formatWinPercentage',
      'formatInstantDate',
      'resolveRichCondition',
      'validateHeadingOutline',
      'readSubject',
      'isPlayerStatsIdentifier',
      'GENERIC_PROFILE_FAILURE',
      'PROFILE_CALL_TIMEOUT_MS',
      'CallResult',
    ]) {
      expect(internalNames, `${internal} must be an internal export`).toContain(
        internal,
      );
    }

    expect(crossingNames(barrelExportedNames, internalNames)).toEqual([
      ...PERMITTED_LIB_AND_API_EXPORTS,
    ]);
  });

  it('detects a parser, a classifier, or a message crossing the boundary', () => {
    // Control: the same intersection, over a surface that forwards three things
    // Requirement 14.2 keeps inside. Each is reported, so the equality above is
    // doing work.
    expect(
      crossingNames(
        [
          ...barrelExportedNames,
          'parsePlayerProfile',
          'classifyOutcome',
          'GENERIC_PROFILE_FAILURE',
        ],
        internalNames,
      ),
    ).toEqual(
      [
        ...PERMITTED_LIB_AND_API_EXPORTS,
        'GENERIC_PROFILE_FAILURE',
        'classifyOutcome',
        'parsePlayerProfile',
      ].sort(),
    );
  });

  it('exports the route factory, the screen, the facade, the leaderboards, and their types', () => {
    // The other half of 14.2: the barrel must carry what a consumer does need, or
    // "one entry point" would be satisfied by an empty file.
    expect([...barrelExportedNames].sort()).toEqual(
      [
        'PlayerStatsApi',
        'PlayerStatsApiDependencies',
        'PlayerStatsRoutesOptions',
        'PlayerStatsScreen',
        'PlayerStatsScreenProps',
        'SquadLeaderboards',
        'SquadLeaderboardsProps',
        'createPlayerStatsApi',
        'createPlayerStatsShellRoutes',
      ].sort(),
    );
  });

  it('exports nothing the barrel does not name, by reading its own source', () => {
    // `exportedNamesOf` reads declaration forms as well as re-export lists, so a
    // surface that grew by a local `export const` would be visible here even if
    // the re-export parse missed it.
    expect([...new Set(exportedNamesOf(barrelSource))].sort()).toEqual(
      [...new Set(barrelExportedNames)].sort(),
    );
  });
});

// --- Invariant 4: the barrel is the only way in (Requirement 14.7) ----------

describe('the feature is imported through its barrel only (Requirement 14.7)', () => {
  /** Every file outside the feature that resolves an import into it. */
  const inboundImports = outsideSources.flatMap((file) =>
    inAppImports(file)
      .filter(({ target }) => isWithin(playerStatsRoot, target))
      .map(({ specifier, target }) => ({ file, specifier, target })),
  );

  it('is imported from outside at all', () => {
    // Guard: `src/app/appRouter.tsx` builds the facade and nests the route table,
    // so an empty set means resolution broke rather than that nothing reaches in.
    expect(inboundImports.length).toBeGreaterThan(0);
  });

  it('is reached at no deeper path than the barrel', () => {
    const offenders = inboundImports
      .filter(({ target }) => !targetsBarrelOf(playerStatsRoot, target))
      .map(({ file, specifier }) => ({ file: relTo(srcRoot, file), specifier }));
    expect(offenders).toEqual([]);
  });

  it('detects a consumer reaching past the barrel', () => {
    // Control: the same predicate, over a synthetic consumer in `src/app` that
    // imports the screen directly instead of through the barrel.
    const consumer = join(srcRoot, 'app', 'controlConsumer.tsx');
    const deep = inAppImportsOf(
      "import { PlayerStatsScreen } from '../features/player-stats/screens/PlayerStatsScreen';",
      consumer,
    ).filter(
      ({ target }) =>
        isWithin(playerStatsRoot, target) &&
        !targetsBarrelOf(playerStatsRoot, target),
    );

    expect(deep.map(({ specifier }) => specifier)).toEqual([
      '../features/player-stats/screens/PlayerStatsScreen',
    ]);

    // And the barrel import it should have written is not reported.
    expect(
      inAppImportsOf(
        "import { createPlayerStatsShellRoutes } from '../features/player-stats';",
        consumer,
      ).filter(({ target }) => !targetsBarrelOf(playerStatsRoot, target)),
    ).toEqual([]);
  });

  it('is imported by the application router wiring only', () => {
    // One consumer, and no second. The App_Shell, the Auth_Feature, the
    // Squads_Feature, and the marketing landing feature import nothing of this
    // feature — the edge to the Squads_Feature runs the other way, which is what
    // the containment invariant above holds.
    const offenders = inboundImports
      .filter(({ file }) => !isWithin(appWiringRoot, file))
      .map(({ file, specifier }) => ({ file: relTo(srcRoot, file), specifier }));
    expect(offenders).toEqual([]);
  });
});

// --- Invariant 5: the route path is obtained, never declared ---------------
//                  (Requirements 1.2, 1.7, 14.7)

/**
 * A path literal a module writes, as this rule reads one.
 *
 * Only a *literal* counts. The modules of this feature discuss the route they
 * answer at length — `screens/PlayerStatsScreen.tsx` opens by naming
 * `/app/squads/:squadId/players/:membershipId`, and `playerStatsRoutes.tsx`
 * quotes the relative child form it derives — so a scan that read prose would
 * flag the documentation promising compliance. Comments are therefore stripped
 * first and string contents kept, which is the pairing
 * `structural/sourceScan.ts` provides {@link stripComments} for.
 *
 * Each interpolation of a template literal is reported as the marker `${}`, so a
 * path being assembled by hand is visible as a path with a dynamic segment in it
 * rather than as two unrelated fragments. The expression is skipped by walking
 * balanced braces, so a nested object literal inside an interpolation cannot
 * unbalance the walk.
 *
 * **Known limits**, both of which cost a detection rather than invent one: a
 * string literal written *inside* an interpolation is skipped with its
 * expression, and an apostrophe in bare JSX text starts a spurious literal whose
 * junk contents match no route shape.
 */
function pathLiteralsOf(source: string): string[] {
  const code = stripComments(source);
  const literals: string[] = [];
  let i = 0;

  while (i < code.length) {
    const quote = code[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      i += 1;
      continue;
    }

    i += 1;
    let body = '';
    while (i < code.length) {
      if (code[i] === '\\') {
        body += code[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (code[i] === quote) {
        i += 1;
        break;
      }
      if (quote === '`' && code[i] === '$' && code[i + 1] === '{') {
        body += '${}';
        i += 2;
        let depth = 1;
        while (i < code.length && depth > 0) {
          if (code[i] === '{') depth += 1;
          else if (code[i] === '}') depth -= 1;
          i += 1;
        }
        continue;
      }
      body += code[i];
      i += 1;
    }

    literals.push(body);
  }

  return literals;
}

/**
 * A literal reduced to the route *shape* it would match: every dynamic segment
 * collapsed, a trailing separator dropped, and the case normalised.
 *
 * Shape rather than spelling, because renaming a parameter does not make a
 * declaration something else — `'/app/squads/:id/players/:member'` is the
 * Player_Stats_Route written out, and so is
 * `` `/app/squads/${squadId}/players/${membershipId}` ``, which is the
 * Squads_Feature's `playerStatsPath` reimplemented. Both reduce to the shape the
 * imported pattern reduces to.
 */
function routeShape(literal: string): string {
  return literal
    .replace(/\$\{\}/g, ':')
    .replace(/:[A-Za-z_$][\w$]*/g, ':')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** The non-empty segments of a shape. */
function segmentsOf(shape: string): string[] {
  return shape.split('/').filter((segment) => segment.length > 0);
}

/**
 * The pattern expressed relative to the shell's route prefix — the form a child
 * of the `/app` layout route takes, and the form `playerStatsRoutes.tsx` derives
 * rather than retypes.
 *
 * Derived here the same way, from the imported pattern and the App_Shell's own
 * {@link HOME_ROUTE}, so this rule states no path literal of its own either.
 */
function relativeToShellPrefix(pattern: string): string {
  const prefix = `${HOME_ROUTE}/`;
  return pattern.startsWith(prefix) ? pattern.slice(prefix.length) : pattern;
}

/**
 * True when `shape` declares `forbidden` — either by matching it, or by naming
 * `distinguishing` and stopping short of it at a segment boundary.
 *
 * The second arm is what catches a path put together piece by piece:
 * `'/app/squads/' + squadId` writes no complete pattern, but the fragment it
 * writes is the Squad_Route's own prefix and exists for no other purpose. The
 * `distinguishing` segment keeps that arm from over-reaching: `'/app'` is the
 * App_Shell's published {@link HOME_ROUTE} and a prefix of every pattern here,
 * and flagging it would make the rule something to be suppressed rather than
 * obeyed.
 */
function declares(
  shape: string,
  forbidden: string,
  distinguishing: string,
): boolean {
  if (shape.length === 0) return false;
  if (shape === forbidden) return true;
  return (
    forbidden.startsWith(`${shape}/`) &&
    segmentsOf(shape).includes(distinguishing)
  );
}

/** A module and the path literal it was found to declare. */
interface PathFinding {
  readonly module: string;
  readonly literal: string;
}

/** Every literal of `modules` that declares one of `forms`. */
function pathDeclarations(
  modules: readonly ScannedModule[],
  forms: readonly string[],
  distinguishing: string,
  describePath: (file: string) => string = featureRel,
): PathFinding[] {
  const forbidden = forms.map(routeShape);
  const findings: PathFinding[] = [];

  for (const { file, source } of modules) {
    for (const literal of pathLiteralsOf(source)) {
      const shape = routeShape(literal);
      if (forbidden.some((form) => declares(shape, form, distinguishing))) {
        findings.push({ module: describePath(file), literal });
      }
    }
  }

  return findings;
}

/**
 * The four forms Requirement 1.7 keeps out of this feature: the two patterns the
 * Squads_Feature's barrel declares, each in its absolute form and in the relative
 * form a child of the shell's layout route takes.
 *
 * Read from the barrel rather than written, so the rule and the registration are
 * the same value — and so a pattern changed in the Squads_Feature cannot leave
 * this scan guarding a path nothing uses.
 */
const SQUAD_SCOPED_ROUTE_FORMS: readonly string[] = [
  SQUAD_ROUTE,
  PLAYER_STATS_ROUTE,
  relativeToShellPrefix(SQUAD_ROUTE),
  relativeToShellPrefix(PLAYER_STATS_ROUTE),
];

/** The two forms of *this* feature's own route — what Requirement 14.7 bars from `src/app`. */
const PLAYER_STATS_ROUTE_FORMS: readonly string[] = [
  PLAYER_STATS_ROUTE,
  relativeToShellPrefix(PLAYER_STATS_ROUTE),
];

describe('the feature declares neither route pattern (Requirements 1.2, 1.7)', () => {
  it('reads the patterns from the Squads_Feature barrel', () => {
    // Guard: the forms this rule forbids are the real ones. A barrel export
    // renamed or emptied would otherwise leave the rule forbidding nothing.
    expect(SQUAD_ROUTE.length).toBeGreaterThan(0);
    expect(PLAYER_STATS_ROUTE.startsWith(`${SQUAD_ROUTE}/`)).toBe(true);
    expect(new Set(SQUAD_SCOPED_ROUTE_FORMS).size).toBe(4);

    // And the relative forms are genuinely shorter than the absolute ones, so
    // the derivation above fired rather than passing the pattern through.
    expect(relativeToShellPrefix(PLAYER_STATS_ROUTE)).not.toBe(
      PLAYER_STATS_ROUTE,
    );
  });

  it('extracts the path literals its modules do write', () => {
    // Non-vacuity of the extractor: the feature writes plenty of literals, and
    // the one path literal it legitimately holds — the facade's endpoint, which
    // `transportSeam.structural.test.ts` pins to `api/playerStatsApi.ts` — is
    // among them. An extractor that returned nothing would satisfy every rule
    // below.
    const literals = scannedModules.flatMap(({ source }) =>
      pathLiteralsOf(source),
    );
    expect(literals.length).toBeGreaterThan(50);

    const facade = join(playerStatsRoot, 'api', 'playerStatsApi.ts');
    expect(pathLiteralsOf(readFileSync(facade, 'utf8'))).toContain(
      '/squads/{squadId}/members/{membershipId}/profile',
    );
  });

  it('writes no literal matching the Player_Stats_Route or the Squad_Route', () => {
    expect(pathDeclarations(scannedModules, SQUAD_SCOPED_ROUTE_FORMS, 'squads')).toEqual(
      [],
    );
  });

  it('detects a declaration in each form, written out or assembled', () => {
    // Control: one violation per shape the rule exists to catch — both patterns
    // in full, both relative child forms, a parameter renamed, the builder
    // reimplemented as a template, and the fragment a concatenation starts from.
    const offenders = pathDeclarations(
      [
        control(
          'playerStatsRoutes.tsx',
          "const path = '/app/squads/:squadId/players/:membershipId';",
        ),
        control(
          'playerStatsRoutes.tsx',
          "const child = 'squads/:squadId/players/:membershipId';",
        ),
        control('components/ControlModule.tsx', "const squad = '/app/squads/:squadId';"),
        control('components/ControlModule.tsx', "const squadChild = 'squads/:id';"),
        control(
          'components/ControlModule.tsx',
          'const built = `/app/squads/${squadId}/players/${membershipId}`;',
        ),
        control(
          'state/ControlModule.ts',
          "const joined = '/app/squads/' + squadId;",
        ),
      ],
      SQUAD_SCOPED_ROUTE_FORMS,
      'squads',
    );

    expect(offenders).toEqual([
      {
        module: 'playerStatsRoutes.tsx',
        literal: '/app/squads/:squadId/players/:membershipId',
      },
      {
        module: 'playerStatsRoutes.tsx',
        literal: 'squads/:squadId/players/:membershipId',
      },
      { module: 'components/ControlModule.tsx', literal: '/app/squads/:squadId' },
      { module: 'components/ControlModule.tsx', literal: 'squads/:id' },
      {
        module: 'components/ControlModule.tsx',
        literal: '/app/squads/${}/players/${}',
      },
      { module: 'state/ControlModule.ts', literal: '/app/squads/' },
    ]);
  });

  it('holds off the literals this feature legitimately writes', () => {
    // The near-miss half: the rule could over-reach in four directions, and each
    // of these is something the feature or its neighbours really do write. The
    // wire path is the facade's contract key, which spells its parameters
    // `{…}` and is rooted at `/squads` rather than `/app/squads`; the shell's
    // own Destinations are published paths; a `key` built from a membership
    // identity is not a path at all; and a class name that happens to contain a
    // slash-free `squads` is markup.
    expect(
      pathDeclarations(
        [
          control(
            'api/ControlFacade.ts',
            "const endpoint = '/squads/{squadId}/members/{membershipId}/profile';",
          ),
          control(
            'components/ControlModule.tsx',
            "const home = '/app';\nconst settings = '/app/settings';",
          ),
          control(
            'components/ControlModule.tsx',
            'const key = `${row.membershipId}:${String(index)}`;',
          ),
          control(
            'components/ControlModule.tsx',
            "const className = 'player-stats-squads-link';",
          ),
        ],
        SQUAD_SCOPED_ROUTE_FORMS,
        'squads',
      ),
    ).toEqual([]);
  });

  it('reads past the prose that names the route', () => {
    // The sharpest near-miss, over the real sources rather than a synthetic
    // module: two modules of the feature *do* contain the route's text, in the
    // docblocks that explain where the pattern comes from. A comment is not a
    // declaration, so the rule must stay silent on both — and if comment
    // stripping were dropped, this is the assertion that would fail.
    const screen = join(playerStatsRoot, 'screens', 'PlayerStatsScreen.tsx');
    const routes = join(playerStatsRoot, 'playerStatsRoutes.tsx');
    const documented = [screen, routes].map((file) => ({
      file,
      source: readFileSync(file, 'utf8'),
    }));

    expect(documented[0].source).toContain(PLAYER_STATS_ROUTE);
    expect(documented[1].source).toContain(
      relativeToShellPrefix(PLAYER_STATS_ROUTE),
    );

    expect(
      pathDeclarations(documented, SQUAD_SCOPED_ROUTE_FORMS, 'squads'),
    ).toEqual([]);
  });

  it('takes the pattern and both builders from the squads barrel instead', () => {
    // The positive half of Requirement 1.2: the paths are absent because they are
    // *obtained*. The route table imports the pattern it registers, and the
    // surfaces that navigate import the two builders — so an empty finding list
    // above means the feature asks the barrel rather than that it navigates
    // nowhere. The leaderboards harness mounts its section at the squad route,
    // which it also takes from the barrel.
    const fromBarrel = new Set(
      scannedModules.flatMap(({ file, source }) =>
        namedImportsFrom(source, file, squadsRoot),
      ),
    );

    expect([...fromBarrel].sort()).toEqual([
      'PLAYER_STATS_ROUTE',
      'SQUAD_ROUTE',
      'playerStatsPath',
      'squadPath',
    ]);
  });
});

/**
 * The names a module imports from the barrel of `root`, as written at the source
 * — an alias is reported by the name it was exported under, because what matters
 * is which published value was taken.
 */
function namedImportsFrom(
  source: string,
  importingFile: string,
  root: string,
): string[] {
  const code = stripComments(source);
  const pattern = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) !== null) {
    const target = resolveWithinSrc(match[2], importingFile);
    if (target === null || !targetsBarrelOf(root, target)) continue;

    for (const entry of match[1].split(',')) {
      const exported = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (exported.length > 0) names.push(exported);
    }
  }

  return names;
}

/** A synthetic module placed in the application wiring, for the rule below. */
function appControl(relativePath: string, source: string): ScannedModule {
  return { file: join(appWiringRoot, ...relativePath.split('/')), source };
}

describe('the application wiring declares no path of this feature (Requirement 14.7)', () => {
  /** The production modules of `src/app` — the one place a route is registered. */
  const wiringModules: readonly ScannedModule[] = collectProductionSources(
    appWiringRoot,
  ).map((file) => ({ file, source: readFileSync(file, 'utf8') }));

  /** Path relative to `src`, for a failure message. */
  const wiringRel = (file: string): string => relTo(srcRoot, file);

  it('scans the router that composes the feature', () => {
    // Guard: the set is the real wiring, `appRouter.tsx` included. An empty set
    // would satisfy the rule below without saying anything about the router.
    expect(wiringModules.length).toBeGreaterThan(0);
    expect(wiringModules.map(({ file }) => wiringRel(file))).toContain(
      'app/appRouter.tsx',
    );
  });

  it('declares no literal of the Player_Stats_Route', () => {
    expect(
      pathDeclarations(
        wiringModules,
        PLAYER_STATS_ROUTE_FORMS,
        'players',
        wiringRel,
      ),
    ).toEqual([]);
  });

  it('detects a router that registers the pattern itself', () => {
    // Control: the three shapes the regression would take — the pattern
    // registered outright, the relative child form handed to the nesting helper,
    // and the fragment a hand-built path starts from.
    const offenders = pathDeclarations(
      [
        appControl(
          'controlRouter.tsx',
          "const routes = [{ path: '/app/squads/:squadId/players/:membershipId' }];",
        ),
        appControl(
          'controlRouter.tsx',
          "const child = { path: 'squads/:squadId/players/:membershipId' };",
        ),
        appControl(
          'controlRoutePaths.ts',
          "export const PLAYER_STATS = '/app/squads/:squadId/players/';",
        ),
      ],
      PLAYER_STATS_ROUTE_FORMS,
      'players',
      wiringRel,
    );

    expect(offenders).toEqual([
      {
        module: 'app/controlRouter.tsx',
        literal: '/app/squads/:squadId/players/:membershipId',
      },
      {
        module: 'app/controlRouter.tsx',
        literal: 'squads/:squadId/players/:membershipId',
      },
      {
        module: 'app/controlRoutePaths.ts',
        literal: '/app/squads/:squadId/players/',
      },
    ]);
  });

  it('holds off the paths the wiring legitimately holds', () => {
    // Requirement 14.7 speaks of *this* feature's paths. The Squads_Feature's own
    // relative child, the shell's Destinations, the application catch-all, and
    // the wire path a harness stubs are none of them a path string of this
    // feature, and a rule that flagged them would be reporting another feature's
    // business as this one's.
    expect(
      pathDeclarations(
        [
          appControl(
            'controlRouter.tsx',
            "const squads = [{ path: 'squads/:squadId' }, { path: '/app/settings' }, { path: '*' }];",
          ),
          appControl(
            'controlHarness.tsx',
            "const stub = '/squads/{squadId}/members/{membershipId}/profile';",
          ),
        ],
        PLAYER_STATS_ROUTE_FORMS,
        'players',
        wiringRel,
      ),
    ).toEqual([]);
  });

  it('registers the feature through its barrel instead', () => {
    // The positive half: the route *is* registered from `src/app`, by nesting the
    // table the barrel hands over. So the clean result above means the pattern is
    // obtained rather than that the screen was never wired.
    const router = readFileSync(join(appWiringRoot, 'appRouter.tsx'), 'utf8');
    const code = stripCommentsAndStrings(router);

    expect(code).toMatch(/\bcreatePlayerStatsShellRoutes\s*\(/);
    expect(code).toMatch(/\bwithNestedRoutes\s*\(/);
    expect(code).toMatch(/\bHOME_ROUTE\b/);
  });
});
