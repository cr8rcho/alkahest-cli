# Alkahest — contributor & agent guide

Screen-graph CLI that reverse-engineers a product from code (static analysis →
product map), plus a hosted viewer so non-developers can read the map from a link.

## Language policy

- **All code is written in English.** Identifiers, comments, commit messages, log
  output, CLI strings, error messages, and inline docs — English only. Do not add
  Korean (or any non-English) text inside source files.
- **User-facing docs are bilingual, split by file.** Keep `README.md` (English, the
  default) and `README.ko.md` (Korean) in sync when one changes.
- `docs/*.md` may be written in the language that best serves their audience
  (internal operator notes are fine in Korean), but **anything shipped to end users
  or embedded in code stays English**.
- If asked to "translate", translate the README pair — never inject translations
  into source files.

## Architecture (open-core)

- **CLI** (`src/`) — public, MIT. Commands: `scan`, `view`, `publish`, `login`,
  `mcp`, `hook`, `update`. Output goes to `<project>/.alkahest/` (`map.json` + `index.html`).
- **Hosted backend** (`supabase/`) — **gitignored / kept private.** Edge functions
  (`publish`, `create-token`, deprecated `register`) + schema. Holds paid-plan logic,
  so it lives outside the public repo (open-core split).
- **Viewer** (`viewer/`, built by `scripts/build-viewer.mjs`) — gitignored build
  output. Dashboard shell + `/account` page; deployed to Vercel.

The same dashboard template (`src/assets/dashboard.html`) renders three ways:
inlined map (local `index.html`), `?src=` override, or `/p/{slug}` + a
`alkahest:map-base` meta tag (hosted). One renderer, no duplication.

## Auth model

GitHub login (web `/account`) issues per-user `alk_` tokens (sha256-hashed in
`api_tokens`). The CLI/MCP authenticate with that token; `publish` resolves it to a
user and auto-creates the project under their account. Plan limits are enforced
server-side in the `publish` edge function.

## Build & checks

```bash
npm run build         # tsc + copy assets to dist/
npm run typecheck     # tsc --noEmit
npm run build:viewer  # generate viewer/ for Vercel
```

Run `npm run typecheck` before committing. Match the surrounding code style;
keep comments at the existing density.

## Releases / versioning

Version channel is **GitHub Releases** (not npm). `alkahest update` reads the repo's
`releases/latest` and compares it to the installed `package.json` version
(`alkahest update --check` reports only; it updates via `git pull` + rebuild for a git
checkout, else prints the reinstall command).

**SemVer is keyed to the `map.json` schema contract** — the structure the CLI emits and
the hosted viewer renders — not to internal refactors:
- **patch** — no schema change.
- **minor** — additive *optional* fields (old maps still render fine).
- **major / breaking** — renamed / removed / restructured fields.

**Cut a release:**
1. Bump `package.json` `version` per the rule above. (`files` already ships `dist/`;
   `prepare` / `prepublishOnly` build it — nothing else to package.)
2. `gh release create vX.Y.Z --target main --title vX.Y.Z --notes "…"` — tag is `v` +
   the package version. This is exactly what `alkahest update` picks up.
3. **Only if the `map.json` schema changed:** also bump the `publish` edge function's
   version gate — `LATEST_CLI_VERSION` (nudge) and, for a breaking change,
   `MIN_CLI_VERSION` (hard floor) — then redeploy it, so old clients get a clear
   "run `alkahest update`" instead of silently breaking. That constant + the full policy
   live in the **alkahest-cloud** repo (`supabase/functions/publish/index.ts`).

`MIN_CLI_VERSION` locks out everyone below it — raise it only for genuine
incompatibility; prefer additive schema changes so it rarely moves.
