# 05 · Features

## Purpose

The catalogue: every feature PitchMate has or is meant to have, with its status. This is the chapter a feature spec is cut from. Each row has an id so a feature spec or a GitHub issue can point at it. "Built" means the API **and** the web UI exist unless the row says otherwise.

## Today (as-is)

Counts: see the summary at the end of this section.

### Accounts and sign-in

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| AC-01 | Register with email and password | **Built** | 12–128 characters | `backend/src/PitchMate.Application/Auth/UseCases/RegisterWithPasswordHandler.cs`, `apps/web/src/features/auth/SignUpScreen.tsx` |
| AC-02 | Email verification | **Built** | 24-hour link; not required to sign in unless a config switch is turned on | `backend/src/PitchMate.Application/Auth/EmailVerification/EmailVerificationOptions.cs`, `apps/web/src/features/auth/VerifyEmailScreen.tsx` |
| AC-03 | Sign in with password | **Built** | | `backend/src/PitchMate.Application/Auth/UseCases/SignInWithPasswordHandler.cs`, `apps/web/src/features/auth/LogInScreen.tsx` |
| AC-04 | Sign in with Google | **Partial** | API verifies Google tokens; the web button is a stub and the client id is a placeholder | `backend/src/PitchMate.Infrastructure/Auth/GoogleProviderVerifier.cs`, `apps/web/src/app/appRouter.tsx:225` |
| AC-05 | Sign in with Apple | **Gap** | Enum value only; deferred to the iOS app | `backend/src/PitchMate.Domain/Auth/AuthProvider.cs` |
| AC-06 | Stay signed in (rotating refresh token, reuse detection) | **Built** | 15-minute access token, 30-day refresh token | `backend/src/PitchMate.Application/Auth/UseCases/RefreshSessionHandler.cs`, `apps/web/src/features/auth/session/SessionManager.ts` |
| AC-07 | Sign out | **Built** | Revokes the refresh-token family | `backend/src/PitchMate.Application/Auth/UseCases/SignOutHandler.cs`, `apps/web/src/features/app-shell/components/AccountMenu.tsx` |
| AC-08 | Forgot and reset password | **Built** | 30-minute code, 5 requests an hour, uniform response | `backend/src/PitchMate.Application/Auth/PasswordReset/RequestPasswordResetHandler.cs`, `apps/web/src/features/auth/ResetRequestScreen.tsx` |
| AC-09 | Link Google, add a password, unlink a sign-in method | **Partial** | API only; no account screen in the web | `backend/src/PitchMate.Api/Auth/Endpoints/AuthEndpoints.cs:163` |
| AC-10 | View and edit own account (name, email, avatar) | **Gap** | `GET /auth/me` exists with no UI; no way to change a display name; avatars are a column with no upload | `backend/src/PitchMate.Api/Auth/Endpoints/AuthEndpoints.cs:135`, `backend/src/PitchMate.Domain/Auth/User.cs` |
| AC-11 | Delete own account (erasure) | **Partial** | API only, and it does not reach squad memberships; see TR rows in [07 · Trust](07-trust.md) | `backend/src/PitchMate.Application/Auth/Gdpr/EraseUserHandler.cs` |
| AC-12 | Export own data | **Partial** | API only; returns account fields, not memberships, matches or ratings | `backend/src/PitchMate.Application/Auth/Gdpr/UserDataExport.cs` |
| AC-13 | Sign-in lockout after repeated failures | **Partial** | Built but off by default, and counted in memory per server instance | `backend/src/PitchMate.Application/Auth/UseCases/SignInProtectionOptions.cs`, `backend/src/PitchMate.Infrastructure/Auth/InMemorySignInAttemptTracker.cs` |

### Squads, roles and invites

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| SQ-01 | Create a squad | **Built** | Name 1–80 characters; creator is owner | `backend/src/PitchMate.Application/Squads/UseCases/CreateSquadHandler.cs`, `apps/web/src/features/squads/screens/SquadsHome.tsx` |
| SQ-02 | Squads home: my squads with recent form and next match | **Built** | | `backend/src/PitchMate.Application/Squads/UseCases/ListMySquadsHandler.cs`, `apps/web/src/features/squads/screens/SquadsHome.tsx` |
| SQ-03 | Squad screen with Players, Matches, Leaderboards and Admin tabs | **Built** | Admin tab hidden from members | `apps/web/src/features/squads/screens/SquadScreen.tsx`, `apps/web/src/features/squads/lib/squadTabs.ts` |
| SQ-04 | Invite link or code: generate, list, revoke | **Built** | 1 hour to 90 days (default 7 days), at most 25 active; only a hash is stored; shown once | `backend/src/PitchMate.Application/Squads/UseCases/GenerateInviteHandler.cs:87`, `apps/web/src/features/squads/components/InviteManager.tsx` |
| SQ-05 | Join by invite; re-joining reactivates the old membership | **Built** | | `backend/src/PitchMate.Application/Squads/UseCases/RedeemInviteHandler.cs`, `apps/web/src/features/squads/screens/InviteLandingScreen.tsx` |
| SQ-06 | Invite link leaks nothing before joining | **Built** | Static anonymous preview | `backend/src/PitchMate.Api/Squads/Endpoints/SquadEndpoints.cs:391` |
| SQ-07 | Sign-up → auto-join | **Partial** | Return target is in memory; lost on reload or new tab | `apps/web/src/features/auth/session/redirectTargetStore.ts` |
| SQ-08 | Promote to admin, demote to member | **Built** | | `backend/src/PitchMate.Application/Squads/UseCases/PromoteToAdminHandler.cs:71`, `backend/src/PitchMate.Application/Squads/UseCases/DemoteToMemberHandler.cs:49` |
| SQ-09 | Remove a member; leave a squad | **Built** | Membership becomes inactive and keeps history | `backend/src/PitchMate.Application/Squads/UseCases/RemoveMemberHandler.cs:74`, `apps/web/src/features/squads/components/LeaveSquadControl.tsx` |
| SQ-10 | Transfer ownership | **Built** | Owner must transfer before leaving | `backend/src/PitchMate.Application/Squads/UseCases/TransferOwnershipHandler.cs:76` |
| SQ-11 | Unique display names within a squad | **Built** | | `backend/src/PitchMate.Infrastructure/Persistence/Configurations/Squads/SquadMembershipConfiguration.cs` |
| SQ-12 | Rename a squad; change a member's squad display name | **Gap** | | `backend/src/PitchMate.Domain/Squads/Squad.cs` |
| SQ-13 | Delete a squad: soft delete with a 30-day grace period | **Built** | 1–90 days allowed | `backend/src/PitchMate.Application/Squads/UseCases/DeleteSquadHandler.cs:76`, `apps/web/src/features/squads/components/DeleteSquadSection.tsx` |
| SQ-14 | Typed-name confirmation before deleting | **Partial** | Enforced by the web only; the API accepts a delete without it | `apps/web/src/features/squads/lib/deletionConfirmation.ts:14`, `backend/src/PitchMate.Application/Squads/UseCases/DeleteSquadCommand.cs` |
| SQ-15 | Export offered before deletion | **Partial** | Downloads JSON of memberships, invites and features; matches, results, ratings and stats are not in it | `backend/src/PitchMate.Application/Squads/UseCases/ExportSquadHandler.cs:69`, `backend/src/PitchMate.Application/Squads/UseCases/SquadExport.cs` |
| SQ-16 | Restore a deleted squad from the owner's deleted list | **Built** | | `backend/src/PitchMate.Application/Squads/UseCases/ReverseSquadDeletionHandler.cs:71`, `apps/web/src/features/squads/screens/SquadsHome.tsx` |
| SQ-17 | Purge after the grace period | **Gap** | The purge use case exists but nothing ever runs it, so deleted squads are kept indefinitely | `backend/src/PitchMate.Application/Squads/UseCases/PurgeSquadHandler.cs`, `backend/src/PitchMate.Api/Squads/SquadsServiceCollectionExtensions.cs:100` |
| SQ-18 | A squad in its grace period is invisible to every read except the owner's deleted list | **Partial** | Reads conceal it; match-changing actions do not check for it | `backend/src/PitchMate.Application/Matches/UseCases/GetTeamSheetHandler.cs`, `backend/src/PitchMate.Application/Matches/UseCases/CreateMatchDraftHandler.cs` |

### Guests and claims

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| GU-01 | Create a guest (display name, optional skill tier) | **Built** | No contact details stored | `backend/src/PitchMate.Application/Squads/UseCases/CreateGuestHandler.cs:78`, `apps/web/src/features/squads/components/GuestForm.tsx` |
| GU-02 | Lawful-basis acknowledgement when creating a guest | **Partial** | Required and timestamped on **every** guest creation; `product.md` asks for a one-time admin acknowledgement | `backend/src/PitchMate.Application/Squads/UseCases/CreateGuestHandler.cs`, `apps/web/src/features/squads/components/GuestForm.tsx` |
| GU-03 | Edit a guest | **Built** | | `backend/src/PitchMate.Application/Squads/UseCases/EditGuestHandler.cs:75` |
| GU-04 | Guests are selected, balanced, rated and shown in stats like members | **Built** | | `backend/src/PitchMate.Application/Matches/MatchAuthorization.cs`, `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs` |
| GU-05 | Claim link: create (7 days, new cancels old), accept, complete, reverse | **Built** | | `backend/src/PitchMate.Domain/Squads/GuestClaim.cs`, `apps/web/src/features/squads/components/GuestClaims.tsx`, `apps/web/src/features/squads/screens/ClaimLandingScreen.tsx` |
| GU-06 | Claim keeps the guest's rating and stats | **Built** | Same membership row | `backend/src/PitchMate.Domain/Squads/SquadMembership.cs` |
| GU-07 | Claim audit trail | **Partial** | Timestamps on the claim row; no audit log | `backend/src/PitchMate.Infrastructure/Persistence/Configurations/Squads/GuestClaimConfiguration.cs` |
| GU-08 | Delete or erase a guest | **Gap** | The erase-membership use case exists; nothing calls it | `backend/src/PitchMate.Application/Squads/UseCases/EraseMembershipHandler.cs` |

### Optional features

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| OF-01 | Per-squad feature toggle | **Built** | Admin-only | `backend/src/PitchMate.Application/Squads/UseCases/SetFeatureFlagHandler.cs:56`, `apps/web/src/features/squads/components/AdminSection.tsx` |
| OF-02 | Live match tracking (the only optional feature) | **Built** | Off by default | `backend/src/PitchMate.Domain/Squads/SquadFeature.cs` |
| OF-03 | A squad with it off still has a coherent experience | **Built** | Balancing, basic result, always-available stats | `apps/web/src/features/matches/screens/MatchScreen.tsx`, `apps/web/src/features/player-stats/lib/richStats.ts` |

### Matches and availability

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| MA-01 | Create a match draft: location and 1–14 candidate days | **Built** | | `backend/src/PitchMate.Domain/Matches/Match.cs:168`, `apps/web/src/features/matches/screens/CreateMatchScreen.tsx` |
| MA-02 | Members mark and change the days they can make | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/SubmitAvailabilityResponseHandler.cs:119` |
| MA-03 | Admin marks days for guests | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/SetGuestAvailabilityHandler.cs:78` |
| MA-04 | Availability tally per day | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/GetAvailabilityTallyHandler.cs:99` |
| MA-05 | Confirm on any candidate day, no minimum | **Built** | | `backend/src/PitchMate.Domain/Matches/Match.cs:397` |
| MA-06 | Join / leave yourself; admin adds / removes anyone | **Built** | Until the lock | `backend/src/PitchMate.Application/Matches/UseCases/JoinMatchHandler.cs:61`, `backend/src/PitchMate.Application/Matches/UseCases/AddParticipantHandler.cs:105` |
| MA-07 | Match list and match page | **Built** | List capped at 200 | `backend/src/PitchMate.Application/Matches/UseCases/GetMatchListHandler.cs:78`, `apps/web/src/features/matches/components/MatchesSection.tsx` |
| MA-08 | Cancel a match | **Built** | Before play starts | `backend/src/PitchMate.Application/Matches/UseCases/CancelMatchHandler.cs:97` |
| MA-09 | Edit a draft's location or days | **Gap** | | `backend/src/PitchMate.Api/Matches/Endpoints/MatchEndpoints.cs` |
| MA-10 | Start; undo kickoff while nothing is recorded | **Built** | | `backend/src/PitchMate.Domain/Matches/Match.cs:911`, `backend/src/PitchMate.Domain/Matches/Match.cs:935` |

### Team balancing and the team sheet

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| TB-01 | Balance for the fairest contest using predicted win probability | **Built** | Uneven sizes handled | `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs` |
| TB-02 | Tie-break towards less skill concentration | **Built** | Implemented as "the higher draw probability wins a tie" | `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs:198` |
| TB-03 | Proposal shows each side's win % and the draw % | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs`, `apps/web/src/features/matches/components/TeamsEditor.tsx` |
| TB-04 | Move a player, re-roll, live win % as you tweak | **Built** | A move, not a two-player swap | `backend/src/PitchMate.Application/Matches/UseCases/AdjustTeamsHandler.cs:109` |
| TB-05 | Team names and the silly-name generator | **Built** | | `backend/src/PitchMate.Application/Matches/Abstractions/ISillyNameGenerator.cs`, `apps/web/src/features/matches/components/TeamsEditor.tsx` |
| TB-06 | Bibs: choose the bib-wearing team | **Built** | | `backend/src/PitchMate.Domain/Matches/Match.cs:770` |
| TB-07 | Lock (captures the kickoff lineup) and unlock | **Built** | | `backend/src/PitchMate.Domain/Matches/Match.cs:770`, `backend/src/PitchMate.Domain/Matches/Match.cs:854` |
| TB-08 | Team sheet | **Built** | | `apps/web/src/features/matches/components/TeamSheetView.tsx`, `apps/web/src/ui/TeamSheet.tsx` |
| TB-09 | Proposals for 10–16 players in two teams, by brute force | **Partial** | The limits are fixed; fewer than 10 or more than 16 cannot be rolled | `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs:38`, `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs:44` |
| TB-10 | Keep-together / keep-apart constraints | **Gap** | The request carries only players, ratings and team count | `backend/src/PitchMate.Application/Matches/Abstractions/TeamBalanceRequest.cs` |
| TB-11 | More than 16 players (greedy + local swaps heuristic) | **Gap** | | `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs` |
| TB-12 | More than two teams (winner-stays-on) | **Partial** | The rating engine ranks N teams; the balancer, handlers and UI are two-team | `backend/src/PitchMate.Domain/Rating/IRatingEngine.cs`, `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs:44` |
| TB-13 | Balance simulation tool for developers | **Built** | | `backend/tools/BalanceSimulation/simulate.cs` |

### Ratings

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| RA-01 | Squad-scoped μ and σ per membership | **Built** | | `backend/src/PitchMate.Domain/Matches/MembershipRating.cs` |
| RA-02 | PlackettLuce rating engine | **Built** | An in-house implementation, not the OpenSkill package | `backend/src/PitchMate.Infrastructure/Rating/PlackettLuceRatingEngine.cs`, `backend/src/PitchMate.Infrastructure/PitchMate.Infrastructure.csproj` |
| RA-03 | Provisional until σ ≤ 8.19 | **Built** | The state drives the settling note; it no longer hides the number (RA-13) | `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:28` |
| RA-04 | Skill-tier seeding: Beginner / Average / Strong (μ 20 / 25 / 30) | **Built** | | `backend/src/PitchMate.Domain/Rating/SkillTier.cs`, `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs` |
| RA-05 | Ratings move on outcome rank, draws first-class, one update per match | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs` |
| RA-06 | σ decays back up after inactivity | **Partial** | The engine supports decay (42 days free, then 0.05); no scheduled job runs it | `backend/src/PitchMate.Infrastructure/Rating/PlackettLuceRatingEngine.cs:291`, `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs` |
| RA-07 | Margin-of-victory and participation weights as switchable levers | **Partial** | Both exist and are off; even switched on they would do nothing, because the outcome passed to the engine carries no margin or participation | `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:37`, `backend/src/PitchMate.Domain/Matches/Match.cs` |
| RA-08 | Display rating = round((μ − 25) × K + C), floored, with K=40 and C=1000 for every squad | **Built** | Every rated player has a number, settling or not; σ does not change it | `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs` |
| RA-09 | K and C tunable per squad | **Partial** | A per-squad source exists but always returns K=40, C=1000; nothing is stored and there is no UI | `backend/src/PitchMate.Infrastructure/Stats/SquadDisplayRatingParametersSource.cs` |
| RA-10 | Rating snapshots after every match | **Built** | | `backend/src/PitchMate.Domain/Matches/RatingSnapshot.cs` |
| RA-11 | Rating replay | **Partial** | The engine implements it; nothing calls it | `backend/src/PitchMate.Domain/Rating/IRatingEngine.cs` |

### Results and live tracking

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| RE-01 | Basic result: final score | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/RecordResultHandler.cs:104` |
| RE-02 | Rich result from the live tracker | **Built** | | `backend/src/PitchMate.Application/LiveTracking/UseCases/FinaliseTrackedResultHandler.cs:121` |
| RE-03 | Live tracker: goals, own goals, keeper changes | **Built** | Admin-only | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx` |
| RE-04 | Corrections: undo last goal, change scorer, remove a goal or keeper change | **Built** | Wider than `product.md` states | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx:323` |
| RE-05 | Live score for members | **Built** | Polled every 20 seconds | `apps/web/src/features/matches/components/LiveScorePanel.tsx:30` |
| RE-06 | Tracker keeps working through a lost connection | **Partial** | Failed sends are resent only while the page stays open | `apps/web/src/features/matches/state/useEventLog.ts` |
| RE-07 | Correct a result after the match is completed | **Gap** | | `backend/src/PitchMate.Domain/Matches/Match.cs:1188` |

### Stats and leaderboards

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| ST-01 | Appearances, W/L/D, win % | **Built** | | `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs`, `backend/src/PitchMate.Domain/Stats/WinPercentage.cs` |
| ST-02 | Current rating, with a settling note while it settles | **Built** | The number looks the same either way; the settling mark sits beside the name | `apps/web/src/features/player-stats/components/RatingPanel.tsx`, `apps/web/src/features/player-stats/components/PlayerIdentityHeader.tsx` |
| ST-03 | Rating progression chart, every reading a number | **Built** | Settling readings are hollow marks on a dashed line, and the table beside it says "Settling" by their dates | `apps/web/src/features/player-stats/components/ProgressionChart.tsx`, `apps/web/src/ui/Stats.tsx` |
| ST-04 | Longest win streak and unbeaten streak | **Built** | Longest ever, not current | `backend/src/PitchMate.Domain/Stats/StreakCalculator.cs` |
| ST-05 | Most played with / against, best partnerships, bogey opponents | **Built** | No minimum number of shared matches | `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs` |
| ST-06 | Bib appearances | **Built** | | `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs` |
| ST-07 | Goals, clean sheets, goals conceded as keeper, keeper time (rich only) | **Built** | | `backend/src/PitchMate.Application/Stats/RichStats.cs`, `apps/web/src/features/player-stats/components/RichStatsPanel.tsx` |
| ST-08 | Top scorer | **Partial** | A query exists; nothing calls it | `backend/src/PitchMate.Application/Stats/IRichStatsSource.cs` |
| ST-09 | Leaderboards: appearances, win %, rating, win streak, unbeaten streak, bibs | **Built** | No rich-stat leaderboards | `backend/src/PitchMate.Application/Stats/LeaderboardStatistic.cs`, `apps/web/src/features/player-stats/screens/SquadLeaderboards.tsx` |
| ST-10 | Cross-squad vanity aggregate | **Gap** | | `backend/src/PitchMate.Application/Stats` |

### Notifications

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| NO-01 | In-app notifications: list, unread count, mark read | **Built** | Count polled every 60 seconds | `backend/src/PitchMate.Api/Notifications/Endpoints/NotificationEndpoints.cs:39`, `apps/web/src/features/app-shell/components/NotificationPanel.tsx` |
| NO-02 | Events: match drafted, match confirmed, teams rolled, result posted, member joined, promoted to admin, removed, ownership transferred | **Built** | "Teams rolled" fires on lock | `backend/src/PitchMate.Domain/Notifications/NotificationType.cs`, `backend/src/PitchMate.Application/Notifications/NotificationCatalogue.cs` |
| NO-03 | Email for every notification | **Partial** | Sent best-effort through the email port, but the cloud runs the Console transport, so no email leaves the system | `backend/src/PitchMate.Application/Notifications/PublishNotificationHandler.cs`, `backend/src/PitchMate.Infrastructure/Auth/Email/ConsoleEmailSender.cs`, `infra/README.md:55` |
| NO-04 | Notification preferences or unsubscribe | **Gap** | | `backend/src/PitchMate.Application/Notifications` |
| NO-05 | Push notifications | **Gap** | Arrives with the mobile app | `backend/src/PitchMate.Domain/Notifications/DeliveryChannel.cs` |

### Web surfaces

| Id | Feature | Status | Notes | Source |
|---|---|---|---|---|
| WE-01 | Marketing landing page | **Built** | | `apps/web/src/features/landing/LandingPage.tsx` |
| WE-02 | App shell: top bar, notification bell, account menu, skip link | **Built** | | `apps/web/src/features/app-shell/shellRoutes.tsx` |
| WE-03 | Settings | **Partial** | Appearance only | `apps/web/src/features/app-shell/SettingsDestination.tsx` |
| WE-04 | Profile | **Gap** | "Not ready yet" placeholder | `apps/web/src/features/app-shell/shellRoutes.tsx:316` |
| WE-05 | Privacy policy and terms pages | **Gap** | Linked, no route | `apps/web/src/features/auth/SignUpScreen.tsx:75` |

### Summary

Of the 103 rows above: **68 Built**, **21 Partial**, **14 Gap**. The Partial and Gap rows are the raw material for [the index's gap list](index.md).

## To be

What is wanted, from [decisions](decisions.md). Nothing in this section is built unless the line says so; the catalogue above is the as-is truth and its rows keep their status until the code changes. A row here that reuses an id (AC-04, TB-09 …) is the requirement that closes that catalogue row; a new id is a new feature.

**Launch** marks what must be done before the public launch ([Q1](decisions.md#q1)), which waits for the native apps ([R3](decisions.md#r3)). Rows without it are wanted but not launch-blocking, or wait on an open question.

### Accounts and sign-in

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| AC-02 | **A verified email is required to sign in.** The switch exists and is off (`backend/src/PitchMate.Application/Auth/UseCases/SignInProtectionOptions.cs`) | **Gap** | Yes | [Q9](decisions.md#q9) |
| AC-04 | **Google sign-in works on the web**: a real client id per environment and the button wired to it | **Gap** | Yes | [A1](decisions.md#a1) |
| AC-05 | **Sign in with Apple**, for the iOS app | **Gap** | Yes | [A1](decisions.md#a1), [R3](decisions.md#r3) |
| AC-09 | **Link and unlink Google and Apple sign-in** from the account screen. The API exists for Google and a password (`backend/src/PitchMate.Api/Auth/Endpoints/AuthEndpoints.cs:163`); the screen and Apple do not | **Gap** | Yes | [R12](decisions.md#r12) |
| AC-10 | **Account screen: view and edit name and avatar.** One screen in place of the profile placeholder, with the features similar apps offer, in line with GDPR | **Gap** | Yes | [Q17](decisions.md#q17), [R12](decisions.md#r12) |
| AC-11 | **Delete my account** from the account screen, reaching squad memberships (TR-06) | **Gap** | Yes | [Q17](decisions.md#q17), [Q7](decisions.md#q7) |
| AC-12 | **Export my data** from the account screen: one JSON file with the account, memberships, matches, rating history and stats | **Gap** | Yes | [Q8](decisions.md#q8), [Q17](decisions.md#q17) |
| AC-13 | **Lockout on: 5 failed attempts, then 15 minutes**, counted somewhere every API replica shares. The code defaults to 10 attempts, off, in one server's memory | **Gap** | Yes | [Q9](decisions.md#q9) |
| AC-14 | **Change my password while signed in**, from the account screen. No endpoint does this today (adding a first password and resetting by email exist) | **Gap** | Yes | [Q17](decisions.md#q17) |
| AC-15 | **Change my email.** The new address is verified before it takes effect, and the old address is told about the change | **Gap** | Yes | [R12](decisions.md#r12) |
| AC-16 | **Signed-in devices** on the account screen: a list of the places the account is signed in, each of which can be signed out (SE-28 in [07](07-trust.md#to-be)) | **Gap** | Yes | [T15](decisions.md#t15) |

### Squads, guests and optional features

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| SQ-07 | **Sign-up → auto-join survives email verification**, a reload and a new tab | **Gap** | Yes | [Q9](decisions.md#q9) |
| SQ-08 | **Demotion is owner-only** (RO-01 in [02](02-roles.md#to-be)) | **Gap** | | [Q15](decisions.md#q15) |
| SQ-09 | **Removing an admin is owner-only**; admins still remove members and guests (RO-08) | **Gap** | | [R9](decisions.md#r9) |
| SQ-14 | **The API enforces the typed-name confirmation** before a squad is deleted; today only the web does (SE-20) | **Gap** | Yes | [T17](decisions.md#t17) |
| SQ-15 | **The squad export is a small CSV of players, matches and stats**, offered before deletion. Today it is JSON of memberships, invites and features | **Gap** | | [R14](decisions.md#r14) |
| SQ-17 | **Deleted squads are purged** when the grace period ends, by the scheduled job (PL-01) | **Gap** | Yes | [Q7](decisions.md#q7) |
| SQ-18 | **A squad in its grace period refuses match-changing actions too.** `product.md` already says so; no decision was needed | **Gap** | Yes | |
| GU-02 | **The lawful-basis acknowledgement is asked once per admin** and remembered, not on every guest | **Gap** | | [Q14](decisions.md#q14) |
| GU-08 | **An admin can erase a guest**: anonymised if they have match history, deleted if not (TR-07, TR-08) | **Gap** | Yes | [Q7](decisions.md#q7) |
| OF-04 | **Pro, held per squad**, at about £1–2 a month. A Pro feature has two switches: whether the squad is *entitled* to it (by plan) and whether the admin has turned it on, and the API enforces both. Pro unlocks balanced rolls every time (TB-13, TB-14) and the match-day options (MA-11). Ratings are tracked in every squad whatever its plan, and live match tracking is free. Score confirmation and team naming are free too. Until Pro is on sale every squad is entitled to everything, unlimited balanced rolls included | **Gap** | | [Q2](decisions.md#q2), [R5](decisions.md#r5), [T2](decisions.md#t2), [U2](decisions.md#u2), [U3](decisions.md#u3) |
| OF-05 | **Paying for Pro**: a subscription bought through the app stores, which take about 15%. Any member can pay for the squad. It cannot be bought on the web, but a Pro squad is Pro on every client. When it lapses the Pro features switch off and no data is lost: saved rules and settings are kept and stop applying. Selling starts after the launch (PL-16, SE-27) | **Gap** | | [R5](decisions.md#r5), [T3](decisions.md#t3) |
| OF-02 | **Live match tracking is free**, an optional feature the admin turns on, as today (`backend/src/PitchMate.Domain/Squads/SquadFeature.cs`) | **Built** | | [T2](decisions.md#t2) |

### Matches, balancing and ratings

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| TB-09 | **3 to 11 players a side, the two sides at most 2 apart**: 6 to 22 players. 4v4 to 11v11 is what a squad plans; 3 a side and uneven sides cover real no-shows, with the ratings handling uneven sides as well as they can. The 10–16 roll limit and the 5–8-a-side lock limit (`backend/src/PitchMate.Domain/Matches/Match.cs:40`) are replaced; two teams remain | **Gap** | | [Q12](decisions.md#q12), [R7](decisions.md#r7), [T7](decisions.md#t7) |
| TB-13 | **A free squad's roll is a random split**, after which the admin moves players between teams as today (TB-04). The random split does not use the ratings and shows no predicted win %. It applies once Pro is on sale | **Gap** | | [T1](decisions.md#t1), [U3](decisions.md#u3), [U4](decisions.md#u4) |
| TB-14 | **Balanced rolls are Pro, with one free balanced match a month** as a taster (squads play about four matches a month). The free roll covers one match, so re-rolls within that match are free, and that match shows the win % as a Pro squad's does. A calendar month is assumed. The API counts it, not the client | **Gap** | | [T1](decisions.md#t1), [U4](decisions.md#u4) |
| TB-10 | **Keep-together and keep-apart rules**: standing rules saved per squad, always obeyed by the balancer on a balanced roll (they do not act on a free squad's random split), visible to admins only. A set of rules that cannot all be met is reported to the admin, not quietly broken | **Gap** | | [Q13](decisions.md#q13), [R8](decisions.md#r8) |
| TB-11 | **The faster search above 16 players** (greedy start, then local swaps), because every split can no longer be tried. Required by TB-09, which goes up to 22 | **Gap** | | [Q12](decisions.md#q12), [R7](decisions.md#r7) |
| TB-12 | More than two teams stays an Idea | **Idea** | | [Q12](decisions.md#q12) |
| RA-06 | **σ decay runs nightly**, in the scheduled job (PL-01), and **starts after 8 weeks without a match**. Matches are weekly at best, so ratings must not decay quickly; decay raises σ only and never lowers μ. The code's free period is 42 days (`backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:31`) | **Gap** | | [R15](decisions.md#r15) |
| RA-12 | **Ratings are tracked in every squad**, Pro or not. This is how the code behaves today: completion always updates ratings (`backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`). The requirement is that gating never changes it | **Built** | | [R5](decisions.md#r5) |
| MA-11 | **Match-day options**, a Pro feature. Two: availability on or off, and payment tracking (who has paid). With both at their default a squad gets today's flow. Score confirmation (RE-08) and team naming (TB-05) are not Pro | **Gap** | | [R5](decisions.md#r5), [T4](decisions.md#t4), [U2](decisions.md#u2) |
| RA-13 | **A rating number from the first match, with a settling note.** Display rating = round((μ − 25) × 40 + 1000), floored: μ on a friendlier scale, so a new Beginner, Average or Strong player starts on 800, 1000 or 1200 and moves with results. σ no longer changes the number; while it is above the provisional threshold (8.19, `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:28`) the rating carries a visible "settling" mark and a line saying ratings take a few matches to settle. Leaderboards rank everyone and show the mark. Balancing is untouched: it uses μ and σ through `Predict`. This replaced the (μ − 3σ) formula and the hidden number (`backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs`, `backend/src/PitchMate.Infrastructure/Stats/EfStatsRepository.cs`, `apps/web/src/features/squads/components/PlayerRow.tsx`). The note reads "Settling", with no count of matches played. On the launch gate because changing it later changes every number people have seen | **Built** | Yes | [T8](decisions.md#t8), [U1](decisions.md#u1), [U6](decisions.md#u6) |
| RA-09 | **K and C are fixed at 40 and 1000**; no per-squad setting is built. The code already returns these for every squad (`backend/src/PitchMate.Infrastructure/Stats/SquadDisplayRatingParametersSource.cs`) | **Built** | | [T17](decisions.md#t17) |
| RA-07 | **The margin and participation levers stay off**, and no work is done to feed them (`backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:37`) | **Built** | | [Q13](decisions.md#q13) |
| NO-06 | **A "match cancelled" notification** to the squad's members | **Gap** | | [Q16](decisions.md#q16) |
| NO-07 | **"Teams rolled" becomes "Teams locked"**, sent at the lock with the team sheet. Nothing is sent at the roll. It already fires at the lock (`backend/src/PitchMate.Application/Matches/UseCases/LockTeamsHandler.cs`); the name and content change | **Gap** | | [R2](decisions.md#r2) |

### Results and live tracking

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| RE-08 | **Score confirmation**, a squad setting, free in every squad. When on, any registered player in the match, or an admin, enters a basic score, and a user on the other team confirms it before the result is final. If the person who entered it played on neither side, anyone in the match confirms. Ratings update on confirmation. Left unconfirmed for 48 hours, it is confirmed by the nightly job (PL-01). A dispute goes to an admin to decide. When nobody on the other side can confirm (a guest-only side, for example), the admin's confirmation stands. A live-tracked result needs no confirmation | **Gap** | | [Q11](decisions.md#q11), [R6](decisions.md#r6), [T5](decisions.md#t5), [U2](decisions.md#u2) |
| RE-09 | **A tracker per match.** The admin picks a registered member who can start the match, undo kickoff, run the live tracker and record a basic score. One tracker at a time (RO-07 in [02](02-roles.md#to-be)) | **Gap** | | [R1](decisions.md#r1), [T6](decisions.md#t6) |
| RE-10 | **Keeper tracking is removed, data included**: keeper stints, clean sheets, goals conceded as keeper and keeper time. What the removal touches is listed under [Removing keeper data](#removing-keeper-data). On the launch gate because the apps and the watch tracker are built without it and the data is cheapest to drop before anything public exists | **Gap** | Yes | [R13](decisions.md#r13), [T9](decisions.md#t9), [U6](decisions.md#u6) |
| RE-06 | **Offline tracking**, delivered in the phone app and the Apple Watch app (DV-03, DV-04 in [04](04-devices.md#to-be)). The web tracker does not get it: it needs a connection, as today | **Gap** | Yes | [Q5](decisions.md#q5), [R3](decisions.md#r3), [T10](decisions.md#t10), [U5](decisions.md#u5) |
| RE-05 | **Live score stays polled** every 20 seconds (`apps/web/src/features/matches/components/LiveScorePanel.tsx:30`) | **Built** | | [Q6](decisions.md#q6) |

### Stats, notifications and web surfaces

| Id | Requirement | Status | Launch | Decision |
|---|---|---|---|---|
| ST-08 | **Top scorer leaderboard**, using the query that already exists (`backend/src/PitchMate.Application/Stats/IRichStatsSource.cs`) | **Gap** | | [Q18](decisions.md#q18) |
| ST-11 | **Every available stat is shown, presented usefully**, and nothing computed is hidden. The keeper-only stats no longer exist (RE-10) | **Gap** | | [Q18](decisions.md#q18), [R13](decisions.md#r13), [T9](decisions.md#t9) |
| ST-12 | **The progression chart plots every point as a number**, with settling points marked, in place of the "~" band; the rating panel and leaderboards show the number with the settling mark (RA-13) (`apps/web/src/features/player-stats/components/ProgressionChart.tsx`, `apps/web/src/features/player-stats/components/ProgressionTable.tsx`, `apps/web/src/features/player-stats/screens/SquadLeaderboards.tsx`) | **Built** | Yes | [T8](decisions.md#t8) |
| NO-04 | **Notification preferences** on the account screen, for in-app, email and push | **Gap** | Yes | [T15](decisions.md#t15) |
| NO-03 | **Email is really sent**, through Azure Communication Services, in QA and production (PL-07 in [06](06-platform.md#to-be)) | **Gap** | Yes | [Q9](decisions.md#q9) |
| NO-05 | **Push notifications**, with the native apps (DV-05) | **Gap** | Yes | [Q4](decisions.md#q4), [R3](decisions.md#r3) |
| WE-04 | **One account screen** replacing the profile placeholder: name, email, avatar, password, linked sign-in methods, notification preferences, signed-in devices, export, delete. On the web and in the apps | **Gap** | Yes | [Q17](decisions.md#q17), [R12](decisions.md#r12), [T15](decisions.md#t15) |
| WE-05 | **Privacy policy and terms pages** at `/privacy` and `/terms`, drafted by Claude and reviewed by a solicitor before launch | **Gap** | Yes | [Q8](decisions.md#q8) |

<a id="removing-keeper-data"></a>
### Removing keeper data

What RE-10 takes out ([T9](decisions.md#t9)). None of it is done.

| What | Where | Note |
|---|---|---|
| Keeper stint events and the stint type | `backend/src/PitchMate.Domain/LiveTracking/KeeperStintStartedEvent.cs`, `backend/src/PitchMate.Domain/LiveTracking/KeeperStintRetractedEvent.cs`, `backend/src/PitchMate.Domain/LiveTracking/KeeperStint.cs`, `backend/src/PitchMate.Domain/LiveTracking/EventKind.cs` | The conceding keeper on a goal goes too |
| Keeper statistics | `backend/src/PitchMate.Domain/LiveTracking/MatchRichStatistics.cs`, `backend/src/PitchMate.Application/Stats/RichStats.cs`, `backend/src/PitchMate.Infrastructure/LiveTracking/EventLogRichStatsSource.cs` | Clean sheets, goals conceded as keeper, keeper time. Goals stay |
| Stored data | `backend/src/PitchMate.Infrastructure/Persistence/Configurations/LiveTracking/MatchEventConfiguration.cs` | A migration deletes the stored keeper events and drops the keeper columns. It cannot be reversed. Only QA holds data today |
| The API contract | `backend/src/PitchMate.Api/LiveTracking/Endpoints/EventSubmissionRequest.cs`, `backend/src/PitchMate.Api/LiveTracking/Endpoints/MatchEventResponse.cs` | The OpenAPI document and the generated client change. A keeper event from an old client is refused cleanly |
| The web | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx`, `apps/web/src/features/player-stats/components/RichStatsPanel.tsx` | The keeper control and the keeper stat lines |

Two rules are affected. The event log is append-only and "nothing is discarded": deleting keeper events is a one-off exception and should be recorded as one. Undo kickoff is refused once anything is recorded; after the removal, "anything" no longer includes a keeper change.

### Decided against

- **RE-07 · Correcting a result after completion.** A confirmed result is final ([Q11](decisions.md#q11)).
- **RA-11 · Rating replay** has no job without RE-07. The engine method can stay; nothing will call it.
- **RA-07 · Wiring margin or participation data into the outcome** ([Q13](decisions.md#q13)).
- **ST-07 · The keeper-only stats** (clean sheets, goals conceded as keeper, keeper time), removed with their data ([R13](decisions.md#r13), [T9](decisions.md#t9)). Goals stay.
- **RA-09 · K and C per squad.** They stay fixed ([T17](decisions.md#t17)).
- **RA-03, RA-08 · A badge or "~" band in place of a number**, and the (μ − 3σ) display formula, replaced by RA-13 ([T8](decisions.md#t8)). Both are gone from the code.
- **Reporting a squad** ([R10](decisions.md#r10)).

### Not decided

Catalogue rows the decisions did not touch stay as they are: SQ-12 (renaming), GU-07 (claim audit), MA-09 (editing a draft), ST-10 (cross-squad aggregate), WE-03 (settings).

## Rules

- **Built** · One match = one kickoff lineup = one outcome = one rating update. `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`
- **Built** · Balancing never alters ratings, and never sums or averages them. `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs`
- **Built** · Ratings belong to the membership, so a claim, a leave and a re-join all keep them. `backend/src/PitchMate.Domain/Matches/MembershipRating.cs`
- **Built** · The display rating is presentational; balancing always uses μ and σ through the engine's prediction. `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs`
- **Built** · A feature that is optional is behind a per-squad flag, and its absence yields an explained empty state, not an error. `apps/web/src/features/player-stats/lib/richStats.ts`

## Open questions

None waiting on the user. Round four confirmed the rating formula ([U1](decisions.md#u1)), what Pro is ([U2](decisions.md#u2)), what is free before it is sold ([U3](decisions.md#u3)), the free roll ([U4](decisions.md#u4)) and the "OpenSkill" wording ([U7](decisions.md#u7)). Left for the feature specs:

1. **How long does the settling note last?** `product.md` says "at most 5 matches (3 at 5v5, 4–5 at 8v8)". That was worked out for 5-a-side to 8-a-side and needs re-checking for 3-a-side and 11-a-side with `/balance-simulation`. A check to run, not a question.
2. **Is the cross-squad vanity aggregate (ST-10) wanted for launch?** `product.md` describes it; nothing computes it. It is not on the launch gate.
3. **Guest acknowledgement (GU-02).** Once per admin across all their squads, or once per admin per squad? Per squad is the safer reading, since the lawful basis is about that squad's guests.
4. **A lapse mid-match (OF-05).** A match already rolled or awaiting confirmation is assumed to finish under the rules it started with.

## Ideas

- **Idea** · Current form (last five) and current streak alongside the longest streaks.
- **Idea** · A minimum number of shared matches before a partnership or bogey opponent is shown.
- **Idea** · "Captain's pick" balancing: two captains draft, with the fairness meter updating live.
- **Idea** · Match fees and who has paid.
- **Idea** · A pitch booking note or map link on the match.
- **Idea** · Squad-level awards at the end of a season (top scorer, most bibs, best partnership).
- **Idea** · Head-to-head page between any two players.
- **Idea** · Avatars or squad crests uploaded by members.
- **Idea** · A **pitch-booking marketplace** with a small cut per booking; see [01](01-vision.md#ideas). Absorbs the "pitch booking note or map link" idea above as its first step.
- **Idea** · "Who has paid" as one option of the match-day customisation (MA-11, now intended). Absorbs the "match fees" idea above.
- **Idea** · **Squad chat**, so the squad no longer needs a WhatsApp or Messenger group beside the app. The app stores require report and block for messages and users, so those come with it ([R10](decisions.md#r10)).
- **Idea** · **Mini games** between squad members, for example a Premier League results predictor with its own squad table.
