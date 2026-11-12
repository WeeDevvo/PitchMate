# PitchMate master spec

**Stage: to-be, draft, not yet signed off.** Each chapter has two halves that must not be confused:

- **Today (as-is)** describes what is built, taken from the code on 2026-11-11, with every Built or Partial line citing the file it comes from.
- **To be** describes what is wanted, taken from the user's answers on 2026-11-12, in two rounds: the 22 questions the as-is spec ended with (Q1–Q22), then the 17 those answers raised (R1–R17). Every line links the [decision](decisions.md) it comes from, and says whether that decision was the user's own or a suggested default they can still change.

This is step 0 of the move to spec-driven development: as-is spec → brainstorm → **to-be spec** → feature specs in `specs/features/`.

Until the to-be spec is signed off, `.claude/rules/product.md` remains the authority on product behaviour, and it has not been changed. The edits it would need are listed in [decisions](decisions.md#proposed-productmd-changes). The conventions for these files are in `.claude/rules/specs.md`.

## Chapters

| # | Chapter | What it answers |
|---|---|---|
| | [Decisions](decisions.md) | The answer to each question, its source, and the proposed `product.md` changes |
| 01 | [Vision](01-vision.md) | What PitchMate is for, and how far the code delivers the promise |
| 02 | [Roles](02-roles.md) | Visitor, member, admin, owner, guest and claimed guest; who can do what |
| 03 | [Journeys](03-journeys.md) | Sign-up and join, the match lifecycle, live tracking, stats |
| 04 | [Devices](04-devices.md) | Web is built; native apps and a watch tracker are wanted |
| 05 | [Features](05-features.md) | Every feature with an id and a status, and the requirements that close the gaps |
| 06 | [Platform](06-platform.md) | Azure, environments, CI/CD, migrations |
| 07 | [Trust](07-trust.md) | GDPR, security, accessibility |
| 08 | [Design](08-design.md) | Brand rules, the design system, `src/ui` |

## Status tags

**Built** shipped and working as described · **Partial** some of it shipped · **Gap** intended but missing · **Idea** not yet intended.

A decided requirement is tagged **Gap** until it is built. A decision does not make anything Built.

## The short version

**Built.** The core loop works end to end on the web: squads, invites, guests and claims, availability, fair two-team balancing with admin control, the team sheet, basic and live-tracked results, squad-scoped ratings, stats and leaderboards, and in-app notifications. The match state machine, the permission model and existence concealment are thorough and heavily tested.

**Wanted.** A public launch on pitch-mate.co.uk, free, after a test period on QA with one or two real squads. The launch waits for the Android and iOS apps, which are meant to be the main way people use PitchMate; live tracking moves to the phone and then to the watch, and loses goalkeeper tracking for now. Before the launch: erasure and purge that work, a nightly job, real email, verified accounts, safer token storage, policy pages and ICO registration, an account screen, and a production environment on its own domain. Also wanted, not launch-blocking: 4v4 to 11v11, standing together and apart rules, a tracker the admin picks for each match, score confirmation by the other team, every remaining stat on show, and a Pro tier per squad that unlocks auto-balancing and match-day customisation.

## Launch gate

What must be true before the public launch ([Q1](decisions.md#q1)), which waits for the native apps ([R3](decisions.md#r3)). Every item is a **Gap** today. Ids point at the To be sections of [04](04-devices.md#to-be), [05](05-features.md#to-be), [06](06-platform.md#to-be) and [07](07-trust.md#to-be).

| Area | Requirement | Ids |
|---|---|---|
| Apps | Android and iOS apps (React Native + Expo) with offline live tracking, push, Sign in with Apple and secure token storage; store accounts and a release pipeline | DV-01, DV-02, DV-03, DV-05, DV-06, DV-07, RE-06, NO-05, AC-05, SE-22, PL-13, PL-14 |
| Erasure | Account erasure reaches memberships; a real match-history check; guests can be erased | TR-06, TR-07, TR-08, GU-08 |
| Purge and retention | A nightly job purges deleted squads after 30 days and clears expired tokens; a squad in its grace period refuses changes; logs kept 90 days | PL-01, TR-12, SQ-17, SQ-18, TR-13, TR-19, PL-11 |
| Email | Real email through Azure Communication Services; no codes in logs | NO-03, TR-15, PL-07 |
| Sign-in | Verified email required; lockout after 5 failures; rate limits; Google working on the web | SE-15, AC-02, SE-13, AC-13, SE-14, AC-04 |
| Session | Refresh token in an httpOnly cookie scoped to its API host, access token in memory | SE-18, PL-09 |
| Joining | Sign-up → auto-join survives verification | SQ-07 |
| Account | One account screen: name, avatar, email change, password, linked sign-in methods, export, delete | WE-04, AC-09, AC-10, AC-11, AC-12, AC-14, AC-15, TR-09, TR-20 |
| Legal | Full user export; privacy policy and terms, solicitor-reviewed; ICO registration | TR-10, TR-14, WE-05, TR-18 |
| Production | Provisioned with its own database; `pitch-mate.co.uk` and `api.pitch-mate.co.uk`, QA on `qa.`; deploys armed only once it exists | PL-02, PL-03, PL-05 |

Wanted but not on the gate: 4v4 to 11v11 (TB-09, TB-11), the together and apart rules (TB-10), the per-match tracker (RE-09), score confirmation (RE-08), dropping keeper tracking (RE-10), "Teams locked" and cancellation notices (NO-07, NO-06), every stat (ST-08, ST-11), Pro and its features (OF-04, OF-05, MA-11), owner-only demotion and removal of admins (SQ-08, SQ-09), the once-per-admin guest acknowledgement (GU-02), the squad CSV export (SQ-15), σ decay after 8 weeks (RA-06), the Apple Watch and Wear OS trackers (DV-04, DV-09), infrastructure in CD (PL-04) and the docs refresh (PL-06).

Several of these change what the apps are built to do (match sizes, the tracker role, no keeper changes, score confirmation), so it is cheaper to settle them before the apps are designed than after, even though none blocks the launch by itself. Reporting a squad was on this gate after round one and has been dropped ([R10](decisions.md#r10)).

## What the as-is spec found, and what was decided

The twelve biggest gaps from the as-is pass, in the same order, with the decision that now covers each.

| # | Gap found | Decision |
|---|---|---|
| 1 | Account erasure does not reach squad data (TR-06 to TR-08) | Fix before launch ([Q7](decisions.md#q7)) |
| 2 | Deleted squads are never purged; no scheduled work of any kind (SQ-17, TR-12, RA-06, TR-13) | A scheduled job beside the API ([Q7](decisions.md#q7)) |
| 3 | No email leaves the system (NO-03, TR-15) | Azure Communication Services ([Q9](decisions.md#q9)) |
| 4 | No privacy policy or terms (TR-14, WE-05) | Claude drafts, a solicitor reviews ([Q8](decisions.md#q8)) |
| 5 | Production does not exist yet | Provision it; keep deploys off until then ([Q19](decisions.md#q19), [Q20](decisions.md#q20), [Q21](decisions.md#q21)) |
| 6 | Google sign-in is half-built (AC-04) | Keep the existing auth and finish it; add Apple for iOS ([A1](decisions.md#a1)) |
| 7 | The account has no screens (AC-09 to AC-12, WE-03, WE-04) | One account screen ([Q17](decisions.md#q17)) |
| 8 | Data exports are skeletal (AC-12, SQ-15, TR-10, TR-11) | A full JSON export per user ([Q8](decisions.md#q8)); a small CSV per squad ([R14](decisions.md#r14)) |
| 9 | No client beyond the connected browser | Native apps before launch; phone tracker, then watch ([Q4](decisions.md#q4), [Q5](decisions.md#q5), [R3](decisions.md#r3), [R4](decisions.md#r4)) |
| 10 | API hardening (SE-13 to SE-18) | Rate limits, verification, lockout, cookies ([Q3](decisions.md#q3), [Q9](decisions.md#q9), [Q10](decisions.md#q10)); API headers not discussed |
| 11 | Balancing limits (TB-09 to TB-12) | 4v4 to 11v11, the faster search above 16, standing rules ([Q12](decisions.md#q12), [Q13](decisions.md#q13), [R7](decisions.md#r7), [R8](decisions.md#r8)); two teams stay |
| 12 | No way to fix mistakes after the fact (RE-07, MA-09, SQ-12) | A completed result stays final, with optional score confirmation ([Q11](decisions.md#q11), [R6](decisions.md#r6)); editing a draft and renaming are not decided |

## Where the code and `product.md` disagree

`product.md` has not been edited. The proposed edits are in [decisions](decisions.md#proposed-productmd-changes).

| # | `product.md` says | The code does | Which side moves |
|---|---|---|---|
| 1 | Erasure anonymises a user's de-identified rows so matches stay valid | Only the account is anonymised; memberships are untouched | The code ([Q7](decisions.md#q7)) |
| 2 | Deleted squads are purged after the grace period | Never purged | The code ([Q7](decisions.md#q7)) |
| 3 | Live-tracker corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | `product.md`, proposed |
| 4 | Creating a guest needs a **one-time** admin acknowledgement of lawful basis | The acknowledgement is required on every guest | The code ([Q14](decisions.md#q14)) |
| 5 | Balancing and ratings use OpenSkill | An in-house PlackettLuce engine; no OpenSkill package | Not decided |
| 6 | K and C of the display rating are tunable per squad | Fixed at K=40, C=1000 | Not decided |
| 7 | Margin-of-victory and participation weights are switchable levers | The switches exist but the match outcome carries no data for them | Neither: they stay off ([Q13](decisions.md#q13)) |
| 8 | A squad in its grace period is invisible to every read but the owner's list | Reads conceal it; match-changing actions do not check | The code (SQ-18) |
| 9 | Notifications go by email and in-app | In-app works; email is written to a log | The code ([Q9](decisions.md#q9)) |
| 10 | Typed-name confirmation guards squad deletion | Only the web enforces it | Not decided |
| 11 | The owner or an admin can promote | Also true of demote and remove, including admin against admin | Both: demoting or removing an admin becomes owner-only ([Q15](decisions.md#q15), [R9](decisions.md#r9)) |
| 12 | Web surfaces include profile, and auth by Google | Profile is a placeholder; Google is not wired on the web | Both: one account screen ([Q17](decisions.md#q17)), Google finished ([A1](decisions.md#a1)) |
| 13 | (`CLAUDE.md`) Hosting is App Service and Postgres Flexible Server; CD is inert | Container Apps; QA on Supabase; CD appears to be switched on | The docs ([Q22](decisions.md#q22)) |

## Still open

Round two answered all 17 questions from round one. This is what remains, most of it raised by the new answers. Each chapter's Open questions section has the detail.

**Pro and money**

1. **How does a free squad pick teams** without auto-balancing: by hand, at random, or a limited number of balanced rolls? ([01](01-vision.md#open-questions))
2. **Is live match tracking free or Pro?** Round one said Pro; the round-two answer names auto-balancing and match-day customisation only. ([05](05-features.md#open-questions))
3. **Paying for Pro**: in the apps (about 15% to the stores) or on the web, who in the squad pays, what happens when it lapses, and when it is first sold. ([05](05-features.md#open-questions))
4. **Which match-day options exist** beyond the two examples (skip availability, track who has paid)? ([03](03-journeys.md#open-questions))

**Matches**

5. **Score confirmation, what is left**: who may enter the score; who confirms when the person entering it played on neither team; whether a live-tracked result needs confirming; whether ratings up to 48 hours stale are acceptable. ([03](03-journeys.md#open-questions))
6. **What the tracker can do beyond starting and tracking**: undo kickoff, record a basic score, and whether there can be more than one. ([02](02-roles.md#open-questions))
7. **Uneven sides**: is the 4-to-11 limit on each side or on the match (is a no-show 4v3 allowed), and how lopsided may a match be? ([05](05-features.md#open-questions))
8. **"Provisional for at most 5 matches"** needs re-checking at 4v4 and 11v11. ([05](05-features.md#open-questions))
9. **Keeper tracking**: hidden in the clients with the data kept, or removed altogether? ([05](05-features.md#open-questions))

**Apps**

10. **Is the Apple Watch app part of the launch**, or the first thing after it? ([04](04-devices.md#open-questions))
11. **Does the web keep every feature the apps have?** ([04](04-devices.md#open-questions))
12. **Do the existing mobile and watch mockups still match the decisions?** The design-system artifact has not been opened. ([08](08-design.md#open-questions))

**Trust and platform**

13. **Retention periods not yet given**: inactive accounts, inactive memberships, old notifications. ([07](07-trust.md#open-questions))
14. **The controller's details**: individual or company, and the contact address for the policy and the ICO. ([07](07-trust.md#open-questions))
15. **The account screen's full list**: notification preferences and signed-in devices are the likely additions. ([05](05-features.md#open-questions))
16. **How the nightly job reaches the code**: its own database access, or a call that wakes the API. ([06](06-platform.md#open-questions))

**An action for the user, outside the repo**

17. A production deploy was waiting for approval on 2026-11-11 with deploys armed for both environments. Under [Q21](decisions.md#q21) it should be rejected and production disarmed until it is provisioned. ([06](06-platform.md#open-questions))

**Still undecided from the as-is list:** the OpenSkill wording, K and C per squad, the typed-name check on the API, API security headers and dependency scanning, and whether Application Insights is wired or removed.

## How this was produced

**As-is (2026-11-11).** Four read-only sweeps of `backend/src`, `apps/web`, `infra/` and `.github/workflows`, then direct checks of the findings that matter most (the unwired purge and erasure handlers, the stubbed history probe, the authorisation line in every use case, the match transitions, the tracker's corrections). Every cited path and line number was checked to exist. Lines marked "not verified" or "not confirmed" in a chapter are the places where a sweep reported something that was not re-read. The design-system artifact was not opened. Live GitHub state (the deployment variable, environment secrets, workflow runs) was read with `gh` and is reported only in [06 · Platform](06-platform.md)'s Open questions, since it is not in the repo.

**To-be (2026-11-12).** The decisions were relayed from the session running the brainstorm with the user and recorded in [decisions](decisions.md) with their source. Each chapter gained a To be section and a rewritten Open questions section; the Today sections and their citations were not changed. Where a requirement follows from a decision but was not itself decided (σ decay and token clean-up sharing the scheduled job, the API moving onto the web's site for the cookie), the line says so. No code was read again for this pass beyond three checks: the lockout defaults, the list of auth endpoints, and that the Azure Communication Services sender exists.

**Round two (2026-11-12).** The answers to R1–R17 were relayed the same way and added to [decisions](decisions.md), with a note on each round-one entry they change. Four more values were read from the code: the log retention in the template, the decay-free period, the team size limits, and QA's database setting.
