# Product

PitchMate organises fair, casual small-sided football between friends (pitch-mate.co.uk). These are the product rules the code implements; when product direction changes, update this file first, then the code. Keep its terminology in code and UI copy.

Lines marked **Today** say where the shipped code falls short of the intent, so it is not mistaken for built behaviour. The requirement behind each rule, and the decision it came from, is in the master spec (`specs/master/`).

## Squads, roles and guests

- A **squad** is a friend group. It has exactly **one owner** (transferable; the owner must transfer before leaving) and any number of **admins**, whom the owner or an admin can promote. Only the owner can demote or remove an admin. **Today:** any admin can demote or remove another admin.
- Admin-only: creating matches and selecting players, creating guests, claiming guests, toggling the squad's optional features, picking a match's tracker.
- For each match an admin can pick a **tracker**: a registered member (never a guest) who can start that match, undo its kickoff, run its live tracker and record a basic score, with no other admin power. One tracker at a time; picking another replaces them. **Today:** not built; only an admin can do these.
- **Joining** is via a revocable, expirable **invite link/code**. Someone without an account goes sign-up → verify their email → auto-join. A verified email is required before signing in, and the invite survives verification. The link must not leak squad data before joining. **Today:** verification is not required, and the invite is lost if the person verifies in another tab.
- A **guest** is an admin-created player profile with no account and no `AuthIdentity`. It is selectable, balanced, rated and accrues stats like anyone else, but exists only in that squad. Store only a display name and optional skill tier, never contact details.
- **Display names are unique within a squad**, for guests and members alike.
- An admin can **claim** a guest for a registered user by creating a one-time **claim link** (valid 7 days; a new link cancels the old one). The player opens it while signed in and accepts, which binds their account; the admin then sees who accepted and completes the claim. A player who already belongs to the squad can't accept. The claim is audited and reversible, and it preserves the guest's rating and stats, because ratings belong to the membership, not the account.
- **Leaving or removal** makes a membership inactive (out of selection) but keeps its rating, stats and history. Re-joining reactivates the same membership.
- **Deleting a squad** is owner-only: soft delete, grace period (30 days by default), then purge, with an export offered first (a small CSV of players, matches and stats) and a typed-name confirmation that the API enforces. A squad in its grace period should be invisible to every read except the owner's own list of deleted squads, where the owner can restore it until the purge, and it refuses changes. **Today:** nothing runs the purge; the export is JSON of memberships, invites and features; only the web checks the typed name; and match-changing actions do not check for the grace period.

## Optional features and Pro

Features are opt-in per squad (admin toggle). **Live match tracking** is the main one, and it is free. A squad with it off still gets balancing and records a basic result after the match. Design every feature so a squad without it still has a coherent experience.

- **Pro** is held per squad (about £1–2 a month), bought through the app stores by any member. Paying gives no admin power: an admin still chooses what is switched on.
- Pro gives **balanced rolls** on every match, and two **match-day options**: availability on or off, and payment tracking.
- Free in every squad, always: ratings, live tracking, score confirmation, team naming, and every stat.
- A free squad's roll is a **random split** the admin can then swap, with no win % shown, plus **one match a month** with balanced rolls (re-rolls included) as a taster.
- Until Pro is on sale, every squad gets everything, unlimited balanced rolls included. Pro goes on sale after the public launch.
- When Pro lapses its features switch off and no data is lost.
- **Today:** none of Pro is built. Every squad gets balanced rolls, and there are no match-day options.

## Match lifecycle and availability

1. An admin creates a **match draft** with a location and 1–14 candidate days; members are notified.
2. **Gathering availability**: registered members mark the candidate days they can make, changeable until confirmation. Guests have no account, so an admin marks the days each guest can make. Availability is a **guide** to the best day, not a requirement: there is no minimum number of players to confirm.
3. **Confirm**: an admin confirms the match on any candidate day, seeing how many can make each. Everyone marked for that day, guests included, becomes a player.
4. **Fill the match**: until teams are locked, members **join or leave** it themselves, and an admin **adds or removes** anyone, member or guest, whether or not they marked the day. Then **roll teams** (3 to 11 players a side, the sides at most 2 apart, so 6 to 22 players): in a Pro squad the balancer proposes; in a free squad the roll is a random split, except on its one balanced match a month. The admin tweaks, sets team names (or uses the silly-name generator) and bibs, then **locks**. Anyone who joined after the roll must be put on a team before locking. The lock captures the **kickoff lineup**. Until the match starts, an admin can **unlock** the teams (back to Confirmed, teams kept, lineup discarded) to add or remove players, then lock again. Once play starts the lineup is immutable. **Today:** a roll needs 10–16 players and a lock 5–8 a side, and every roll is balanced.
5. An admin or the match's tracker **starts** the match. **Play, then record** the result (basic or rich), then **complete**, which updates ratings. A match started by mistake can be put back: while it is in play and **nothing has been recorded for it yet** (no live-tracking events, corrected ones included, and no result), an admin or the tracker can **undo kickoff**. The match returns to TeamsRolled with the teams still locked and the kickoff lineup kept, and the kickoff instant is cleared, so starting again restarts the clock. Once anything is recorded, undo is refused: the event log is append-only, so nothing is discarded.
6. **Score confirmation** is a squad setting, off by default and free. When it is on and the result is basic, any registered player in the match, or an admin, enters the score, and the match waits in **AwaitingConfirmation** until a user on the other team confirms it. If the person who entered it played on neither side, anyone in the match confirms. Left unconfirmed for 48 hours it confirms itself; a dispute goes to an admin to decide; where nobody on the other side can confirm (a guest-only side), the admin's confirmation stands. Ratings update on confirmation. A live-tracked result needs no confirmation. **Today:** not built; a recorded result is completed by an admin.

A completed result is final: it is never corrected.

States: `GatheringAvailability → Confirmed → TeamsRolled → InProgress → Completed`, plus `AwaitingConfirmation` between InProgress and Completed (only when score confirmation is on and the result was not live-tracked) and `Cancelled` (from GatheringAvailability, Confirmed or TeamsRolled). Unlocking returns `TeamsRolled → Confirmed`; undoing kickoff returns `InProgress → TeamsRolled`. Entering a basic score moves `InProgress → AwaitingConfirmation`; confirming, the 48-hour auto-confirm or an admin's decision moves `AwaitingConfirmation → Completed`. There is no separate Draft state: creating a draft starts at GatheringAvailability. **Today:** `AwaitingConfirmation` does not exist.

**Every match is recorded**, uneven ones included. Matches run about an hour, from 4v4 to 11v11, and down to 3 a side when people do not turn up. They may be uneven (e.g. 7v6), by 2 players at most. **Today:** 5v5 to 8v8.

## Team balancing

- **Objective:** a fair contest. Minimise the gap from 50/50 as measured by OpenSkill's `Predict` over the full rosters (μ and σ, uneven sizes handled), **not** a mechanically even split. Clustering stronger players on the smaller side is fine if that's fairest. Tie-break towards less skill concentration.
- "OpenSkill" names the rating model. The engine is PitchMate's own PlackettLuce implementation of it; no OpenSkill package is used.
- The admin stays in control: the proposal shows each side's predicted win and draw %, and the admin can swap, re-roll and lock. Balancing never alters ratings.
- Goalkeepers are not special-cased (they rotate, and rating is outcome-based).
- The engine ranks **N teams** (PlackettLuce), so winner-stays-on formats stay possible. The product is two teams.
- **Keep-together and keep-apart rules** are standing rules saved per squad, seen by admins only. A balanced roll always obeys them, and a set that cannot be met is reported to the admin, not quietly broken. They do not act on a random split.
- Above 16 players every split cannot be tried, so the balancer uses a faster search (greedy start, then local swaps).
- **Today:** proposals need 10–16 participants in 2 teams and brute-force every split. The keep-together and keep-apart rules and the faster search above 16 are not built.

## Ratings

- **Squad-scoped**, attached to the `SquadMembership`, and tracked in every squad, Pro or not. Any cross-squad number is a vanity stat that never feeds balancing.
- Each player has **μ (skill)** and **σ (uncertainty)**. New players start with high σ and are **settling** until σ ≤ 8.19, which takes **at most 5 matches** (3 at 5v5, 4–5 at 8v8; not yet checked for 3-a-side or 11-a-side). The settling note drops while σ is still high, so balancing keeps treating the player as uncertain. σ decays back up after 8 weeks without a match; decay raises σ only and never lowers μ, and a short lay-off can make a player settling again. **Today:** the engine supports decay but no scheduled job runs it, and its decay-free period is 6 weeks.
- **Cold start:** an admin may seed a starting **skill tier** (Beginner / Average / Strong), which sets the initial μ while σ stays high. The tier is an input only.
- Ratings move on **outcome rank** (win/loss/draw, draws first-class). The score is always stored, but margin doesn't count by default: a capped margin-of-victory weight and a participation weight exist as switchable levers, both **off**, and they stay off.
- **One match = one kickoff lineup = one outcome = one rating update.** Late arrivals, early leavers and substitutions count for stats only. Re-mixing teams mid-session makes a new match.
- **Display rating** = round((μ − 25) × K + C), floored, with K=40 and C=1000 fixed. It is μ on a friendlier scale: a new Beginner, Average or Strong player starts on 800, 1000 or 1200 and moves with results. Every player shows a number from their first match. A settling player shows the same number with a visible note that ratings take a few matches to settle; σ changes the note, never the number. It's presentational only: balancing always uses μ/σ through `Predict`.
- **"Settling"** is the one term for a rating above the σ threshold. **Today:** the web's rating copy says "settling", but the code and the API still say "provisional" (`RatingEngineConfig.ProvisionalThreshold`, the `Provisional` rating state on the wire); renaming them is a follow-up, not yet done.

## Results

Two fidelities, and both must produce a valid outcome so ratings always update:

- **Rich (live-tracked):** goal **events** (scorer, minute), plus the running score.
- **Basic (post-match):** which team won and the final score.

Stats views degrade gracefully when only basic results exist.

In a squad with live tracking on, an admin or the match's tracker records a match in play from the **live tracker** (GOAL → team → scorer, own goals, changing a scorer, removing a goal), and members see the live score on the match page. Each event's minute counts from the kickoff instant recorded when the match starts. **Ending** the match makes the tracked score its result and completes it. The tracker starts from the match's event log, so a reload keeps the goals a correction can name.

**Goalkeeper tracking is removed**: no keeper stints, no conceding keeper on a goal, and the stored keeper data is deleted. That deletion is a one-off exception to the append-only event log. **Today:** keeper tracking is still built: the tracker records keeper changes, goals carry a conceding keeper, and keeper stints are stored.

The **watch** is the main live tracker, with the phone app beside it; both keep working offline and send their events when a connection returns. The web tracker needs a connection. **Today:** only the web tracker exists (a failed send is kept and resent only while the page stays open).

## Presentation

- The **team sheet** shows match time and location, both teams with names and players, and a clear flag for the bib-wearing team. It is shown once teams are locked.
- **Bib appearances** are tracked per player as a deliberately fun stat.

## Stats and leaderboards

Squad-scoped leaderboards and per-player profiles. A player's screen shows only the stats from the squad it was opened from. Every available stat is shown; nothing computed is hidden.

- **Always available:** appearances, W/L/D and win %, current rating and whether it is settling, rating progression (from μ/σ snapshots; every point is plotted as a number, settling points marked), longest win/unbeaten streak, most played with/against, best partnerships and bogey opponents, bib appearances.
- **Rich tracking only:** goals and top scorer, including a top-scorer leaderboard.
- **Today:** the top-scorer leaderboard is not built; and clean sheets, goals conceded as keeper and keeper time are still shown.

New "fun stat" ideas go in the backlog.

## Notifications

**Email, in-app and push.** Events: match drafted, match confirmed, teams locked (sent at the lock, with the team sheet; nothing is sent at the roll), match cancelled, result posted, plus the squad events (member joined, promoted to admin, removed, ownership transferred). Each user sets their own notification preferences.

**Today:** in-app works; email is written to a log and not sent; there is no push, no "match cancelled" notice and no preferences; and the lock's notice is still called "teams rolled".

## Visibility and privacy (UK GDPR)

- All squad data is visible to **squad members only**; there are no public profiles. Ratings are visible to members on purpose, so balancing is transparent. A user's cross-squad vanity aggregate is visible to that user alone.
- **Erasure = anonymisation:** a user or guest with match history keeps de-identified rows (name → placeholder, avatar removed) so immutable matches and rating replay stay valid. Hard delete only when there's no history. **Today:** erasing an account does not reach its squad memberships, the match-history check is a stub, and a guest cannot be erased.
- Creating a guest needs a one-time admin acknowledgement of lawful basis, asked once per admin. **Today:** it is asked on every guest.
- **Retention:** deleted squads are purged after their 30-day grace; expired tokens are cleaned up daily; logs and notifications are kept 90 days; an inactive account (no sign-in) is emailed at 2 years and erased at 3, its memberships kept, anonymised. A nightly job does this. **Today:** no scheduled job exists, so none of it runs, and logs are kept 30 days.
- **Before launch:** a privacy policy and terms; a data export (DSAR) of everything held about a user, as one JSON file (account, memberships, matches, rating history, stats); and ICO registration, with the person who operates PitchMate as the data controller. **Today:** there are no policy or terms pages and no full user export.

## Clients and surfaces

Dark-mode first (see `brand.md`).

- **Web:** marketing landing page, auth (email+password or Google), app shell (notifications, settings, account), squads list, squad screen (players, matches, leaderboards; admin actions), player stats screen (guests too), and the create-match flow (location and candidate days → availability → confirm → guests → roll/tweak teams with live win % → names and bibs → team sheet). The web keeps every feature except watch tracking and offline tracking.
- **Android and iOS apps:** the main way people use PitchMate, and part of the public launch. The phone app does everything an admin can do, tracks offline, sends push, and adds Sign in with Apple on iOS.
- **Watch:** an Apple Watch app is the main live tracker and is part of the launch. Wear OS follows.
- **One account screen** in place of profile: name, email (changeable, re-verified), avatar, password, linked sign-in methods, notification preferences, signed-in devices, export, delete.
- **Today:** only the web exists. There are no apps and no watch app, the account screen is a placeholder, and Google sign-in is not wired on the web.
