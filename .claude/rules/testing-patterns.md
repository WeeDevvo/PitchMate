---
paths:
  - "backend/tests/**"
  - "apps/web/src/**/*.test.ts"
  - "apps/web/src/**/*.test.tsx"
  - "apps/web/src/**/testing/**"
  - "apps/web/src/test/**"
---

# Testing patterns

A test's doc comment states the property or behaviour it checks. Older tests also cite requirement numbers (`Validates: Requirements 8.2, 8.8`) from retired feature specs; leave those as they are, and don't add new ones. Universal claims ("for every roster…", "no module may…") are written as property tests or structural scans. Examples alone don't prove them.

## Backend (xUnit)

| Project | What it tests | Doubles |
|---|---|---|
| `Domain.Tests` | entity invariants, value types | none: pure |
| `Application.Tests` | use-case handlers | hand-written fakes: `Fakes/InMemoryRepository`, per-feature `*UseCaseFakes.cs` |
| `Infrastructure.Tests` | EF mapping, repositories, migrations, rating engine, architecture | real PostgreSQL through Testcontainers (`postgres:17.2`) |
| `Api.Tests` | endpoints, wire contract, emitted OpenAPI, architecture | `WebApplicationFactory<Program>` subclasses (`AuthApiFactory`, `RoutingApiFactory`) |

- Property tests use FsCheck with `[Property(MaxTest = N)]` and live in `*PropertyTests.cs` or `*Properties.cs`. **Version split:** `Infrastructure.Tests` is on FsCheck **2.16.6**, while Domain, Application and Api tests are on **3.3.3**. The generator and `Arbitrary` APIs differ between them, so copy patterns from the same project. Infrastructure arbitraries live in `Generators/` as `XArbitraries` + `XGenerators`.
- Database tests join the shared container with `[Collection(PostgreSqlCollection.Name)]` and use `PostgreSqlContainerFixture`. Persistence is tested against real PostgreSQL only; there is no in-memory or SQLite EF provider.
- Time comes from an injected `TimeProvider`. Tests drive it with `FakeTimeProvider` (`Microsoft.Extensions.TimeProvider.Testing`).
- Internal types are tested directly through `InternalsVisibleTo`. Add the test assembly to the `.csproj` rather than making a type public.
- Architecture tests that assert a rule should also show the rule has teeth: apply it to types planted to break it, as `ApiInwardLogicProperties` does.
- **Coverage is mandatory:** every Application use case has tests for its success path and each meaningful failure, and a use case isn't done without them. Domain behaviour is unit tested. The rating engine covers balancing, provisional flagging, σ inactivity decay, the μ − 3σ display rating and uneven teams, preferring property tests for invariants (balancing never drops a player, outcomes are symmetric, σ never goes negative).
- **Model-based database properties** share one migrated database per test class: created lazily behind a semaphore (FsCheck's xUnit runner ignores `IAsyncLifetime`), with a fixed, self-healing name dropped `WITH (FORCE)` on first use, and **Npgsql pooling left enabled**. Each generated case seeds fresh squads into it. Never create a database per case or disable pooling: that put 16,000+ sockets into `TIME_WAIT` and failed unrelated tests with `WSAEADDRINUSE`. Copy `MembershipStandingScopeHarness` or `MatchListSourceHarness`.
- Generators that guarantee a case (a member who marks no day, a gapped roster) must keep it reachable under every other generated choice. Two such slips surfaced only on a fresh CI seed, so a property's non-vacuity assertions belong in the test, not just in the generator's doc.

## Web (Vitest + Testing Library)

File suffix states the kind of test:

| Suffix | Kind |
|---|---|
| `*.test.ts(x)` | example-based unit or component test |
| `*.property.test.ts(x)`, `*.pbt.test.ts` | `fast-check` property test (`fc.assert(fc.property/asyncProperty(...), { numRuns })`) |
| `*.a11y.test.tsx` | `jest-axe`: render, `await axe(container)`, `expect(results).toHaveNoViolations()`, in each theme |
| `*.structural.test.ts` | source scan over a feature's production modules via `structural/sourceScan.ts` |
| `*.integration.test.tsx` | routed screens through `app/appRouterTestHarness.tsx` |

- Accessibility target is WCAG 2.1 AA. A new screen or interactive component gets an `*.a11y.test.tsx`, and queries use roles and accessible names (`getByRole('button', { name: … })`).
- Screen-state fixtures and render helpers live in the feature's `testing/` folder (`squadsScreenStates.tsx`, `playerProfileFixtures.ts`). Production modules never import them.
- Tests that cross the transport seam drive the real facade over the real generated client with an injected `fetch`, so the test exercises the contract types.
- Nothing typechecks test files: `tsconfig.app.json` excludes them, and Vitest strips types without checking them. A test can therefore drift from the production types it exercises, so read the current types before editing a test.
- Property tests that render many cases run near Vitest's 5 s default under full-suite load. Give a long one an explicit timeout (`it(name, fn, 15_000)`), and keep `numRuns` proportionate.
