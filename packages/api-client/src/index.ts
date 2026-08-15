// Public surface of @pitchmate/api-client.
//
// Types are generated from the committed .NET OpenAPI spec (../openapi/v1.json) into
// ./schema.d.ts by `npm run gen` (openapi-typescript). Requests go through openapi-fetch, whose
// client is fully typed against that contract, so consumers never hand-roll request/response
// shapes (coding-standards: "use the generated API client; never hand-roll request/response
// types that duplicate the OpenAPI contract").

import createClient, { type ClientOptions, type Client } from "openapi-fetch";
import type { paths } from "./schema";

// Re-export the generated contract types so consumers can name request/response/schema shapes
// (e.g. components["schemas"]["..."]) without importing the generated module directly.
export type { paths, components, operations, webhooks } from "./schema";

// Re-export the openapi-fetch types consumers commonly need (middleware, options, the client
// shape) so they depend only on @pitchmate/api-client, not on openapi-fetch directly.
export type { ClientOptions, Client, Middleware, FetchResponse } from "openapi-fetch";

/**
 * A PitchMate API client instance, typed against the OpenAPI `paths`. Every method
 * (`GET`, `POST`, ...) is constrained to real endpoints and their request/response schemas.
 */
export type PitchMateApiClient = Client<paths>;

/**
 * Create a typed PitchMate API client.
 *
 * @param options openapi-fetch client options (e.g. `baseUrl`, `fetch`, `headers`).
 * @returns a client whose calls are typed against the generated OpenAPI contract.
 *
 * @example
 * const api = createApiClient({ baseUrl: "https://api.pitch-mate.co.uk" });
 * const { data, error } = await api.POST("/auth/sign-in", { body: { ... } });
 */
export function createApiClient(options?: ClientOptions): PitchMateApiClient {
  return createClient<paths>(options);
}

// Also re-export openapi-fetch's factory for consumers who want the raw, unopinionated entry point.
export { createClient };
