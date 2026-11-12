# Decisions

The answers to the 22 questions the as-is spec ended with (Q1–Q22, round one) and to the 17 questions those answers raised (R1–R17, round two), both recorded on 2026-11-12, plus the further decisions and ideas raised along the way. Where a round-two answer changes a round-one decision, the round-one entry says so and the round-two entry is the one that stands. Each chapter's **To be** section turns these into requirements and links back here.

**Source** says where a decision came from:

- **User**: the user's own answer.
- **Suggested**: a default the user asked for and has not overridden. It stands until they change it.

A decision is not a built feature. Nothing on this page is in the code unless a chapter's **Today (as-is)** section says so. `.claude/rules/product.md` has not been edited; the changes these decisions imply are listed under [Proposed product.md changes](#proposed-productmd-changes) at the end.

## Summary

| Q | Topic | Decision in one line | Source |
|---|---|---|---|
| [Q1](#q1) | Launch | Public launch, after testing on QA with the user's own squad and perhaps one more | User |
| [Q2](#q2) | Business model | Free first; build feature gating so a Pro tier can come later; pitch booking is a long-term idea | User |
| [Q3](#q3) | Trust model | Trust stays within a squad; rate limits and verified email between squads (squad reporting dropped in R10) | Suggested |
| [Q4](#q4) | Devices | Native apps for Android and iOS | User |
| [Q5](#q5) | Live tracker | Phone first; the watch becomes the main way to track | User |
| [Q6](#q6) | Polling | Fine for now | User |
| [Q7](#q7) | Erasure and purge | Fix before public launch; run from a scheduled timer job beside the API | Suggested |
| [Q8](#q8) | Export and legal | Full JSON export per user; Claude drafts policy and terms, a solicitor reviews | Suggested |
| [Q9](#q9) | Email and sign-in | Azure Communication Services; verified email required; lockout after 5 failures for 15 minutes | Suggested |
| [Q10](#q10) | Tokens | Web: refresh token in an httpOnly cookie, access token in memory. Native: Keychain and Keystore | Suggested |
| [Q11](#q11) | Result correction | None once confirmed; optional opposing-team confirmation of the score | User |
| [Q12](#q12) | Team sizes | Any team-v-team size, uneven allowed (4v4 to 11v11 in R7); the more-than-16 heuristic becomes a requirement | User |
| [Q13](#q13) | Balancing options | Build keep-together and keep-apart; margin and participation levers stay off | Suggested |
| [Q14](#q14) | Guest consent | Keep the acknowledgement, once per admin | Suggested |
| [Q15](#q15) | Admin powers | Owner promotes and demotes; admins promote only (tracking settled in R1, removal in R9) | User |
| [Q16](#q16) | Notifications | Notify members of cancellations (the "teams rolled" wording settled in R2) | User |
| [Q17](#q17) | Account screen | One account screen: name, email, avatar, plus password, export and delete | User + Suggested |
| [Q18](#q18) | Stats | Show every available stat, presented usefully | User |
| [Q19](#q19) | Database | Postgres Flexible Server, burstable, 7-day point-in-time restore; geo-redundant backup with paying users | Suggested |
| [Q20](#q20) | Domain and CD | Wire pitch-mate.co.uk before launch, QA on `qa.`; infra through CD with what-if and approval | Suggested |
| [Q21](#q21) | Production deploys | Off until production is provisioned, then armed behind approval | Suggested |
| [Q22](#q22) | Docs | Refresh `CLAUDE.md` and the READMEs; drop the `.kiro` references | User |
| [A1](#a1) | Auth provider | Keep the existing .NET auth, not Firebase; add Sign in with Apple for iOS | Suggested |
| [R1](#r1) | Non-admin tracking | Yes: the admin picks a tracker for each match, who can start it and run the live tracker | User + Suggested |
| [R2](#r2) | "Teams rolled" notice | Rename to "Teams locked", sent at the lock with the team sheet; nothing at the roll | Suggested |
| [R3](#r3) | Launch timing | The public launch waits for the native apps | User |
| [R4](#r4) | Native stack | React Native + Expo for phones; Apple Watch in SwiftUI first, Wear OS later | Suggested |
| [R5](#r5) | Pro tier | Per squad, about £1–2 a month; ratings always tracked; Pro unlocks auto-balancing and match-day customisation | User |
| [R6](#r6) | Score confirmation | One team enters, the other confirms; auto-confirm after 48 hours; a dispute goes to an admin | User + Suggested |
| [R7](#r7) | Match sizes | 4v4 to 11v11, uneven allowed | User |
| [R8](#r8) | Together and apart rules | Standing per squad, always obeyed, admin-only | Suggested |
| [R9](#r9) | Removing admins | Only the owner can remove an admin | User |
| [R10](#r10) | Squad reporting | Dropped | User |
| [R11](#r11) | Controller and retention | The user is the data controller; register with the ICO; purge on a schedule; logs kept 90 days | User + Suggested |
| [R12](#r12) | Account features | Email can be changed (re-verified, old address told); link and unlink Google and Apple | User + Suggested |
| [R13](#r13) | Keeper tracking | Dropped for now; keeper-only stats go | User |
| [R14](#r14) | Squad export | A small CSV of players, matches and stats | Suggested |
| [R15](#r15) | Scheduled job | One Azure Functions timer, nightly; σ decay starts after 8 weeks | Suggested |
| [R16](#r16) | Hostnames | pitch-mate.co.uk and api.pitch-mate.co.uk; QA with a `qa.` prefix | Suggested |
| [R17](#r17) | QA database | Stays on the cheap external database until other testers join | User + Suggested |

## Scope and launch

<a id="q1"></a>
### Q1 · What is the first launch?

**Decision (User):** a public launch on pitch-mate.co.uk, after testing on QA with the user's own squad and perhaps one more.

**What follows:** every launch-blocking gap in the as-is spec becomes a requirement, and the QA environment has to be good enough for a real squad to use (which needs real email, see Q9). The launch gate is listed in [index](index.md#launch-gate).

<a id="q2"></a>
### Q2 · Is there a business model?

**Decision (User):** free at first. Build a feature-gating mechanism so that **live match tracking** and **rating-based auto-balancing** can later be locked behind a Pro tier. Long-term revenue idea: a pitch-booking marketplace taking a small cut, in the way Playtomic does for padel. That needs partnerships, so it is an Idea, not near-term.

**What follows:** an entitlement check, enforced by the API, that sits alongside the per-squad admin toggle ([05](05-features.md#to-be) OF-04). At launch every squad is entitled to everything, so nothing changes for users.

**Refined by [R5](#r5):** Pro is per squad at about £1–2 a month, ratings are always tracked, and the Pro features are named as auto-balancing and match-day customisation. Whether live match tracking is still a Pro feature is open.

<a id="q3"></a>
### Q3 · How far beyond a group of friends should the trust model stretch?

**Decision (Suggested):** trust stays within a squad: members keep seeing each other's ratings and admins keep adding anyone. Between squads and towards strangers, add rate limits, a required verified email, and a way to report a squad.

**What follows:** SE-14 (rate limiting) and SE-15 (verified email, see Q9).

**Changed by [R10](#r10):** the way to report a squad is dropped.

## Devices

<a id="q4"></a>
### Q4 · Native apps, or an installable web app first?

**Decision (User):** native apps, for Android and iOS.

**What follows:** the installable, offline-capable web app is not pursued. Push notifications and Sign in with Apple arrive with the apps ([04](04-devices.md#to-be)).

<a id="q5"></a>
### Q5 · Is the watch still the intended live tracker?

**Decision (User):** the phone comes first, and the watch should become the main way to live-track.

**What follows:** the tracker is built in the phone app first, with an outbox that survives being offline; the watch app follows and is designed as the primary tracker.

<a id="q6"></a>
### Q6 · Is polling good enough?

**Decision (User):** yes, for now. Live score stays on a 20-second poll and unread notifications on a 60-second poll. A push channel remains an Idea.

## Trust

<a id="q7"></a>
### Q7 · Fix erasure and purge now? Where does scheduled work run?

**Decision (Suggested):** before public launch, fix the unwired account erasure so that it reaches squad memberships, wire the squad purge, and replace the match-history stub. Run them from a scheduled timer job beside the API, because the API scales to zero and cannot host a timer.

**What follows:** TR-06, TR-07, TR-08, TR-12 and SQ-17 become launch requirements, and the platform gains a scheduled job ([06](06-platform.md#to-be) PL-01). The same job is the natural home for the two other pieces of scheduled work the as-is spec found missing, σ decay (RA-06) and expired-token clean-up (TR-13); those were not part of the question in round one.

**Refined by [R15](#r15):** the job is one Azure Functions timer run nightly, and σ decay, token clean-up and score auto-confirmation are decided to share it.

<a id="q8"></a>
### Q8 · What goes in a data export, and who writes the policy and terms?

**Decision (Suggested):** a JSON export of everything held about a user: account, memberships, matches, rating history and stats. Claude drafts the privacy policy and the terms; a solicitor reviews both before launch.

**What follows:** AC-12 and TR-10 (the export), TR-14 and WE-05 (the pages). The squad export is decided in [R14](#r14), and the data controller and retention in [R11](#r11).

<a id="q9"></a>
### Q9 · Email provider, verified email, lockout?

**Decision (Suggested):**

- Azure Communication Services is the email provider.
- A verified email is required.
- Lockout is on: 5 failed attempts, then 15 minutes.

**What follows:** NO-03 and TR-15 (real email, so reset codes leave the log), SE-15, SE-13 and AC-13. The code's lockout default is 10 attempts, not 5, and the counter lives in one server's memory, so the requirement includes a shared counter. Requiring a verified email makes the sign-up → auto-join return (SQ-07) a requirement too, because every new joiner will now leave the tab to verify.

<a id="q10"></a>
### Q10 · Where do tokens live?

**Decision (Suggested):**

- Web: the refresh token in an httpOnly, Secure, SameSite cookie; the access token in memory only.
- Native: the Keychain on iOS and the Keystore on Android.

**What follows:** SE-18 and SE-22. The cookie only works if the web and the API are on the same site, which they are not on the platform's default hostnames, so this depends on the custom domain in Q20. The API keeps accepting the refresh token in the request body for native clients.

## Product rules

<a id="q11"></a>
### Q11 · Should a completed result be correctable?

**Decision (User):** no. Once a result is confirmed it cannot be corrected. Add a squad setting under which a player from the opposing team must confirm the score before it is final. Where no such player can confirm (a guest-only side, for example), the admin's confirmation stands.

**Refined by [R6](#r6):** how confirmation works, the 48-hour auto-confirm and disputes.

**What follows:** RE-07 is decided against. A new opposing-team confirmation feature (RE-08) and, with it, a step between "result recorded" and "completed". Rating replay (RA-11) no longer has a job.

<a id="q12"></a>
### Q12 · Is 10–16 players in two teams the right envelope?

**Decision (User):** no. Any team-v-team size, uneven allowed (9v9 and 7v6 are the examples given).

**Refined by [R7](#r7):** the range is 4v4 to 11v11.

**What follows:** the 10–16 roll limit and the 5–8-a-side lock limit go (TB-09). Because every split cannot be tried above 16 players, the more-than-16 heuristic (TB-11) becomes a requirement. The format stays two teams; three-team and winner-stays-on formats remain an Idea (TB-12).

<a id="q13"></a>
### Q13 · Keep-together, keep-apart and the rating levers?

**Decision (Suggested):** build keep-together and keep-apart constraints. Keep the margin-of-victory and participation levers off.

**Refined by [R8](#r8):** the constraints are standing rules per squad, always obeyed, admin-only.

**What follows:** TB-10 becomes a requirement. RA-07 stays as it is: the switches remain, off, and no work is done to feed them.

<a id="q14"></a>
### Q14 · Guest lawful-basis acknowledgement: once or every time?

**Decision (Suggested):** keep the acknowledgement, once per admin. The user thought it might not be needed at all; the suggestion is to keep it, because it is the UK GDPR cover for storing a profile of someone who has no account and has agreed to nothing.

**What follows:** GU-02 changes from "every guest" to "once per admin".

<a id="q15"></a>
### Q15 · Can admins demote and remove each other? Can a non-admin track?

**Decision (User):** the owner promotes and demotes admins. Admins can promote only.

**Settled in round two:** a non-admin can track a match ([R1](#r1)), and only the owner can remove an admin ([R9](#r9)).

**What follows:** demotion becomes owner-only ([02](02-roles.md#to-be) RO-01).

<a id="q16"></a>
### Q16 · Cancellation notices, and what "teams rolled" announces

**Decision (User):** yes, notify members when a match is cancelled.

**Settled in round two:** it becomes "Teams locked" ([R2](#r2)).

**What follows:** NO-06.

<a id="q17"></a>
### Q17 · What belongs on the profile and account screens?

**Decision (User):** profile and account are one account screen, showing name, email and avatar.

**Decision (Suggested):** password, data export and delete-account go on the same screen.

**Refined by [R12](#r12):** the email can be changed, and sign-in methods are linked and unlinked there.

**What follows:** WE-04, AC-10, AC-11, AC-12 and TR-09. Avatars need somewhere to be stored ([06](06-platform.md#to-be) PL-08).

<a id="q18"></a>
### Q18 · Which stats and leaderboards come next?

**Decision (User):** show every available stat, presented usefully.

**Limited by [R13](#r13):** keeper-only stats are dropped with keeper tracking.

**What follows:** ST-08 and ST-11. "Available" is read as "already computed or computable from stored data"; it does not by itself add new data to collect.

## Platform

<a id="q19"></a>
### Q19 · What is production's database?

**Decision (Suggested):** Postgres Flexible Server on a burstable tier with 7-day point-in-time restore. Add geo-redundant backup once there are paying users.

**What follows:** this is what the template already declares for production, so the requirement is to provision it ([06](06-platform.md#to-be) PL-02). QA's database is decided in [R17](#r17).

<a id="q20"></a>
### Q20 · Custom domain, and infrastructure in CD?

**Decision (Suggested):** wire pitch-mate.co.uk before launch, with QA on a `qa.` subdomain. Infrastructure deploys go through CD with a what-if preview and a manual approval.

**Refined by [R16](#r16):** the exact hostnames.

**What follows:** PL-03 and PL-04.

<a id="q21"></a>
### Q21 · Should production stay armed before it is provisioned?

**Decision (Suggested):** no. Keep production deploys off until production is provisioned, then arm them behind the approval. The user's first answer was "yes" and they asked for advice; this is the advice.

**What follows:** PL-05. One switch arms both environments today, so QA and production need separate switches. Until that is built, the production run that was waiting for approval on 2026-11-11 should be rejected rather than approved, because the environment has no secrets and it would fail.

<a id="q22"></a>
### Q22 · Update the docs?

**Decision (User):** yes. Refresh `CLAUDE.md` and the READMEs, and drop the `.kiro` references, because Kiro is no longer used.

**What follows:** PL-06. Not done in this change, which touches only `specs/`.

## Further decisions

<a id="a1"></a>
### A1 · Should auth move to Firebase?

The user asked whether Firebase would be the best choice for auth.

**Decision (Suggested):** no. Keep the existing .NET auth. Email and password, Google token verification, rotating refresh tokens and account erasure are already built and tested, and moving would mean migrating accounts and adding a second place that holds personal data. Apple requires Sign in with Apple in an iOS app that offers Google sign-in, so that is added for the iOS app (AC-05). With [R3](#r3) the iOS app is part of the launch, so Sign in with Apple is too.

**What follows:** [07](07-trust.md#to-be) SE-23.

## Round two

The questions the round-one answers left open or raised, numbered as they were in [index](index.md) before this round.

<a id="r1"></a>
### R1 · Can a non-admin track a match?

**Decision (User):** yes. "Track" means starting the match and running the live tracker, and an admin may not be there to play or to track.

**Decision (Suggested):** the admin picks a tracker for each match.

**What follows:** a per-match tracker role ([02](02-roles.md#to-be) RO-07, [05](05-features.md#to-be) RE-09). The tracker has to be someone who can sign in, so a guest cannot be picked.

<a id="r2"></a>
### R2 · What should "teams rolled" announce?

**Decision (Suggested):** rename it "Teams locked" and send it at the lock, with the team sheet. Send nothing at the roll, because a roll is a draft.

**What follows:** NO-07. The timing is already right in the code (it fires at the lock); the name, the copy and the link to the team sheet change.

<a id="r3"></a>
### R3 · Does the public launch wait for the native apps?

**Decision (User):** yes. The user sees the apps as the main way people will use PitchMate.

**What follows:** the Android and iOS apps, push, Sign in with Apple, secure token storage and store distribution join the [launch gate](index.md#launch-gate).

<a id="r4"></a>
### R4 · Which app stack?

The user leaves this to Claude, since they will not be writing the code.

**Decision (Suggested):**

- React Native + Expo for Android and iOS: one TypeScript codebase that shares `@pitchmate/api-client` and the design tokens with the web.
- Native watch apps: Apple Watch in SwiftUI first, Wear OS later.

**What follows:** DV-01, DV-02, DV-04 and DV-09 in [04](04-devices.md#to-be), and the tokens need a native output ([08](08-design.md#to-be)).

<a id="r5"></a>
### R5 · The Pro tier

**Decision (User):**

- Pro is per squad, at about £1–2 a month, so that it is barely noticed when split between the players.
- Ratings are always tracked, in every squad.
- Pro unlocks auto-balancing and the match-day customisation options.
- The aim is a free app useful enough that squads want to upgrade.
- The app stores take about 15% of subscriptions.

**What follows:** OF-04 is per squad, and gating never stops a rating update. The customisable match-day flow moves from an idea to an intended Pro feature (MA-11), though its options are not designed. Round one named live match tracking as a Pro feature and this answer does not mention it, so its tier is open. Where and how a squad pays is not decided.

<a id="r6"></a>
### R6 · How score confirmation works

**Decision (User):** as on Playtomic: someone on one team enters the score and a user on the other team confirms it. A separate job auto-confirms results left unconfirmed after a day or two.

**Decision (Suggested):** auto-confirm after 48 hours. A dispute goes to an admin to decide.

**What follows:** RE-08 gains the 48-hour auto-confirm (run by the nightly job, PL-01) and the dispute path. Ratings for that match update when the result becomes final, which can be up to 48 hours after the match.

<a id="r7"></a>
### R7 · Smallest and largest match

**Decision (User):** 4v4 to 11v11, with uneven sides allowed because people really do fail to turn up. The ranking should handle uneven sides as well as it can.

**What follows:** TB-09 has bounds: 8 to 22 players when both sides are full. More than 16 players needs the faster balancing search, so TB-11 stays a requirement. The code's limits today are 5 to 8 a side (`backend/src/PitchMate.Domain/Matches/Match.cs:40`).

<a id="r8"></a>
### R8 · Together and apart rules

**Decision (Suggested):** standing rules saved per squad, treated as hard constraints (always obeyed), visible to admins only.

**What follows:** TB-10. Because the rules are hard, a set that cannot be satisfied (or that leaves no legal split) has to be refused or reported to the admin rather than quietly broken.

<a id="r9"></a>
### R9 · Can an admin remove another admin?

**Decision (User):** no. Only the owner can remove an admin.

**What follows:** RO-08. Admins still remove members and guests.

<a id="r10"></a>
### R10 · Reporting a squad

**Decision (User):** reporting a whole squad does not make sense. **Decision (Suggested):** drop it.

**What follows:** TR-17 and RO-06 are withdrawn and leave the launch gate. If squad chat is ever built, the app stores require report and block for messages and users; that is recorded with the chat idea.

<a id="r11"></a>
### R11 · Data controller and retention

**Decision (User):** the data controller is the user, as the person who operates PitchMate. Data is kept for the recommended time, with jobs that purge what is no longer needed.

**Decision (Suggested):**

- Register with the ICO, which has a small annual fee.
- Purge deleted squads after their 30-day grace.
- Clean up expired tokens daily.
- Keep logs for 90 days.

**What follows:** TR-18 (ICO registration), TR-12 and TR-13 (both in the nightly job), PL-11 (log retention; the template sets 30 days today, `infra/main.bicep:104`). No period was given for inactive accounts, inactive memberships or old notifications.

<a id="r12"></a>
### R12 · The account screen

**Decision (User):** an email can be changed, and the account screen should have the features most similar apps offer, in line with GDPR.

**Decision (Suggested):** re-verify the new email and notify the old one; link and unlink Google and Apple sign-in from the screen.

**What follows:** AC-15 (change email) and AC-09 (linked sign-in methods, which has an API and no UI today).

<a id="r13"></a>
### R13 · Every stat, or drop keeper tracking?

**Decision (User):** drop keeper tracking for now. That wins over "every stat", so the keeper-only stats go.

**What follows:** RE-10. The tracker loses keeper changes; clean sheets, goals conceded as keeper and keeper time leave the stats screens. "Every available stat" ([Q18](#q18)) now means every stat except those.

<a id="r14"></a>
### R14 · The squad export

The user is not sure it is needed.

**Decision (Suggested):** keep a small CSV of players, matches and stats, because `product.md` offers an export before a squad is deleted.

**What follows:** SQ-15 changes from today's JSON of memberships, invites and features.

<a id="r15"></a>
### R15 · The scheduled job

**Decision (Suggested):** one Azure Functions timer, run nightly, covering the squad purge, erasure, score auto-confirm, token clean-up and σ decay. Start decay after 8 weeks without a match, not the 4–6 weeks in `product.md`.

The user's point behind the last part: matches are weekly at best, so ratings must not decay quickly. Decay only raises σ; it never lowers μ.

**What follows:** PL-01 and RA-06. The code's decay-free period is 42 days (`backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:31`) and becomes 56.

<a id="r16"></a>
### R16 · Hostnames

**Decision (Suggested):** the app at `pitch-mate.co.uk` and the API at `api.pitch-mate.co.uk`. QA mirrors these with a `qa.` prefix: `qa.pitch-mate.co.uk` and `api.qa.pitch-mate.co.uk`. Being on the same site makes the cookie plan in [Q10](#q10) work.

**What follows:** PL-03 and PL-09. QA and production are also on the same site as each other, so the refresh cookie must be scoped to its own API host and never to the whole domain.

<a id="r17"></a>
### R17 · QA's database

**Decision (User):** keep it cheap while the user is the only one testing. **Decision (Suggested):** yes; it is one setting in the QA parameter file, to switch when others join.

**What follows:** PL-12. The switch happens before the test squad of [Q1](#q1) starts using QA, because the free database pauses when idle.

## New ideas from the user

Raised in round one. Two have since been decided.

| Idea | Where | State |
|---|---|---|
| Pitch-booking marketplace, taking a small cut | [01](01-vision.md#ideas), [05](05-features.md#ideas) | **Idea.** The long-term revenue idea from Q2; needs partnerships |
| Drop goalkeeper tracking from live tracking | [05](05-features.md#to-be) RE-10 | **Decided** in [R13](#r13) |
| Customisable match-day flow per squad | [05](05-features.md#to-be) MA-11 | **Intended as a Pro feature** in [R5](#r5); its options are not designed |
| Squad chat | [05](05-features.md#ideas) | **Idea.** Needs report and block for messages and users ([R10](#r10)) |
| Mini games between squad members | [05](05-features.md#ideas) | **Idea.** For example a Premier League results predictor |

## Proposed product.md changes

`product.md` is unchanged. These are the edits it would need for the decisions above to become the product rules. Each one needs the user's go-ahead.

### From decisions

| # | Section of `product.md` | Now says | Would say | From |
|---|---|---|---|---|
| 1 | Squads, roles and guests | "any number of admins, whom the owner or an admin can promote" | Add: only the owner can demote or remove an admin | Q15, R9 |
| 2 | Squads, roles and guests | "Admin-only: creating matches and selecting players, …" | Add: for each match the admin can pick a **tracker**, a registered member who may start that match and run its live tracker | R1 |
| 3 | Squads, roles and guests | Joining is by invite link; sign-up → auto-join | Add: a verified email is required before signing in, and the invite survives verification | Q9 |
| 4 | Optional features | Features are opt-in per squad by admin toggle; a squad with live tracking off still gets balancing | Add **Pro**, held per squad. Ratings are tracked in every squad. Pro unlocks auto-balancing and match-day customisation. Say how a free squad picks teams, and which tier live tracking is in | Q2, R5 |
| 5 | Match lifecycle | Roll teams "needs 10–16 players" | 4v4 to 11v11, uneven allowed | Q12, R7 |
| 6 | Match lifecycle | "Matches run about an hour, from 5v5 to 8v8" | From 4v4 to 11v11 | R7 |
| 7 | Match lifecycle, step 4 | An admin starts the match | The admin or the match's tracker starts it | R1 |
| 8 | Team balancing, Today | "proposals need 10–16 participants in 2 teams and brute-force every split. Keep-together/keep-apart constraints and the >16 heuristic … are not built" | Both become intended behaviour, with the constraints described as standing per-squad rules that are always obeyed and seen by admins only; the Today note stays until they are built | Q12, Q13, R8 |
| 9 | Match lifecycle, step 5 | "Play, then record the result (basic or rich), then complete" | Add the optional step: in a squad with score confirmation on, one team enters the score and a user on the other team confirms it; unconfirmed after 48 hours it confirms itself; a dispute goes to an admin; the admin's confirmation stands where nobody on the other side can confirm. State that a completed result is never corrected | Q11, R6 |
| 10 | Match lifecycle, States | Five states plus Cancelled | Possibly a state for "awaiting confirmation"; depends on the design of RE-08 | Q11 |
| 11 | Ratings | "σ decays back up after about 4–6 weeks inactive" | After 8 weeks without a match; decay raises σ only | R15 |
| 12 | Ratings | "(today the engine supports decay but no scheduled job runs it)" | Keep until the nightly job exists | R15 |
| 13 | Results | Rich results are goal events (scorer, conceding keeper, minute) and goalkeeper stints | Rich results are goal events (scorer, minute). Keeper stints and the conceding keeper are removed for now | R13 |
| 14 | Results | The live tracker records "own goals, keeper changes, undo the last goal" | Remove keeper changes | R13 |
| 15 | Stats and leaderboards | Rich tracking only: "goals and top scorer, clean sheets, goals conceded as keeper, keeper time" | Rich tracking only: goals and top scorer | R13 |
| 16 | Stats and leaderboards | Lists the stats | Add: every available stat is shown, including a top-scorer leaderboard | Q18 |
| 17 | Notifications | Events: match drafted, match confirmed, teams rolled, result posted, plus the squad events | Rename "teams rolled" to "teams locked" (sent at the lock with the team sheet); add match cancelled | Q16, R2 |
| 18 | Notifications | "Web MVP: email + in-app; push arrives with the mobile app" | The apps are part of the launch, so push is too | Q4, R3 |
| 19 | Web surfaces | "app shell (notifications, settings, profile)" | One account screen (name, email, avatar, password, linked sign-in methods, export, delete) in place of profile | Q17, R12 |
| 20 | Web surfaces | Describes the web only | Add the Android and iOS apps as launch clients, and the watch as the intended main tracker | Q4, Q5, R3 |
| 21 | Results, Today | "the tracker needs a connection … " | Add the intent: the phone app tracks offline, and the watch becomes the main tracker | Q5 |
| 22 | Squads, roles and guests | Deleting a squad: "with an export offered first" | Say what the export is: a small CSV of players, matches and stats | R14 |
| 23 | Visibility and privacy | "Before launch: privacy policy, terms, and a data export (DSAR) path" | Add what the user's export contains, ICO registration, and the retention rules (deleted squads purged after 30 days, expired tokens daily, logs 90 days) | Q8, R11 |

### To correct `product.md` against the code

| # | Section | Now says | The code does | Proposed |
|---|---|---|---|---|
| 24 | Results, Today | Corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | Reword the Today note to match (without the keeper part once row 14 is taken) |

### Only if the idea is adopted

None left: dropping goalkeeper tracking and the customisable match-day flow are now rows 13–15 and row 4.

### Disagreements the decisions did not settle

These rows of the as-is list in [index](index.md) still need an answer; `product.md` stays the authority on each until then.

- **OpenSkill** names an algorithm, not a dependency (the engine is an in-house PlackettLuce implementation).
- **K and C tunable per squad**: fixed at K=40, C=1000 in the code.
- **Typed-name confirmation** on squad deletion is enforced by the web only.
- **A squad in its grace period** is hidden from reads but not from match-changing actions. `product.md` is clear here, so this is treated as a Gap to fix (SQ-18), not a question.
- **"Provisional for at most 5 matches (3 at 5v5, 4–5 at 8v8)"** was worked out for 5-a-side to 8-a-side. It needs re-checking for 4v4 and 11v11 before `product.md` repeats it ([R7](#r7)).
