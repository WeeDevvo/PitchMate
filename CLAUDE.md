# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

PitchMate: a football app for organising fair, casual small-sided matches between friends. It covers squads, availability/RSVP, auto-balanced teams (OpenSkill), live tracking and player stats. It is a monorepo:

- `backend/`: .NET 10 solution (`PitchMate.slnx`), Clean Architecture: Domain → Application → Infrastructure → Api, on EF Core 10, Npgsql and PostgreSQL.
- `apps/web/`: React 19, TypeScript, Vite and React Router 7 (`@pitchmate/web`). `apps/mobile` and `apps/watch` are placeholders.
- `packages/api-client/`: `@pitchmate/api-client`, a typed client generated from the backend's OpenAPI spec.

The product rules live in `.claude/rules/product.md`, which loads every session. `docs/` (local-dev guide, migrations, backlog, ADRs) is git-ignored and may not exist locally.

## Commands

Run from the repo root unless noted.

```bash
# Local database (Postgres 16 on :5432, db/user "pitchmate")
docker compose up -d

# Backend
(cd backend && dotnet tool restore)               # restores dotnet-ef
dotnet build backend/PitchMate.slnx               # also regenerates packages/api-client/openapi/v1.json
dotnet test backend/PitchMate.slnx                # Infrastructure + Api tests need Docker (Testcontainers)
dotnet test backend/tests/PitchMate.Domain.Tests --filter "FullyQualifiedName~SquadCreationPropertyTests"   # single class/test
dotnet user-secrets set "Auth:Token:SigningKey" "<32+ byte secret>" --project backend/src/PitchMate.Api   # required to boot locally
dotnet run --project backend/src/PitchMate.Api

# Web (npm workspaces)
npm install
npm run dev
npm run build                                     # tsc -b && vite build; test files are not typechecked
npm run lint
npm test --workspace @pitchmate/web               # vitest run
npm test --workspace @pitchmate/web -- src/features/squads/api/squadsApi.test.ts   # single file
npm test --workspace @pitchmate/web -- -t "test name pattern"

# API client codegen
npm run gen --workspace @pitchmate/api-client     # openapi/v1.json -> src/schema.d.ts
```

EF Core migrations run from `backend/`. The design-time `PitchMateDbContextFactory` has a placeholder connection string, so any command that touches a database needs `--connection`:

```bash
dotnet ef migrations add <Name> --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api --output-dir Persistence/Migrations
dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.Api \
  --connection "Host=localhost;Port=5432;Database=pitchmate;Username=pitchmate;Password=pitchmate_local_dev"
```

Migrations never run on app startup. Deploys apply them out of process as an `efbundle` step before the app rolls out.

## Skills and rules

Project skills live in `.claude/skills/`:

- `verify`: run every CI gate locally before calling work done
- `sync-contracts`: regenerate the OpenAPI spec and TS client after an API change
- `db-migration`: scaffold, review and validate a migration
- `/balance-simulation`: run the real team balancer over mock rosters

Rules in `.claude/rules/`. `product.md` always loads; the rest load when you touch matching files:

- `product.md`: what PitchMate does and the product rules the code implements (ratings, balancing, lifecycle, guests, GDPR), with "Today" notes where code lags intent
- `architecture-rules.md`: layering, where each piece of a use case goes, data-model invariants, web feature boundaries
- `security-and-privacy.md`: existence concealment, auth and identity, GDPR, secrets
- `testing-patterns.md`: test kinds, coverage rules, database property harnesses, FsCheck versions, a11y
- `brand.md`: palette, semantic colours, dark-first theming and per-feature theme tokens (web and app UI)

## API contract pipeline (CI-enforced)

Building `PitchMate.Api` boots the host at build time (`Microsoft.Extensions.ApiDescription.Server`) and writes `packages/api-client/openapi/v1.json`. The csproj injects placeholder config so this works without a database or secrets. `npm run gen` turns that spec into `src/schema.d.ts`. Both files are committed and CI fails if either drifts from its source, so every endpoint, request/response or enum change ships with both regenerated files (`sync-contracts`). Enums cross the wire as their C# member **names**.

## Architecture in brief

- **Backend**: feature-sliced in every layer (Auth, Squads, Matches, LiveTracking, Notifications, Stats, plus Rating). Application use cases are command/handler pairs returning `Result<T>` with a typed per-feature error. Api endpoints call one handler each and map failures through a single per-feature `XErrorResults` seam to `ProblemDetails`. `Program.cs` composes `AddInfrastructure` plus one `AddX()` per feature, with `ValidateOnBuild` so wiring errors fail at startup. Team balancing brute-forces splits for ≤ 16 players and scores each one only with the OpenSkill engine's `Predict`.
- **Web**: `src/app/appRouter.tsx` composes routes from features in `src/features/<feature>/`. Each feature has a public barrel and a single API facade, enforced by structural source-scan tests. A Vite plugin injects the pre-paint theme bootstrap from `src/theme/themeBootstrap.ts` into `index.html`.

## Conventions and gotchas

- `Directory.Build.props` turns on `TreatWarningsAsErrors` for every .NET project, so any compiler warning breaks the build.
- `.editorconfig` asks for CRLF, but every committed file is LF, so match the file you're editing. It also sets file-scoped namespaces, `_camelCase` private fields, 4-space C# and 2-space TS/JSON/YAML.
- `.npmrc` sets `legacy-peer-deps=true` because `openapi-typescript` declares a stale TS 5 peer range while the repo pins TypeScript ~6.0.
- Testcontainers pulls `postgres:17.2` from Docker Hub. If tests fail with `DockerApiException ... Unauthorized`, the local Docker login is stale; this is not a code fault.
- Flow is feature branch → PR → `main`. CI is path-filtered: `ci-backend.yml` runs for `backend/**`, and `ci-web.yml` for `apps/web/**`, `packages/**` and the root package files. CD workflows are scaffolded but inert until `AZURE_DEPLOY_ENABLED` is set. Once active, a merge to `develop` deploys to QA and a merge to `main` deploys to production behind a manual approval, authenticating to Azure through GitHub OIDC. Hosting is Azure: App Service, Postgres Flexible Server, Static Web Apps, Key Vault (`infra/main.bicep`).