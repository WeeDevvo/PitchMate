# 04 · Devices

## Purpose

Which devices PitchMate runs on and what each client can do. The honest summary: **the web app is the only client that exists.** `apps/mobile` and `apps/watch` each contain one README and no code. This chapter says what the web does on each screen size, and what the backend already provides for the clients that are not built.

## Today (as-is)

| Device | Client | Status | Source |
|---|---|---|---|
| Desktop and laptop browser | React web app | **Built** | `apps/web/package.json`, `apps/web/src/app/appRouter.tsx` |
| Phone browser | The same web app, responsive | **Built** | `apps/web/src/features/app-shell/state/useViewportLayout.ts` |
| Android app | None | **Gap** | `apps/mobile/README.md` |
| iOS app | None | **Gap** | `apps/mobile/README.md` |
| Watch (watchOS) | None | **Gap** | `apps/watch/README.md` |

### Web

| Line | Status | Source |
|---|---|---|
| A single-page app (React 19, Vite, React Router) served as static files from Azure Static Web Apps, calling the API cross-origin | **Built** | `apps/web/package.json`, `apps/web/public/staticwebapp.config.json`, `infra/main.bicep:337` |
| Every feature in [05 · Features](05-features.md) that has a UI has it here | **Built** | `apps/web/src/features` |
| Responsive layout: the shell switches at 768px, and the landing page, match screens, team sheet and cards have their own narrow-screen rules | **Built** | `apps/web/src/features/app-shell/state/useViewportLayout.ts`, `apps/web/src/ui/TeamSheet.css`, `apps/web/src/ui/Steps.css` |
| Dark-first theme with a System / Dark / Light choice, applied before first paint and remembered on the device | **Built** | `apps/web/src/theme/themeBootstrap.ts`, `apps/web/src/theme/appearancePreference.ts`, `apps/web/src/features/app-shell/SettingsDestination.tsx` |
| The session survives a reload (stored in `localStorage`) | **Built** | `apps/web/src/features/auth/session/SessionStore.ts` |
| Installable app (web manifest, home-screen icon) | **Gap** | `apps/web/index.html` |
| Offline use (service worker, cached shell, persisted outbox) | **Gap** | `apps/web/src/features/matches/state/useEventLog.ts` |
| Push notifications | **Gap** | `backend/src/PitchMate.Domain/Notifications/DeliveryChannel.cs` |
| Updates arrive by polling: unread notifications every 60 seconds, live score every 20 seconds; nothing is pushed | **Partial** | `apps/web/src/features/app-shell/lib/pollInterval.ts`, `apps/web/src/features/matches/components/LiveScorePanel.tsx:30` |
| Pitch-side use on a phone: the live tracker works in a phone browser but needs a connection for the whole match | **Partial** | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx`, `apps/web/src/features/matches/state/useEventLog.ts` |

### Mobile (Android and iOS)

`apps/mobile/README.md` in full intent: React Native + Expo for iOS and Android, **not yet started**; Apple Sign-In is required for iOS; the app will consume the same API through `@pitchmate/api-client`.

| Line | Status | Source |
|---|---|---|
| Any mobile app code | **Gap** | `apps/mobile/README.md` |
| Sign in with Apple: the provider value exists in the domain enum but no verifier, endpoint or UI uses it | **Gap** | `backend/src/PitchMate.Domain/Auth/AuthProvider.cs` |
| Push delivery: the notification model names the channel but only in-app and email are implemented | **Gap** | `backend/src/PitchMate.Domain/Notifications/DeliveryChannel.cs`, `backend/src/PitchMate.Application/Notifications/PublishNotificationHandler.cs` |
| A typed API client any TypeScript client can share | **Built** | `packages/api-client/package.json`, `packages/api-client/src/index.ts` |
| A session model that suits native clients: short access token, rotating refresh token in the request body, no cookies | **Built** | `backend/src/PitchMate.Application/Auth/UseCases/RefreshSessionHandler.cs`, `backend/src/PitchMate.Api/WebClientCors.cs` |
| Mobile screen designs | **Partial** | The brand rule says the design-system artifact holds mobile mockups; none of them is implemented and this pass did not open the artifact | `.claude/rules/brand.md` |

### Watch

`apps/watch/README.md` in full intent: native SwiftUI on watchOS for live match tracking, **not yet started**; the watch syncs through the paired phone and acts as one of several offline-first live-tracking clients.

| Line | Status | Source |
|---|---|---|
| Any watch app code | **Gap** | `apps/watch/README.md` |
| The server side of offline-first tracking: client-generated time-ordered event ids, batched submission, per-event Applied / Duplicate / Rejected outcomes, duplicates harmless | **Built** | `backend/src/PitchMate.Domain/LiveTracking/EventIdPolicy.cs`, `backend/src/PitchMate.Domain/LiveTracking/EventOutcome.cs`, `backend/src/PitchMate.Application/LiveTracking/UseCases/RecordEventBatchHandler.cs` |
| A relay of the phone's session to the watch | **Gap** | `.claude/rules/security-and-privacy.md` |
| Several people tracking the same match at once: the log accepts events from any admin client, but nothing reconciles two clients recording the same goal under different ids | **Partial** | `backend/src/PitchMate.Application/LiveTracking/UseCases/RecordEventBatchHandler.cs` |

## To be

What is wanted, from [decisions](decisions.md). **None of this is built** except the polling line. `apps/mobile` and `apps/watch` are still one README each.

| Id | Requirement | Status | Decision |
|---|---|---|---|
| DV-01 | **An Android app** covering what a player and an admin do on the web: squads, availability, matches, teams, the team sheet, results, stats, notifications | **Gap** | [Q4](decisions.md#q4) |
| DV-02 | **An iOS app** with the same scope | **Gap** | [Q4](decisions.md#q4) |
| DV-03 | **Live tracking in the phone app, offline-first**: events are queued on the device, survive the app closing, and are sent when a connection returns. The API already accepts this (client event ids, batches, per-event outcomes) | **Gap** | [Q5](decisions.md#q5) |
| DV-04 | **A watch app that becomes the main way to live-track**, built after the phone tracker | **Gap** | [Q5](decisions.md#q5) |
| DV-05 | **Push notifications** from the apps, for the events that are emailed today (NO-05) | **Gap** | [Q4](decisions.md#q4) |
| DV-06 | **Tokens in the device's secure store**: the Keychain on iOS, the Keystore on Android (SE-22) | **Gap** | [Q10](decisions.md#q10) |
| DV-07 | **Sign in with Apple** in the iOS app, required by Apple because Google sign-in is offered (AC-05) | **Gap** | [A1](decisions.md#a1) |
| DV-08 | **The web keeps polling**: 20 seconds for the live score, 60 for unread notifications (`apps/web/src/features/app-shell/lib/pollInterval.ts`, `apps/web/src/features/matches/components/LiveScorePanel.tsx:30`) | **Built** | [Q6](decisions.md#q6) |

**Decided against:** an installable, offline-capable web app as the first "mobile" release ([Q4](decisions.md#q4)). The web manifest, service worker and web push lines under Today stay Gap and are not planned.

## Rules

- **Built** · One API and one generated contract for every client; no client reimplements rating maths. `packages/api-client/package.json`, `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs`
- **Built** · One session model across clients: bearer access token plus rotating refresh token. `backend/src/PitchMate.Infrastructure/Auth/JwtTokenService.cs`
- **Built** · Dark mode is designed first; every token has a light value too. `apps/web/src/design/tokens.css`
- **Gap** · Apple Sign-In ships with the iOS app (an App Store requirement once Google sign-in is offered). `apps/mobile/README.md`

## Open questions

Answered: native apps ([Q4](decisions.md#q4)), phone first then watch ([Q5](decisions.md#q5)), polling ([Q6](decisions.md#q6)). Still open:

1. **Do the apps ship with the public launch, or after it?** See [01](01-vision.md#open-questions).
2. **Which stack?** The READMEs say React Native + Expo for the phones and SwiftUI for the watch, citing `.kiro/steering/`, which is no longer used ([Q22](decisions.md#q22)). Are those choices still current? "The watch" there means Apple Watch only; is a Wear OS tracker wanted for Android?
3. **How does the watch sign in and sync?** Through the paired phone, as the README says, or on its own?
4. **Two people tracking the same match.** Nothing reconciles two clients recording the same goal under different ids (`backend/src/PitchMate.Application/LiveTracking/UseCases/RecordEventBatchHandler.cs`). With a phone and a watch both able to track, is one tracker per match enforced?
5. **Does the web tracker get an offline outbox**, or is offline tracking an app-only feature?

## Ideas

- **Idea** · Ship the web app as an installable PWA with a persisted tracker outbox as the first "mobile" release.
- **Idea** · Web push for match drafted / confirmed / teams set, ahead of any native app.
- **Idea** · A lock-screen or home-screen widget showing the next match and whether you have marked your days.
- **Idea** · A watch companion that only does GOAL → team → scorer, with everything else on the phone.
- **Idea** · A big-screen "team sheet" mode for a tablet or a phone propped at the side of the pitch.
- **Idea** · A Wear OS tracker, if Android users want to track from the wrist.
