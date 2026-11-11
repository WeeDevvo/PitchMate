# 01 · Vision

## Purpose

What PitchMate is for, who it is for, and the handful of principles everything else follows. This chapter is the shortest; it exists so that a feature spec can be tested against "does this serve the vision?" before any detail is argued.

## Today (as-is)

**PitchMate organises fair, casual small-sided football between friends** (pitch-mate.co.uk). A friend group forms a squad, an admin proposes a match, people say which days they can make, the app proposes balanced teams, the match is played and recorded, and everyone's rating and stats move.

### The promise, measured against the code

| Promise | Status | Where it stands | Source |
|---|---|---|---|
| A friend group can form a **squad** and bring people in by invite link | **Built** | Create squad, invite generate / revoke / redeem, roles | `backend/src/PitchMate.Api/Squads/Endpoints/SquadEndpoints.cs:52`, `backend/src/PitchMate.Api/Squads/Endpoints/SquadEndpoints.cs:304` |
| People without an account can still play (**guests**) | **Built** | Admin-created guest memberships, later claimable by a real account | `backend/src/PitchMate.Application/Squads/UseCases/CreateGuestHandler.cs`, `backend/src/PitchMate.Domain/Squads/GuestClaim.cs` |
| Finding a day is easy (**availability**) | **Built** | 1–14 candidate days, self-marked by members and admin-marked for guests, with a tally | `backend/src/PitchMate.Domain/Matches/Match.cs:168`, `backend/src/PitchMate.Api/Matches/Endpoints/MatchEndpoints.cs:289` |
| Teams are **fair**, not just even | **Built** | The balancer minimises the gap from 50/50 using the rating engine's prediction over full rosters, uneven sizes included | `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs` |
| The admin stays **in control** of the teams | **Built** | Proposal with win and draw %, move, re-roll, names, bibs, lock, unlock | `backend/src/PitchMate.Application/Matches/UseCases/AdjustTeamsHandler.cs`, `backend/src/PitchMate.Domain/Matches/Match.cs:770` |
| **Every match is recorded**, at whatever fidelity the squad wants | **Built** | Basic result (score) or rich result (live-tracked goal events and keeper stints) | `backend/src/PitchMate.Domain/Matches/ResultFidelity.cs`, `backend/src/PitchMate.Domain/LiveTracking/EventKind.cs` |
| Ratings are **squad-scoped** and move on the outcome | **Built** | One rating per membership, one update per completed match | `backend/src/PitchMate.Domain/Matches/MembershipRating.cs`, `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs` |
| **Stats** give the group something to talk about | **Built** | Leaderboards and per-player profiles, fun stats included | `backend/src/PitchMate.Application/Stats/GetLeaderboardHandler.cs`, `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs` |
| It works on **web, phone and watch** | **Partial** | Only the web app exists; mobile and watch are README placeholders | `apps/web/package.json`, `apps/mobile/README.md`, `apps/watch/README.md` |
| It is **live** at pitch-mate.co.uk | **Partial** | A QA environment is modelled and deployable; production is not provisioned and the domain is not wired | `infra/main.qa.bicepparam`, `infra/main.prod.bicepparam`, `infra/main.bicep` |
| It is **safe to launch** under UK GDPR | **Partial** | Concealment, hashed tokens and account erasure exist; purge, the erasure cascade, and the policy pages do not | See [07 · Trust](07-trust.md) |

### Who it is for

- **Built** · The organiser of a regular kickabout (the squad's owner and admins), who today does this in a group chat. `backend/src/PitchMate.Application/Matches/MatchAuthorization.cs`
- **Built** · The players, who want to say when they are free, see their team, and see their numbers. `backend/src/PitchMate.Application/Matches/UseCases/SubmitAvailabilityResponseHandler.cs`
- **Built** · The mate-of-a-mate who turns up without an account (a guest). `backend/src/PitchMate.Application/Squads/UseCases/CreateGuestHandler.cs`

### What it deliberately is not (today)

- **Built** · Not public: there are no public profiles, and nothing about a squad is visible to a non-member. `backend/src/PitchMate.Application/Squads/SquadAuthorization.cs`
- **Built** · Not a league or tournament manager: a match is one kickoff lineup, one outcome, one rating update. `backend/src/PitchMate.Application/Matches/UseCases/CompleteMatchHandler.cs`
- **Built** · Not a global ranking: ratings hang off the squad membership, never the account. `backend/src/PitchMate.Domain/Matches/MembershipRating.cs`

## Rules

The principles the code already honours. A feature spec that breaks one needs an explicit decision.

- **Built** · **Fair contest over even split.** Balancing optimises predicted win probability, never a sum or average of ratings. `backend/src/PitchMate.Infrastructure/Matches/TeamBalancer.cs`
- **Built** · **The admin decides.** Balancing proposes and never alters ratings; the admin tweaks and locks. `backend/src/PitchMate.Application/Matches/UseCases/ProposeTeamsHandler.cs`
- **Built** · **Availability is a guide, not a gate.** Confirming needs no minimum number of players. `backend/src/PitchMate.Domain/Matches/Match.cs:397`
- **Built** · **Optional features degrade gracefully.** With live tracking off, a squad still gets balancing, a basic result and every always-available stat. `backend/src/PitchMate.Domain/Squads/SquadFeature.cs`, `backend/src/PitchMate.Application/Stats/GetPlayerProfileHandler.cs`
- **Built** · **Squad data is for squad members only**, and a non-member cannot tell that a squad exists. `backend/src/PitchMate.Api/Squads/Endpoints/SquadErrorResults.cs`
- **Built** · **History is kept.** Leaving keeps the membership's rating and stats; the live event log is append-only. `backend/src/PitchMate.Domain/Squads/SquadMembership.cs`, `backend/src/PitchMate.Domain/LiveTracking/MatchEventLog.cs`
- **Built** · **The backend owns the maths.** The web client renders display-ready values and computes no ratings. `backend/src/PitchMate.Domain/Stats/DisplayRatingCalculator.cs`

## Open questions

1. **What does "launched" mean?** A private beta for one squad on the QA environment, or a public launch on pitch-mate.co.uk with policy pages, production infrastructure and email? The gap list in [index](index.md) is long or short depending on the answer.
2. **Is mobile part of the first launch**, or does a responsive web app carry it? This decides whether offline live tracking and push notifications are launch requirements. See [04 · Devices](04-devices.md).
3. **How far beyond "friends" does it go?** Everything assumes a small trusted group (members see each other's ratings, admins can add anyone). Larger or semi-public groups would strain those assumptions.
4. **Is there a business model?** Nothing in the code meters, limits or charges; hosting is on free and lowest tiers.

## Ideas

- **Idea** · A one-line positioning statement on the landing page tested against real organisers ("the fairest way to pick teams").
- **Idea** · A "season" concept that groups matches for leaderboards without changing how ratings work.
- **Idea** · Winner-stays-on and three-team formats, which the N-team rating engine already allows.
