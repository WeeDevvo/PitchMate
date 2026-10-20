---
paths:
  - "backend/src/**"
  - "apps/web/src/features/auth/**"
  - "apps/web/src/features/*/api/**"
---

# Security and privacy

## Existence concealment

Wherever a caller could probe for a resource's existence, every failure reason gets the same answer. On existence-sensitive reads, these cases all return one code-agnostic `404 Not Found`, byte-for-byte identical whatever the error code:

- a non-member, or an inactive or guest membership
- an absent resource
- a squad pending deletion

The `Concealed` result in each `XErrorResults` builds this response from constants, never from the error's code or message. In Squads and Matches, a new existence-sensitive read passes `concealExistence: true` to its error seam. The Stats, Notifications and LiveTracking seams conceal unconditionally.

Account flows follow the same idea: `RequestPasswordResetHandler` returns an identical success whether or not the email matches an account or the rate limit fired, and it swallows delivery failures so they can't become an enumeration side channel. Any new flow keyed by email or another identifier gets the same uniform response.

## Authentication

- Endpoints call `.RequireAuthorization()` unless they are deliberately public, in which case they say `.AllowAnonymous()` explicitly. The JWT bearer middleware returns the uniform `401` before any handler runs.
- The acting user comes only from the token, via `CallerIdentity.ResolveUserId(principal)`. Request bodies and routes never carry the caller's identity.
- Refresh, email-verification and password-reset tokens are opaque, high-entropy secrets. Only their `ISecretHasher` hash is persisted, and verification is fixed-time. Refresh tokens rotate on use.
- The Bearer security scheme in the OpenAPI document comes from the auth transformers, so a new protected endpoint is marked automatically through `RequireAuthorization()`.
- **Identity is split from credentials:** a `User` has many `AuthIdentity` rows keyed on (Provider, ProviderUserId) and is **never matched on email**. So signing in with a second provider never merges accounts. Linking another method is a deliberate action taken while already signed in, from account settings. Providers are email+password and Google; Apple is deferred until the iOS app.
- Access tokens are short-lived JWTs (about 15 minutes) paired with rotating, revocable refresh tokens, so the SPA now and mobile and watch later share one model. The watch relays the paired phone's session rather than holding its own long-lived credential.
- **Existence concealment covers the deletion grace period:** a squad pending deletion keeps its memberships `Active`, so a squad-scoped read must check visibility itself (a source's join on `NOT squad.is_deleted`, or `ISquadMembershipRepository.IsSquadPendingDeletionAsync`) rather than rely on the membership gate.

## Problem responses

Failures are `ProblemDetails` with the stable error code in `title` and a `code` extension. Clients branch on `code`. Messages are written for users and contain no internal identifiers, stack traces or other members' data.

## Personal data (GDPR)

- Erasure means anonymisation: entities holding PII implement `IAnonymisable.Anonymise()`, which replaces PII with fixed placeholders and keeps the row, id and relationships, so completed matches and rating replay stay valid. A new entity with PII implements it, and the erase/export flows (`Application/Auth/Gdpr`, squad export/erase-membership) include it.
- Deletion is soft (`BaseEntity` + `ISoftDeletable`), and query filters hide deleted rows.

## Secrets and config

`appsettings.Example.json` documents every key's shape. Real secrets (`Auth:Token:SigningKey`, ACS/SendGrid keys) come from user-secrets locally and Key Vault in the cloud. `appsettings*.json` holds non-secret values only, and a new secret gets a placeholder entry in `appsettings.Example.json`. Startup validates options and fails fast on missing or invalid values.

## Web session

- Tokens live behind the `SessionStore` seam (currently `localStorage`). `SessionManager` is the only owner of the in-memory session, and sign-out clears both copies.
- Feature facades receive the authenticated client from the auth feature (`authMiddleware.ts`), which attaches the bearer token and handles refresh. Token handling stays inside `features/auth`.
