# Decisions

The answers to the 22 questions the as-is spec ended with (Q1–Q22, round one) and to the 17 questions those answers raised (R1–R17, round two), both recorded on 2026-11-12; the answers to the 17 questions still open after that (T1–T17, round three), and the 7 that round left for the user (U1–U7, round four), both recorded on 2026-11-13; plus the further decisions and ideas raised along the way. Where a later answer changes an earlier decision, the earlier entry says so and the later entry is the one that stands. Each chapter's **To be** section turns these into requirements and links back here.

**Source** says where a decision came from:

- **User**: the user's own answer.
- **Suggested**: a default the user asked for and has not overridden. It stands until they change it.

A decision is not a built feature. Nothing on this page is in the code unless a chapter's **Today (as-is)** section says so. The changes these decisions imply for `.claude/rules/product.md` were approved by the user and applied on 2026-11-13; they are listed under [Proposed product.md changes](#proposed-productmd-changes) at the end, now marked Applied.

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
| [T1](#t1) | Free squads and teams | A random split the admin can then swap; balanced rolls are Pro, with one free balanced roll a month | User |
| [T2](#t2) | Live tracking's tier | Free | User |
| [T3](#t3) | Paying for Pro | Through the app stores; any member can pay; a lapse switches features off and loses no data; sold after launch | Suggested |
| [T4](#t4) | Match-day options | Availability on or off and payment tracking (score confirmation and team naming stay free, U2) | Suggested + User |
| [T5](#t5) | Score confirmation | Any player in the match or an admin enters; live-tracked results need no confirming; ratings update on confirmation | Suggested |
| [T6](#t6) | Tracker powers | Also undoes kickoff and records a basic score; one tracker at a time | Suggested |
| [T7](#t7) | Side sizes | 3 to 11 a side, the sides at most 2 players apart | Suggested |
| [T8](#t8) | Rating display | A number from the first match with a "settling" note; no badge in place of a number (formula confirmed in U1) | User |
| [T9](#t9) | Keeper data | Removed entirely: stints, clean sheets, goals conceded as keeper, keeper time | User |
| [T10](#t10) | Watch | An Apple Watch app at launch, as the main live tracker; Wear OS follows | User + Suggested |
| [T11](#t11) | Parity | The web keeps every feature except watch tracking and offline tracking; the phone app has full admin parity | User |
| [T12](#t12) | Mockups | Redone in the design-system overhaul; Higgsfield for brand imagery and promo animation only | User |
| [T13](#t13) | Retention | Inactive accounts emailed at 2 years, erased at 3; memberships kept; notifications deleted after 90 days | Suggested |
| [T14](#t14) | Controller | The user as an individual, for now | User |
| [T15](#t15) | Account screen | Adds notification preferences and signed-in devices | Suggested |
| [T16](#t16) | Nightly job | Calls a protected API endpoint | Suggested |
| [T17](#t17) | Technical leftovers | K=40 and C=1000 fixed; typed-name check on the API; security headers and Dependabot; Application Insights wired | Suggested |
| [U1](#u1) | Rating formula | round((μ − 25) × 40 + 1000) for everyone from match one; σ drives only the settling note | User |
| [U2](#u2) | What Pro is | Balanced rolls, availability on or off, payment tracking. Score confirmation and team naming are free in every squad | User |
| [U3](#u3) | Before Pro is sold | Everything is free for every squad, unlimited balanced rolls included | User |
| [U4](#u4) | The free roll | The monthly balanced roll covers one match, re-rolls included; no win % on a random split | User |
| [U5](#u5) | Web tracking | Needs a connection; offline tracking is phone and watch only | User |
| [U6](#u6) | Launch-gate additions | Keeper removal, the new rating display, the hardening items and the account-screen additions all stay on the gate | User |
| [U7](#u7) | "OpenSkill" wording | Keep the name for the rating model; say once that the engine is PitchMate's own PlackettLuce implementation | Suggested |

## Scope and launch

<a id="q1"></a>
### Q1 · What is the first launch?

**Decision (User):** a public launch on pitch-mate.co.uk, after testing on QA with the user's own squad and perhaps one more.

**What follows:** every launch-blocking gap in the as-is spec becomes a requirement, and the QA environment has to be good enough for a real squad to use (which needs real email, see Q9). The launch gate is listed in [index](index.md#launch-gate).

<a id="q2"></a>
### Q2 · Is there a business model?

**Decision (User):** free at first. Build a feature-gating mechanism so that **live match tracking** and **rating-based auto-balancing** can later be locked behind a Pro tier. Long-term revenue idea: a pitch-booking marketplace taking a small cut, in the way Playtomic does for padel. That needs partnerships, so it is an Idea, not near-term.

**What follows:** an entitlement check, enforced by the API, that sits alongside the per-squad admin toggle ([05](05-features.md#to-be) OF-04). At launch every squad is entitled to everything, so nothing changes for users.

**Refined by [R5](#r5):** Pro is per squad at about £1–2 a month, ratings are always tracked, and the Pro features are named as auto-balancing and match-day customisation.

**Changed by [T2](#t2):** live match tracking is free, so it is no longer a feature to gate. [T1](#t1) says what a free squad gets in place of auto-balancing, and [T3](#t3) how Pro is paid for.

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

**Changed by [T10](#t10):** the Apple Watch app is part of the launch, not something that follows it.

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

**Refined by [R6](#r6):** how confirmation works, the 48-hour auto-confirm and disputes. **And by [T5](#t5):** who enters the score, and that a live-tracked result needs no confirming. It stays a setting any squad can turn on, free ([U2](#u2)).

**What follows:** RE-07 is decided against. A new opposing-team confirmation feature (RE-08) and, with it, a step between "result recorded" and "completed". Rating replay (RA-11) no longer has a job.

<a id="q12"></a>
### Q12 · Is 10–16 players in two teams the right envelope?

**Decision (User):** no. Any team-v-team size, uneven allowed (9v9 and 7v6 are the examples given).

**Refined by [R7](#r7):** the range is 4v4 to 11v11. **And by [T7](#t7):** 3 to 11 a side, the sides at most 2 apart.

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

**Refined by [R12](#r12):** the email can be changed, and sign-in methods are linked and unlinked there. **And by [T15](#t15):** notification preferences and signed-in devices are added.

**What follows:** WE-04, AC-10, AC-11, AC-12 and TR-09. Avatars need somewhere to be stored ([06](06-platform.md#to-be) PL-08).

<a id="q18"></a>
### Q18 · Which stats and leaderboards come next?

**Decision (User):** show every available stat, presented usefully.

**Limited by [R13](#r13):** keeper-only stats are dropped with keeper tracking, and [T9](#t9) removes their data.

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

**Refined by [T6](#t6):** what else the tracker can do, and that there is one at a time.

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

**Refined by [T10](#t10):** the Apple Watch app ships at launch; Wear OS still follows.

<a id="r5"></a>
### R5 · The Pro tier

**Decision (User):**

- Pro is per squad, at about £1–2 a month, so that it is barely noticed when split between the players.
- Ratings are always tracked, in every squad.
- Pro unlocks auto-balancing and the match-day customisation options.
- The aim is a free app useful enough that squads want to upgrade.
- The app stores take about 15% of subscriptions.

**What follows:** OF-04 is per squad, and gating never stops a rating update. The customisable match-day flow moves from an idea to an intended Pro feature (MA-11), though its options are not designed. Round one named live match tracking as a Pro feature and this answer does not mention it; [T2](#t2) settles that it is free. [T1](#t1) says how a free squad picks teams, [T3](#t3) how a squad pays, and [T4](#t4) which match-day options exist.

<a id="r6"></a>
### R6 · How score confirmation works

**Decision (User):** as on Playtomic: someone on one team enters the score and a user on the other team confirms it. A separate job auto-confirms results left unconfirmed after a day or two.

**Decision (Suggested):** auto-confirm after 48 hours. A dispute goes to an admin to decide.

**What follows:** RE-08 gains the 48-hour auto-confirm (run by the nightly job, PL-01) and the dispute path. Ratings for that match update when the result becomes final, which can be up to 48 hours after the match.

**Refined by [T5](#t5).**

<a id="r7"></a>
### R7 · Smallest and largest match

**Decision (User):** 4v4 to 11v11, with uneven sides allowed because people really do fail to turn up. The ranking should handle uneven sides as well as it can.

**Refined by [T7](#t7):** a side can be as small as 3, and the sides may differ by 2 at most.

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

**What follows:** TR-18 (ICO registration), TR-12 and TR-13 (both in the nightly job), PL-11 (log retention; the template sets 30 days today, `infra/main.bicep:104`). No period was given for inactive accounts, inactive memberships or old notifications; [T13](#t13) gives them, and [T14](#t14) says the controller is the user as an individual.

<a id="r12"></a>
### R12 · The account screen

**Decision (User):** an email can be changed, and the account screen should have the features most similar apps offer, in line with GDPR.

**Decision (Suggested):** re-verify the new email and notify the old one; link and unlink Google and Apple sign-in from the screen.

**What follows:** AC-15 (change email) and AC-09 (linked sign-in methods, which has an API and no UI today).

<a id="r13"></a>
### R13 · Every stat, or drop keeper tracking?

**Decision (User):** drop keeper tracking for now. That wins over "every stat", so the keeper-only stats go.

**What follows:** RE-10. The tracker loses keeper changes; clean sheets, goals conceded as keeper and keeper time leave the stats screens. "Every available stat" ([Q18](#q18)) now means every stat except those.

**Strengthened by [T9](#t9):** not hidden "for now" but removed, data included.

<a id="r14"></a>
### R14 · The squad export

The user is not sure it is needed.

**Decision (Suggested):** keep a small CSV of players, matches and stats, because `product.md` offers an export before a squad is deleted.

**What follows:** SQ-15 changes from today's JSON of memberships, invites and features.

<a id="r15"></a>
### R15 · The scheduled job

**Decision (Suggested):** one Azure Functions timer, run nightly, covering the squad purge, erasure, score auto-confirm, token clean-up and σ decay. Start decay after 8 weeks without a match, not the 4–6 weeks in `product.md`.

The user's point behind the last part: matches are weekly at best, so ratings must not decay quickly. Decay only raises σ; it never lowers μ.

**Refined by [T16](#t16):** the timer does not run the work itself; it calls a protected API endpoint.

**What follows:** PL-01 and RA-06. The code's decay-free period is 42 days (`backend/src/PitchMate.Domain/Rating/RatingEngineConfig.cs:31`) and becomes 56.

<a id="r16"></a>
### R16 · Hostnames

**Decision (Suggested):** the app at `pitch-mate.co.uk` and the API at `api.pitch-mate.co.uk`. QA mirrors these with a `qa.` prefix: `qa.pitch-mate.co.uk` and `api.qa.pitch-mate.co.uk`. Being on the same site makes the cookie plan in [Q10](#q10) work.

**What follows:** PL-03 and PL-09. QA and production are also on the same site as each other, so the refresh cookie must be scoped to its own API host and never to the whole domain.

<a id="r17"></a>
### R17 · QA's database

**Decision (User):** keep it cheap while the user is the only one testing. **Decision (Suggested):** yes; it is one setting in the QA parameter file, to switch when others join.

**What follows:** PL-12. The switch happens before the test squad of [Q1](#q1) starts using QA, because the free database pauses when idle.

## Round three

The 16 questions still open in [index](index.md) after round two (T1–T16), plus the as-is technical leftovers (T17), answered on 2026-11-13. "Suggested" here means the user took the default they were offered.

<a id="t1"></a>
### T1 · How does a free squad pick teams?

**Decision (User):** a free squad gets a **random split**, and players can then be swapped between the teams. Balanced rolls, the ones that use the ratings, are Pro. A free squad gets **one balanced roll a month** as a taster; squads play about four matches a month.

**What follows:** TB-13 and TB-14 in [05](05-features.md#to-be). Ratings are still tracked for every squad ([R5](#r5)), so the taster roll has real ratings to work with. Settled afterwards: the roll covers one match and a random split shows no win % ([U4](#u4)), and everything is free until Pro is on sale ([U3](#u3)).

<a id="t2"></a>
### T2 · Is live match tracking free or Pro?

**Decision (User):** free. It stays an optional feature the admin turns on, as today.

**What follows:** this reverses the part of [Q2](#q2) that named live tracking as a feature to gate. OF-04 covers balanced rolls and the match-day options only.

<a id="t3"></a>
### T3 · Paying for Pro

**Decision (Suggested):**

- Pro is sold through the app stores.
- Any member can pay for the squad.
- When Pro lapses its features switch off, and no data is lost.
- Selling starts after launch.

**What follows:** OF-05. Being store-only, Pro cannot be bought on the web, though a squad that has it gets it on every client. A lapse has to leave the squad coherent: saved together and apart rules and match-day settings are kept but stop applying, and matches already in progress finish under the rules they started with (this last part is not decided). The entitlement check (OF-04) is not needed at launch, since nothing is sold then; [Q2](#q2)'s "every squad is entitled to everything at launch" still holds, confirmed in [U3](#u3).

<a id="t4"></a>
### T4 · Which match-day options exist?

**Decision (Suggested):** four: availability on or off, payment tracking, score confirmation, and team naming.

**Changed by [U2](#u2):** score confirmation and team naming are not Pro match-day options. Both stay free in every squad: score confirmation as a setting any squad can turn on ([Q11](#q11), [R6](#r6)), team names and the silly-name generator as they are built today. The Pro match-day options are the other two.

**What follows:** MA-11 has two options: availability on or off, and payment tracking.

<a id="t5"></a>
### T5 · Score confirmation, what was left

**Decision (Suggested):**

- Any player in the match, or an admin, enters the score.
- If the person who entered it played on neither side, anyone in the match confirms it.
- A live-tracked result needs no confirmation.
- Ratings update on confirmation.

**What follows:** RE-08. "Player" means a registered player in the kickoff lineup, since a guest cannot sign in. The match's tracker ([T6](#t6)) can also enter a basic score and is treated like an admin who did not play. Ratings can still be up to 48 hours behind for a basic result; a tracked result updates them at once.

<a id="t6"></a>
### T6 · What the tracker can do

**Decision (Suggested):** besides starting the match and running the live tracker, the tracker can undo kickoff and record a basic score. There is one tracker at a time.

**What follows:** RO-07 and RE-09. Picking a new tracker replaces the old one.

<a id="t7"></a>
### T7 · Uneven sides

**Decision (Suggested):** 3 to 11 players a side, and the two sides differ by 2 players at most.

**What follows:** TB-09. The smallest match is 3v3 (6 players) and the largest 11v11 (22); a no-show 4v3 is allowed and a 7v4 is not. This lowers the floor [R7](#r7) set at 4v4: 4v4 to 11v11 is what a squad plans, 3 a side is what it may end up with.

<a id="t8"></a>
### T8 · New players and the provisional badge

**Decision (User):** a new player must not sit behind a provisional badge for about five weeks (a squad plays once a week at most). Show a rating **from the first match**, with a visible note that ratings take a few matches to settle. Balancing still uses μ and σ through `Predict`.

The user asked for a proposal on the number itself, because the conservative figure (μ − 3σ) is very low while σ is high.

**Decision (User), the proposal, accepted in [U1](#u1):**

- **One formula for everyone: display rating = round((μ − 25) × 40 + 1000)**, floored as today. It is μ on a friendlier scale, anchored on the seeding tiers: a new Beginner shows 800, Average 1000, Strong 1200, and the number then moves with results.
- **σ no longer changes the number. It only drives the note.** While σ is above the provisional threshold (8.19, unchanged) the rating carries a visible "settling" mark and a line saying ratings take a few matches to settle. When σ drops below it, the mark goes and the number does not jump.
- **K and C stay fixed at 40 and 1000** ([T17](#t17)). C becomes the number an Average player starts on.
- **Leaderboards rank everyone** and show the settling mark beside the number, so a newcomer on a lucky start is read as such.
- **The progression chart plots every point as a number**, with settling points marked, in place of the "~" band.

Why not keep μ − 3σ once a player has settled: the two formulas differ by 3σ × 40, about 980 points at the threshold, so the number would fall off a cliff on the day the note disappears. And under μ − 3σ a rating climbs simply by turning up, because σ falls with every match; the same Average player shows 1000 on day one and about 1400 once σ reaches 5, without getting any better. A μ-based number says how good the ratings think a player is; the settling mark says how sure they are.

**What follows:** RA-13, which replaces the display half of RA-03 and RA-08, and ST-12. The cost is honest volatility: μ moves fastest in a player's first matches, so a settling number swings more than a settled one. The formula is decided and is in `product.md` (row 26 under [Proposed product.md changes](#proposed-productmd-changes)).

<a id="t9"></a>
### T9 · Keeper tracking: hide or remove?

**Decision (User):** remove keeper data entirely: keeper stints, clean sheets, goals conceded as keeper, and keeper time.

**What follows:** RE-10 becomes a removal, not a hidden feature:

- **Domain and events.** The keeper stint events and the stint type go (`backend/src/PitchMate.Domain/LiveTracking/KeeperStintStartedEvent.cs`, `backend/src/PitchMate.Domain/LiveTracking/KeeperStintRetractedEvent.cs`, `backend/src/PitchMate.Domain/LiveTracking/KeeperStint.cs`), along with the conceding keeper on a goal and the keeper parts of the rich statistics (`backend/src/PitchMate.Domain/LiveTracking/MatchRichStatistics.cs`).
- **Stored data.** A migration deletes the stored keeper events and drops the keeper columns from the match event table (`backend/src/PitchMate.Infrastructure/Persistence/Configurations/LiveTracking/MatchEventConfiguration.cs`). It cannot be reversed. Only QA holds data today, so nothing public is lost; it is cheapest done before launch.
- **The append-only rule.** `product.md` and the Rules in [03](03-journeys.md) say the event log is append-only and nothing is discarded. This migration is a one-off exception to that, and should be written down as one.
- **Undo kickoff** counts "anything recorded"; after the removal that no longer includes keeper changes.
- **The contract.** The live-tracking and stats responses lose their keeper fields, so the OpenAPI document and the generated client change, and every client with them. Old clients sending keeper events must be refused cleanly.
- **Clients.** The web tracker loses the keeper control and the stats screens the keeper lines; the apps and the watch are built without them.

<a id="t10"></a>
### T10 · Is the watch part of the launch?

**Decision (User):** yes, a watch app at launch, Apple Watch at minimum. The watch is the main live tracker.

**Decision (Suggested):** Wear OS follows the launch. It is a second native codebase (Kotlin, not SwiftUI) for a smaller group of users, and an Android user still has the phone tracker on day one.

**What follows:** DV-04 joins the [launch gate](index.md#launch-gate); DV-09 stays after it. The phone tracker is still built, first, because the watch needs its tracking logic, its offline outbox and a paired phone, and because it is the only tracker an Android user has at launch. The build order becomes: phone apps with the phone tracker, then the Apple Watch tracker, then launch, then Wear OS. This changes [Q5](#q5) and [R4](#r4), which had the watch after the launch.

<a id="t11"></a>
### T11 · Does the web keep every feature?

**Decision (User):** the web keeps every feature except watch tracking and offline tracking ([U5](#u5)). Admins must also be able to do everything in the phone app, so there is full admin parity on mobile.

**What follows:** DV-10. Nothing may be built for the web alone or for the apps alone, apart from what a device cannot do (the watch tracker, offline tracking, push, store purchases). The web tracker needs a connection, as it does today.

<a id="t12"></a>
### T12 · Do the mockups still match?

**Decision (User):** the app mockups are redone in the design-system overhaul. That work runs on Fable, using the Higgsfield API where it fits: brand imagery and promo animation, not tokens or vector icons.

**What follows:** the existing mobile and watch mockups are not build targets; the redone ones are ([08](08-design.md#to-be)). Tokens stay generated from `tokens.json` and icons stay vector. Higgsfield is an outside service, so only brand material goes to it, never squad or player data.

<a id="t13"></a>
### T13 · The missing retention periods

**Decision (Suggested):**

- An inactive account is emailed at 2 years and erased at 3.
- Memberships are kept, anonymised.
- Notifications are deleted after 90 days.

**What follows:** TR-21 and TR-22, both run by the nightly job. "Inactive" needs a definition (no sign-in is the obvious one), and erasing an account follows the existing rule: memberships with match history are anonymised and kept, so matches and ratings stay valid. An inactive membership of an account that is still active keeps its name, as it does today when someone leaves a squad.

<a id="t14"></a>
### T14 · The controller's details

**Decision (User):** the data controller is the user as an individual, for now.

**What follows:** TR-14 and TR-18. An individual's ICO entry shows their address, so a company or a business address can be swapped in later to keep a home address off the public register. The policy and the registration are written so that the controller can be changed without rewriting them.

<a id="t15"></a>
### T15 · The account screen's full list

**Decision (Suggested):** add notification preferences and signed-in devices to the account screen.

**What follows:** NO-04 and AC-16. With push arriving at launch, preferences cover three channels: in-app, email and push.

<a id="t16"></a>
### T16 · How the nightly job reaches the code

**Decision (Suggested):** the nightly job calls a protected API endpoint.

**What follows:** PL-01 and SE-26. The timer holds no database secret and runs no PitchMate code; it wakes the API, which does the work. The endpoint must be callable by the job alone, must be safe to call twice, and must finish within one request or hand back a "more to do" answer the timer can repeat. This changes the reasoning in [Q7](#q7) and [R15](#r15), which wanted the job not to depend on the API being awake.

<a id="t17"></a>
### T17 · The technical leftovers from the as-is list

**Decision (Suggested):**

- The display rating is fixed at K=40, C=1000 for now. No per-squad setting is built (RA-09).
- The typed-name check on squad deletion is enforced by the API (SQ-14, SE-20). Today only the web enforces it.
- Add security headers to the API (SE-17) and Dependabot for dependency updates (SE-21).
- Wire up Application Insights (PL-15); the resource is not removed.

**What follows:** the four rows above. With [T8](#t8), K and C keep their values and C changes meaning. The fifth leftover, that "OpenSkill" names an algorithm and not a package, is settled in [U7](#u7).

<a id="what-round-three-contradicts"></a>
### What round three contradicts

Places where a round-three answer disagrees with an earlier decision, with `product.md`, or with the code. The later answer has been followed in each case. The four that were open after round three were settled in round four, and the user accepted the readings in rows 10 and 14.

| # | Answer | Disagrees with | How it is recorded |
|---|---|---|---|
| 1 | [T4](#t4): score confirmation is a match-day option, and those are Pro | [Q11](#q11), [R6](#r6): a squad setting, with no tier | Settled by [U2](#u2): score confirmation stays free, so there is no conflict |
| 2 | [T4](#t4): team naming is a match-day option | Team names and the silly-name generator are built and free (`backend/src/PitchMate.Application/Matches/Abstractions/ISillyNameGenerator.cs`), and `product.md` puts naming in every squad's flow | Settled by [U2](#u2): team naming stays free, so there is no conflict |
| 3 | [T2](#t2): live tracking is free | [Q2](#q2): live tracking named as a feature to gate | T2 stands |
| 4 | [T7](#t7): 3 a side | [R7](#r7): 4v4 at the smallest | T7 stands; 4v4 to 11v11 is the planned range |
| 5 | [T9](#t9): keeper data removed | [R13](#r13) "for now"; the append-only event log rule in `product.md` | T9 stands, as a one-off exception to append-only |
| 6 | [T10](#t10): watch at launch | [Q5](#q5), [R4](#r4): phone first, the watch following | T10 stands; the launch gets bigger |
| 7 | [T16](#t16): the job calls the API | [Q7](#q7), [R15](#r15): a job that does not need the API awake | T16 stands |
| 8 | [T8](#t8): a number from the first match | `product.md`: provisional players show "a badge or ~ band instead of a number", and the formula is (μ − 3σ) × K + C | Proposed `product.md` change |
| 9 | [T17](#t17): K and C fixed | `product.md`: "K and C tunable per squad" | Proposed `product.md` change |
| 10 | [T17](#t17): "keep" the typed-name check on the API | The API does not have one; only the web checks | Read as "add it to the API"; reading accepted |
| 11 | [T3](#t3): any member can pay for Pro | `product.md`: toggling a squad's optional features is admin-only | Both hold: a member can pay, an admin still chooses what is switched on |
| 12 | [T1](#t1), [T3](#t3): balanced rolls are Pro, and Pro is sold after launch | [Q2](#q2): at launch every squad is entitled to everything | Settled by [U3](#u3): everything is free until Pro is on sale |
| 13 | [T11](#t11): the web keeps every feature | [Q5](#q5): offline tracking is delivered in the phone app, not the web | Settled by [U5](#u5): the web tracker needs a connection |
| 14 | [T13](#t13): memberships kept "anonymised" | A member who leaves keeps their name on the inactive membership today | Read as: anonymised when the account is erased; reading accepted |

## Round four

The seven questions round three left for the user, answered on 2026-11-13 with "all fine" to the defaults put to them, plus three readings confirmed. Nothing in the spec is waiting on the user after this round.

<a id="u1"></a>
### U1 · The rating display formula

**Decision (User):** yes to the [T8](#t8) proposal. Display rating = round((μ − 25) × 40 + 1000) for everyone from their first match. New players start on 800, 1000 or 1200 by tier. σ drives only the "settling" note. Balancing still uses μ and σ through `Predict`.

**What follows:** RA-13 and ST-12 are decided, not proposed.

<a id="u2"></a>
### U2 · Are score confirmation and team naming Pro?

**Decision (User):** no. Both stay free in every squad. Pro is balanced rolls, plus two match-day options: availability on or off, and payment tracking.

**What follows:** this changes [T4](#t4). MA-11 has two options; RE-08 is a squad setting again; team names and the silly-name generator stay as built.

<a id="u3"></a>
### U3 · What is free before Pro goes on sale?

**Decision (User):** everything, for every squad, unlimited balanced rolls included.

**What follows:** OF-04. The random split and the monthly taster (TB-13, TB-14) only start to apply when Pro is first sold, which is after the launch ([T3](#t3)).

<a id="u4"></a>
### U4 · The free roll's small print

**Decision (User):** the free monthly balanced roll covers one match, so re-rolls within that match are free. A free squad does not see the predicted win % on a random split.

**What follows:** TB-13 and TB-14. The fairness meter is part of a balanced roll, so a free squad sees it on its taster match and a Pro squad on every match. A calendar month is assumed.

<a id="u5"></a>
### U5 · Does the web tracker work offline?

**Decision (User):** no. Web tracking needs a connection; offline tracking is for the phone and the watch.

**What follows:** [T11](#t11) reads "the web keeps every feature except watch tracking and offline tracking". RE-06 and DV-10.

<a id="u6"></a>
### U6 · The launch-gate rows this spec added

**Decision (User):** keep them all: keeper removal, the new rating display, the hardening items (security headers, Dependabot, the typed-name check, Application Insights) and the two account-screen additions.

**What follows:** the [launch gate](index.md#launch-gate) stands as written.

<a id="u7"></a>
### U7 · The "OpenSkill" wording

The user left this to Claude.

**Decision (Suggested):** keep "OpenSkill" as the name of the rating model, since that is what `product.md`, the skills and the conversation all call it and its `Predict` is the measure the balancer is defined by. Say once, in `product.md` and in `CLAUDE.md`, that the engine is PitchMate's own PlackettLuce implementation of that model and that no OpenSkill package is used. No code changes.

**What follows:** a row under [Proposed product.md changes](#proposed-productmd-changes); the `CLAUDE.md` line goes with the docs refresh (PL-06).

### Readings and defaults accepted

- Wear OS follows the launch ([T10](#t10)).
- "Keep the typed-name check on the API" means add it ([T17](#t17)).
- Memberships are anonymised when the account is erased ([T13](#t13)).
- The defaults assumed for the feature specs stand: the watch signs in and syncs through the paired phone; "inactive" means no sign-in; the together and apart rules act only on balanced rolls.

## New ideas from the user

Raised in round one. Two have since been decided.

| Idea | Where | State |
|---|---|---|
| Pitch-booking marketplace, taking a small cut | [01](01-vision.md#ideas), [05](05-features.md#ideas) | **Idea.** The long-term revenue idea from Q2; needs partnerships |
| Drop goalkeeper tracking from live tracking | [05](05-features.md#to-be) RE-10 | **Decided** in [R13](#r13); [T9](#t9) removes the data too |
| Customisable match-day flow per squad | [05](05-features.md#to-be) MA-11 | **A Pro feature** ([R5](#r5)) with two options ([T4](#t4), [U2](#u2)) |
| Squad chat | [05](05-features.md#ideas) | **Idea.** Needs report and block for messages and users ([R10](#r10)) |
| Mini games between squad members | [05](05-features.md#ideas) | **Idea.** For example a Premier League results predictor |

## Proposed product.md changes

**Applied on 2026-11-13.** The user approved all 30 rows, plus the two decisions recorded in rows 10 and 31, and `.claude/rules/product.md` was edited to match. The heading keeps its name so that links to it still work. Every rule that is not built yet carries a **Today** note in `product.md`, so applying a row did not make anything Built.

### From decisions

| # | Section of `product.md` | Now says | Would say | From |
|---|---|---|---|---|
| 1 | Squads, roles and guests | "any number of admins, whom the owner or an admin can promote" | Add: only the owner can demote or remove an admin | Q15, R9 |
| 2 | Squads, roles and guests | "Admin-only: creating matches and selecting players, …" | Add: for each match the admin can pick a **tracker**, a registered member who may start that match and run its live tracker | R1 |
| 3 | Squads, roles and guests | Joining is by invite link; sign-up → auto-join | Add: a verified email is required before signing in, and the invite survives verification | Q9 |
| 4 | Optional features | Features are opt-in per squad by admin toggle; a squad with live tracking off still gets balancing | Add **Pro**, held per squad and bought through the app stores by any member. Ratings are tracked in every squad. Live tracking stays free. A free squad gets a random split it can then swap, plus one balanced roll a month; Pro gives balanced rolls every time and two match-day options (availability on or off, payment tracking). Score confirmation and team naming are free. Until Pro is on sale every squad gets everything. A lapse switches Pro features off and loses no data | Q2, R5, T1–T4, U2–U4 |
| 5 | Match lifecycle | Roll teams "needs 10–16 players" | 3 to 11 a side, the sides at most 2 apart (6 to 22 players) | Q12, R7, T7 |
| 6 | Match lifecycle | "Matches run about an hour, from 5v5 to 8v8" | From 4v4 to 11v11, and down to 3 a side when people do not turn up | R7, T7 |
| 7 | Match lifecycle, steps 4 and 5 | An admin starts the match, undoes kickoff and records the result | The admin or the match's tracker does; there is one tracker at a time | R1, T6 |
| 8 | Team balancing, Today | "proposals need 10–16 participants in 2 teams and brute-force every split. Keep-together/keep-apart constraints and the >16 heuristic … are not built" | Both become intended behaviour, with the constraints described as standing per-squad rules that are always obeyed and seen by admins only; the Today note stays until they are built | Q12, Q13, R8 |
| 9 | Match lifecycle, step 5 | "Play, then record the result (basic or rich), then complete" | Add the optional step: in a squad with score confirmation on, any player in the match or an admin enters a basic score and a user on the other team confirms it (anyone in the match, if the person entering it played on neither side); unconfirmed after 48 hours it confirms itself; a dispute goes to an admin; the admin's confirmation stands where nobody on the other side can confirm. A live-tracked result needs no confirmation. Ratings update on confirmation. State that a completed result is never corrected | Q11, R6, T5 |
| 10 | Match lifecycle, States | Five states plus Cancelled | Add `AwaitingConfirmation`, between InProgress and Completed, for a basic result that has been entered and not yet confirmed. It applies only when score confirmation is on and the result was not live-tracked. A dispute is decided by an admin from this state; there is no separate disputed state | Q11, user 2026-11-13 |
| 11 | Ratings | "σ decays back up after about 4–6 weeks inactive" | After 8 weeks without a match; decay raises σ only | R15 |
| 12 | Ratings | "(today the engine supports decay but no scheduled job runs it)" | Keep until the nightly job exists | R15 |
| 13 | Results | Rich results are goal events (scorer, conceding keeper, minute) and goalkeeper stints | Rich results are goal events (scorer, minute). Keeper stints and the conceding keeper are removed, with their stored data | R13, T9 |
| 14 | Results | The live tracker records "own goals, keeper changes, undo the last goal" | Remove keeper changes | R13, T9 |
| 15 | Stats and leaderboards | Rich tracking only: "goals and top scorer, clean sheets, goals conceded as keeper, keeper time" | Rich tracking only: goals and top scorer | R13, T9 |
| 16 | Stats and leaderboards | Lists the stats | Add: every available stat is shown, including a top-scorer leaderboard | Q18 |
| 17 | Notifications | Events: match drafted, match confirmed, teams rolled, result posted, plus the squad events | Rename "teams rolled" to "teams locked" (sent at the lock with the team sheet); add match cancelled | Q16, R2 |
| 18 | Notifications | "Web MVP: email + in-app; push arrives with the mobile app" | The apps are part of the launch, so push is too | Q4, R3 |
| 19 | Web surfaces | "app shell (notifications, settings, profile)" | One account screen (name, email, avatar, password, linked sign-in methods, notification preferences, signed-in devices, export, delete) in place of profile | Q17, R12, T15 |
| 20 | Web surfaces | Describes the web only | Add the Android and iOS apps and the Apple Watch tracker as launch clients, the watch being the main live tracker and Wear OS following. The web keeps every feature except watch tracking, and the phone app does everything an admin can do | Q4, Q5, R3, T10, T11 |
| 21 | Results, Today | "the tracker needs a connection … " | Add the intent: the phone app tracks offline, and the watch is the main tracker from launch | Q5, T10 |
| 22 | Squads, roles and guests | Deleting a squad: "with an export offered first" | Say what the export is: a small CSV of players, matches and stats | R14 |
| 23 | Visibility and privacy | "Before launch: privacy policy, terms, and a data export (DSAR) path" | Add what the user's export contains, ICO registration with the user as controller, and the retention rules (deleted squads purged after 30 days, expired tokens daily, logs and notifications 90 days, inactive accounts emailed at 2 years and erased at 3) | Q8, R11, T13, T14 |
| 25 | Ratings | "provisional until σ ≤ 8.19 … The badge drops while σ is still high" | Keep the threshold, change what it means on screen: every player shows a number from their first match, and a rating above the threshold carries a visible "settling" note in place of hiding the number | T8 |
| 26 | Ratings (formula confirmed, U1) | "Display rating = round((μ − 3σ) × K + C), floored, with K and C tunable per squad (e.g. K=40, C=1000). Provisional players show a badge or "~" band instead of a number" | Display rating = round((μ − 25) × K + C), floored, with K=40 and C=1000 fixed. A new Beginner, Average or Strong player starts on 800, 1000 or 1200. Settling players show the same number with a note that ratings take a few matches to settle. Still presentational only | T8, T17 |
| 27 | Stats and leaderboards | "provisional points are plotted at their estimate and shown only as the "~" band" | Every point is plotted as a number; settling points are marked | T8 |
| 28 | Match lifecycle, step 4 | "roll teams (needs 10–16 players): the balancer proposes" | Once Pro is on sale: in a free squad the roll is a random split the admin then swaps, with no win %, except for one match a month that gets balanced rolls; in a Pro squad the balancer proposes | T1, U4 |
| 29 | Results | "the event log is append-only, so nothing is discarded" | Unchanged as a rule; note the one-off removal of keeper events | T9 |
| 30 | Team balancing, Ratings | "OpenSkill's `Predict`" | Keep the name; add once that the engine is PitchMate's own PlackettLuce implementation of the OpenSkill model, with no OpenSkill package | U7 |
| 31 | Ratings, Stats, throughout | "provisional" | **"Settling"**, as the one term for a rating above the σ threshold. The rename should carry through the code and the UI copy (for example `RatingEngineConfig.ProvisionalThreshold` and the web's "~ Provisional" badge). No code is changed here; the code rename is a follow-up feature-spec item, and `product.md` carries a Today note until it is done | user 2026-11-13 |

### To correct `product.md` against the code

| # | Section | Now says | The code does | Proposed |
|---|---|---|---|---|
| 24 | Results, Today | Corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | Reword the Today note to match (without the keeper part once row 14 is taken) |

### Only if the idea is adopted

None left: dropping goalkeeper tracking and the customisable match-day flow are now rows 13–15 and row 4.

### Disagreements the decisions did not settle

All five are now settled; the list is kept as a record.

- **OpenSkill** names an algorithm, not a dependency: settled by [U7](#u7) (row 30).
- **K and C tunable per squad**: settled by [T17](#t17), fixed; `product.md` moves (row 26).
- **Typed-name confirmation** on squad deletion: settled by [T17](#t17); the code moves (SQ-14).
- **A squad in its grace period** is hidden from reads but not from match-changing actions. `product.md` is clear here, so this is a Gap to fix (SQ-18), and `product.md` now has a Today note for it.
- **"Provisional for at most 5 matches (3 at 5v5, 4–5 at 8v8)"** was worked out for 5-a-side to 8-a-side. With [T8](#t8) it now says how long the settling note lasts. `product.md` keeps the claim and says it is not yet checked for 3-a-side or 11-a-side; a `/balance-simulation` run settles it ([T7](#t7)).
