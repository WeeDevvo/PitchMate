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
| RA-03 | Provisional until σ ≤ 8.19 | **Built** | | `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:28` |
| RA-04 | Skill-tier seeding: Beginner / Average / Strong (μ 20 / 25 / 30) | **Built** | | `backend/src/PitchMate.Domain/Rating/SkillTier.cs`, `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs` |
| RA-05 | Ratings move on outcome rank, draws first-class, one update per match | **Built** | | `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs` |
| RA-06 | σ decays back up after inactivity | **Partial** | The engine supports decay (42 days free, then 0.05); no scheduled job runs it | `backend/src/PitchMate.Infrastructure/Rating/PlackettLuceRatingEngine.cs:291`, `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs` |
| RA-07 | Margin-of-victory and participation weights as switchable levers | **Partial** | Both exist and are off; even switched on they would do nothing, because the outcome passed to the engine carries no margin or participation | `backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:37`, `backend/src/PitchMate.Domain/Matches/Match.cs` |
| RA-08 | Display rating = round((μ − 3σ) × K + C), floored | **Built** | | `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs` |
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
| ST-02 | Current rating and provisional state | **Built** | | `apps/web/src/features/player-stats/components/RatingPanel.tsx` |
| ST-03 | Rating progression chart with the "~" band | **Built** | | `apps/web/src/features/player-stats/components/ProgressionChart.tsx`, `apps/web/src/ui/Stats.tsx` |
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

## Rules

- **Built** · One match = one kickoff lineup = one outcome = one rating update. `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`
- **Built** · Balancing never alters ratings, and never sums or averages them. `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs`
- **Built** · Ratings belong to the membership, so a claim, a leave and a re-join all keep them. `backend/src/PitchMate.Domain/Matches/MembershipRating.cs`
- **Built** · The display rating is presentational; balancing always uses μ and σ through the engine's prediction. `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs`
- **Built** · A feature that is optional is behind a per-squad flag, and its absence yields an explained empty state, not an error. `apps/web/src/features/player-stats/lib/richStats.ts`

## Open questions

1. **"OpenSkill" names an algorithm here, not a dependency.** `product.md` and `CLAUDE.md` say OpenSkill; the engine is an in-house PlackettLuce implementation (RA-02). Fine as is, or should the docs say so?
2. **Lawful-basis acknowledgement: once per admin, or every guest?** `product.md` says one-time; the code asks every time (GU-02), which is the safer reading.
3. **Should the API enforce the typed-name confirmation** (SQ-14), or is a client-side gate enough?
4. **What belongs in a squad export?** Today it has no matches, results or ratings (SQ-15), which is most of what an owner would want to keep.
5. **Is 10 the right minimum to roll teams?** A 4v4 (8 players) cannot be rolled or locked, since a side needs 5 (TB-09).
6. **Are the dead rating levers wanted?** Margin of victory and participation need the match outcome to carry more data before the switches mean anything (RA-07).
7. **Does replay have a job to do** (RA-11)? It only matters if results can be corrected after completion (RE-07).
8. **Which rich stats deserve leaderboards** (ST-08, ST-09)?

## Ideas

- **Idea** · Current form (last five) and current streak alongside the longest streaks.
- **Idea** · A minimum number of shared matches before a partnership or bogey opponent is shown.
- **Idea** · "Captain's pick" balancing: two captains draft, with the fairness meter updating live.
- **Idea** · Match fees and who has paid.
- **Idea** · A pitch booking note or map link on the match.
- **Idea** · Squad-level awards at the end of a season (top scorer, most bibs, best partnership).
- **Idea** · Head-to-head page between any two players.
- **Idea** · Avatars or squad crests uploaded by members.
