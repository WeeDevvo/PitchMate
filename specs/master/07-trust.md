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

## Rules

- **Built** · Every existence-sensitive failure looks the same to the caller. `backend/src/PitchMate.Api/Squads/Endpoints/SquadErrorResults.cs`
- **Built** · Secrets are high-entropy, stored hashed, compared in fixed time, and single-purpose. `backend/src/PitchMate.Infrastructure/Auth/Sha256SecretHasher.cs`
- **Built** · Erasure means anonymisation where history exists, so immutable matches and ratings stay valid. `backend/src/PitchMate.Domain/Auth/User.cs`
- **Built** · A screen ships with an axe test, and text meets WCAG 2.1 AA contrast in both themes. `apps/web/src/test/setup.ts`, `apps/web/src/design/tokens.contrast.test.ts`
- **Built** · Problem responses carry a stable `code` and a user-facing message, never internal identifiers. `backend/src/PitchMate.Api/Matches/Endpoints/MatchErrorResults.cs`

## Open questions

1. **Erasure does not do what `product.md` and `security-and-privacy.md` say it does.** Both describe anonymisation of a user's de-identified rows across squads; today the account is anonymised and the memberships are untouched (TR-06), and the history check that would protect matches is a stub (TR-07). This is the most serious disagreement between the rules and the code. Fix before any real users?
2. **Deleted squads are never purged** (TR-12). The UI promises a 30-day window. Who runs the purge: a scheduled job in the API, a separate timer, or a manual admin task for now?
3. **Where does scheduled work run at all?** Purge, σ decay and token clean-up all need a scheduler, and the API scales to zero in QA.
4. **What should a data export contain** to satisfy a subject access request (TR-10)? Presumably memberships, match history, ratings and notifications.
5. **Who writes the privacy policy and terms**, and who is the data controller named in them?
6. **Should sign-in require a verified email and lockout be on in production** (SE-13, SE-15)? Both are one config switch, but lockout needs shared storage once there is more than one replica.
7. **Is `localStorage` acceptable for tokens at launch**, given the CSP is minimal (SE-16, SE-18)? Tightening the CSP is cheap; moving to cookies is not.
8. **Reset codes in logs** (TR-15): acceptable in QA, not in production. Is a real email provider (ACS or SendGrid, both implemented) a launch requirement? This also decides whether notification emails exist at all.
9. **How long is personal data kept** for inactive accounts, inactive memberships and old notifications? Nothing expires today.

## Ideas

- **Idea** · A "your data" page: export everything, delete the account, see which squads hold a profile for you.
- **Idea** · An admin-visible audit log per squad (who claimed, removed, promoted, deleted what).
- **Idea** · Passkeys as a sign-in method.
- **Idea** · Add `eslint-plugin-jsx-a11y` and a keyboard-only end-to-end pass to CI.
- **Idea** · A per-member privacy choice to hide their rating number from other members.
