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

## To be

What is wanted, from [decisions](decisions.md). Nothing in this section is built unless the line says so; the section above is the as-is truth.

| Line | Status | Decision |
|---|---|---|
| **The first launch is public**, on pitch-mate.co.uk, after a test period on QA with the user's own squad and perhaps one more. Everything on the [launch gate](index.md#launch-gate) is therefore a requirement | **Gap** | [Q1](decisions.md#q1) |
| **Free at launch.** No squad pays for anything, and nothing is metered | **Gap** | [Q2](decisions.md#q2) |
| **Ready for a Pro tier.** Live match tracking and rating-based auto-balancing can later be made Pro-only by changing an entitlement, without a rebuild (OF-04 in [05](05-features.md#to-be)) | **Gap** | [Q2](decisions.md#q2) |
| **Web, Android and iOS**, with a watch app to follow as the main live tracker ([04](04-devices.md#to-be)) | **Gap** | [Q4](decisions.md#q4), [Q5](decisions.md#q5) |
| **Trust stays inside the squad.** Members see each other's ratings and admins add anyone, as today; towards strangers the product adds rate limits, verified email and a way to report a squad ([07](07-trust.md#to-be)) | **Gap** | [Q3](decisions.md#q3) |
| **Any team-v-team size**, not only 5-a-side to 8-a-side | **Gap** | [Q12](decisions.md#q12) |
| **A confirmed result is final.** It is never corrected afterwards; a squad can ask for the opposing team to confirm the score first | **Gap** | [Q11](decisions.md#q11) |

The "What it deliberately is not" list above still holds: not public, not a league manager, not a global ranking.

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

The four questions the as-is spec asked here are answered: launch ([Q1](decisions.md#q1)), mobile ([Q4](decisions.md#q4)), trust ([Q3](decisions.md#q3)) and business model ([Q2](decisions.md#q2)). What the answers leave open:

1. **Does the public launch wait for the native apps, or does the web launch first?** Q1 and Q4 were answered separately. If the launch waits, the apps, push and Sign in with Apple all join the launch gate.
2. **What is a Pro tier attached to: the squad, or a person?** The gating mechanism needs to know before it is built, even though nothing is charged for yet.
3. **What does a squad without rating-based balancing get?** Fair teams are the product's core promise (see Rules). Random teams, manual teams, or balancing a limited number of times? And do ratings still update for it?

## Ideas

- **Idea** · A one-line positioning statement on the landing page tested against real organisers ("the fairest way to pick teams").
- **Idea** · A "season" concept that groups matches for leaderboards without changing how ratings work.
- **Idea** · Winner-stays-on and three-team formats, which the N-team rating engine already allows.
- **Idea** · A **pitch-booking marketplace**: squads book a pitch through PitchMate, which takes a small cut, as Playtomic does for padel. The long-term revenue idea; needs partnerships with pitch providers. ([Q2](decisions.md#q2))
