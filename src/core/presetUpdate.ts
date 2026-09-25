import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { diff3Merge, diffComm } from "node-diff3";
import { pullSkills, saveSkill } from "./tasks.js";
import { listPresets, loadManifest, snippetMarker, type PresetManifest } from "./presets.js";

/**
 * `alkahest preset update` (cloud ADR-108). An install copies a preset's skills, reference
 * script and CLAUDE.md snippet once; this brings each installed copy up to the preset's
 * current body without throwing away what the user changed:
 *
 *  - the copy's body is one the preset shipped      → replace it with the current body
 *  - the copy was edited                             → 3-way merge: base = the shipped body
 *    closest to the copy, theirs = the current body; the user's edits outside the preset's
 *    changes survive untouched
 *  - an edit and a preset change hit the same lines  → the preset's lines win, and the
 *    replaced local lines are reported so an agent (or person) can put back what mattered
 *
 * The update always completes — the user ran it because they want it; "merge later" leftovers
 * were rejected. The one exception is a copy the preset can't merge into without breaking it
 * (`diverged`: the repo's own rewrite, or a merged script that no longer parses). That copy is
 * left exactly as it was and the preset's change is printed to apply by hand. A working sync
 * must never be traded for a half-merged one. The judge's ground truth is presets/<id>/history.json + history/<sha>, built
 * from git by scripts/preset-history.mjs and shipped in the package. No DB state: skills are
 * judged by body, repo files by content.
 */

/** Must match scripts/preset-history.mjs: CRLF-normalised, sha256, first 16 hex. */
const norm = (s: string): string => s.replace(/\r\n/g, "\n");
const shaOf = (s: string): string => createHash("sha256").update(norm(s)).digest("hex").slice(0, 16);

interface ShippedVersion { sha: string; since: string }
interface History { files: Record<string, ShippedVersion[]> }

export type UpdateState =
  | "current" // already the preset's current body (or already carries every preset change)
  | "replaced" // was an unedited shipped body — now the current one
  | "merged" // edited copy — preset changes merged in, every local edit kept
  | "merged_with_conflicts" // edited copy — merged, but some local lines lost to the preset's
  | "replaced_edits" // a preset-owned engine that had local edits — replaced; the edits are in `git diff` (or <file>.bak)
  | "created" // a repo-owned settings file that didn't exist yet
  | "diverged" // not a copy the preset can merge into (a rewrite, or the merge wouldn't run) — left untouched
  | "not_installed" // nothing of this item in the account / repo
  | "failed";

export interface UpdateConflict {
  /** 1-based line in the updated copy where the preset's lines start. */
  line: number;
  /** The local lines that were replaced. */
  local: string[];
  /** The preset's lines now in their place. */
  preset: string[];
}

export interface UpdateItem {
  kind: "skill" | "script" | "snippet";
  /** Skill name, or the repo-relative file. */
  name: string;
  state: UpdateState;
  /** Package version the copy was judged to come from (the merge base). */
  from?: string;
  /** False when the base had to be guessed from an edited copy (closest shipped body). */
  exactBase?: boolean;
  conflicts?: UpdateConflict[];
  /** For `diverged`: what the preset changed (its previous body → current), to apply by hand. */
  presetChange?: string[];
  message?: string;
}

export interface PresetUpdateReport {
  id: string;
  items: UpdateItem[];
  /** CHANGES.md bullets for the files that changed, newer than each copy's base. */
  changes: string[];
}

export interface UpdatePresetParams {
  api?: string;
  token?: string;
  /** One preset id; omitted → every preset that has something installed here. */
  preset?: string;
  /** Judge and report, write nothing. */
  dryRun?: boolean;
  /**
   * Switch an edited or hand-written engine copy to the preset's even when the staged notes
   * can't be shown identical — for a repo that has moved its settings into the config.
   */
  adopt?: boolean;
}

export interface UpdatePresetResult {
  ok: boolean;
  presets?: PresetUpdateReport[];
  code?: string;
  message?: string;
}

function readHistory(dir: string): History {
  const p = join(dir, "history.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as History) : { files: {} };
}

/** Lines of a text, keeping a trailing newline as a final "" so joins round-trip. */
const lines = (s: string): string[] => norm(s).split("\n");

/** How many lines two texts do NOT share (the closest-base metric). */
function distance(a: string[], b: string[]): number {
  let n = 0;
  for (const c of diffComm(a, b)) if (!c.common) n += c.buffer1.length + c.buffer2.length;
  return n;
}

interface Judged {
  state: UpdateState;
  text: string;
  from?: string;
  exactBase?: boolean;
  conflicts?: UpdateConflict[];
  presetChange?: string[];
  message?: string;
}

/**
 * Below this share of lines in common with its closest shipped body, a copy is not an edited
 * copy but the repo's own rewrite — a line merge would splice the preset's head and tail onto
 * a body that never declared what they use (seen 2026-09-26: iobook/iomatrix rewrote the sync
 * script from scratch, 18% shared, and the merge didn't parse). Real edited copies measured
 * 61–98%.
 */
const MIN_SHARED = 0.5;

/** The preset's own change between two of its bodies, as -/+ lines with a location. */
function presetPatch(from: string[], to: string[]): string[] {
  const out: string[] = [];
  let line = 1;
  for (const c of diffComm(from, to)) {
    if (c.common) { line += c.common.length; continue; }
    out.push(`@@ at line ${line} of the preset's previous version`);
    for (const l of c.buffer1) out.push(`- ${l}`);
    for (const l of c.buffer2) out.push(`+ ${l}`);
    line += c.buffer1.length;
  }
  return out;
}

/**
 * Judge one installed copy against a file's shipped history and produce its updated text.
 * `current` is the preset's body now; `bodyOf(sha)` reads a shipped body.
 */
export function judgeCopy(local: string, current: string, shipped: { since: string; body: string }[]): Judged {
  const versions = shipped.map((v) => ({ since: v.since, body: norm(v.body), sha: shaOf(v.body) }));
  const bodyOf = (sha: string) => versions.find((v) => v.sha === sha)!.body;
  const localSha = shaOf(local);
  const currentSha = shaOf(current);
  if (localSha === currentSha) return { state: "current", text: local, from: versions.find((v) => v.sha === currentSha)?.since, exactBase: true };

  const same = versions.find((v) => v.sha === localSha);
  if (same) return { state: "replaced", text: norm(current), from: same.since, exactBase: true };

  // Edited copy: the base is the shipped body it is closest to (ties go to the newer one).
  const localLines = lines(local);
  let base: (typeof versions)[number] | undefined;
  let best = Infinity;
  for (const v of versions) {
    const d = distance(localLines, lines(bodyOf(v.sha)));
    if (d <= best) { best = d; base = v; }
  }
  if (!base) return { state: "current", text: local }; // no history — nothing to merge against

  const baseLines = lines(bodyOf(base.sha));
  const presetChange = presetPatch(baseLines, lines(current));
  let shared = 0;
  for (const c of diffComm(localLines, baseLines)) if (c.common) shared += c.common.length;
  if (shared / localLines.length < MIN_SHARED) {
    return {
      state: "diverged", text: local, from: base.since, exactBase: false, presetChange,
      message: `your copy is its own version (${Math.round((100 * shared) / localLines.length)}% of lines shared with the preset) — merging would mix the two`,
    };
  }

  const out: string[] = [];
  const conflicts: UpdateConflict[] = [];
  for (const region of diff3Merge(localLines, baseLines, lines(current))) {
    if (region.ok) out.push(...region.ok);
    else if (region.conflict && region.conflict.o.length === 0) {
      // Both sides only ADDED lines at the same spot (e.g. the user appended a rule to the
      // snippet, the preset appended its end marker) — nothing of either is replaced, so keep
      // both: the user's lines first, then the preset's.
      out.push(...region.conflict.a, ...region.conflict.b);
    } else if (region.conflict) {
      conflicts.push({ line: out.length + 1, local: region.conflict.a, preset: region.conflict.b });
      out.push(...region.conflict.b);
    }
  }
  const text = out.join("\n");
  if (text === norm(local)) return { state: "current", text: local, from: base.since, exactBase: false };
  return {
    state: conflicts.length ? "merged_with_conflicts" : "merged",
    text,
    from: base.since,
    exactBase: false,
    conflicts: conflicts.length ? conflicts : undefined,
    presetChange,
  };
}

/**
 * A merged SCRIPT must still run: `node --check` on the result, and a failure turns the merge
 * into `diverged` (nothing written). Line merges can't see that code in one hunk depends on a
 * declaration in another; this is the backstop behind MIN_SHARED.
 */
/** Every file under a staged dir, relative path → content. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).split(sep).join("/"), readFileSync(p, "utf8"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** Run a sync script with --stage-only and return its staging dir (from its `→ <dir>` line). */
function stageWith(script: string): string | undefined {
  const run = spawnSync(process.execPath, [script, "--stage-only"], { cwd: dirname(dirname(script)), encoding: "utf8", timeout: 120_000 });
  if (run.status !== 0) return undefined;
  return /→\s*(\S+)\s*$/m.exec(run.stdout ?? "")?.[1];
}

/**
 * Does the preset engine (written at `dest`, reading the repo's config beside it) stage the same
 * notes as the repo's previous script? Only copies whose script honours --stage-only can be
 * compared — running anything else could import for real. Leaves `dest` holding the engine.
 */
function sameStaging(dest: string, previous: string, engine: string): { same: boolean; message: string } {
  if (!previous.includes("--stage-only")) {
    return { same: false, message: "your script is its own version (no --stage-only to compare with) — kept as is" };
  }
  const prevFile = join(dirname(dest), `.${basename(dest, ".mjs")}.previous.mjs`);
  const dirs: string[] = [];
  try {
    writeFileSync(prevFile, previous);
    const before = stageWith(prevFile);
    writeFileSync(dest, engine);
    const after = stageWith(dest);
    for (const d of [before, after]) if (d) dirs.push(d);
    if (!before || !after) return { same: false, message: "couldn't stage with both versions to compare — kept yours" };
    const a = snapshot(before), b = snapshot(after);
    const names = new Set([...a.keys(), ...b.keys()]);
    let differ = 0;
    for (const n of names) if (a.get(n) !== b.get(n)) differ++;
    if (!differ) return { same: true, message: `your settings carried over — the engine stages the same ${a.size} notes` };
    return { same: false, message: `the engine would stage ${differ} of ${names.size} notes differently — kept yours` };
  } finally {
    rmSync(prevFile, { force: true });
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
}

function checkScript(dest: string, j: Judged): Judged {
  if (!["merged", "merged_with_conflicts"].includes(j.state) || !/\.(mjs|cjs|js)$/.test(dest)) return j;
  const dir = mkdtempSync(join(tmpdir(), "alkahest-preset-check-"));
  try {
    const probe = join(dir, basename(dest));
    writeFileSync(probe, j.text);
    const run = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" });
    if (run.status === 0) return j;
    const why = (run.stderr ?? "").split("\n").find((l) => /Error/.test(l))?.trim() ?? "syntax check failed";
    return { ...j, state: "diverged", text: "", conflicts: undefined, message: `the merged result doesn't run (${why})` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Where the preset's snippet sits in a CLAUDE.md: from the marker comment to the end marker
 * (snippets since 0.1.91 carry one). Older snippets have none, so the block runs to the next
 * top-level heading or HTML comment outside a code fence, trailing blank lines dropped.
 */
function findSnippetBlock(fileLines: string[], presetId: string): { start: number; end: number } | undefined {
  const open = `<!-- ${snippetMarker(presetId)}`;
  const close = `<!-- /${snippetMarker(presetId)} -->`;
  const start = fileLines.findIndex((l) => l.startsWith(open));
  if (start < 0) return undefined;
  const closeAt = fileLines.findIndex((l, i) => i > start && l.trim() === close);
  if (closeAt >= 0) return { start, end: closeAt + 1 };

  let end = fileLines.length;
  let inFence = false;
  let seenHeading = false;
  for (let i = start + 1; i < fileLines.length; i++) {
    const l = fileLines[i];
    if (l.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    if (/^#{1,2}\s/.test(l)) {
      if (seenHeading) { end = i; break; }
      seenHeading = true;
    } else if (l.startsWith("<!--")) { end = i; break; }
  }
  while (end > start + 1 && fileLines[end - 1].trim() === "") end--;
  return { start, end };
}

const semverGt = (a: string, b: string): boolean => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/**
 * The CHANGES.md bullets that explain what an update just brought in: for each changed file,
 * the bullets that name it (`skills/adr.md`, `sync-docs-maps.mjs`, …) in versions newer than
 * the copy's base. Bullets naming no file ("First release") are not "why this changed".
 */
function changesFor(dir: string, changed: { file: string; from?: string }[]): string[] {
  const p = join(dir, "CHANGES.md");
  if (!existsSync(p) || !changed.length) return [];
  const sections: { version: string; bullets: string[] }[] = [];
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const h = /^## (\d+\.\d+\.\d+)/.exec(l);
    if (h) { sections.push({ version: h[1], bullets: [] }); continue; }
    const cur = sections[sections.length - 1];
    if (!cur) continue;
    if (l.startsWith("- ")) cur.bullets.push(l);
    else if (/^\s+\S/.test(l) && cur.bullets.length) cur.bullets[cur.bullets.length - 1] += "\n" + l;
  }
  const out: string[] = [];
  for (const sec of sections) {
    const hits = sec.bullets.filter((b) =>
      changed.some((c) => b.includes("`" + c.file + "`") && (!c.from || c.from === "unknown" || semverGt(sec.version, c.from))));
    if (hits.length) out.push(`## ${sec.version}`, ...hits.flatMap((b) => b.split("\n")));
  }
  return out;
}

async function updateOne(
  root: string,
  path: string,
  dir: string,
  manifest: PresetManifest,
  personal: Map<string, string>,
  params: UpdatePresetParams,
): Promise<PresetUpdateReport> {
  const history = readHistory(dir);
  const shippedOf = (file: string, map: (body: string) => string = (b) => b) =>
    (history.files[file] ?? []).map((v) => ({ since: v.since, body: map(readFileSync(join(dir, "history", v.sha), "utf8")) }));
  const items: UpdateItem[] = [];
  const changedFiles: { file: string; from?: string }[] = [];
  const itemFrom = (kind: UpdateItem["kind"], name: string, j: Judged, file: string): UpdateItem => {
    if (j.state !== "current") changedFiles.push({ file, from: j.from });
    return {
      kind, name, state: j.state, from: j.from, exactBase: j.exactBase, conflicts: j.conflicts,
      presetChange: j.state === "diverged" ? j.presetChange : undefined, message: j.message,
    };
  };

  // 1) Account skills — the personal row of the same name.
  for (const s of manifest.skills ?? []) {
    const local = personal.get(s.name.toLowerCase());
    if (local === undefined) { items.push({ kind: "skill", name: s.name, state: "not_installed" }); continue; }
    const j = judgeCopy(local, readFileSync(join(dir, s.file), "utf8"), shippedOf(s.file));
    const item = itemFrom("skill", s.name, j, s.file);
    if (j.state !== "current" && j.state !== "diverged" && !params.dryRun) {
      const saved = await saveSkill(path, { api: params.api, token: params.token, name: s.name, body: j.text });
      if (!saved.ok) { item.state = "failed"; item.message = saved.message ?? saved.code; }
    }
    items.push(item);
  }

  // 2) Repo scripts (ADR-109). The repo-owned settings file goes first so it can read what the
  //    old engine hard-coded before the engine is replaced.
  const scripts = [...(manifest.scripts ?? [])].sort((a, b) => Number(b.owner === "repo") - Number(a.owner === "repo"));
  const engine = (manifest.scripts ?? []).find((s) => s.owner === "preset");
  const engineDest = engine ? join(root, ...engine.dest.split("/")) : undefined;
  for (const s of scripts) {
    const dest = join(root, ...s.dest.split("/"));
    if (s.owner === "repo") {
      // Created once, beside an installed engine, and never touched again — it is the repo's.
      if (existsSync(dest)) { items.push({ kind: "script", name: s.dest, state: "current", message: "yours — never updated" }); continue; }
      if (!engineDest || !existsSync(engineDest)) { items.push({ kind: "script", name: s.dest, state: "not_installed" }); continue; }
      let body = readFileSync(join(dir, s.file), "utf8");
      const slug = /ALKAHEST_PROJECT\s*\?\?\s*["']([a-z0-9-]+)["']/.exec(readFileSync(engineDest, "utf8"))?.[1];
      let message: string | undefined;
      if (slug) {
        body = body.replace(/^ {2}\/\/ project: .*$/m, `  project: "${slug}", // carried over from the previous sync script`);
        message = `project "${slug}" carried over from the previous script`;
      }
      if (!params.dryRun) writeFileSync(dest, body);
      items.push({ kind: "script", name: s.dest, state: "created", message });
      continue;
    }
    if (!existsSync(dest)) { items.push({ kind: "script", name: s.dest, state: "not_installed" }); continue; }
    if (s.owner === "preset") {
      // The engine is the preset's: always the current body, never merged. A copy that isn't a
      // body the preset shipped had local edits — they belong in the settings file now.
      const local = readFileSync(dest, "utf8");
      const current = readFileSync(join(dir, s.file), "utf8");
      const shipped = history.files[s.file] ?? [];
      const localSha = shaOf(local);
      if (localSha === shaOf(current)) { items.push({ kind: "script", name: s.dest, state: "current" }); continue; }
      const from = shipped.find((v) => v.sha === localSha)?.since;
      if (from) {
        // An unedited shipped engine: nothing of the repo's is in it — replace.
        if (!params.dryRun) writeFileSync(dest, current);
        changedFiles.push({ file: s.file, from });
        items.push({ kind: "script", name: s.dest, state: "replaced", from, exactBase: true });
        continue;
      }
      // An edited (or hand-written) copy. Switch only when the engine + the repo's settings file
      // stage EXACTLY what the old script staged — the sync must keep producing the same notes.
      // Otherwise the old script stays and the repo moves its settings into the config first.
      if (params.dryRun) {
        items.push({ kind: "script", name: s.dest, state: "replaced_edits", message: "your copy has edits — on update, the switch happens only if the engine + config stage the same notes" });
        continue;
      }
      if (params.adopt) {
        writeFileSync(dest, current);
        changedFiles.push({ file: s.file });
        items.push({ kind: "script", name: s.dest, state: "replaced_edits", message: "adopted (--adopt) — now run it with --dry-run and check it plans no NEW notes (new = a title changed)" });
        continue;
      }
      const verdict = sameStaging(dest, local, current);
      if (verdict.same) {
        changedFiles.push({ file: s.file });
        items.push({ kind: "script", name: s.dest, state: "replaced_edits", message: verdict.message });
        continue;
      }
      writeFileSync(dest, local); // keep the working script
      changedFiles.push({ file: s.file });
      items.push({ kind: "script", name: s.dest, state: "diverged", message: verdict.message, presetChange: undefined });
      continue;
    }
    const j = checkScript(dest, judgeCopy(readFileSync(dest, "utf8"), readFileSync(join(dir, s.file), "utf8"), shippedOf(s.file)));
    if (j.state !== "current" && j.state !== "diverged" && !params.dryRun) writeFileSync(dest, j.text);
    items.push(itemFrom("script", s.dest, j, s.file));
  }

  // 3) CLAUDE.md snippet — just the preset's block; the rest of the file is the repo's.
  if (manifest.snippet) {
    const file = join(root, "CLAUDE.md");
    const fileLines = existsSync(file) ? lines(readFileSync(file, "utf8")) : [];
    const block = findSnippetBlock(fileLines, manifest.id);
    if (!block) items.push({ kind: "snippet", name: "CLAUDE.md", state: "not_installed" });
    else {
      // The end marker is structure, not content: judge and merge the block without it and
      // put it back after, so a user edit on the block's last line doesn't collide with it.
      const close = `<!-- /${snippetMarker(manifest.id)} -->`;
      const unclose = (t: string) => lines(t).filter((l) => l.trim() !== close).join("\n");
      const local = fileLines.slice(block.start, block.end).join("\n") + "\n";
      const current = readFileSync(join(dir, manifest.snippet), "utf8");
      const j = judgeCopy(unclose(local), unclose(current), shippedOf(manifest.snippet, unclose));
      if (j.state === "current" && lines(local).some((l) => l.trim() === close) !== lines(current).some((l) => l.trim() === close)) {
        j.state = "merged"; // only the marker differs
      }
      if (j.state !== "current" && j.state !== "diverged" && !params.dryRun) {
        const merged = lines(j.text);
        while (merged.length && merged[merged.length - 1] === "") merged.pop();
        if (lines(current).some((l) => l.trim() === close)) merged.push(close);
        writeFileSync(file, [...fileLines.slice(0, block.start), ...merged, ...fileLines.slice(block.end)].join("\n"));
      }
      // Conflict line numbers are relative to the block; report them against the file.
      for (const c of j.conflicts ?? []) c.line += block.start;
      items.push(itemFrom("snippet", "CLAUDE.md", j, manifest.snippet));
    }
  }

  return { id: manifest.id, items, changes: changesFor(dir, changedFiles) };
}

/** Update one preset (or every installed one) in the account + the repo at `path`. */
export async function updatePreset(path: string, params: UpdatePresetParams = {}): Promise<UpdatePresetResult> {
  const root = resolve(path || ".");
  const ids = params.preset
    ? [params.preset.trim()]
    : (listPresets().presets ?? []).map((p) => p.id);

  const pulled = await pullSkills(path, { api: params.api, token: params.token });
  if (!pulled.ok) return { ok: false, code: pulled.code, message: pulled.message };
  // Personal rows only: a team copy is updated by its author's "Deploy update" (ADR-070).
  const personal = new Map(
    (pulled.skills ?? []).filter((s) => s.scope !== "workspace").map((s) => [s.name.toLowerCase(), s.body ?? ""]),
  );

  const presets: PresetUpdateReport[] = [];
  for (const id of ids) {
    const loaded = loadManifest(id);
    if (!("manifest" in loaded)) return { ok: false, code: loaded.code, message: loaded.message };
    const report = await updateOne(root, path, loaded.dir, loaded.manifest, personal, params);
    // Without an explicit id, skip presets that have nothing installed here at all.
    if (!params.preset && report.items.every((i) => i.state === "not_installed")) continue;
    presets.push(report);
  }
  return { ok: true, presets };
}

/**
 * Offline, read-only: which presets' REPO files (script, snippet) here are behind this
 * package's bodies. `alkahest update` prints one line from it — skills need the network and
 * a token, so they are left to `preset update` itself.
 */
export async function repoPresetsBehind(path: string): Promise<string[]> {
  const root = resolve(path || ".");
  const behind: string[] = [];
  for (const p of listPresets().presets ?? []) {
    const loaded = loadManifest(p.id);
    if (!("manifest" in loaded)) continue;
    const report = await updateOne(root, path, loaded.dir, { ...loaded.manifest, skills: [] }, new Map(), { dryRun: true });
    if (report.items.some((i) => ["replaced", "replaced_edits", "created", "merged", "merged_with_conflicts", "diverged"].includes(i.state))) behind.push(p.id);
  }
  return behind;
}
