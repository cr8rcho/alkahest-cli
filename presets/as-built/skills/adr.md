# adr — decision records

ADRs (`docs/decisions/NNN-kebab-title.md`) record the **why** of decisions: context,
alternatives, trade-offs. They are a separate axis from as-built docs — as-built documents
are overwritten to stay current; ADRs are **append-only**, frozen at decision time.

## When to write one

One-line test: **if the code diff alone cannot reconstruct the "why", it deserves an ADR.**

Typical cases: data-model or structural changes; policy decisions and their reversals;
adopting an external dependency or license; fixing an ownership boundary ("this module is
the single owner of that transform"); behavior changes that trade something away; and
decisions deliberately **not** taken (record the reason and the revisit trigger).

Skip when: plain bug fixes, refactors, dependency bumps — anything self-evident from the
code and the as-built docs.

## Bootstrap — ADR-001

On a repo's first documentation pass, write **ADR-001 as an architecture snapshot**: the
decisions already embedded in the current code (framework, storage, module boundaries),
each with the alternatives it implicitly rejected. This seeds the habit of communicating
through decision records.

## Numbering & lifecycle

- `NNN` is zero-padded, sequential, never reused or renumbered.
- Never rewrite an accepted ADR. When a decision changes, write a **new** ADR that names
  the old one in `Supersedes:`, and flip the old one's Status to `Superseded by …`
  (keep the body — "why we did it that way once, then backed out" is the value).

## Tags (frontmatter)

Every ADR opens with a `tags:` frontmatter block. Keep the vocabulary small and stable:
one **surface** tag (the area of the product it touches) plus at most two **arc** tags
(a storyline several ADRs share). On the hosted `adr` note map each tag renders as a hub
node — keep every tag attached to roughly 3–12 ADRs so the map stays legible, and prefer
reusing an existing tag over inventing a new one.

## Template

```markdown
---
tags: [<one surface tag>, <0-2 arc tags>]
---

# ADR-NNN: <one-line title>

* **Status**: Accepted (YYYY-MM-DD)
* **Date**: YYYY-MM-DD
* **Supersedes**: none | ADR-NNN (partial/full)
* **Related**: ADRs, as-built docs

***

## 1. Context
## 2. Decision
## 3. Trade-offs
## 4. Considered alternatives
## 5. Known limitations
```

Keep *Trade-offs*, *Considered alternatives*, and *Known limitations* non-empty — they are
the point of the record. Cite code richly (files, functions, constants).
