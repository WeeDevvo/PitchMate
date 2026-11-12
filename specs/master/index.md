# PitchMate master spec

**Stage: to-be, draft, not yet signed off.** Each chapter has two halves that must not be confused:

- **Today (as-is)** describes what is built, taken from the code on 2026-11-11, with every Built or Partial line citing the file it comes from.
- **To be** describes what is wanted, taken from the user's answers on 2026-11-12 to the 22 questions the as-is spec ended with. Every line links the [decision](decisions.md) it comes from, and says whether that decision was the user's own or a suggested default they can still change.

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

**Wanted.** A public launch on pitch-mate.co.uk, free, after a test period on QA with one or two real squads. Native apps for Android and iOS, with live tracking moving to the phone and then the watch. Before the launch: erasure and purge that work, real email, verified accounts, safer token storage, policy pages, an account screen, and a production environment on its own domain. After those: any team size, keep-together and keep-apart, optional opposing-team confirmation of the score, every stat on show, and a gating mechanism so a Pro tier can come later.

## Launch gate

What must be true before the public launch ([Q1](decisions.md#q1)). Every item is a **Gap** today. Ids point at the To be sections of [05](05-features.md#to-be), [06](06-platform.md#to-be) and [07](07-trust.md#to-be).

| Area | Requirement | Ids |
|---|---|---|
| Erasure | Account erasure reaches memberships; a real match-history check; guests can be erased | TR-06, TR-07, TR-08, GU-08 |
| Purge | Deleted squads are purged on time, by a scheduled job; a squad in its grace period refuses changes | TR-12, SQ-17, SQ-18, PL-01 |
| Email | Real email through Azure Communication Services; no codes in logs | NO-03, TR-15, PL-07 |
| Sign-in | Verified email required; lockout after 5 failures; rate limits; Google working on the web | SE-15, AC-02, SE-13, AC-13, SE-14, AC-04 |
| Session | Refresh token in an httpOnly cookie, access token in memory | SE-18, PL-09 |
| Joining | Sign-up → auto-join survives verification | SQ-07 |
| Account | One account screen: name, email, avatar, password, export, delete | WE-04, AC-10, AC-11, AC-12, AC-14, TR-09 |
| Legal | Full user export; privacy policy and terms, solicitor-reviewed; a way to report a squad | TR-10, TR-14, WE-05, TR-17 |
| Production | Provisioned with its own database; custom domains; deploys armed only once it exists | PL-02, PL-03, PL-05 |

Wanted but not on the gate: any team size (TB-09, TB-11), constraints (TB-10), score confirmation (RE-08), entitlements (OF-04), every stat (ST-08, ST-11), cancellation notices (NO-06), owner-only demotion (SQ-08), the once-per-admin guest acknowledgement (GU-02), infrastructure in CD (PL-04) and the docs refresh (PL-06). Whether the native apps (DV-01 to DV-07) are on the gate is the first open question below.

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
| 8 | Data exports are skeletal (AC-12, SQ-15, TR-10, TR-11) | The user export is decided ([Q8](decisions.md#q8)); the squad export is not |
| 9 | No client beyond the connected browser | Native apps; phone tracker, then watch ([Q4](decisions.md#q4), [Q5](decisions.md#q5)) |
| 10 | API hardening (SE-13 to SE-18) | Rate limits, verification, lockout, cookies ([Q3](decisions.md#q3), [Q9](decisions.md#q9), [Q10](decisions.md#q10)); API headers not discussed |
| 11 | Balancing limits (TB-09 to TB-12) | Any size, the more-than-16 heuristic, constraints ([Q12](decisions.md#q12), [Q13](decisions.md#q13)); two teams stay |
| 12 | No way to fix mistakes after the fact (RE-07, MA-09, SQ-12) | A completed result stays final, with optional score confirmation ([Q11](decisions.md#q11)); editing a draft and renaming are not decided |

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
| 11 | The owner or an admin can promote | Also true of demote and remove, including admin against admin | Both: demotion becomes owner-only ([Q15](decisions.md#q15)); removal not decided |
| 12 | Web surfaces include profile, and auth by Google | Profile is a placeholder; Google is not wired on the web | Both: one account screen ([Q17](decisions.md#q17)), Google finished ([A1](decisions.md#a1)) |
| 13 | (`CLAUDE.md`) Hosting is App Service and Postgres Flexible Server; CD is inert | Container Apps; QA on Supabase; CD appears to be switched on | The docs ([Q22](decisions.md#q22)) |

## Open questions after this round

What the answers left open or raised. Each chapter's Open questions section has the detail.

**Left open in the answers**

1. Can a non-admin ever track a match? ([Q15](decisions.md#q15); [02](02-roles.md#open-questions))
2. Should "teams rolled", which fires at the lock, be renamed or moved? ([Q16](decisions.md#q16); [03](03-journeys.md#open-questions))

**Raised by the answers**

3. **Does the public launch wait for the native apps**, or does the web launch first? ([01](01-vision.md#open-questions))
4. **Which app stack?** The READMEs' React Native + Expo and SwiftUI choices came from the retired `.kiro` notes. Is a Wear OS tracker wanted? ([04](04-devices.md#open-questions))
5. **Pro tier**: held by the squad or a person? What does a squad without rating-based balancing get, and do its ratings still update? ([05](05-features.md#open-questions))
6. **Score confirmation**: who is the opposing team when the recording admin did not play; what happens on a dispute or no response; does it cover live-tracked results? ([03](03-journeys.md#open-questions))
7. **Team sizes**: a smallest and largest match? The "provisional for at most 5 matches" claim needs re-checking at other sizes. ([05](05-features.md#open-questions))
8. **Constraints**: per match or standing, hard or soft, visible to members? ([05](05-features.md#open-questions))
9. **Can an admin remove another admin**, now that only the owner demotes? ([02](02-roles.md#open-questions))
10. **Report a squad**: who can report, where it goes, who acts. There is no operator role today. ([07](07-trust.md#open-questions))
11. **The policies need facts**: who the data controller is, and how long data is kept. ([07](07-trust.md#open-questions))
12. **The account screen**: can the email be changed; do linked sign-in methods appear? ([05](05-features.md#open-questions))
13. **"Every stat" against the idea of dropping goalkeeper tracking**: which wins? ([05](05-features.md#open-questions))
14. **The squad export** contents were not covered. ([07](07-trust.md#open-questions))
15. **The scheduled job**: what it runs on, how often, and whether σ decay and token clean-up share it. ([06](06-platform.md#open-questions))
16. **Hostnames** for the API and QA, which the cookie decision depends on. ([06](06-platform.md#open-questions))
17. **Does QA stay on a database that pauses when idle** while a real squad tests on it? ([06](06-platform.md#open-questions))

**An action for the user, outside the repo**

18. A production deploy was waiting for approval on 2026-11-11 with deploys armed for both environments. Under [Q21](decisions.md#q21) it should be rejected and production disarmed until it is provisioned. ([06](06-platform.md#open-questions))

**Still undecided from the as-is list:** the OpenSkill wording, K and C per squad, and the typed-name check on the API (rows 5, 6 and 10 above).

## How this was produced

**As-is (2026-11-11).** Four read-only sweeps of `backend/src`, `apps/web`, `infra/` and `.github/workflows`, then direct checks of the findings that matter most (the unwired purge and erasure handlers, the stubbed history probe, the authorisation line in every use case, the match transitions, the tracker's corrections). Every cited path and line number was checked to exist. Lines marked "not verified" or "not confirmed" in a chapter are the places where a sweep reported something that was not re-read. The design-system artifact was not opened. Live GitHub state (the deployment variable, environment secrets, workflow runs) was read with `gh` and is reported only in [06 · Platform](06-platform.md)'s Open questions, since it is not in the repo.

**To-be (2026-11-12).** The decisions were relayed from the session running the brainstorm with the user and recorded in [decisions](decisions.md) with their source. Each chapter gained a To be section and a rewritten Open questions section; the Today sections and their citations were not changed. Where a requirement follows from a decision but was not itself decided (σ decay and token clean-up sharing the scheduled job, the API moving onto the web's site for the cookie), the line says so. No code was read again for this pass beyond three checks: the lockout defaults, the list of auth endpoints, and that the Azure Communication Services sender exists.
