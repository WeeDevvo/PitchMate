# 03 · Journeys

## Purpose

How a person moves through PitchMate, end to end, as the web app and API behave today: signing up and joining a squad, taking a match from draft to result, tracking a match live, and looking at stats. Read this before designing a screen or a flow, so the new piece joins an existing path rather than inventing one.

Web paths below are routes in `apps/web/src/app/appRouter.tsx`; everything under `/app` sits behind the sign-in guard (`apps/web/src/features/app-shell/RouteGuard.tsx`).

## Today (as-is)

### Journey 1 · Sign up and join a squad

```mermaid
flowchart TD
  link[Opens invite link /join/:code] --> signed{Signed in?}
  signed -- yes --> redeem[Invite redeemed automatically]
  signed -- no --> preview[Generic preview: no squad name shown]
  preview --> signup[/signup: email + password/]
  preview --> login[/login/]
  signup --> msg[Account created message, no session yet]
  msg --> login
  login --> back[Returns to /join/:code via ?redirect=]
  back --> redeem
  redeem --> name{Display name free in this squad?}
  name -- no --> choose[Choose another display name] --> redeem
  name -- yes --> squad[Squad screen as a Member]
  land[Landing page /] --> signup
  login --> home[/app: squads home/]
  home --> create[Create a squad: becomes Owner]
  home --> code[Paste an invite link or code] --> redeem
```

| Step | Status | Detail | Source |
|---|---|---|---|
| Landing page with sign-up and log-in calls to action | **Built** | Hero, benefits, how it works, stats showcase, footer | `apps/web/src/features/landing/LandingPage.tsx`, `apps/web/src/features/landing/content/landingContent.ts` |
| Register with email and password | **Built** | 12–128 character password; a verification email is started; no session is created by sign-up itself | `apps/web/src/features/auth/SignUpScreen.tsx`, `backend/src/PitchMate.Application/Auth/UseCases/RegisterWithPasswordHandler.cs`, `backend/src/PitchMate.Domain/Auth/PasswordPolicy.cs` |
| Verify email | **Built** | Link redeemed at `/verify-email`; resend when signed in. Verification is **not required** to sign in by default | `apps/web/src/features/auth/VerifyEmailScreen.tsx`, `backend/src/PitchMate.Application/Auth/UseCases/SignInProtectionOptions.cs` |
| Log in with password | **Built** | Returns a 15-minute access token and a rotating refresh token; the web refreshes just in time | `apps/web/src/features/auth/LogInScreen.tsx`, `apps/web/src/features/auth/session/SessionManager.ts` |
| Log in with Google | **Partial** | The API verifies Google ID tokens, but the web button is wired to a stub that returns nothing, and the client id is a placeholder in both environments | `backend/src/PitchMate.Infrastructure/Auth/GoogleProviderVerifier.cs`, `apps/web/src/app/appRouter.tsx:225`, `apps/web/src/features/auth/components/GoogleSignInControl.tsx` |
| Forgot and reset password | **Built** | Request always answers the same way; the emailed code is redeemed at `/reset-password/confirm` and signs out every session | `apps/web/src/features/auth/ResetRequestScreen.tsx`, `apps/web/src/features/auth/ResetConfirmScreen.tsx`, `backend/src/PitchMate.Application/Auth/PasswordReset/RedeemPasswordResetHandler.cs` |
| Invite link shows nothing about the squad before joining | **Built** | The anonymous preview is a static message; the landing heading names no squad | `backend/src/PitchMate.Api/Squads/Endpoints/SquadEndpoints.cs:391`, `apps/web/src/features/squads/screens/InviteLandingScreen.tsx` |
| Sign-up → auto-join | **Partial** | The return target (`?redirect=`) is held in memory, so it survives sign-up → log-in in the same tab but is lost on a reload or when the verification email is opened in a new tab; the person then has to open the invite link again | `apps/web/src/features/auth/session/redirectTargetStore.ts`, `apps/web/src/features/auth/session/authNavigation.ts` |
| Redeem the invite | **Built** | Creates the membership, or reactivates the old one; a display-name clash asks for another name | `backend/src/PitchMate.Application/Squads/UseCases/RedeemInviteHandler.cs`, `apps/web/src/features/squads/screens/InviteLandingScreen.tsx` |
| Create a squad from the squads home | **Built** | Squad name plus your display name; the creator is the owner | `apps/web/src/features/squads/screens/SquadsHome.tsx`, `backend/src/PitchMate.Application/Squads/UseCases/CreateSquadHandler.cs` |
| Claim a guest profile via `/claim/:code` | **Built** | Sign in, see the guest and squad name, accept; an admin then completes it | `apps/web/src/features/squads/screens/ClaimLandingScreen.tsx`, `backend/src/PitchMate.Application/Squads/UseCases/AcceptGuestClaimHandler.cs` |
| Privacy policy and terms linked from sign-up and the footer | **Gap** | The links point at `/privacy` and `/terms`, which have no route and fall to the not-found page | `apps/web/src/features/auth/SignUpScreen.tsx:75`, `apps/web/src/features/landing/content/landingContent.ts:283` |

### Journey 2 · The match lifecycle

```mermaid
stateDiagram-v2
  [*] --> GatheringAvailability: admin creates match draft
  GatheringAvailability --> Confirmed: admin confirms a candidate day
  Confirmed --> TeamsRolled: admin locks teams (captures kickoff lineup)
  TeamsRolled --> Confirmed: admin unlocks (lineup discarded, teams kept)
  TeamsRolled --> InProgress: admin starts (kickoff instant stamped)
  InProgress --> TeamsRolled: admin undoes kickoff (only if nothing recorded)
  InProgress --> Completed: result recorded, then complete (ratings update)
  GatheringAvailability --> Cancelled
  Confirmed --> Cancelled
  TeamsRolled --> Cancelled
  Completed --> [*]
  Cancelled --> [*]
```

Rolling, re-rolling, moving players, naming teams and choosing bibs all happen **inside `Confirmed`**; the state only becomes `TeamsRolled` at the lock.

| Step | Status | Detail | Source |
|---|---|---|---|
| 1. Create a match draft | **Built** | Location (1–200 characters) and 1–14 distinct future candidate days; the web allows up to two kick-off times per day. Members are notified | `backend/src/PitchMate.Domain/Matches/Match.cs:168`, `apps/web/src/features/matches/screens/CreateMatchScreen.tsx`, `apps/web/src/features/matches/lib/candidateSlots.ts` |
| 2. Members mark the days they can make | **Built** | Changeable until confirmation; guests excluded from self-service | `backend/src/PitchMate.Application/Matches/UseCases/SubmitAvailabilityResponseHandler.cs:119`, `apps/web/src/features/matches/screens/MatchScreen.tsx` |
| 2. An admin marks days for each guest | **Built** | Organiser-only, target must be an active guest | `backend/src/PitchMate.Application/Matches/UseCases/SetGuestAvailabilityHandler.cs:78` |
| 3. Confirm on any candidate day, seeing the tally | **Built** | No minimum number of players; everyone marked for that day, guests included, becomes a player | `backend/src/PitchMate.Domain/Matches/Match.cs:397`, `backend/src/PitchMate.Api/Matches/Endpoints/MatchEndpoints.cs:289` |
| 4. Members join or leave; an admin adds or removes anyone | **Built** | Allowed only in `Confirmed`, i.e. until teams are locked | `backend/src/PitchMate.Application/Matches/UseCases/JoinMatchHandler.cs:61`, `backend/src/PitchMate.Domain/Matches/Match.cs:466` |
| 4. Roll teams | **Built** | Needs 10–16 players, always two teams; the proposal carries each side's win % and the draw % | `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs:38`, `apps/web/src/features/matches/components/TeamsEditor.tsx` |
| 4. Tweak: move a player, re-roll, set team names or roll a silly name, choose the bib team | **Built** | The first roll gives generated names and bibs to the first team | `backend/src/PitchMate.Application/Matches/UseCases/AdjustTeamsHandler.cs:109`, `apps/web/src/features/matches/components/TeamsEditor.tsx` |
| 4. Lock | **Built** | Requires at least two teams, 5–8 players a side, everyone on a team, exactly one bib team, distinct team names. Captures the kickoff lineup and notifies members | `backend/src/PitchMate.Domain/Matches/Match.cs:770`, `backend/src/PitchMate.Application/Matches/UseCases/LockTeamsHandler.cs:119` |
| 4. Unlock before kickoff | **Built** | Back to `Confirmed` with teams, names and bibs kept and the lineup discarded | `backend/src/PitchMate.Domain/Matches/Match.cs:854` |
| Team sheet | **Built** | Time, location, both teams with names and players, bib flag; shown once teams are locked | `backend/src/PitchMate.Application/Matches/UseCases/GetTeamSheetHandler.cs:81`, `apps/web/src/features/matches/components/TeamSheetView.tsx` |
| 5. Start the match | **Built** | Stamps the kickoff instant | `backend/src/PitchMate.Domain/Matches/Match.cs:911` |
| 5. Undo kickoff | **Built** | Refused once a result or any live event exists; clears the kickoff instant | `backend/src/PitchMate.Domain/Matches/Match.cs:935`, `apps/web/src/features/matches/components/MatchActionsPanel.tsx` |
| 5. Record a basic result, then complete | **Built** | Scores 0–99 per team; the web offers this only when live tracking is off. A result can be overwritten until completion | `backend/src/PitchMate.Domain/Matches/Match.cs:991`, `apps/web/src/features/matches/screens/MatchScreen.tsx` |
| 5. Completing updates ratings once | **Built** | One rating update from the kickoff lineup, one snapshot per player, atomic and idempotent; members are notified | `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs:171` |
| Cancel | **Built** | From `GatheringAvailability`, `Confirmed` or `TeamsRolled`; no notification is sent | `backend/src/PitchMate.Domain/Matches/Match.cs:1225`, `backend/src/PitchMate.Application/Matches/UseCases/CancelMatchHandler.cs:97` |
| Correct a result after completion | **Gap** | A completed match is immutable and there is no correction use case | `backend/src/PitchMate.Domain/Matches/Match.cs:1188` |
| Edit a draft (location, days) after creating it | **Gap** | No use case; the only way is cancel and recreate | `backend/src/PitchMate.Api/Matches/Endpoints/MatchEndpoints.cs` |

### Journey 3 · Live tracking

Only in a squad with **live match tracking** switched on, and only an admin records.

```mermaid
flowchart TD
  start[Match InProgress] --> tracker[Admin opens /matches/:id/live]
  tracker --> load[Tracker loads the event log and running score]
  load --> goal[GOAL] --> team[Pick team] --> scorer[Pick scorer, skip, or own goal]
  scorer --> send[Event sent with a client id]
  send --> ok{Accepted?}
  ok -- yes --> synced[Synced: score updates]
  ok -- transport failure --> unsynced[Unsynced: kept in the page, Send again]
  unsynced --> send
  synced --> more{More play?}
  more -- keeper change --> keeper[Keeper dialog] --> send
  more -- mistake --> fix[Undo last goal, change scorer, remove goal or keeper change] --> send
  more -- full time --> finish[End match] --> done[Tracked score becomes the result; match Completed; ratings update]
  members[Members on the match page] -. poll every 20s .-> synced
```

| Step | Status | Detail | Source |
|---|---|---|---|
| Record a goal: GOAL → team → scorer, with skip and own goal | **Built** | The scorer must be in the lineup and on the scoring team unless it is an own goal | `apps/web/src/features/matches/components/GoalPicker.tsx`, `backend/src/PitchMate.Domain/LiveTracking/MatchEventValidation.cs` |
| Keeper changes | **Built** | Recorded as stints; goals conceded are attributed to the keeper in goal at that minute | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx`, `backend/src/PitchMate.Domain/LiveTracking/MatchEventLog.cs` |
| Undo the last goal | **Built** | A button plus a 10-second toast | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx:303` |
| Change a scorer, remove any goal, remove a keeper change | **Built** | From the timeline; implemented as retractions appended to the log | `apps/web/src/features/matches/screens/LiveTrackerScreen.tsx:323`, `apps/web/src/features/matches/lib/messages.ts:542` |
| Minutes count from the kickoff instant | **Built** | The kickoff instant is stored at start; the minute is computed by the client and sent with the event | `backend/src/PitchMate.Domain/Matches/Match.cs:911`, `backend/src/PitchMate.Application/LiveTracking/UseCases/RecordEventBatchHandler.cs` |
| Members see the live score | **Built** | The match page polls the running score every 20 seconds; there is no push channel | `apps/web/src/features/matches/components/LiveScorePanel.tsx:30` |
| End the match from the tracker | **Built** | The tracked score becomes a rich result and the match completes in one step | `backend/src/PitchMate.Application/LiveTracking/UseCases/FinaliseTrackedResultHandler.cs:121` |
| Reload keeps the keeper and the goals | **Built** | The tracker starts from the server's event log | `apps/web/src/features/matches/state/useEventLog.ts` |
| Tracking without a connection | **Partial** | A failed send is kept and resent only while the page stays open; the queue is not persisted, so a reload loses unsent events. The API is ready for offline clients (idempotent client ids, batches, per-event outcomes) | `apps/web/src/features/matches/state/useEventLog.ts`, `backend/src/PitchMate.Domain/LiveTracking/EventIdPolicy.cs`, `backend/src/PitchMate.Application/LiveTracking/UseCases/RecordEventBatchHandler.cs:123` |
| Assists, cards, substitutions, per-player time on pitch | **Gap** | The event kinds are goals and keeper stints only | `backend/src/PitchMate.Domain/LiveTracking/EventKind.cs` |

### Journey 4 · Stats

```mermaid
flowchart LR
  squad[Squad screen] --> players[Players tab] --> profile[Player stats screen]
  squad --> boards[Leaderboards tab] --> pick[Pick one statistic] --> ranked[Ranked list] --> profile
  profile --> record[Record: W/L/D, win %]
  profile --> rating[Rating or 'still settling']
  profile --> chart[Rating progression]
  profile --> fun[Streaks, bibs, played with/against, partnerships, bogey opponents]
  profile --> rich{Live tracking on?}
  rich -- yes --> detail[Goals, clean sheets, goals conceded, keeper time]
  rich -- no --> off[Explains the squad does not record live detail]
```

| Step | Status | Detail | Source |
|---|---|---|---|
| Leaderboards, one statistic at a time | **Built** | Appearances, win %, display rating (default), win streak, unbeaten streak, bib appearances | `apps/web/src/features/player-stats/screens/SquadLeaderboards.tsx`, `backend/src/PitchMate.Application/Stats/LeaderboardStatistic.cs` |
| Player stats screen for any member or guest, scoped to the squad it was opened from | **Built** | `/app/squads/:squadId/players/:membershipId` | `apps/web/src/features/player-stats/screens/PlayerStatsScreen.tsx`, `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs:93` |
| Provisional players show no number | **Built** | "Rating still settling" and a "~ Provisional" band on the chart | `apps/web/src/features/player-stats/components/RatingPanel.tsx`, `apps/web/src/features/player-stats/components/ProgressionChart.tsx` |
| Rich stats degrade gracefully | **Built** | Disabled or empty states rather than zeros | `apps/web/src/features/player-stats/lib/richStats.ts` |
| Top scorer and other rich-stat leaderboards | **Partial** | Goals show on a profile; a top-scorer query exists in the stats port but nothing calls it and no leaderboard offers it | `backend/src/PitchMate.Application/Stats/IRichStatsSource.cs`, `backend/src/PitchMate.Application/Stats/LeaderboardStatistic.cs` |
| A user's cross-squad vanity aggregate | **Gap** | Nothing in the code | `backend/src/PitchMate.Application/Stats` |
| A profile page for the signed-in user | **Gap** | `/app/profile` shows "not ready yet" | `apps/web/src/features/app-shell/shellRoutes.tsx:316` |

## Rules

- **Built** · A signed-out visitor to any `/app` path is sent to `/login?redirect=…` and returned afterwards; the return target must be a same-origin, non-auth path. `apps/web/src/features/app-shell/RouteGuard.tsx`, `apps/web/src/features/auth/lib/redirectTarget.ts`
- **Built** · Match states and transitions are enforced in the domain entity; no handler sets a state directly. `backend/src/PitchMate.Domain/Matches/Match.cs`
- **Built** · The lineup is editable until kickoff (unlock) and immutable once play starts; ratings use the kickoff lineup only. `backend/src/PitchMate.Domain/Matches/Match.cs:854`, `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`
- **Built** · Both result fidelities end in the same completion step, so ratings always update. `backend/src/PitchMate.Application/LiveTracking/UseCases/FinaliseTrackedResultHandler.cs`, `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`
- **Built** · The live event log is append-only; a correction is a retraction, never an edit or delete. `backend/src/PitchMate.Domain/LiveTracking/MatchEventLog.cs`
- **Built** · Match creation and live events are idempotent on a client-supplied id. `backend/src/PitchMate.Application/Matches/UseCases/CreateMatchDraftHandler.cs`, `backend/src/PitchMate.Domain/LiveTracking/EventIdPolicy.cs`

## Open questions

1. **`product.md` understates the tracker's corrections.** It says corrections "go no further than undoing the last goal", but the tracker can change a scorer and remove any goal or keeper change (`apps/web/src/features/matches/screens/LiveTrackerScreen.tsx:323`). Update `product.md`, or was the wider correction not meant to ship?
2. **"Teams rolled" is announced at the lock, not at the roll** (`backend/src/PitchMate.Application/Matches/UseCases/LockTeamsHandler.cs`). Is the notification's name right, or should it read "Teams are set"?
3. **What should happen between sign-up and joining?** The return to the invite is easy to lose. Should the invite code be remembered across email verification, and should verification be required before joining?
4. **A member can only join or leave while the match is `Confirmed`.** After the lock they need an admin to unlock. Intended?
5. **A basic result can be overwritten until "complete", and the web makes these two steps.** Should recording a basic result complete the match in one action, as ending a tracked match does?
6. **No notification on cancel, start, or unlock.** Should members hear that a match was cancelled?
7. **Should a completed match ever be correctable?** Today a wrong score is permanent, and with it the rating change.
8. **Live score is polled every 20 seconds.** Good enough, or is a push channel wanted before mobile?

## Ideas

- **Idea** · Remember a pending invite or claim code in storage so it survives email verification and a new tab.
- **Idea** · A "who's in" share card for the group chat once a match is confirmed.
- **Idea** · Reminders: "you haven't marked your days" and "match tomorrow".
- **Idea** · A waiting list when a match is full at 16.
- **Idea** · Recurring matches (same place, same weekday) so the admin doesn't recreate the draft each week.
- **Idea** · Assists and a man-of-the-match vote as new event kinds or post-match inputs.
