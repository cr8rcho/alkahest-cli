<!-- alkahest as-built preset — installed by `alkahest docs init`. Owned by this repo: edit freely. -->
## Documentation — as-built docs + ADR

This repo keeps **as-built documentation** under `docs/` (four layers: system / components /
features / modules — see docs/README.md) and **ADRs** under `docs/decisions/`. The writing
instructions live in the account skills `as-built-docs` and `adr` — read them via the
alkahest MCP `skills` tool before writing docs.

1. **After finishing any code change, update the affected docs in the same session.**
   The layer mapping and the update checklist are in the `as-built-docs` skill. Write an
   ADR only for decisions whose "why" a code diff cannot reconstruct (criteria and the
   template are in the `adr` skill).
2. **First documentation pass (repo has no docs yet)?** Follow the bootstrap protocol in
   the `as-built-docs` skill: one system map + 2–3 core modules + ADR-001 (architecture
   snapshot) — small first, then mirror and hand the user the note-map link. Grow the rest
   incrementally with later work.
3. **After changing `docs/`, mirror it to the hosted note maps** by running
   `node scripts/sync-docs-maps.mjs` (background recommended — one POST per document).
   The script stages the docs (title from the first H1, H1 line stripped, intra-set
   relative links → `[[wikilinks]]`, the original repo path injected as `source_path:`
   frontmatter) and uploads with `alkahest notes import --map <adr|as-built>`. The import
   is idempotent by source_path first, title second — re-runs and retitles update notes in
   place. The script is a reference implementation and belongs to this repo: adapt it to
   local conventions freely.
