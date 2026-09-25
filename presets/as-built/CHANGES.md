# as-built preset — changes

Why each shipped file changed, newest first. `alkahest preset update` prints the entries newer
than the version an installed copy came from, so whoever merges knows what the change is for.
One `## <version>` per release that touched the preset; each bullet names its file.

## 0.1.94
- `sync-docs-maps.mjs`: becomes the preset's ENGINE — `alkahest preset update` now replaces it
  wholesale instead of merging, so every repo runs the same sync rules. Repo-specific settings
  move to the new `scripts/sync-docs-maps.config.mjs` (created on update, never touched again;
  the project slug a previous script hard-coded is carried over). Staged output with an empty
  config is identical to 0.1.92. New: `--dry-run`, `extra` files, `title()` override, `links`,
  `sets`, missing note maps are created. If your old script had edits, move them into the config
  (the update prints the sentence to hand your agent).
- `CLAUDE-snippet.md`: says the script is the engine and points at the config file.

## 0.1.92
- `sync-docs-maps.mjs`: removes its staging dir after a successful sync (it is this run's own
  since 0.1.90, so nothing else is touched); kept on `--stage-only` and on failure, with the path
  printed.

## 0.1.91
- `CLAUDE-snippet.md`: closes with an end marker (`<!-- /alkahest as-built preset -->`) so
  `alkahest preset update` can find the block's boundary; the header names the update command.

## 0.1.90
- `sync-docs-maps.mjs`: stages into a fresh temp dir per run (`mkdtempSync`). The fixed shared
  `tmpdir()/alkahest-docs-staging` let two repos' syncs running at once swap docs, so one repo's
  docs were imported into the other's project.

## 0.1.76
- `skills/as-built-docs.md`, `skills/adr.md`, `CLAUDE-snippet.md`: skill names are namespaced
  (`alkahest/as-built-docs`, `alkahest/adr`) and every reference follows.

## 0.1.75
- `skills/adr.md`: the tag vocabulary becomes part of the preset.

## 0.1.74
- `skills/as-built-docs.md`: pilot feedback (classed-H1 rule, `modules/`-first hint for the
  first pass, session MCP binding warning).

## 0.1.72
- First release of the preset.
