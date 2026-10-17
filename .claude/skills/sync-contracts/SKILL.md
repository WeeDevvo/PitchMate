---
name: sync-contracts
description: Regenerate the committed OpenAPI spec and the typed TS client (@pitchmate/api-client), then update web consumers. Use after changing an Api endpoint, a request/response record, or a wire enum, or when CI reports OpenAPI or schema.d.ts drift.
---

# Sync API contracts

The contract flows one way: .NET code → `packages/api-client/openapi/v1.json` → `packages/api-client/src/schema.d.ts` → web feature facades. Both generated files are committed, and CI fails when either one drifts from its source.

## Steps

1. **Emit the spec**: `dotnet build backend/src/PitchMate.Api`. The build boots the host with placeholder config and writes `openapi/v1.json`, so it needs no database and no secrets.
2. **Generate the client**: `npm run gen --workspace @pitchmate/api-client`.
3. **Audit the diff**: `git diff -- packages/api-client`. Trace every changed path, schema and enum member back to a code change you meant to make. Each unexplained hunk is an accidental contract change: fix the C# and go back to step 1.
4. **Update consumers**: `npm run build`. It runs `tsc -b`, which flags each consumer the change broke:
   - the feature facade `apps/web/src/features/<feature>/api/<feature>Api.ts` (the only module that calls the client)
   - `apps/web/src/features/<feature>/lib/wireEnums.ts`: an added or renamed backend enum member fails `WIRE_ENUM_COVERAGE` or a `satisfies` check until you update the names tuple there. Enums travel by member **name**.

   Express request and response types through `components["schemas"][...]` from `@pitchmate/api-client`.
5. **Stage** both generated files together with the code change that produced them.

**Done** when `git diff --exit-code -- packages/api-client` passes after staging, `npm run build` is green, and `npm test --workspace @pitchmate/web` passes for the features you touched. Then run the `verify` skill with scope `all`.
