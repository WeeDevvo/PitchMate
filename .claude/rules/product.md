# Product

PitchMate organises fair, casual small-sided football between friends (pitch-mate.co.uk). These are the product rules the code implements; when product direction changes, update this file first, then the code. Keep its terminology in code and UI copy.

Lines marked **Today** say where the shipped code falls short of the intent, so it is not mistaken for built behaviour.

## Squads, roles and guests

- A **squad** is a friend group. It has exactly **one owner** (transferable; the owner must transfer before leaving) and any number of **admins**, whom the owner or an admin can promote.
- Admin-only: creating matches and selecting players, creating guests, claiming guests, toggling the squad's optional features.
- **Joining** is via a revocable, expirable **invite link/code**. Someone without an account goes sign-up → auto-join. The link must not leak squad data before joining.
- A **guest** is an admin-created player profile with no account and no `AuthIdentity`. It is selectable, balanced, rated and accrues stats like anyone else, but exists only in that squad. Store only a display name and optional skill tier, never contact details.
- **Display names are unique within a squad**, for guests and members alike.
- An admin can **claim** a guest for a registered user by creating a one-time **claim link** (valid 7 days; a new link cancels the old one). The player opens it while signed in and accepts, which binds their account; the admin then sees who accepted and completes the claim. A player who already belongs to the squad can't accept. The claim is audited and reversible, and it preserves the guest's rating and stats, because ratings belong to the membership, not the account.
- **Leaving or removal** makes a membership inactive (out of selection) but keeps its rating, stats and history. Re-joining reactivates the same membership.
- **Deleting a squad** is owner-only: soft delete, grace period (30 days by default), then purge, with an export offered first and a typed-name confirmation. A squad in its grace period should be invisible to every read except the owner's own list of deleted squads, where the owner can restore it until the purge. **Today** the squad leaderboard and player profile reads still answer for it (logged in the backlog).

## Optional features

Features are opt-in per squad (admin toggle). **Live match tracking** is the main one. A squad with it off still gets balancing and records a basic result after the match. Design every feature so a squad without it still has a coherent experience.

## Match lifecycle and availability

1. An admin creates a **match draft** with a location and 1–14 candidate days; members are notified.
2. **Gathering availability**: registered members mark the candidate days they can make, changeable until confirmation. Guests have no account, so an admin marks the days each guest can make. Availability is a **guide** to the best day, not a requirement: there is no minimum number of players to confirm.
3. **Confirm**: an admin confirms the match on any candidate day, seeing how many can make each. Everyone marked for that day, guests included, becomes a player.
4. **Fill the match**: until teams are locked, members **join or leave** it themselves, and an admin **adds or removes** anyone, member or guest, whether or not they marked the day. Then **roll teams** (needs 10–16 players): the balancer proposes, the admin tweaks, sets team names (or uses the silly-name generator) and bibs, then **locks**. Anyone who joined after the roll must be put on a team before locking. The lock captures the **kickoff lineup**. Until the match starts, an admin can **unlock** the teams (back to Confirmed, teams kept, lineup discarded) to add or remove players, then lock again; once play starts the lineup is immutable.
5. **Play, then record** the result (basic or rich), then **complete**, which updates ratings.

States: `GatheringAvailability → Confirmed → TeamsRolled → InProgress → Completed`, plus `Cancelled` (from GatheringAvailability, Confirmed or TeamsRolled). Unlocking returns `TeamsRolled → Confirmed`. There is no separate Draft state: creating a draft starts at GatheringAvailability.

**Every match is recorded**, uneven ones included. Matches run about an hour, from 5v5 to 8v8, and may be uneven (e.g. 7v6).

## Team balancing

- **Objective:** a fair contest. Minimise the gap from 50/50 as measured by OpenSkill's `Predict` over the full rosters (μ and σ, uneven sizes handled), **not** a mechanically even split. Clustering stronger players on the smaller side is fine if that's fairest. Tie-break towards less skill concentration.
- The admin stays in control: the proposal shows each side's predicted win and draw %, and the admin can swap, re-roll and lock. Balancing never alters ratings.
- Goalkeepers are not special-cased (they rotate, and rating is outcome-based).
- The engine ranks **N teams** (PlackettLuce), so winner-stays-on formats stay possible. The MVP UI is two teams.
- **Today:** proposals need 10–16 participants in 2 teams and brute-force every split. Keep-together/keep-apart constraints and the >16 heuristic (greedy + local swaps) are not built.

## Ratings

- **Squad-scoped**, attached to the `SquadMembership`. Any cross-squad number is a vanity stat that never feeds balancing.
- Each player has **μ (skill)** and **σ (uncertainty)**. New players start with high σ and are **provisional** until σ ≤ 7.75 (`RatingEngineConfig.ProvisionalThreshold`), which takes about 10 matches at 5v5 and 15 at 8v8. σ decays back up after about 4–6 weeks inactive (**today** the engine supports decay but no scheduled job runs it).
- **Cold start:** an admin may seed a starting **skill tier** (Beginner / Average / Strong), which sets the initial μ while σ stays high. The tier is an input only.
- Ratings move on **outcome rank** (win/loss/draw, draws first-class). The score is always stored, but margin doesn't count by default: a capped margin-of-victory weight and a participation weight exist as switchable levers, both **off**.
- **One match = one kickoff lineup = one outcome = one rating update.** Late arrivals, early leavers and substitutions count for stats only. Re-mixing teams mid-session makes a new match.
- **Display rating** = round((μ − 3σ) × K + C), floored, with K and C tunable per squad (e.g. K=40, C=1000). Provisional players show a badge or "~" band instead of a number. It's presentational only: balancing always uses μ/σ through `Predict`.

## Results

Two fidelities, and both must produce a valid outcome so ratings always update:

- **Rich (live-tracked):** goal **events** (scorer, conceding keeper, minute) and goalkeeper **stints** (time ranges), plus the running score.
- **Basic (post-match):** which team won and the final score.

Stats views degrade gracefully when only basic results exist.

## Presentation

- The **team sheet** shows match time and location, both teams with names and players, and a clear flag for the bib-wearing team. It is shown once teams are locked.
- **Bib appearances** are tracked per player as a deliberately fun stat.

## Stats and leaderboards

Squad-scoped leaderboards and per-player profiles. A player's screen shows only the stats from the squad it was opened from.

- **Always available:** appearances, W/L/D and win %, current rating and provisional state, rating progression (from μ/σ snapshots; provisional points are plotted at their estimate and shown only as the "~" band), longest win/unbeaten streak, most played with/against, best partnerships and bogey opponents, bib appearances.
- **Rich tracking only:** goals and top scorer, clean sheets, goals conceded as keeper, keeper time.

New "fun stat" ideas go in the backlog.

## Notifications

Web MVP: **email + in-app**; push arrives with the mobile app. Events: match drafted, match confirmed, teams rolled, result posted, plus the squad events (member joined, promoted to admin, removed, ownership transferred).

## Visibility and privacy (UK GDPR)

- All squad data is visible to **squad members only**; there are no public profiles. Ratings are visible to members on purpose, so balancing is transparent. A user's cross-squad vanity aggregate is visible to that user alone.
- **Erasure = anonymisation:** a user or guest with match history keeps de-identified rows (name → placeholder, avatar removed) so immutable matches and rating replay stay valid. Hard delete only when there's no history.
- Creating a guest needs a one-time admin acknowledgement of lawful basis.
- Before launch: privacy policy, terms, and a data export (DSAR) path.

## Web surfaces

Dark-mode first (see `brand.md`): marketing landing page, auth (email+password or Google), app shell (notifications, settings, profile), squads list, squad screen (players, matches, leaderboards; admin actions), player stats screen (guests too), and the create-match flow (location and candidate days → availability → confirm → guests → roll/tweak teams with live win % → names and bibs → team sheet).
