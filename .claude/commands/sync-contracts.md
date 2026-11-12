Synchronize the OpenAPI specification and TypeScript contracts from the .NET backend API.

Follow the contract pipeline steps:

1. **Emit the OpenAPI specification**:
   ```bash
   dotnet build backend/src/PitchMate.Api
   ```
   This builds `PitchMate.Api` with placeholder config (no database or secrets required) and writes the updated spec to `packages/api-client/openapi/v1.json`.

2. **Generate the typed TypeScript client**:
   ```bash
   npm run gen --workspace @pitchmate/api-client
   ```
   This generates `packages/api-client/src/schema.d.ts` from `openapi/v1.json`.

3. **Audit the contract diff**:
   ```bash
   git diff -- packages/api-client
   ```
   Verify each added/changed route, request/response schema, and enum member.

4. **Verify web consumers**:
   ```bash
   npm run build
   ```
   Ensure the feature API facades (`apps/web/src/features/<feature>/api/<feature>Api.ts`) and wire enums (`lib/wireEnums.ts`) compile cleanly against the updated contracts.

5. **Stage and verify**:
   Ensure both generated files (`openapi/v1.json` and `src/schema.d.ts`) are staged alongside the backend changes that produced them.
