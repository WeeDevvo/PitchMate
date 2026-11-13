# PitchMate master spec

**Stage: to-be, every question answered, not yet signed off.** Each chapter has two halves that must not be confused:

- **Today (as-is)** describes what is built, taken from the code on 2026-11-11, with every Built or Partial line citing the file it comes from.
- **To be** describes what is wanted, taken from the user's answers in three rounds: the 22 questions the as-is spec ended with (Q1–Q22) and the 17 those answers raised (R1–R17), both on 2026-11-12, then the 17 still open after that (T1–T17) and the last 7 (U1–U7) on 2026-11-13. Every line links the [decision](decisions.md) it comes from, and says whether that decision was the user's own or a suggested default they can still change.

This is step 0 of the move to spec-driven development: as-is spec → brainstorm → **to-be spec** → feature specs in `specs/features/`.

Until the to-be spec is signed off, `.claude/rules/product.md` remains the authority on product behaviour, and it has not been changed. The edits it would need are listed in [decisions](decisions.md#proposed-productmd-changes). The conventions for these files are in `.claude/rules/specs.md`.

## Chapters

| # | Chapter | What it answers |
|---|---|---|
| | [Decisions](decisions.md) | The answer to each question, its source, and the proposed `product.md` changes |
| 01 | [Vision](01-vision.md) | What PitchMate is for, and how far the code delivers the promise |
| 02 | [Roles](02-roles.md) | Visitor, member, admin, owner, guest and claimed guest; who can do what |
| 03 | [Journeys](03-journeys.md) | Sign-up and join, the match lifecycle, live tracking, stats |
| 04 | [Devices](04-devices.md) | Web is built; native apps and an Apple Watch tracker are wanted for launch |
| 05 | [Features](05-features.md) | Every feature with an id and a status, and the requirements that close the gaps |
| 06 | [Platform](06-platform.md) | Azure, environments, CI/CD, migrations |
| 07 | [Trust](07-trust.md) | GDPR, security, accessibility |
| 08 | [Design](08-design.md) | Brand rules, the design system, `src/ui` |

## Status tags

**Built** shipped and working as described · **Partial** some of it shipped · **Gap** intended but missing · **Idea** not yet intended.

A decided requirement is tagged **Gap** until it is built. A decision does not make anything Built.

## The short version

**Built.** The core loop works end to end on the web: squads, invites, guests and claims, availability, fair two-team balancing with admin control, the team sheet, basic and live-tracked results, squad-scoped ratings, stats and leaderboards, and in-app notifications. The match state machine, the permission model and existence concealment are thorough and heavily tested.

**Wanted.** A public launch on pitch-mate.co.uk, free, after a test period on QA with one or two real squads. The launch waits for the Android and iOS apps, which are meant to be the main way people use PitchMate, and for an Apple Watch app, which is the main live tracker. The web keeps every feature except watch tracking and offline tracking. Before the launch: erasure and purge that work, a nightly job, real email, verified accounts, safer token storage, policy pages and ICO registration, an account screen, a rating shown from a player's first match, keeper tracking removed, and a production environment on its own domain. Also wanted, not launch-blocking: 3 to 11 a side, standing together and apart rules, a tracker the admin picks for each match, every remaining stat on show, and, sold after the launch, a Pro tier per squad that gives balanced rolls every time, availability on or off and payment tracking. Until Pro is on sale everything is free; after that a free squad gets a random split and one balanced match a month. Score confirmation, team naming and live tracking are free throughout.

## Launch gate

What must be true before the public launch ([Q1](decisions.md#q1)), which waits for the native apps ([R3](decisions.md#r3)) and the Apple Watch app ([T10](decisions.md#t10)). Every item is a **Gap** today. Ids point at the To be sections of [04](04-devices.md#to-be), [05](05-features.md#to-be), [06](06-platform.md#to-be) and [07](07-trust.md#to-be).

| Area | Requirement | Ids |
|---|---|---|
| Apps | Android and iOS apps (React Native + Expo) with full admin parity, offline live tracking, push, Sign in with Apple and secure token storage; store accounts and a release pipeline | DV-01, DV-02, DV-03, DV-05, DV-06, DV-07, DV-10, RE-06, NO-05, AC-05, SE-22, PL-13, PL-14 |
| Watch | An Apple Watch app (SwiftUI) as the main live tracker | DV-04 |
| Tracking and ratings | Keeper tracking removed, data included; a rating number from the first match with a settling note | RE-10, TR-23, RA-13, ST-12 |
| Erasure | Account erasure reaches memberships; a real match-history check; guests can be erased | TR-06, TR-07, TR-08, GU-08 |
| Purge and retention | A nightly job, calling a protected API endpoint, purges deleted squads after 30 days, clears expired tokens and deletes notifications after 90 days; a squad in its grace period refuses changes; logs kept 90 days | PL-01, SE-26, TR-12, SQ-17, SQ-18, TR-13, TR-19, TR-22, PL-11 |
| Email | Real email through Azure Communication Services; no codes in logs | NO-03, TR-15, PL-07 |
| Sign-in | Verified email required; lockout after 5 failures; rate limits; Google working on the web | SE-15, AC-02, SE-13, AC-13, SE-14, AC-04 |
| Session | Refresh token in an httpOnly cookie scoped to its API host, access token in memory | SE-18, PL-09 |
| Joining | Sign-up → auto-join survives verification | SQ-07 |
| Account | One account screen: name, avatar, email change, password, linked sign-in methods, notification preferences, signed-in devices, export, delete | WE-04, AC-09, AC-10, AC-11, AC-12, AC-14, AC-15, AC-16, NO-04, SE-28, TR-09, TR-20 |
| Legal | Full user export; privacy policy and terms, solicitor-reviewed; ICO registration as an individual | TR-10, TR-14, WE-05, TR-18 |
| Hardening | Security headers, Dependabot, the typed-name check on the API, Application Insights wired | SE-17, SE-21, SE-20, SQ-14, PL-15 |
| Production | Provisioned with its own database; `pitch-mate.co.uk` and `api.pitch-mate.co.uk`, QA on `qa.`; deploys armed only once it exists | PL-02, PL-03, PL-05 |

Three rows were added to the gate by this spec's reading and then confirmed by the user ([U6](decisions.md#u6)): **Tracking and ratings**, **Hardening**, and the two additions to **Account**.

Wanted but not on the gate: 3 to 11 a side (TB-09, TB-11), the together and apart rules (TB-10), the per-match tracker (RE-09), score confirmation (RE-08), "Teams locked" and cancellation notices (NO-07, NO-06), every stat (ST-08, ST-11), owner-only demotion and removal of admins (SQ-08, SQ-09), the once-per-admin guest acknowledgement (GU-02), the squad CSV export (SQ-15), σ decay after 8 weeks (RA-06), erasing inactive accounts at 3 years (TR-21), infrastructure in CD (PL-04) and the docs refresh (PL-06).

After the launch: Pro and everything sold with it (OF-04, OF-05, TB-13, TB-14, MA-11, PL-16, SE-27), and the Wear OS tracker (DV-09).

Match sizes and the tracker role change what the apps and the watch are built to do, so they are cheaper to settle before those are designed, even though neither blocks the launch by itself. Reporting a squad was on this gate after round one and has been dropped ([R10](decisions.md#r10)).

## What the as-is spec found, and what was decided

The twelve biggest gaps from the as-is pass, in the same order, with the decision that now covers each.

| # | Gap found | Decision |
|---|---|---|
| 1 | Account erasure does not reach squad data (TR-06 to TR-08) | Fix before launch ([Q7](decisions.md#q7)) |
| 2 | Deleted squads are never purged; no scheduled work of any kind (SQ-17, TR-12, RA-06, TR-13) | A nightly timer that calls a protected API endpoint ([Q7](decisions.md#q7), [R15](decisions.md#r15), [T16](decisions.md#t16)) |
| 3 | No email leaves the system (NO-03, TR-15) | Azure Communication Services ([Q9](decisions.md#q9)) |
| 4 | No privacy policy or terms (TR-14, WE-05) | Claude drafts, a solicitor reviews ([Q8](decisions.md#q8)) |
| 5 | Production does not exist yet | Provision it; keep deploys off until then ([Q19](decisions.md#q19), [Q20](decisions.md#q20), [Q21](decisions.md#q21)) |
| 6 | Google sign-in is half-built (AC-04) | Keep the existing auth and finish it; add Apple for iOS ([A1](decisions.md#a1)) |
| 7 | The account has no screens (AC-09 to AC-12, WE-03, WE-04) | One account screen ([Q17](decisions.md#q17), [R12](decisions.md#r12), [T15](decisions.md#t15)) |
| 8 | Data exports are skeletal (AC-12, SQ-15, TR-10, TR-11) | A full JSON export per user ([Q8](decisions.md#q8)); a small CSV per squad ([R14](decisions.md#r14)) |
| 9 | No client beyond the connected browser | Native apps and an Apple Watch tracker before launch; Wear OS after ([Q4](decisions.md#q4), [Q5](decisions.md#q5), [R3](decisions.md#r3), [R4](decisions.md#r4), [T10](decisions.md#t10)) |
| 10 | API hardening (SE-13 to SE-18) | Rate limits, verification, lockout, cookies, security headers and Dependabot ([Q3](decisions.md#q3), [Q9](decisions.md#q9), [Q10](decisions.md#q10), [T17](decisions.md#t17)) |
| 11 | Balancing limits (TB-09 to TB-12) | 3 to 11 a side, the faster search above 16, standing rules ([Q12](decisions.md#q12), [Q13](decisions.md#q13), [R7](decisions.md#r7), [R8](decisions.md#r8), [T7](decisions.md#t7)); two teams stay |
| 12 | No way to fix mistakes after the fact (RE-07, MA-09, SQ-12) | A completed result stays final, with optional score confirmation ([Q11](decisions.md#q11), [R6](decisions.md#r6), [T5](decisions.md#t5)); editing a draft and renaming are not decided |

## Where the code and `product.md` disagree

`product.md` has not been edited. The proposed edits are in [decisions](decisions.md#proposed-productmd-changes).

| # | `product.md` says | The code does | Which side moves |
|---|---|---|---|
| 1 | Erasure anonymises a user's de-identified rows so matches stay valid | Only the account is anonymised; memberships are untouched | The code ([Q7](decisions.md#q7)) |
| 2 | Deleted squads are purged after the grace period | Never purged | The code ([Q7](decisions.md#q7)) |
| 3 | Live-tracker corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | `product.md`, proposed |
| 4 | Creating a guest needs a **one-time** admin acknowledgement of lawful basis | The acknowledgement is required on every guest | The code ([Q14](decisions.md#q14)) |
| 5 | Balancing and ratings use OpenSkill | An in-house PlackettLuce engine; no OpenSkill package | `product.md`: keep the name, say once that the engine is PitchMate's own implementation ([U7](decisions.md#u7)) |
| 6 | K and C of the display rating are tunable per squad | Fixed at K=40, C=1000 | `product.md`: they stay fixed ([T17](decisions.md#t17)) |
| 7 | Margin-of-victory and participation weights are switchable levers | The switches exist but the match outcome carries no data for them | Neither: they stay off ([Q13](decisions.md#q13)) |
| 8 | A squad in its grace period is invisible to every read but the owner's list | Reads conceal it; match-changing actions do not check | The code (SQ-18) |
| 9 | Notifications go by email and in-app | In-app works; email is written to a log | The code ([Q9](decisions.md#q9)) |
| 10 | Typed-name confirmation guards squad deletion | Only the web enforces it | The code: the API enforces it too ([T17](decisions.md#t17)) |
| 11 | The owner or an admin can promote | Also true of demote and remove, including admin against admin | Both: demoting or removing an admin becomes owner-only ([Q15](decisions.md#q15), [R9](decisions.md#r9)) |
| 12 | Web surfaces include profile, and auth by Google | Profile is a placeholder; Google is not wired on the web | Both: one account screen ([Q17](decisions.md#q17)), Google finished ([A1](decisions.md#a1)) |
| 14 | Provisional players show a badge or "~" band instead of a number; display rating is (μ − 3σ) × K + C | Exactly that | Both: a number from the first match with a settling note, on a μ-based formula ([T8](decisions.md#t8)) |
| 15 | Rich results include goalkeeper stints; keeper stats are listed | Built | Both: keeper tracking and its data are removed ([T9](decisions.md#t9)) |
| 13 | (`CLAUDE.md`) Hosting is App Service and Postgres Flexible Server; CD is inert | Container Apps; QA on Supabase; CD appears to be switched on | The docs ([Q22](decisions.md#q22)) |

## Still open

**Nothing is waiting on the user.** Round four answered the seven questions round three left ([U1–U7](decisions.md#round-four)), and every conflict in [what round three contradicts](decisions.md#what-round-three-contradicts) is settled.

**Decided in round four**

| # | Question | Decided |
|---|---|---|
| 1 | The rating display formula | **Decided**: round((μ − 25) × 40 + 1000) for everyone from match one ([U1](decisions.md#u1)) |
| 2 | Are score confirmation and team naming Pro? | **Decided**: no, both free ([U2](decisions.md#u2)) |
| 3 | What is free before Pro goes on sale? | **Decided**: everything ([U3](decisions.md#u3)) |
| 4 | The free roll's small print | **Decided**: one match a month, re-rolls included; no win % on a random split ([U4](decisions.md#u4)) |
| 5 | Does the web tracker work offline? | **Decided**: no, phone and watch only ([U5](decisions.md#u5)) |
| 6 | The launch-gate rows this spec added | **Decided**: all stay ([U6](decisions.md#u6)) |
| 7 | The "OpenSkill" wording | **Decided**: keep the name, state the implementation once ([U7](decisions.md#u7)) |

**Before sign-off**

1. **`product.md` is unedited.** The 30 [proposed changes](decisions.md#proposed-productmd-changes) are proposals until the user approves them; `product.md` stays the authority until then.
2. **A production deploy was waiting for approval** on 2026-11-11 with deploys armed for both environments. Under [Q21](decisions.md#q21) it should be rejected and production disarmed until it is provisioned. An action for the user in GitHub. ([06](06-platform.md#open-questions))

**Left for the feature specs**, each with a default the user accepted or a check to run

3. The watch signs in and syncs through the paired phone. ([04](04-devices.md#open-questions))
4. "Inactive" means no sign-in for the 2- and 3-year rule. ([07](07-trust.md#open-questions))
5. The together and apart rules act only on balanced rolls. ([05](05-features.md#to-be) TB-10)
6. How long the settling note lasts at 3-a-side and 11-a-side: a `/balance-simulation` check. ([05](05-features.md#open-questions))
7. The smaller questions in each chapter's Open questions section: none blocks the launch gate or needs an answer before feature specs are cut.

## How this was produced

**As-is (2026-11-11).** Four read-only sweeps of `backend/src`, `apps/web`, `infra/` and `.github/workflows`, then direct checks of the findings that matter most (the unwired purge and erasure handlers, the stubbed history probe, the authorisation line in every use case, the match transitions, the tracker's corrections). Every cited path and line number was checked to exist. Lines marked "not verified" or "not confirmed" in a chapter are the places where a sweep reported something that was not re-read. The design-system artifact was not opened. Live GitHub state (the deployment variable, environment secrets, workflow runs) was read with `gh` and is reported only in [06 · Platform](06-platform.md)'s Open questions, since it is not in the repo.

**To-be (2026-11-12).** The decisions were relayed from the session running the brainstorm with the user and recorded in [decisions](decisions.md) with their source. Each chapter gained a To be section and a rewritten Open questions section; the Today sections and their citations were not changed. Where a requirement follows from a decision but was not itself decided (σ decay and token clean-up sharing the scheduled job, the API moving onto the web's site for the cookie), the line says so. No code was read again for this pass beyond three checks: the lockout defaults, the list of auth endpoints, and that the Azure Communication Services sender exists.

**Round two (2026-11-12).** The answers to R1–R17 were relayed the same way and added to [decisions](decisions.md), with a note on each round-one entry they change. Four more values were read from the code: the log retention in the template, the decay-free period, the team size limits, and QA's database setting.

**Round three (2026-11-13).** The answers to T1–T17 were relayed the same way. Read from the code for this pass: the rating defaults (μ 25, σ 25/3, the 8.19 threshold) and the display calculator, for the [T8](decisions.md#t8) proposal; and the files that hold keeper data, for [T9](decisions.md#t9). The keeper file list comes from a search for the word, not a line-by-line read, so the feature spec should re-check it. The design-system artifact is still unopened.

**Round four (2026-11-13).** The user answered the seven remaining questions and accepted the readings and defaults; they are recorded as U1–U7 in [decisions](decisions.md#round-four). No code was read.
