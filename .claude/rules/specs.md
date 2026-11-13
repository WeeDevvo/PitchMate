---
paths:
  - "specs/**"
---

# Specs

PitchMate is built spec-first. The specs are committed under `specs/` (`docs/` is git-ignored, so nothing durable goes there).

## Layout

- `specs/master/` holds the **master spec**: one file per chapter (`01-vision.md` … `08-design.md`) plus `index.md`, which lists the chapters and ends with the launch gate and the open questions, and `decisions.md`, which records each decision and where it came from.
- `specs/features/<feature>.md` holds **feature specs**, each cut from the master spec. None exist until the to-be master spec is signed off.

## Status tags

Every requirement or feature line carries exactly one status tag:

| Tag | Meaning |
|---|---|
| **Built** | Shipped in the code and behaves as the line says. |
| **Partial** | Some of it is shipped; the line says what is missing. |
| **Gap** | Intended (by `product.md` or another rule) but not in the code. |
| **Idea** | Not yet intended; a candidate for the brainstorm. |

## Citations

- Every **Built** or **Partial** line cites its source as `path` or `path:line`, repo-relative with forward slashes.
- Cite the code that implements the behaviour (domain method, use case, endpoint, component, bicep resource, workflow step), not a rule file that describes it.
- A **Gap** line cites where the intent is stated, and, where it helps, the code that shows the absence.
- When code moves, fix the citation in the same change. A line whose citation no longer holds is wrong until re-checked.

## Chapter shape

Every chapter has the same six sections, in this order:

1. **Purpose**: what the chapter covers and who reads it.
2. **Today (as-is)**: what the code does now, as tagged, cited lines.
3. **To be**: what is wanted, as tagged lines that each link the decision in `decisions.md` they come from. A decided requirement stays **Gap** until it is built; when it is built, update the Today line and its citation in the same change.
4. **Rules**: the invariants that hold, tagged and cited.
5. **Open questions**: decisions for the user, including every disagreement between spec, code and `product.md`.
6. **Ideas**: **Idea**-tagged candidates.

Keep built and wanted apart: never describe a wanted behaviour under Today, and never move a line to **Built** because it was decided.

## Decisions

- `specs/master/decisions.md` records each decision with its source: **User** (their own answer) or **Suggested** (a default they asked for and can still change).
- A requirement that follows from a decision but was not itself decided says so on its line.

Flows and state machines are **Mermaid** diagrams, not prose or ASCII art.

## Authority

- The to-be master spec was **signed off on 2026-11-13**, and `.claude/rules/product.md` was updated from it the same day. The two now say the same thing at different depths: `product.md` holds the product rules and, in its **Today** notes, what the shipped code actually does; the master spec holds the requirements, their ids, their status and the decision behind each.
- `product.md` stays the authority on built behaviour. A rule in it without a **Today** note is shipped; a rule with one is intended and not yet built.
- When product direction changes, change `product.md` and the master spec in the same change, then the code. When a requirement is built, update the spec's Today line and remove or reword the `product.md` **Today** note in that change.
- Where the spec, the code and `product.md` disagree, that is a defect: record it under **Open questions** in the affected chapter. Never change `product.md` silently to make them agree.
- Use the terminology `product.md` uses (squad, owner, admin, tracker, guest, claim, match draft, candidate day, kickoff lineup, settling, bibs, Pro, and so on) in every spec. "Settling" replaced "provisional" on 2026-11-13; the code and the spec's as-is lines still say "provisional" until the code is renamed.
