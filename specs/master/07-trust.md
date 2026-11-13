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
| TR-12 | **Deleted squads are purged** after their 30-day grace, by the nightly job (PL-01 in [06](06-platform.md#to-be)) | **Gap** | Yes | [Q7](decisions.md#q7), [R11](decisions.md#r11) |
| TR-13 | **Expired tokens are cleaned up daily** by the same job | **Gap** | Yes | [R11](decisions.md#r11), [R15](decisions.md#r15) |
| TR-14 | **A privacy policy and terms exist** and are linked: drafted by Claude, reviewed by a solicitor before launch. The policy names the user, as an individual, as the data controller, and states the retention rules. It is written so a company or a business address can replace the individual later without a rewrite | **Gap** | Yes | [Q8](decisions.md#q8), [R11](decisions.md#r11), [T14](decisions.md#t14) |
| TR-15 | **Reset codes and verification links never reach a log**: real email in every cloud environment (NO-03) | **Gap** | Yes | [Q9](decisions.md#q9) |
| TR-04 | **The guest lawful-basis acknowledgement stays**, asked once per admin (GU-02). It is the UK GDPR cover for storing a profile of someone with no account | **Gap** | | [Q14](decisions.md#q14) |
| TR-11 | **The squad export is a small CSV of players, matches and stats** (SQ-15) | **Gap** | | [R14](decisions.md#r14) |
| TR-17 | Withdrawn: reporting a squad was dropped | | | [R10](decisions.md#r10) |
| TR-18 | **The user is registered with the ICO as a data controller, as an individual for now** (a small annual fee). The public register shows the controller's address, so a company or a business address can be swapped in later to keep a home address off it | **Gap** | Yes | [R11](decisions.md#r11), [T14](decisions.md#t14) |
| TR-19 | **Data is kept no longer than needed**: deleted squads go after 30 days (TR-12), expired tokens daily (TR-13), logs after 90 days (PL-11), notifications after 90 days (TR-22), inactive accounts after 3 years (TR-21) | **Gap** | Yes | [R11](decisions.md#r11), [T13](decisions.md#t13) |
| TR-21 | **An inactive account is emailed at 2 years and erased at 3**, by the nightly job. Erasure follows the existing rule: memberships with match history are kept, anonymised. "Inactive" is taken to mean no sign-in. The policy states the rule at launch; the job itself has nothing to do until accounts are two years old | **Gap** | | [T13](decisions.md#t13) |
| TR-22 | **Notifications are deleted after 90 days**, by the nightly job | **Gap** | Yes | [T13](decisions.md#t13) |
| TR-23 | **Keeper data is deleted**, by a one-off migration, when keeper tracking is removed (RE-10 in [05](05-features.md#to-be)). Only QA holds any today | **Gap** | Yes | [T9](decisions.md#t9) |
| TR-20 | **Changing an email is safe**: the new address is verified before it takes effect and the old address is told (AC-15) | **Gap** | Yes | [R12](decisions.md#r12) |

### Security

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| SE-13 | **Lockout on: 5 failed attempts, then 15 minutes**, with the count shared between API replicas (AC-13) | **Gap** | Yes | [Q9](decisions.md#q9) |
| SE-14 | **Rate limits on the API**, at least on the anonymous endpoints (register, sign-in, reset, invite preview and redeem) | **Gap** | Yes | [Q3](decisions.md#q3) |
| SE-15 | **A verified email is required to sign in** | **Gap** | Yes | [Q9](decisions.md#q9) |
| SE-18 | **Web session: the refresh token in an httpOnly, Secure, SameSite cookie; the access token in memory only.** Nothing in `localStorage`. This needs the web and API on the same site (PL-09), a cookie scoped to its own API host so QA's never reaches production, CORS that allows credentials for the web origin only, and a defence against cross-site requests on the refresh endpoint | **Gap** | Yes | [Q10](decisions.md#q10), [R16](decisions.md#r16) |
| SE-22 | **Native session: tokens in the Keychain (iOS) and the Keystore (Android).** The API keeps accepting the refresh token in the request body for these clients | **Gap** | Yes | [Q10](decisions.md#q10), [R3](decisions.md#r3) |
| SE-23 | **Auth stays in the PitchMate API.** No move to Firebase or another hosted identity provider. Email and password and Google verification are built (`backend/src/PitchMate.Application/Auth/UseCases/SignInWithPasswordHandler.cs`, `backend/src/PitchMate.Infrastructure/Auth/GoogleProviderVerifier.cs`); Sign in with Apple is added for iOS (AC-05) | **Partial** | | [A1](decisions.md#a1) |
| SE-24 | **Trust is squad-scoped.** Inside a squad members see each other's ratings and admins add anyone; this is already how the code works (`backend/src/PitchMate.Application/Squads/SquadAuthorization.cs`). The controls in SE-14 and SE-15 are what is added between squads | **Built** | | [Q3](decisions.md#q3), [R10](decisions.md#r10) |
| SE-25 | **The per-match tracker is authorised by the API**, for that match only, and loses the power when the match ends or the admin picks someone else (RO-07) | **Gap** | | [R1](decisions.md#r1), [T6](decisions.md#t6) |
| SE-26 | **The nightly-job endpoint is callable by the job alone**: authenticated with the job's own identity or a secret from Key Vault, not a user token, and hidden from everyone else as any concealed resource is (PL-01) | **Gap** | Yes | [T16](decisions.md#t16) |
| SE-17 | **Security headers on the API** (HSTS among them) and a global error handler | **Gap** | Yes | [T17](decisions.md#t17), [U6](decisions.md#u6) |
| SE-20 | **The API enforces the typed-name confirmation** on squad deletion; today only the web does | **Gap** | Yes | [T17](decisions.md#t17) |
| SE-21 | **Dependabot** watches the NuGet, npm and GitHub Actions dependencies. No `.github/dependabot.yml` exists | **Gap** | Yes | [T17](decisions.md#t17) |
| SE-27 | **A purchase is checked by the API** with the store before a squad becomes Pro; a client's word is not enough (OF-05, PL-16) | **Gap** | | [T3](decisions.md#t3) |
| SE-28 | **Signed-in devices can be seen and signed out** by the account's owner (AC-16). Refresh tokens are already stored one per session (`backend/src/PitchMate.Domain/Auth/RefreshToken.cs`); what is missing is a label for each and the list | **Gap** | Yes | [T15](decisions.md#t15) |

### Accessibility

No decision touched accessibility. AX-08 to AX-10 stay Gap. The launch now waits for the native apps ([R3](decisions.md#r3)), which need their own accessibility checks (screen readers, text scaling, contrast in both themes); nothing defines these yet.

## Rules

- **Built** · Every existence-sensitive failure looks the same to the caller. `backend/src/PitchMate.Api/Squads/Endpoints/SquadErrorResults.cs`
- **Built** · Secrets are high-entropy, stored hashed, compared in fixed time, and single-purpose. `backend/src/PitchMate.Infrastructure/Auth/Sha256SecretHasher.cs`
- **Built** · Erasure means anonymisation where history exists, so immutable matches and ratings stay valid. `backend/src/PitchMate.Domain/Auth/User.cs`
- **Built** · A screen ships with an axe test, and text meets WCAG 2.1 AA contrast in both themes. `apps/web/src/test/setup.ts`, `apps/web/src/design/tokens.contrast.test.ts`
- **Built** · Problem responses carry a stable `code` and a user-facing message, never internal identifiers. `backend/src/PitchMate.Api/Matches/Endpoints/MatchErrorResults.cs`

## Open questions

Answered in round three: the retention periods ([T13](decisions.md#t13)), the controller ([T14](decisions.md#t14)), and security headers, Dependabot and the typed-name check ([T17](decisions.md#t17)). Still open:

1. **Verified email and Google or Apple.** Is a Google or Apple sign-in treated as already verified? What happens to accounts created on QA before verification became required?
2. **Lockout and existence concealment.** Locking a known email must not reveal that the account exists; the response for a locked account and an unknown one should stay the same.
3. **Cookies and the policy** (TR-16): the refresh cookie is strictly necessary, so no banner is needed, but the privacy policy must describe it. The apps will also hold push tokens and, once Application Insights is wired, send telemetry; the policy and the store privacy labels must list both.
4. **Payments and personal data** (OF-05): a store subscription adds a payer and two store operators to the policy, after launch.
5. **What counts as "inactive"** for TR-21: no sign-in. The default was accepted in round four.
6. **Outside services in the design work.** The design overhaul may send brand material to Higgsfield ([T12](decisions.md#t12)). No personal data should go with it; worth one line in the policy only if that ever changes.

## Ideas

- **Idea** · A "your data" page: export everything, delete the account, see which squads hold a profile for you.
- **Idea** · An admin-visible audit log per squad (who claimed, removed, promoted, deleted what).
- **Idea** · Passkeys as a sign-in method.
- **Idea** · Add `eslint-plugin-jsx-a11y` and a keyboard-only end-to-end pass to CI.
- **Idea** · A per-member privacy choice to hide their rating number from other members.
