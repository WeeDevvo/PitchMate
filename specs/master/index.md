# PitchMate master spec

**Stage: as-is.** This describes what is built today, taken from the code on 2026-11-11, with every Built or Partial line citing the file it comes from. It is step 0 of the move to spec-driven development: as-is spec → brainstorm → to-be spec → feature specs in `specs/features/`.

Until the to-be spec is signed off, `.claude/rules/product.md` remains the authority on product behaviour. Where the code and `product.md` disagree, the disagreement is listed under the affected chapter's Open questions and collected at the end of this page; `product.md` has not been changed. The conventions for these files are in `.claude/rules/specs.md`.

## Chapters

| # | Chapter | What it answers |
|---|---|---|
| 01 | [Vision](01-vision.md) | What PitchMate is for, and how far the code delivers the promise |
| 02 | [Roles](02-roles.md) | Visitor, member, admin, owner, guest and claimed guest; who can do what |
| 03 | [Journeys](03-journeys.md) | Sign-up and join, the match lifecycle, live tracking, stats |
| 04 | [Devices](04-devices.md) | Web is built; mobile and watch are placeholders |
| 05 | [Features](05-features.md) | Every feature with an id and a status |
| 06 | [Platform](06-platform.md) | Azure, environments, CI/CD, migrations |
| 07 | [Trust](07-trust.md) | GDPR, security, accessibility |
| 08 | [Design](08-design.md) | Brand rules, the design system, `src/ui` |

## Status tags

**Built** shipped and working as described · **Partial** some of it shipped · **Gap** intended but missing · **Idea** not yet intended.

## The short version

The core loop is built end to end on the web: squads, invites, guests and claims, availability, fair two-team balancing with admin control, the team sheet, basic and live-tracked results, squad-scoped ratings, stats and leaderboards, and in-app notifications. The match state machine, the permission model and existence concealment are thorough and heavily tested.

What is thin is everything around the loop: the things that only matter once real people depend on it (erasure, purge, policies, email, production), the account's own screens, and any client other than a browser with a connection.

## Biggest gaps

Ordered by how much they block a real launch. Ids refer to rows in [05 · Features](05-features.md), [07 · Trust](07-trust.md) and sections of [06 · Platform](06-platform.md).

1. **Account erasure does not reach squad data** (TR-06, TR-07, TR-08). The account is anonymised but every squad membership keeps the person's display name; the cascade exists and is never called, and the match-history check that would protect completed matches is a stub.
2. **Deleted squads are never purged** (SQ-17, TR-12). The UI promises a 30-day window; nothing runs the purge. More broadly, **there is no scheduled work of any kind**, which also leaves σ decay (RA-06) and token clean-up (TR-13) undone.
3. **No email leaves the system** (NO-03, TR-15). The cloud runs the Console transport, so verification, password reset and notification emails go to the API log, reset codes included.
4. **No privacy policy or terms** (TR-14, WE-05), and the pages linked from sign-up lead to "not found".
5. **Production does not exist yet** ([06](06-platform.md)). QA is deployable; production has a parameter file but no provisioning, no custom domain, no alerts, and Application Insights is provisioned but unused. The docs still describe App Service and an inert CD.
6. **Google sign-in is half-built** (AC-04): the API verifies tokens, the web button is a stub, the client id is a placeholder.
7. **The account has no screens** (AC-09 to AC-12, WE-03, WE-04): no profile, no linked sign-in methods, no delete-my-account, no data export, although the API has endpoints for all four.
8. **Data exports are skeletal** (AC-12, SQ-15, TR-10, TR-11): neither the user export nor the squad export includes matches, results or ratings.
9. **No client beyond the connected browser** ([04](04-devices.md)): no mobile app, no watch app, no installable or offline web app, no push. The live tracker loses unsent events on reload (RE-06).
10. **API hardening** (SE-13 to SE-18): no rate limiting, lockout and verified-email both off, a minimal CSP alongside tokens in `localStorage`, no API security headers.
11. **Balancing limits** (TB-09 to TB-12): exactly two teams and 10–16 players; no keep-together or keep-apart; nothing below 5-a-side.
12. **No way to fix mistakes after the fact** (RE-07, MA-09, SQ-12): a completed result, a draft's details, a squad's name and a member's display name cannot be changed.

## Where the code and `product.md` disagree

`product.md` has not been edited. Each of these needs a decision on which side moves.

| # | `product.md` says | The code does | Chapter |
|---|---|---|---|
| 1 | Erasure anonymises a user's de-identified rows so matches stay valid | Only the account is anonymised; memberships are untouched | [07](07-trust.md) |
| 2 | Deleted squads are purged after the grace period | Never purged | [07](07-trust.md) |
| 3 | Live-tracker corrections "go no further than undoing the last goal" | The tracker can also change a scorer and remove any goal or keeper change | [03](03-journeys.md) |
| 4 | Creating a guest needs a **one-time** admin acknowledgement of lawful basis | The acknowledgement is required on every guest | [05](05-features.md) |
| 5 | Balancing and ratings use OpenSkill | An in-house PlackettLuce engine; no OpenSkill package | [05](05-features.md) |
| 6 | K and C of the display rating are tunable per squad | Fixed at K=40, C=1000 | [05](05-features.md) |
| 7 | Margin-of-victory and participation weights are switchable levers | The switches exist but the match outcome carries no data for them | [05](05-features.md) |
| 8 | A squad in its grace period is invisible to every read but the owner's list | Reads conceal it; match-changing actions do not check | [05](05-features.md) |
| 9 | Notifications go by email and in-app | In-app works; email is written to a log | [05](05-features.md) |
| 10 | Typed-name confirmation guards squad deletion | Only the web enforces it | [07](07-trust.md) |
| 11 | The owner or an admin can promote | Also true of demote and remove, including admin against admin, which `product.md` does not mention | [02](02-roles.md) |
| 12 | Web surfaces include profile, and auth by Google | Profile is a placeholder; Google is not wired on the web | [05](05-features.md) |
| 13 | (`CLAUDE.md`) Hosting is App Service and Postgres Flexible Server; CD is inert | Container Apps; QA on Supabase; CD appears to be switched on | [06](06-platform.md) |

## Questions for the brainstorm

The decisions that shape the to-be spec. Each chapter's Open questions section has the detail.

**Scope and launch**

1. What is the first launch: a private beta for one squad, or a public launch on pitch-mate.co.uk? Most of the gap list is launch-blocking for the second and optional for the first.
2. Is there a business model, or is this free to run at hobby scale?
3. How far beyond a small group of friends should the trust model stretch?

**Devices**

4. Native apps for launch, or an installable, offline-capable web app first?
5. Is the watch still the intended live tracker, or does a phone-first tracker come first?
6. Is polling (20 seconds for scores, 60 for notifications) good enough until then?

**Trust (decide before real users)**

7. Fix erasure and purge now? Where does scheduled work run, given the API scales to zero?
8. What goes in a data export, and who writes the privacy policy and terms?
9. Real email provider for launch (ACS or SendGrid are both implemented)? Require verified email? Turn lockout on?
10. Tokens in `localStorage` with a tighter CSP, or a move to cookies?

**Product rules**

11. Should a completed result be correctable (which gives rating replay a job)?
12. Is 10–16 players in two teams the right envelope, or are 4-a-side, 17+ and three-team formats wanted?
13. Are keep-together and keep-apart still wanted? Are the margin and participation levers?
14. Once per admin or every time for the guest lawful-basis acknowledgement?
15. Can admins demote and remove each other? Should a non-admin ever track a match?
16. Should members hear about cancellations, and should "teams rolled" announce the lock?
17. What belongs on the profile and account screens?
18. Which fun stats and leaderboards come next (top scorer, current form, head-to-head)?

**Platform**

19. Is production's database the Flexible Server in the template, and what are the backup expectations?
20. When is the custom domain wired, and should infrastructure changes run in CD?
21. Should production stay armed for deployment before it is provisioned?
22. Update `CLAUDE.md`, the workflow README and the device READMEs to match reality (and drop the `.kiro/steering/` references)?

## How this was produced

Four read-only sweeps of `backend/src`, `apps/web`, `infra/` and `.github/workflows`, then direct checks of the findings that matter most (the unwired purge and erasure handlers, the stubbed history probe, the authorisation line in every use case, the match transitions, the tracker's corrections). Every cited path and line number was checked to exist. Lines marked "not verified" or "not confirmed" in a chapter are the places where a sweep reported something that was not re-read. The design-system artifact was not opened. Live GitHub state (the deployment variable, environment secrets, workflow runs) was read with `gh` and is reported only in [06 · Platform](06-platform.md)'s Open questions, since it is not in the repo.
