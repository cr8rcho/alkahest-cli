#!/usr/bin/env node
// Build (or check) each preset's shipped-version history — the ground truth `alkahest preset
// update` judges an installed copy against (cloud ADR-108).
//
// For every file a preset installs AND can later update (skill bodies, reference scripts, the
// CLAUDE.md snippet), walk its git history and record each distinct body it ever shipped with:
//   presets/<id>/history.json   { files: { "<file>": [{ sha, since }] } }   oldest first
//   presets/<id>/history/<sha>  the body itself — the merge base for a copy the user edited
// `since` is the package version at the commit that first carried that body. The working-tree
// body is included too, so running this before committing a preset change records it.
//
// Usage: node scripts/preset-history.mjs          rewrite the history files
//        node scripts/preset-history.mjs --check  exit 1 if a current body is missing from
//                                                 history (run by prepublishOnly — a release
//                                                 must never ship a body update can't place)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = join(ROOT, "presets");
const check = process.argv.includes("--check");

// Must match core/presets.ts: CRLF-normalised, sha256, first 16 hex.
const norm = (s) => s.replace(/\r\n/g, "\n");
const shaOf = (s) => createHash("sha256").update(norm(s)).digest("hex").slice(0, 16);
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

/** The updatable files a manifest declares, as paths relative to the preset dir. */
function updatableFiles(manifest) {
  return [
    ...(manifest.skills ?? []).map((s) => s.file),
    // A repo-owned file (owner: "repo") is created once and never updated — no history to keep.
    ...(manifest.scripts ?? []).filter((s) => s.owner !== "repo").map((s) => s.file),
    ...(manifest.snippet ? [manifest.snippet] : []),
  ];
}

/** Every distinct body a repo path carried, oldest first, with the package version at that commit. */
function shippedBodies(repoPath) {
  let commits = [];
  try {
    commits = git("log", "--follow", "--format=%H", "--", repoPath).split("\n").filter(Boolean).reverse();
  } catch { /* untracked file — only the working tree below */ }
  const out = [];
  const seen = new Set();
  const add = (body, since) => {
    const sha = shaOf(body);
    if (seen.has(sha)) return;
    seen.add(sha);
    out.push({ sha, since, body: norm(body) });
  };
  for (const c of commits) {
    // --follow can hand back commits where the file lived under an older name; ask git for the
    // path as of that commit rather than assuming it never moved.
    const names = git("show", "--name-only", "--format=", "-M", c, "--").split("\n").filter(Boolean);
    const path = names.find((n) => n === repoPath || n.endsWith("/" + repoPath.split("/").pop())) ?? repoPath;
    let body;
    try { body = git("show", `${c}:${path}`); } catch { continue; }
    let since = "unknown";
    try { since = JSON.parse(git("show", `${c}:package.json`)).version; } catch { /* keep unknown */ }
    add(body, since);
  }
  const wt = join(ROOT, repoPath);
  if (existsSync(wt)) add(readFileSync(wt, "utf8"), JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version);
  return out;
}

let missing = 0;
for (const id of readdirSync(PRESETS)) {
  const manifestPath = join(PRESETS, id, "preset.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const historyJson = join(PRESETS, id, "history.json");

  if (check) {
    const hist = existsSync(historyJson) ? JSON.parse(readFileSync(historyJson, "utf8")) : { files: {} };
    for (const file of updatableFiles(manifest)) {
      const sha = shaOf(readFileSync(join(PRESETS, id, file), "utf8"));
      const known = (hist.files?.[file] ?? []).some((v) => v.sha === sha);
      const stored = existsSync(join(PRESETS, id, "history", sha));
      if (!known || !stored) {
        console.error(`[preset-history] ${id}/${file}: current body ${sha} is not in history — run node scripts/preset-history.mjs`);
        missing++;
      }
    }
    continue;
  }

  const histDir = join(PRESETS, id, "history");
  rmSync(histDir, { recursive: true, force: true });
  mkdirSync(histDir, { recursive: true });
  const files = {};
  for (const file of updatableFiles(manifest)) {
    const versions = shippedBodies(`presets/${id}/${file}`);
    files[file] = versions.map(({ sha, since }) => ({ sha, since }));
    for (const v of versions) writeFileSync(join(histDir, v.sha), v.body);
    console.log(`[preset-history] ${id}/${file}: ${versions.length} version(s)`);
  }
  writeFileSync(historyJson, JSON.stringify({ files }, null, 2) + "\n");
}

if (check && missing) process.exit(1);
if (check) console.log("[preset-history] every shipped body is in history.");
