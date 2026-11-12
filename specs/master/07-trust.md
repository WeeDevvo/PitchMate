# 07 · Trust

## Purpose

What PitchMate does to deserve its users' trust: privacy and UK GDPR, security, and accessibility. These are the launch-blocking topics, so this chapter is stricter than the others about saying what is **not** done. Read it before any change that touches personal data, sign-in, or a screen.

## Today (as-is)

### Privacy and UK GDPR

Personal data held: for a user, display name, email, verified flag, avatar reference and sign-in identities (`backend/src/PitchMate.Infrastructure/Persistence/Configurations/Auth/UserConfiguration.cs`); for a membership or guest, a squad display name and optional skill tier (`backend/src/PitchMate.Infrastructure/Persistence/Configurations/Squads/SquadMembershipConfiguration.cs`).

| Id | Line | Status | Source |
|---|---|---|---|
| TR-01 | All squad data is visible to squad members only; there are no public profiles | **Built** | `backend/src/PitchMate.Application/Squads/SquadAuthorization.cs`, `backend/src/PitchMate.Application/Stats/StatsAuthorization.cs` |
| TR-02 | Ratings are visible to fellow members on purpose | **Built** | `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs:93` |
| TR-03 | A guest stores only a display name and an optional skill tier, never contact details | **Built** | `backend/src/PitchMate.Domain/Squads/SquadMembership.cs` |
| TR-04 | Creating a guest needs a lawful-basis acknowledgement, and the instant is stored | **Built** | `backend/src/PitchMate.Application/Squads/UseCases/CreateGuestHandler.cs`, `apps/web/src/features/squads/components/GuestForm.tsx` |
| TR-05 | Erasing an account anonymises the user (name → "Former player", placeholder email, avatar cleared), removes the password, scrubs external identities, revokes sessions and deletes their notifications | **Built** | `backend/src/PitchMate.Application/Auth/Gdpr/EraseUserHandler.cs`, `backend/src/PitchMate.Domain/Auth/User.cs` |
| TR-06 | Erasure reaches the user's squad memberships | **Gap** | The cascade use case exists and is registered, but account erasure never calls it, so each membership keeps the person's display name and its link to the user | `backend/src/PitchMate.Application/Squads/UseCases/OnUserErasedHandler.cs`, `backend/src/PitchMate.Api/Squads/SquadsServiceCollectionExtensions.cs:102`, `backend/src/PitchMate.Application/Auth/Gdpr/EraseUserHandler.cs` |
| TR-07 | A membership with match history is anonymised rather than deleted | **Gap** | The check for match history is a stub that always answers "no history", so if membership erasure ran it would hard-delete rows that completed matches and rating snapshots refer to | `backend/src/PitchMate.Infrastructure/Squads/NoMatchHistoryProbe.cs`, `backend/src/PitchMate.Application/Squads/UseCases/EraseMembershipHandler.cs` |
| TR-08 | Erasing a guest | **Gap** | No endpoint or UI; the use case exists | `backend/src/PitchMate.Application/Squads/UseCases/EraseMembershipHandler.cs` |
| TR-09 | A user can erase their account from the app | **Gap** | `POST /auth/erasure` has no UI | `backend/src/PitchMate.Api/Auth/Endpoints/AuthEndpoints.cs:229`, `apps/web/src/features/app-shell/SettingsDestination.tsx` |
| TR-10 | Data export (DSAR) for a user | **Partial** | The endpoint returns display name, email, verified flag and provider kinds only; no memberships, matches, ratings or notifications; and it has no UI | `backend/src/PitchMate.Application/Auth/Gdpr/UserDataExport.cs`, `backend/src/PitchMate.Api/Auth/Endpoints/AuthEndpoints.cs:247` |
| TR-11 | Squad export for the owner | **Partial** | Memberships, invites and features; no matches or ratings | `backend/src/PitchMate.Application/Squads/UseCases/SquadExport.cs` |
| TR-12 | A deleted squad is purged after its grace period | **Gap** | Nothing runs the purge; "deleted" squads and their personal data are retained indefinitely while the UI promises a 30-day window | `backend/src/PitchMate.Application/Squads/UseCases/PurgeSquadHandler.cs`, `apps/web/src/features/squads/components/DeleteSquadSection.tsx` |
| TR-13 | Expired tokens (refresh, reset, verification, invites, claims) are cleaned up | **Gap** | No background job of any kind exists | `backend/src/PitchMate.Api/Program.cs` |
| TR-14 | Privacy policy and terms | **Gap** | Linked from sign-up and the footer; no page exists | `apps/web/src/features/auth/SignUpScreen.tsx:75`, `apps/web/src/features/landing/content/landingContent.ts:283` |
| TR-15 | Reset codes and verification links stay out of logs | **Partial** | With the Console email transport, which is what the cloud runs today, the full email body, including the reset code, is written to the API log | `backend/src/PitchMate.Infrastructure/Auth/Email/ConsoleEmailSender.cs`, `infra/README.md:55` |
| TR-16 | Cookie or tracking consent | **Built** | Nothing to consent to: no cookies, no analytics, no third-party scripts; the app stores a session and a theme preference in `localStorage` | `apps/web/src/features/auth/session/SessionStore.ts`, `apps/web/src/theme/appearancePreference.ts`, `apps/web/index.html` |

### Security

| Id | Line | Status | Source |
|---|---|---|---|
| SE-01 | Existence concealment: on squad, match, stats, live-tracking and notification reads, "not a member", "does not exist" and "pending deletion" return the same fixed 404 | **Built** | `backend/src/PitchMate.Api/Squads/Endpoints/SquadErrorResults.cs`, `backend/src/PitchMate.Api/Matches/Endpoints/MatchErrorResults.cs`, `backend/src/PitchMate.Api/ExistenceConcealingMetadata.cs` |
| SE-02 | Password reset answers identically whether or not the account exists or the limit was hit | **Built** | `backend/src/PitchMate.Application/Auth/PasswordReset/RequestPasswordResetHandler.cs` |
| SE-03 | The acting user comes only from the token | **Built** | `backend/src/PitchMate.Api/Auth/Endpoints/CallerIdentity.cs` |
| SE-04 | Access tokens: 15-minute HMAC-SHA256 JWTs carrying only the user id, validated with zero clock skew; one uniform 401 | **Built** | `backend/src/PitchMate.Infrastructure/Auth/JwtTokenService.cs`, `backend/src/PitchMate.Api/Auth/ConfigureJwtBearerOptions.cs` |
| SE-05 | Refresh tokens: random 32-byte secrets, only the hash stored, rotated on use, whole family revoked on reuse | **Built** | `backend/src/PitchMate.Infrastructure/Auth/RandomSecretTokenGenerator.cs`, `backend/src/PitchMate.Infrastructure/Auth/Sha256SecretHasher.cs`, `backend/src/PitchMate.Application/Auth/UseCases/RefreshSessionHandler.cs` |
| SE-06 | Invite, claim, reset and verification secrets are stored hashed | **Built** | `backend/src/PitchMate.Application/Squads/UseCases/GenerateInviteHandler.cs`, `backend/src/PitchMate.Infrastructure/Persistence/Configurations/Auth/EmailVerificationTokenConfiguration.cs` |
| SE-07 | Passwords hashed with the ASP.NET Identity hasher, with rehash-on-sign-in support | **Built** | `backend/src/PitchMate.Infrastructure/Auth/IdentityPasswordHasher.cs` |
| SE-08 | Identity is split from credentials; accounts are never matched or merged on email | **Built** | `backend/src/PitchMate.Application/Auth/UseCases/SignInWithGoogleHandler.cs` |
| SE-09 | Startup fails fast on missing or weak configuration (signing key under 32 bytes, missing issuer, bad email provider) | **Built** | `backend/src/PitchMate.Api/Auth/Configuration/AuthTokenOptionsValidator.cs`, `backend/src/PitchMate.Api/Auth/AuthServiceCollectionExtensions.cs` |
| SE-10 | Secrets live in Key Vault and reach the API through a managed identity; none are committed | **Built** | `infra/main.bicep:297`, `backend/src/PitchMate.Api/appsettings.json` |
| SE-11 | CORS allows only the configured web origin, without credentials | **Built** | `backend/src/PitchMate.Api/WebClientCors.cs` |
| SE-12 | Optimistic concurrency and soft delete on every entity | **Built** | `backend/src/PitchMate.Infrastructure/Persistence/PitchMateDbContext.cs` |
| SE-13 | Sign-in lockout | **Partial** | Implemented, off by default, and counted in memory per instance, so it resets on restart and is not shared between replicas | `backend/src/PitchMate.Application/Auth/UseCases/SignInProtectionOptions.cs`, `backend/src/PitchMate.Infrastructure/Auth/InMemorySignInAttemptTracker.cs` |
| SE-14 | Rate limiting on the API | **Gap** | No rate limiter is registered; the only throttle is the password-reset window | `backend/src/PitchMate.Api/Program.cs` |
| SE-15 | Email verified before use | **Partial** | Verification exists; requiring it to sign in is off by default | `backend/src/PitchMate.Application/Auth/UseCases/SignInProtectionOptions.cs` |
| SE-16 | Security headers on the web | **Partial** | The Static Web App sends nosniff, referrer policy, permissions policy, HSTS and a CSP that restricts framing, objects, base and form targets but has no script or connect directives | `apps/web/public/staticwebapp.config.json:7` |
| SE-17 | Security headers and a global error handler on the API | **Gap** | HTTPS redirection only; no HSTS, no exception-handling middleware | `backend/src/PitchMate.Api/Program.cs` |
| SE-18 | Web session storage | **Partial** | Tokens are kept in `localStorage` behind a storage seam, which any script running on the page can read; the thin CSP (SE-16) is the main mitigation that is missing | `apps/web/src/features/auth/session/SessionStore.ts` |
| SE-19 | The API health check proves the database is reachable | **Partial** | `/health` is a static "ok" | `backend/src/PitchMate.Api/Program.cs:107` |
| SE-20 | Typed-name confirmation on squad deletion is enforced server-side | **Gap** | Web only | `apps/web/src/features/squads/lib/deletionConfirmation.ts:14`, `backend/src/PitchMate.Application/Squads/UseCases/DeleteSquadCommand.cs` |
| SE-21 | Dependency and image scanning in CI | **Gap** | | `.github/workflows/ci-backend.yml` |

### Accessibility

| Id | Line | Status | Source |
|---|---|---|---|
| AX-01 | Automated axe checks: 16 `*.a11y.test.tsx` files covering the shell, every auth screen, the landing page, matches, player stats, leaderboards, squads and the UI kit | **Built** | `apps/web/src/test/setup.ts:4`, `apps/web/src/ui/ui.a11y.test.tsx` |
| AX-02 | Checks run in both dark and light themes | **Partial** | Most suites iterate both themes; four (guest claims, players panel, squad deletion, squad leaderboards) show no light-theme run and may be dark only (not confirmed line by line) | `apps/web/src/features/matches`, `apps/web/src/features/squads` |
| AX-03 | Colour contrast of every documented token pairing is tested in both themes | **Built** | `apps/web/src/design/tokens.contrast.test.ts` |
| AX-04 | Skip link and focus moved to the arriving page heading | **Built** | `apps/web/src/features/app-shell/components/SkipLink.tsx`, `apps/web/src/features/app-shell/components/ContentRegion.tsx` |
| AX-05 | Reduced motion respected | **Built** | `apps/web/src/index.css:55` |
| AX-06 | Never colour alone: W/L/D letters and marks, the "~ Provisional" label, team names, the word BIBS | **Built** | `apps/web/src/ui/Result.tsx`, `apps/web/src/ui/BibFlag.tsx`, `apps/web/src/features/player-stats/components/ProgressionChart.tsx` |
| AX-07 | Keyboard patterns for composite widgets (roving focus) are property-tested | **Built** | `apps/web/src/ui/roving.ts`, `apps/web/src/ui/roving.property.test.ts` |
| AX-08 | Static accessibility linting | **Gap** | No `eslint-plugin-jsx-a11y` in the lint config | `apps/web/eslint.config.js` |
| AX-09 | Manual checks: screen-reader walkthroughs, keyboard-only passes, zoom and reflow | **Gap** | Nothing recorded in the repo | `apps/web` |
| AX-10 | An accessibility statement | **Gap** | | `apps/web/src/features/landing/content/landingContent.ts` |

## To be

What is wanted, from [decisions](decisions.md). Nothing in this section is built unless the line says so; the tables above are the as-is truth. A row that reuses an id is the requirement that closes that row. Every row marked **Launch** must be done before the public launch ([Q1](decisions.md#q1)).

### Privacy and UK GDPR

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| TR-06 | **Account erasure reaches every squad membership** of that user: the existing cascade is called from account erasure | **Gap** | Yes | [Q7](decisions.md#q7) |
| TR-07 | **A real match-history check** replaces the stub, so a membership with history is anonymised and only one without history is hard-deleted | **Gap** | Yes | [Q7](decisions.md#q7) |
| TR-08 | **A guest can be erased** by an admin, by the same rule | **Gap** | Yes | [Q7](decisions.md#q7) |
| TR-09 | **Delete my account** is on the account screen (AC-11) | **Gap** | Yes | [Q17](decisions.md#q17) |
| TR-10 | **The user's export is everything held about them**, as one JSON file: account, memberships, matches, rating history and stats | **Gap** | Yes | [Q8](decisions.md#q8) |
| TR-12 | **Deleted squads are purged** when the grace period ends, by the scheduled job (PL-01 in [06](06-platform.md#to-be)) | **Gap** | Yes | [Q7](decisions.md#q7) |
| TR-13 | **Expired tokens are cleaned up** by the same job. Follows from Q7; not separately decided | **Gap** | | [Q7](decisions.md#q7) |
| TR-14 | **A privacy policy and terms exist** and are linked: drafted by Claude, reviewed by a solicitor before launch | **Gap** | Yes | [Q8](decisions.md#q8) |
| TR-15 | **Reset codes and verification links never reach a log**: real email in every cloud environment (NO-03) | **Gap** | Yes | [Q9](decisions.md#q9) |
| TR-04 | **The guest lawful-basis acknowledgement stays**, asked once per admin (GU-02). It is the UK GDPR cover for storing a profile of someone with no account | **Gap** | | [Q14](decisions.md#q14) |
| TR-17 | **Report a squad**: someone who can see a squad can report it to PitchMate, and the report reaches a person who can act | **Gap** | Yes | [Q3](decisions.md#q3) |

### Security

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| SE-13 | **Lockout on: 5 failed attempts, then 15 minutes**, with the count shared between API replicas (AC-13) | **Gap** | Yes | [Q9](decisions.md#q9) |
| SE-14 | **Rate limits on the API**, at least on the anonymous endpoints (register, sign-in, reset, invite preview and redeem) | **Gap** | Yes | [Q3](decisions.md#q3) |
| SE-15 | **A verified email is required to sign in** | **Gap** | Yes | [Q9](decisions.md#q9) |
| SE-18 | **Web session: the refresh token in an httpOnly, Secure, SameSite cookie; the access token in memory only.** Nothing in `localStorage`. This needs the web and API on the same site (PL-09), CORS that allows credentials for the web origin only, and a defence against cross-site requests on the refresh endpoint | **Gap** | Yes | [Q10](decisions.md#q10) |
| SE-22 | **Native session: tokens in the Keychain (iOS) and the Keystore (Android).** The API keeps accepting the refresh token in the request body for these clients | **Gap** | With apps | [Q10](decisions.md#q10) |
| SE-23 | **Auth stays in the PitchMate API.** No move to Firebase or another hosted identity provider. Email and password and Google verification are built (`backend/src/PitchMate.Application/Auth/UseCases/SignInWithPasswordHandler.cs`, `backend/src/PitchMate.Infrastructure/Auth/GoogleProviderVerifier.cs`); Sign in with Apple is added for iOS (AC-05) | **Partial** | | [A1](decisions.md#a1) |
| SE-24 | **Trust is squad-scoped.** Inside a squad members see each other's ratings and admins add anyone; this is already how the code works (`backend/src/PitchMate.Application/Squads/SquadAuthorization.cs`). The controls in SE-14, SE-15 and TR-17 are what is added between squads | **Built** | | [Q3](decisions.md#q3) |

### Accessibility

No decision touched accessibility. AX-08 to AX-10 stay Gap, and the native apps ([Q4](decisions.md#q4)) will need their own accessibility checks, which nothing defines yet.

## Rules

- **Built** · Every existence-sensitive failure looks the same to the caller. `backend/src/PitchMate.Api/Squads/Endpoints/SquadErrorResults.cs`
- **Built** · Secrets are high-entropy, stored hashed, compared in fixed time, and single-purpose. `backend/src/PitchMate.Infrastructure/Auth/Sha256SecretHasher.cs`
- **Built** · Erasure means anonymisation where history exists, so immutable matches and ratings stay valid. `backend/src/PitchMate.Domain/Auth/User.cs`
- **Built** · A screen ships with an axe test, and text meets WCAG 2.1 AA contrast in both themes. `apps/web/src/test/setup.ts`, `apps/web/src/design/tokens.contrast.test.ts`
- **Built** · Problem responses carry a stable `code` and a user-facing message, never internal identifiers. `backend/src/PitchMate.Api/Matches/Endpoints/MatchErrorResults.cs`

## Open questions

Answered: erasure, purge and where scheduled work runs ([Q7](decisions.md#q7)); the export and who writes the policies ([Q8](decisions.md#q8)); email, verification and lockout ([Q9](decisions.md#q9)); token storage ([Q10](decisions.md#q10)). Still open:

1. **Report a squad (TR-17).** A squad is invisible to non-members, so who can report: members, and people holding an invite or claim link? Where does a report go, who reads it, and what can they do (suspend a squad, remove a member)? There is no operator role or back-office today.
2. **Who is the data controller** named in the privacy policy, and what contact address does it give? The solicitor review ([Q8](decisions.md#q8)) will need this.
3. **How long is personal data kept** for inactive accounts, inactive memberships and old notifications? Nothing expires today, and the policy has to state a period.
4. **Verified email and Google.** Is a Google sign-in treated as already verified? What happens to accounts created on QA before verification became required?
5. **Lockout and existence concealment.** Locking a known email must not reveal that the account exists; the response for a locked account and an unknown one should stay the same.
6. **The squad export** (TR-11) was not covered by Q8. Does it gain matches, results and ratings?
7. **Typed-name confirmation on the API** (SE-20), **API security headers** (SE-17) and **dependency scanning** (SE-21) were not discussed. Launch requirements for a public launch, or later?
8. **Cookies change the consent picture slightly** (TR-16): the refresh cookie is strictly necessary, so no banner is needed, but the privacy policy must describe it.

## Ideas

- **Idea** · A "your data" page: export everything, delete the account, see which squads hold a profile for you.
- **Idea** · An admin-visible audit log per squad (who claimed, removed, promoted, deleted what).
- **Idea** · Passkeys as a sign-in method.
- **Idea** · Add `eslint-plugin-jsx-a11y` and a keyboard-only end-to-end pass to CI.
- **Idea** · A per-member privacy choice to hide their rating number from other members.
- **Idea** · A small operator console for handling squad reports and erasure requests, if reports turn out to need more than an inbox.
