# alkahest/wiki — an LLM-maintained knowledge wiki

You maintain a **knowledge wiki** for the user: a hosted alkahest project whose notes are
markdown documents the LLM writes and keeps current, and whose note map draws the graph.
The user curates sources, asks questions and reads; **you do the bookkeeping** — summaries,
cross-references, filing, consistency. Knowledge is compiled once and kept current, not
re-derived from raw material on every question.

The pattern is Andrej Karpathy's *LLM Wiki* idea file
(<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>). This skill is that
pattern instantiated on alkahest: the three layers and three loops are his; the note pool,
the graph and the tools below are where they land.

## The three layers, on alkahest

| Layer | Karpathy | Here |
|---|---|---|
| Raw sources | `raw/` — immutable | notes under folder **`raw/…`** (`raw/articles`, `raw/notes`, `raw/transcripts`). You read them; you **never edit or delete them**. |
| The wiki | `wiki/` — LLM-owned | notes under **`wiki/…`**: `sources` (one page per ingested source), `concepts`, `entities` (people, companies, products, tools), `topics`, `comparisons`, `syntheses`, `overviews`. |
| The schema | `CLAUDE.md` / `AGENTS.md` | **this skill** plus its siblings `alkahest/wiki-capture` and `alkahest/wiki-lint`. Local preferences (language, extra folders) go in a note `wiki/overviews/Conventions` — read it when it exists. |

Deliverables (briefs, decks, lint reports) go under **`outputs/…`** (`outputs/briefs`, `outputs/lint`).

Two of Karpathy's files have no counterpart here, on purpose — **do not create them**:
- `index.md` → the note map, the tree sidebar (folders) and server-side search (`search`, `notes q=`) are the catalog.
- `log.md` → note history (revisions) and the activity journal already record what changed and when.

## Tools

`notes` (list — excerpts, `q` for full-body search, `map`) · `get_note` (one document + its links and backlinks)
· `add_note` (`title`, `body`, `folder`, `props`, `map`) · `update_note` (`body`/`folder`/`props`; `delete`+`reason`
and `restore` — lint only) · `note_props` (the notebook's property schema) · `search` (notes + issues + tasks in one).

**Note-to-note connections are `[[Title]]` references in the body.** The graph derives them at
read time; there is no separate edge to draw. A note nobody references and that references
nothing is an island — always name at least one neighbour in the body.

Properties: use `props.tags` (string array) for cross-cutting labels; keep a `source`
property on `wiki/sources` pages pointing at the raw note (`[[Raw title]]`). Keep the tag
vocabulary small — a tag on 3–12 notes is a useful hub, a tag on 1 is noise.

## Loop 1 — Ingest (a new source arrives)

1. **File the raw source** as a note under `raw/<kind>` with the original text (or the
   text you fetched from the URL), the URL and date in a short frontmatter-style header.
   Preserve the source's language. `props.tags: ["raw"]`.
2. **Read it and discuss** the key takeaways with the user before writing — one source at
   a time, the user stays involved. (A batch ingest is fine when they ask for it.)
3. **Write the source page** under `wiki/sources`: what it claims, why it matters, key
   quotes, and a `## Related` section of `[[…]]` references. Meaning-first title, not the
   raw file name.
4. **Update the wiki pages it touches** — `notes q=` first, then `update_note` existing
   concept/entity/topic pages (add the new evidence, cite the source page) and `add_note`
   only for concepts that have no page yet. A single source can rightly touch 5–15 pages.
5. **Never erase a claim the new source contradicts.** State the difference in the page
   ("Source A (2025) says X; Source B (2026) says Y") and prefer the newer claim when you
   present current understanding.
6. End with the map link and a one-paragraph summary of what changed.

## Loop 2 — Query (the user asks a question)

1. `search` / `notes q=` first, then `get_note` the pages that matter — read the wiki, not
   the raw sources, unless the wiki is silent.
2. Answer with citations as `[[Page title]]` references.
3. **File the good answers back.** A comparison, an analysis, a connection the user
   asked for is knowledge — save it under `wiki/comparisons` or `wiki/syntheses` with its
   sources referenced, so explorations compound like ingested sources do. Ask when unsure
   whether an answer is worth keeping; a throwaway answer stays in chat.

## Loop 3 — Lint

Periodically health-check the wiki: `alkahest/wiki-lint` has the checks, the self-trigger
rule and the delete policy. Capturing knowledge that surfaced *during a session* (not from
a source) is `alkahest/wiki-capture`.

## Rules

- **One topic per note.** Prefer updating an existing page to adding a near-duplicate —
  always `notes q=` before `add_note`.
- **Meaning-first titles.** The title is the node label and the `[[…]]` key other pages
  cite; date-prefixed titles are for `raw/` only.
- **Bodies are small markdown documents** — `##` sections, a `## Related` list, code where
  it carries the knowledge. Consistent beats comprehensive.
- **Language**: raw stays as it came; wiki pages follow the user's language (say it in
  `wiki/overviews/Conventions` if it isn't obvious from the existing pages).
- **Deletion is lint's job**, never ingest's or query's.

## Getting this read

Hosted skills are read when something asks for them. Tell your agent once, in whatever
rules file it reads (`CLAUDE.md`, `AGENTS.md`, a user-level rules file):
*"My knowledge wiki is the alkahest project `<slug>` — read the `alkahest/wiki` skill over MCP
before touching it."* Or just say "read the alkahest/wiki skill" when you start a session.
