---
paths:
  - "specs/**"
---

# Specs

PitchMate is built spec-first. The specs are committed under `specs/` (`docs/` is git-ignored, so nothing durable goes there).

## Layout

- `specs/master/` holds the **master spec**: one file per chapter (`01-vision.md` … `08-design.md`) plus `index.md`, which lists the chapters and ends with the biggest gaps and open questions.
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

Every chapter has the same five sections, in this order:

1. **Purpose**: what the chapter covers and who reads it.
2. **Today (as-is)**: what the code does now, as tagged, cited lines.
3. **Rules**: the invariants that hold, tagged and cited.
4. **Open questions**: decisions for the user, including every disagreement between spec, code and `product.md`.
5. **Ideas**: **Idea**-tagged candidates.

Flows and state machines are **Mermaid** diagrams, not prose or ASCII art.

## Authority

- `.claude/rules/product.md` stays the authority on product behaviour until the to-be master spec is signed off.
- Where the spec (or the code it describes) and `product.md` disagree, record it under **Open questions** in the affected chapter. Never change `product.md` silently to make them agree.
- Use the terminology `product.md` uses (squad, owner, admin, guest, claim, match draft, candidate day, kickoff lineup, provisional, bibs, and so on) in every spec.
