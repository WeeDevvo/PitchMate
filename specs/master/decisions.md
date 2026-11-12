# Decisions

The answers to the 22 questions the as-is spec ended with, recorded on 2026-11-12, plus the further decisions and ideas raised in the same round. Each chapter's **To be** section turns these into requirements and links back here.

**Source** says where a decision came from:

- **User**: the user's own answer.
- **Suggested**: a default the user asked for and has not overridden. It stands until they change it.

A decision is not a built feature. Nothing on this page is in the code unless a chapter's **Today (as-is)** section says so. `.claude/rules/product.md` has not been edited; the changes these decisions imply are listed under [Proposed product.md changes](#proposed-productmd-changes) at the end.

## Summary

| Q | Topic | Decision in one line | Source |
|---|---|---|---|
| [Q1](#q1) | Launch | Public launch, after testing on QA with the user's own squad and perhaps one more | User |
| [Q2](#q2) | Business model | Free first; build feature gating so a Pro tier can come later; pitch booking is a long-term idea | User |
| [Q3](#q3) | Trust model | Trust stays within a squad; rate limits, verified email and squad reporting between squads | Suggested |
| [Q4](#q4) | Devices | Native apps for Android and iOS | User |
| [Q5](#q5) | Live tracker | Phone first; the watch becomes the main way to track | User |
| [Q6](#q6) | Polling | Fine for now | User |
| [Q7](#q7) | Erasure and purge | Fix before public launch; run from a scheduled timer job beside the API | Suggested |
| [Q8](#q8) | Export and legal | Full JSON export per user; Claude drafts policy and terms, a solicitor reviews | Suggested |
| [Q9](#q9) | Email and sign-in | Azure Communication Services; verified email required; lockout after 5 failures for 15 minutes | Suggested |
| [Q10](#q10) | Tokens | Web: refresh token in an httpOnly cookie, access token in memory. Native: Keychain and Keystore | Suggested |
| [Q11](#q11) | Result correction | None once confirmed; optional opposing-team confirmation of the score | User |
| [Q12](#q12) | Team sizes | Any team-v-team size, uneven allowed; the more-than-16 heuristic becomes a requirement | User |
| [Q13](#q13) | Balancing options | Build keep-together and keep-apart; margin and participation levers stay off | Suggested |
| [Q14](#q14) | Guest consent | Keep the acknowledgement, once per admin | Suggested |
| [Q15](#q15) | Admin powers | Owner promotes and demotes; admins promote only. Non-admin tracking still open | User (part open) |
| [Q16](#q16) | Notifications | Notify members of cancellations. The "teams rolled" wording still open | User (part open) |
| [Q17](#q17) | Account screen | One account screen: name, email, avatar, plus password, export and delete | User + Suggested |
| [Q18](#q18) | Stats | Show every available stat, presented usefully | User |
| [Q19](#q19) | Database | Postgres Flexible Server, burstable, 7-day point-in-time restore; geo-redundant backup with paying users | Suggested |
| [Q20](#q20) | Domain and CD | Wire pitch-mate.co.uk before launch, QA on `qa.`; infra through CD with what-if and approval | Suggested |
| [Q21](#q21) | Production deploys | Off until production is provisioned, then armed behind approval | Suggested |
| [Q22](#q22) | Docs | Refresh `CLAUDE.md` and the READMEs; drop the `.kiro` references | User |
| [A1](#a1) | Auth provider | Keep the existing .NET auth, not Firebase; add Sign in with Apple for iOS | Suggested |

## Scope and launch

<a id="q1"></a>
### Q1 · What is the first launch?

**Decision (User):** a public launch on pitch-mate.co.uk, after testing on QA with the user's own squad and perhaps one more.

**What follows:** every launch-blocking gap in the as-is spec becomes a requirement, and the QA environment has to be good enough for a real squad to use (which needs real email, see Q9). The launch gate is listed in [index](index.md#launch-gate).

<a id="q2"></a>
### Q2 · Is there a business model?

**Decision (User):** free at first. Build a feature-gating mechanism so that **live match tracking** and **rating-based auto-balancing** can later be locked behind a Pro tier. Long-term revenue idea: a pitch-booking marketplace taking a small cut, in the way Playtomic does for padel. That needs partnerships, so it is an Idea, not near-term.

**What follows:** an entitlement check, enforced by the API, that sits alongside the per-squad admin toggle ([05](05-features.md#to-be) OF-04). At launch every squad is entitled to everything, so nothing changes for users. No payment, pricing or billing is decided.

<a id="q3"></a>
### Q3 · How far beyond a group of friends should the trust model stretch?

**Decision (Suggested):** trust stays within a squad: members keep seeing each other's ratings and admins keep adding anyone. Between squads and towards strangers, add rate limits, a required verified email, and a way to report a squad.

**What follows:** SE-14 (rate limiting), SE-15 (verified email, see Q9) and a new report-a-squad requirement ([07](07-trust.md#to-be) TR-17).

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

**What follows:** TR-06, TR-07, TR-08, TR-12 and SQ-17 become launch requirements, and the platform gains a scheduled job ([06](06-platform.md#to-be) PL-01). The same job is the natural home for the two other pieces of scheduled work the as-is spec found missing, σ decay (RA-06) and expired-token clean-up (TR-13); those were not part of the question, so they are listed as following from it rather than as decided.

<a id="q8"></a>
### Q8 · What goes in a data export, and who writes the policy and terms?

**Decision (Suggested):** a JSON export of everything held about a user: account, memberships, matches, rating history and stats. Claude drafts the privacy policy and the terms; a solicitor reviews both before launch.

**What follows:** AC-12 and TR-10 (the export), TR-14 and WE-05 (the pages). What a **squad** export should contain (SQ-15, TR-11) was not decided.

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

**What follows:** RE-07 is decided against. A new opposing-team confirmation feature (RE-08) and, with it, a step between "result recorded" and "completed". Rating replay (RA-11) no longer has a job.

<a id="q12"></a>
### Q12 · Is 10–16 players in two teams the right envelope?

**Decision (User):** no. Any team-v-team size, uneven allowed (9v9 and 7v6 are the examples given).

**What follows:** the 10–16 roll limit and the 5–8-a-side lock limit go (TB-09). Because every split cannot be tried above 16 players, the more-than-16 heuristic (TB-11) becomes a requirement. The format stays two teams; three-team and winner-stays-on formats remain an Idea (TB-12).

<a id="q13"></a>
### Q13 · Keep-together, keep-apart and the rating levers?

**Decision (Suggested):** build keep-together and keep-apart constraints. Keep the margin-of-victory and participation levers off.

**What follows:** TB-10 becomes a requirement. RA-07 stays as it is: the switches remain, off, and no work is done to feed them.

<a id="q14"></a>
### Q14 · Guest lawful-basis acknowledgement: once or every time?

**Decision (Suggested):** keep the acknowledgement, once per admin. The user thought it might not be needed at all; the suggestion is to keep it, because it is the UK GDPR cover for storing a profile of someone who has no account and has agreed to nothing.

**What follows:** GU-02 changes from "every guest" to "once per admin".

<a id="q15"></a>
### Q15 · Can admins demote and remove each other? Can a non-admin track?

**Decision (User):** the owner promotes and demotes admins. Admins can promote only.

**Still open:** whether a non-admin can ever track a match, and whether an admin may **remove** another admin (the answer covered demotion, and removal has the same effect).

**What follows:** demotion becomes owner-only ([02](02-roles.md#to-be) RO-01).

<a id="q16"></a>
### Q16 · Cancellation notices, and what "teams rolled" announces

**Decision (User):** yes, notify members when a match is cancelled.

**Still open:** whether the "teams rolled" notification, which fires at the lock, should be renamed or moved.

**What follows:** NO-06.

<a id="q17"></a>
### Q17 · What belongs on the profile and account screens?

**Decision (User):** profile and account are one account screen, showing name, email and avatar.

**Decision (Suggested):** password, data export and delete-account go on the same screen.

**What follows:** WE-04, AC-10, AC-11, AC-12 and TR-09. Avatars need somewhere to be stored ([06](06-platform.md#to-be) PL-08).

<a id="q18"></a>
### Q18 · Which stats and leaderboards come next?

**Decision (User):** show every available stat, presented usefully.

**What follows:** ST-08 and ST-11. "Available" is read as "already computed or computable from stored data"; it does not by itself add new data to collect.

## Platform

<a id="q19"></a>
### Q19 · What is production's database?

**Decision (Suggested):** Postgres Flexible Server on a burstable tier with 7-day point-in-time restore. Add geo-redundant backup once there are paying users.

**What follows:** this is what the template already declares for production, so the requirement is to provision it ([06](06-platform.md#to-be) PL-02). QA staying on the external Supabase database was not discussed and is left as it is.

<a id="q20"></a>
### Q20 · Custom domain, and infrastructure in CD?

**Decision (Suggested):** wire pitch-mate.co.uk before launch, with QA on a `qa.` subdomain. Infrastructure deploys go through CD with a what-if preview and a manual approval.

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

**Decision (Suggested):** no. Keep the existing .NET auth. Email and password, Google token verification, rotating refresh tokens and account erasure are already built and tested, and moving would mean migrating accounts and adding a second place that holds personal data. Apple requires Sign in with Apple in an iOS app that offers Google sign-in, so that is added for the iOS app (AC-05).

**What follows:** [07](07-trust.md#to-be) SE-23.

## New ideas from the user

Recorded as **Idea** lines in the chapters named. None is decided.

| Idea | Where | Note |
|---|---|---|
| Pitch-booking marketplace, taking a small cut | [01](01-vision.md#ideas), [05](05-features.md#ideas) | The long-term revenue idea from Q2; needs partnerships |
| Drop goalkeeper tracking from live tracking | [03](03-journeys.md#ideas), [05](05-features.md#ideas) | The user has used it and finds it adds nothing for now. Conflicts with `product.md`; see below |
| Customisable match-day flow per squad | [03](03-journeys.md#ideas), [05](05-features.md#ideas) | From "pick a day, invite, record the result" up to availability and payment tracking |
| Squad chat | [05](05-features.md#ideas) | To replace the WhatsApp or Messenger group |
| Mini games between squad members | [05](05-features.md#ideas) | For example a Premier League results predictor |

## Proposed product.md changes

`product.md` is unchanged. These are the edits it would need for the decisions above to become the product rules. Each one needs the user's go-ahead.

### From decisions

| # | Section of `product.md` | Now says | Would say | From |
|---|---|---|---|---|
| 1 | Squads, roles and guests | "any number of admins, whom the owner or an admin can promote" | Add: only the owner can demote an admin | Q15 |
| 2 | Squads, roles and guests | Joining is by invite link; sign-up → auto-join | Add: a verified email is required before signing in, and the invite survives verification | Q9 |
| 3 | Optional features | Features are opt-in per squad by admin toggle; a squad with live tracking off still gets balancing | Add an entitlement layer: a feature can be available to a squad or not (free at launch, Pro later), separate from the admin toggle. Say what a squad without rating-based balancing gets | Q2 |
| 4 | Match lifecycle | Roll teams "needs 10–16 players" | Any number of players that makes two teams, uneven allowed | Q12 |
| 5 | Match lifecycle | "Matches run about an hour, from 5v5 to 8v8" | Any team-v-team size | Q12 |
| 6 | Team balancing, Today | "proposals need 10–16 participants in 2 teams and brute-force every split. Keep-together/keep-apart constraints and the >16 heuristic … are not built" | Both become intended behaviour; the Today note stays until they are built | Q12, Q13 |
| 7 | Match lifecycle, step 5 | "Play, then record the result (basic or rich), then complete" | Add the optional step: in a squad with score confirmation on, a player from the opposing team confirms the score before the match completes; the admin's confirmation stands where no such player exists. State that a completed result is never corrected | Q11 |
| 8 | Match lifecycle, States | Five states plus Cancelled | Possibly a state for "awaiting confirmation"; depends on the design of Q11 | Q11 |
| 9 | Notifications | Events: match drafted, match confirmed, teams rolled, result posted, plus the squad events | Add: match cancelled | Q16 |
| 10 | Notifications | "Web MVP: email + in-app; push arrives with the mobile app" | Unchanged in meaning; name the native apps as launch-track clients | Q4 |
| 11 | Web surfaces | "app shell (notifications, settings, profile)" | One account screen (name, email, avatar, password, export, delete) in place of profile | Q17 |
| 12 | Results, Today | "the tracker needs a connection … " | Add the intent: the phone app tracks offline, and the watch becomes the main tracker | Q5 |
| 13 | Stats and leaderboards | Lists the stats | Add: every available stat is shown, including rich-stat leaderboards | Q18 |
| 14 | Visibility and privacy | "Before launch: privacy policy, terms, and a data export (DSAR) path" | Add what the export contains, and a way to report a squad | Q3, Q8 |

### To correct `product.md` against the code

| # | Section | Now says | The code does | Proposed |
|---|---|---|---|---|
| 15 | Results, Today | Corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | Reword the Today note to match |

### Only if the idea is adopted

| # | Section | Change | Idea |
|---|---|---|---|
| 16 | Results; Stats and leaderboards | Remove goalkeeper stints and the conceding keeper from rich results, and with them clean sheets, goals conceded as keeper and keeper time. Stored stints from past matches would need a decision (keep and hide, or drop) | Drop goalkeeper tracking |
| 17 | Match lifecycle | Make availability, and other steps, optional per squad | Customisable match-day flow |

### Disagreements the decisions did not settle

These rows of the as-is list in [index](index.md) still need an answer; `product.md` stays the authority on each until then.

- **OpenSkill** names an algorithm, not a dependency (the engine is an in-house PlackettLuce implementation).
- **K and C tunable per squad**: fixed at K=40, C=1000 in the code.
- **Typed-name confirmation** on squad deletion is enforced by the web only.
- **A squad in its grace period** is hidden from reads but not from match-changing actions. `product.md` is clear here, so this is treated as a Gap to fix (SQ-18), not a question.
