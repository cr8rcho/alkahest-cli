# as-built-docs — writing instructions

You are maintaining this repository's **as-built documentation**: documents that record how
the system **is actually built**. Never plans, PRDs, or aspirations — present tense, code as
the source of truth.

## The four layers

Documents live under `docs/` in four folders, split by scope and viewpoint:

| Layer | Scope | Viewpoint | Answers |
|---|---|---|---|
| `system/` | whole app | architecture / data flow | "How is this app put together overall?" |
| `components/` | one UI area | what the user sees | "What is on this screen area, and what does each control do?" |
| `features/` | one behavior | time / user action | "When and under what conditions does this behavior run?" |
| `modules/` | one code layer | developer view | "What does this layer provide, and how is it separated from the rest?" |

Placement rule of thumb: what the user *sees* → `components/`; what *happens over time* →
`features/`; *code structure* → `modules/`; the picture that crosses all three → `system/`.
When a topic straddles two layers, pick one as the **main** document and leave a short
summary + link in the other.

## Document shape

Title each document with a **classed H1**: `# System — <name>`, `# Component — <name>`,
`# Feature — <name>`, `# Module — <name>`. The note-map mirror strips the class prefix,
so the hosted note is titled just `<name>` while the file stays unambiguous in the repo.
(ADRs have their own H1 shape — see the `adr` skill.)

## Bootstrap — when the repo has no docs yet

Do NOT try to document everything in one session. The first pass is deliberately small so
the user sees a map fast:

1. `docs/system/<app>.md` — one system map: layers, data flow, key dependencies, honest
   Known Limitations.
2. Two or three `docs/modules/*.md` for the load-bearing modules only.
3. One decision record (see the `adr` skill): **ADR-001, an architecture snapshot** — the
   decisions already embedded in the current code.
4. Add each document to the index in `docs/README.md`, then **mirror to the note maps and
   hand the user the map link** (the mirroring rule lives in this repo's CLAUDE.md).

In the first pass, **prefer `modules/`** (plus the one `system/` map) when a topic could
fit several layers — grow `features/` and `components/` in later sessions, and leave their
index tables empty until they have documents.

Grow the rest incrementally: each later work session adds or updates only the documents its
code changes touch.

## Tone and rules

- **As-built, present tense** — "this is how it is built." Cite real file paths, function
  names, and constants so readers can jump straight to code.
- **Decision history is a separate axis** — why / alternatives / trade-offs belong in ADRs
  (`docs/decisions/`, see the `adr` skill), not in these documents.
- **Known Limitations, honestly** — the most valuable section of a post-hoc document.
  Remove limitations you fixed; add the ones you introduced.
- **Overwrite freely** — these documents always describe the present. (ADRs are the
  append-only record; never blend the two.)
- **Trust the code over connected tools** — an MCP server configured in your session
  (a database MCP, for instance) may be bound to a *different* project than the repo you
  are documenting. Verify the binding before citing anything from it, or read the schema
  from the code instead.

## After every code change (checklist)

- [ ] Does the affected document still describe current behavior?
- [ ] Are its code citations (paths, names, constants) still valid?
- [ ] Known Limitations updated — fixed ones removed, new ones added?
- [ ] Cross-references from documents in other layers updated?
- [ ] `docs/README.md` index still accurate (add a row when adding a document)?
