// Settings for scripts/sync-docs-maps.mjs (alkahest as-built preset) — this file is the REPO'S.
// `alkahest preset update` replaces the sync engine next to it but never touches this file, so
// everything that makes this repo's docs sync its own goes here. Every key is optional: an empty
// object is the preset's default behaviour.
export default {
  // The alkahest project to sync into. Default: the project this folder is linked to
  // (`.alkahest/project.json`), or the ALKAHEST_PROJECT environment variable.
  // project: "my-project-1a2b3c",

  // Where the docs live, relative to the repo root.
  // docsDir: "docs",

  // Extra files (relative to docsDir) to mirror into a map, beyond its folders.
  // extra: { "as-built": ["README.md"] },

  // Note titles. Return a string to replace the preset's title for a doc, or nothing to keep it.
  // Titles are how existing notes are matched, so change them deliberately (then run --stage-only).
  // title: ({ map, kind, path, h1, defaultTitle }) => (map === "adr" ? h1 : undefined),

  // Relative .md links become [[wikilinks]] within each map ("set", default) or across maps ("all").
  // links: "set",

  // Which folders go to which note map. Default:
  // sets: [
  //   { map: "adr", kind: "adr", dirs: ["decisions"], match: /^\d{3}-.*\.md$/, folders: false },
  //   { map: "as-built", kind: "as-built", dirs: ["system", "components", "features", "modules"], folders: true },
  // ],

  // Create a missing note map before importing (default true).
  // createMaps: true,
};
