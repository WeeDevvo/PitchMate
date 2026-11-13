# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Overview & Architecture Boundaries

PitchMate is a football web and mobile application for organising fair, casual small-sided matches between friends. It covers squads, availability/RSVP, auto-balanced teams (OpenSkill), live match tracking, and player stats.

The repository is structured as a monorepo with strict architectural boundaries:

- **Backend (`backend/`)**: .NET 10 solution (`PitchMate.slnx`) following Clean Architecture with strict inward dependency flow:
  - `PitchMate.Domain`: Zero external dependencies. Encapsulated domain entities (private setters, mutations via methods), value types, domain errors/results (`Result<T>`), and rating engine interfaces (`IRatingEngine`).
  - `PitchMate.Application`: Orchestrates use cases (commands/queries returning `Result<T>`) and defines ports/abstractions (`IRepository<T>`, `IUnitOfWork`). Strictly no references to EF Core, Npgsql, or ASP.NET Core.
  - `PitchMate.Infrastructure`: Implements persistence via EF Core 10, Npgsql and PostgreSQL, the OpenSkill rating engine (`PlackettLuceRatingEngine`, PitchMate's own PlackettLuce implementation of the OpenSkill model; no OpenSkill package is used), email delivery, and Azure integrations.
  - `PitchMate.Api`: Minimal API endpoints, transport DTOs, uniform existence-concealing error mapping (`XErrorResults`), authentication/JWT handling, and build-time OpenAPI document emission.
- **Web Frontend (`apps/web/`)**: React 19, TypeScript, Vite, and React Router v7 (`@pitchmate/web`). Feature-sliced architecture (`src/features/<feature>/`) consuming the typed API client facade. (`apps/mobile` and `apps/watch` are future placeholders).
- **Shared Packages (`packages/api-client/`)**: `@pitchmate/api-client`, providing TypeScript types and client generated directly from the backend OpenAPI specification.

The product rules live in `.claude/rules/product.md`, which loads every session. `docs/` is git-ignored and may not exist locally.

## Specs

PitchMate is moving to spec-driven development. The **master spec** lives in `specs/master/` (start at `specs/master/index.md`): one chapter per file, every line tagged Built / Partial / Gap / Idea, and every Built or Partial line citing the code it comes from. Feature specs will live in `specs/features/<feature>.md`. The conventions are in `.claude/rules/specs.md`. `.claude/rules/product.md` is the authority on product rules, and `specs/master/` is the signed-off to-be spec; record any disagreement between them in the spec's Open questions rather than silently editing `product.md`.

## Common CLI Commands

Run all commands from the repository root unless noted otherwise.

### Backend

```bash
# Restore local tools (restores dotnet-ef)
(cd backend && dotnet tool restore)

# Build solution (also emits packages/api-client/openapi/v1.json via PitchMate.Api)
dotnet build backend/PitchMate.slnx

# Run all backend tests (Infrastructure and Api tests require Docker / Testcontainers)
dotnet test backend/PitchMate.slnx

# Run a single test class or test by name
dotnet test backend/tests/PitchMate.Domain.Tests --filter "FullyQualifiedName~SquadCreationPropertyTests"

# Set dev JWT signing key locally (minimum 32 bytes required for boot)
dotnet user-secrets set "Auth:Token:SigningKey" "development-secret-key-that-is-at-least-32-bytes-long!" --project backend/src/PitchMate.Api

# Run backend API locally
dotnet run --project backend/src/PitchMate.Api
# Alternatively using Makefile: make dev-backend
```

### Frontend & Monorepo

```bash
# Install dependencies
npm install

# Start web development server
npm run dev
# Alternatively using Makefile: make dev-client

# Typecheck and build frontend
npm run build

# Run linter across workspaces
npm run lint

# Run web test suite (Vitest)
npm test --workspace @pitchmate/web

# Run a single web test file or test pattern
npm test --workspace @pitchmate/web -- src/features/squads/api/squadsApi.test.ts
npm test --workspace @pitchmate/web -- -t "test name pattern"
```

### Contract Drift & API Generation

The contract flows one way: **C# Backend API → OpenAPI Spec → TypeScript Client**. Both generated files are committed, and CI fails if either drifts from source.

```bash
# 1. Build backend API to emit OpenAPI spec (outputs to packages/api-client/openapi/v1.json)
dotnet build backend/src/PitchMate.Api

# 2. Generate TypeScript contracts (outputs to packages/api-client/src/schema.d.ts)
npm run gen --workspace @pitchmate/api-client

# 3. Check for unstaged drift
git diff -- packages/api-client
```

### Database & Docker

```bash
# Start local PostgreSQL 16 (on port 5432, db/user "pitchmate", password "pitchmate_local_dev")
docker compose up -d
# Alternatively: make up

# Stop containers
docker compose down
# Alternatively: make down

# Run EF Core database migrations (design-time factory requires explicit --connection for database access)
dotnet ef database update --project backend/src/PitchMate.Infrastructure --startup-project backend/src/PitchMate.Api \
  --connection "Host=localhost;Port=5432;Database=pitchmate;Username=pitchmate;Password=pitchmate_local_dev"
```

Migrations never run on application startup; deployments execute an `efbundle` step out-of-process before rollout.

## Coding Conventions & Guardrails

### C# 13 / .NET 10
- **Nullable reference types**: Enabled across all projects (`<Nullable>enable</Nullable>`). No unannotated nullables.
- **File-scoped namespaces**: Standardized across the entire C# codebase (`namespace PitchMate...;`).
- **Domain entity encapsulation**: Private property setters; all state changes must occur through explicit domain methods or factory methods that return `Result<T>`.
- **Existence-concealing endpoints**: On existence-sensitive resources (unauthorized squad access, squads in deletion grace period, missing resources, password resets), return byte-for-byte uniform 404 responses (`Concealed` via `XErrorResults`) to eliminate timing and enumeration side channels.
- **Compiler warnings as errors**: `Directory.Build.props` enables `TreatWarningsAsErrors`. Do not suppress warnings without documented justification.
- **Asynchronous programming**: Use `async`/`await` for all I/O with `CancellationToken` propagated through public APIs. Never use `async void`, `.Result`, or `.Wait()`.

### TypeScript / React
- **Strict typing**: Zero `any` or loose casts; types are strictly checked.
- **API client consumption**: Components and features strictly consume `@pitchmate/api-client` types via feature facades (`src/features/<feature>/api/<feature>Api.ts`). Never make raw fetch calls from UI components.
- **No domain logic on client**: Rating calculations (μ, σ, win probability) belong exclusively to the backend. The web client only renders display-ready values.
- **Accessibility (a11y)**: WCAG 2.1 AA compliance is mandatory. Components and screens must have accessible names and semantic roles (`getByRole`), and include `*.a11y.test.tsx` verified via `jest-axe` in both light and dark themes.
- **Property-based testing**: Property invariants on frontend are tested with `fast-check` (`*.property.test.ts(x)`).

### Git & PR Workflow
- **Branch naming**: Use descriptive prefixes:
  - `feat/<feature-name>` for new features
  - `fix/<issue-name>` for bug fixes
  - `test/<test-name>` for test additions or harness improvements
- **Commit conventions**: Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`).
- **PR verification**: Always verify CI passes locally prior to opening a PR or merging using the `/verify` command (`.claude/skills/verify/verify.sh all`).

## Claude Skills & Slash Commands

Specialized skills live in `.claude/skills/` and corresponding slash commands live in `.claude/commands/`:

- **/verify** / **/verify-monorepo** (`.claude/skills/verify/`, `.claude/commands/verify.md`):
  Runs all CI verification gates locally: backend build, OpenAPI spec drift, Docker readiness, backend tests, TS client generation, contract drift, web linter, web build (tsc + Vite), and web tests. Accepts scope argument `all` (default), `backend`, or `web`.
- **/sync-contracts** / **/sync-api-contracts** (`.claude/skills/sync-contracts/`, `.claude/commands/sync-contracts.md`):
  Re-emits `openapi/v1.json` from `PitchMate.Api`, regenerates `schema.d.ts` in `@pitchmate/api-client`, audits diffs, and validates web consumers.
- **/db-migration** / **/manage-migrations** (`.claude/skills/db-migration/`, `.claude/commands/db-migration.md`):
  Scaffolds a new EF Core migration with proper snake_case conventions, validates model changes against Docker PostgreSQL, tests forward/backward rollouts, and runs migration tests.
- **/balance-simulation** / **/test-balancing** (`.claude/skills/balance-simulation/`, `.claude/commands/balance-simulation.md`):
  Runs the production `TeamBalancer` and `PlackettLuceRatingEngine` via `backend/tools/BalanceSimulation/simulate.cs` over mock rosters (`even`, `mixed`, `stars`, `newcomers`, `uncertainty`, `random`, `all`) or custom rosters (`--roster`).

## Modular Guidelines

Deep domain rules are modularized in `.claude/rules/` to ensure relevant guidelines are automatically loaded for matching file paths:

- **`product.md`** (Loads unconditionally): Core PitchMate concepts, matchmaking invariants, rating dynamics, squad lifecycle, and "Today" status notes.
- **`architecture-rules.md`** (Loads for `backend/src/**`, `backend/tests/**`, `apps/web/src/**`): Strict layer isolation, dependency directions, use-case scaffolding rules, data-model invariants, and web feature boundaries.
- **`security-and-privacy.md`** (Loads for `backend/src/**`, `apps/web/src/features/auth/**`, `apps/web/src/features/*/api/**`): Uniform existence concealment, token rotation and hashing, auth providers, GDPR anonymisation, and secrets management.
- **`testing-patterns.md`** (Loads for backend tests and web test suites): xUnit, Testcontainers, FsCheck version rules (2.16.6 in Infrastructure vs 3.3.3 elsewhere), database property harnesses, Vitest, Testing Library, `fast-check`, and `jest-axe`.
- **`brand.md`** (Loads for web styling and UI components): Design tokens (`--pm-*`), semantic colors, dark-first theming, and shared UI component guidelines.
- **`specs.md`** (Loads for `specs/**`): Spec layout (`specs/master/`, `specs/features/`), status tags (Built / Partial / Gap / Idea), source citations, the six-section chapter shape (Purpose, Today (as-is), To be, Rules, Open questions, Ideas), Mermaid for flows, and how `product.md` and the signed-off to-be spec stay in agreement.

## Key Conventions & Gotchas

- `Directory.Build.props` turns on `TreatWarningsAsErrors` for every .NET project, so any compiler warning breaks the build.
- `.editorconfig` asks for CRLF, but every committed file is LF, so match the file you're editing. It also sets file-scoped namespaces, `_camelCase` private fields, 4-space C# and 2-space TS/JSON/YAML.
- `.npmrc` sets `legacy-peer-deps=true` because `openapi-typescript` declares a stale TS 5 peer range while the repo pins TypeScript ~6.0.
- Testcontainers pulls `postgres:17.2` from Docker Hub. If tests fail with `DockerApiException ... Unauthorized`, the local Docker login is stale; this is not a code fault.
- CI is path-filtered: `ci-backend.yml` runs for `backend/**`, and `ci-web.yml` for `apps/web/**`, `packages/**` and the root package files. CD workflows are scaffolded but inert until `AZURE_DEPLOY_ENABLED` is set. Once active, a merge to `develop` deploys to QA and a merge to `main` deploys to production behind a manual approval, authenticating to Azure through GitHub OIDC. Hosting is Azure: App Service, Postgres Flexible Server, Static Web Apps, Key Vault (`infra/main.bicep`).