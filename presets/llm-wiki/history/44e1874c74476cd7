# alkahest/wiki-capture — keep what you just learned

The user says *"save this"*, *"keep that"*, *"put this in the wiki"*, *"이거 정리해서 넣어줘"*,
*"기억해 둬"* — or a piece of work just finished and something durable came out of it. This
skill turns knowledge that surfaced **during a session** into wiki pages. (A source the
user hands you — an article, a URL, a transcript — is an *ingest*, see `alkahest/wiki`.)
Read `alkahest/wiki` once first: it holds the layout, the tools and the rules this skill
builds on.

## Two modes — detect from the call

- **Pointed capture** — the user gestured at one specific thing ("save the part about X",
  an argument naming a topic). The worth-it decision is **already made by the user**; do
  not re-litigate it. Scope to exactly what they pointed at and write **one focused
  note** (or one update). Do not sweep the rest of the session.
- **Sweep** — no specific pointer ("save anything useful from this", end of a task).
  Scan the session for **durable, reusable** knowledge against the bar below. May yield
  several notes. If nothing meets the bar, say so in a sentence and stop — no filler.

When the pointer is ambiguous, ask one short question instead of guessing.

## The worth-it bar (sweep; in pointed mode only to reject the clearly unfit)

Keep: a decision and its rationale · a reusable concept, definition or pattern · a fact
about a company, tool, product, person or process · a synthesis distilled from research ·
a non-obvious how-to or operating rule · a good answer the user is likely to want again.

Never keep: throwaway conversation, one-off debugging steps, anything already in the wiki,
anything derivable from code or git history, secrets.

## Steps

1. **Dedupe first** — `search` / `notes q="<topic>"` (matches full bodies), `get_note` the
   candidates. A page on the topic exists → **`update_note`** it. If the new knowledge
   conflicts with it, don't overwrite silently: state the difference and prefer the newer
   claim.
2. **Route** — pick the folder by what the knowledge *is*: `wiki/concepts` (a definition or
   pattern), `wiki/entities` (a company / tool / person), `wiki/topics` (an ongoing
   subject), `wiki/syntheses` (something distilled from several pages), `outputs/…` for a
   deliverable. Company-internal knowledge and general knowledge may live on different
   note maps — check `maps` and the existing pages, and pass `map` accordingly.
3. **Write** — one topic per note; a small markdown document with `##` sections
   (Definition / Why it matters / How to apply, or Summary / Key points / Relevance —
   whatever fits) and code where it carries the knowledge. Meaning-first title.
   `props.tags` from the existing vocabulary (`note_props`), 1–3 tags.
4. **Connect** — name 1–3 closest neighbours as `[[Title]]` references in the body (a
   `## Related` list is the convention). The graph derives the edges; a note with no
   references is an island — if you truly found no neighbour, say so in the report.
5. **Report** — two lines: what was kept, and the viewer link of each created/updated
   note (`https://alkahest.app/p/<project>/<map>/<note-slug>`), plus any conflict you
   noted against an existing page.

## Not this skill's job

- **No deletions.** Capture updates or adds; retiring pages is `alkahest/wiki-lint`.
- **No index or log notes.** The map and the history are those.
- **No raw pages.** What the user hands you as a source goes through ingest.
