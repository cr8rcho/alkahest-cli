import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pullSkills, saveSkill } from "./tasks.js";
import { createMap, listMaps } from "./maps.js";
import { resolveProject } from "./project.js";

/**
 * Docs presets (cloud ADR-083): installable bundles of an OPINION — a documentation
 * convention (account skills), a repo scaffold, a CLAUDE.md snippet carrying the agent
 * rules + mirroring spec, and a reference sync script. The preset gates nothing: every
 * step rides public primitives (skills-post upsert, plain file copies), so a user who
 * skips it and builds their own environment loses nothing. `docs init` is sugar for
 * discoverability, not a gate — an agent driving MCP `add_skill` + copying files by hand
 * lands in the same state.
 *
 * Bundles live in the package's `presets/` directory (shipped via npm `files`), which
 * doubles as the public, MIT-licensed home of the method itself.
 */

export interface PresetSummary {
  id: string;
  name: string;
  description: string;
  skills: string[];
  maps: string[];
  contents: string[];
}

export interface PresetsListResult {
  ok: boolean;
  presets?: PresetSummary[];
  code?: string;
  message?: string;
}

/** The packaged presets/ dir — package root relative to this file (works from dist/ and src/). */
function presetsRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "presets");
}

/** Read the registry (presets/index.json) — the single source of truth every surface lists from. */
export function listPresets(): PresetsListResult {
  const idx = join(presetsRoot(), "index.json");
  try {
    const parsed = JSON.parse(readFileSync(idx, "utf8"));
    return { ok: true, presets: (parsed?.presets ?? []) as PresetSummary[] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "no_registry", message: `Could not read the preset registry (${idx}): ${msg}` };
  }
}

interface PresetManifest {
  id: string;
  name: string;
  description: string;
  skills: { name: string; file: string }[];
  scaffold?: string;
  snippet?: string;
  scripts?: { file: string; dest: string }[];
  maps?: { slug: string; name?: string }[];
}

export interface DocsInitParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Preset id from the registry (default "as-built"). */
  preset?: string;
  /** Overwrite existing same-name skills with the preset bodies (default: skip them). */
  force?: boolean;
}

export interface DocsInitResult {
  ok: boolean;
  preset?: string;
  /** Per-skill outcome. "skipped" = a same-name skill already exists and --force was not given. */
  skills?: { name: string; action: "installed" | "updated" | "skipped" | "failed"; message?: string }[];
  /** Per-file scaffold outcome (paths relative to the target root). */
  scaffold?: { file: string; action: "created" | "skipped" }[];
  /** Reference script outcome. */
  scripts?: { dest: string; action: "created" | "skipped" }[];
  /** Note-map outcome — only attempted when the folder resolves to a project. */
  maps?: { slug: string; action: "created" | "exists" | "failed" | "no_project"; message?: string }[];
  /** The CLAUDE.md snippet body, for the command layer to print / append. */
  snippet?: string;
  /** True when the target CLAUDE.md already carries the snippet marker. */
  snippetInstalled?: boolean;
  code?: string;
  message?: string;
}

const SNIPPET_MARKER = "alkahest as-built preset";

/** Every file under dir, as paths relative to dir. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) visit(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  visit(dir);
  return out;
}

/**
 * Install a docs preset into the repo at `path`: account skills (upsert-by-name; existing
 * names are respected unless force), scaffold files (never overwritten), the reference
 * sync script, and — when the folder resolves to a project — the preset's note maps.
 * Returns the CLAUDE.md snippet for the caller to print or append; never edits CLAUDE.md
 * itself (file mutation is the command layer's explicit, opt-in step).
 */
export async function docsInit(path: string, params: DocsInitParams = {}): Promise<DocsInitResult> {
  const presetId = (params.preset ?? "as-built").trim();
  const dir = join(presetsRoot(), presetId);
  let manifest: PresetManifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "preset.json"), "utf8")) as PresetManifest;
  } catch {
    const known = listPresets().presets?.map((p) => p.id).join(", ") || "(registry unreadable)";
    return { ok: false, code: "unknown_preset", message: `No preset '${presetId}'. Available: ${known}.` };
  }
  const root = resolve(path || ".");
  const result: DocsInitResult = { ok: true, preset: presetId, skills: [], scaffold: [], scripts: [], maps: [] };

  // 1) Account skills — upsert by name, but never silently clobber a user-edited body:
  //    an existing name is skipped unless --force (mirrors deploy_skill being explicit).
  const existing = await pullSkills(path, { api: params.api, token: params.token });
  if (!existing.ok) return { ok: false, code: existing.code, message: existing.message };
  const personal = new Set(
    (existing.skills ?? []).filter((s) => s.scope !== "workspace").map((s) => s.name.toLowerCase()),
  );
  for (const s of manifest.skills ?? []) {
    const body = readFileSync(join(dir, s.file), "utf8");
    if (personal.has(s.name.toLowerCase()) && !params.force) {
      result.skills!.push({ name: s.name, action: "skipped" });
      continue;
    }
    const had = personal.has(s.name.toLowerCase());
    const saved = await saveSkill(path, { api: params.api, token: params.token, name: s.name, body });
    result.skills!.push(
      saved.ok
        ? { name: s.name, action: had ? "updated" : "installed" }
        : { name: s.name, action: "failed", message: saved.message ?? saved.code },
    );
  }

  // 2) Scaffold — copy the bundle's tree, never overwriting what exists.
  if (manifest.scaffold) {
    const src = join(dir, manifest.scaffold);
    for (const rel of walkFiles(src)) {
      const dest = join(root, ...rel.split("/"));
      if (existsSync(dest)) {
        result.scaffold!.push({ file: rel, action: "skipped" });
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(src, ...rel.split("/")), dest);
      result.scaffold!.push({ file: rel, action: "created" });
    }
  }

  // 3) Reference script — copied once; ownership transfers to the repo (we never update it).
  for (const s of manifest.scripts ?? []) {
    const dest = join(root, ...s.dest.split("/"));
    if (existsSync(dest)) {
      result.scripts!.push({ dest: s.dest, action: "skipped" });
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(dir, s.file), dest);
    result.scripts!.push({ dest: s.dest, action: "created" });
  }

  // 4) Note maps — best-effort, only when the folder is bound to a project. No project is
  //    not an error: the maps can be created at publish/first-sync time instead.
  if (manifest.maps?.length) {
    const { slug } = resolveProject(path, params.slug);
    if (!slug) {
      for (const m of manifest.maps) result.maps!.push({ slug: m.slug, action: "no_project" });
    } else {
      const have = await listMaps(path, { api: params.api, token: params.token, slug: params.slug, type: "note" });
      const haveSlugs = new Set((have.ok ? have.maps ?? [] : []).map((m) => m.slug));
      for (const m of manifest.maps) {
        if (haveSlugs.has(m.slug)) {
          result.maps!.push({ slug: m.slug, action: "exists" });
          continue;
        }
        const made = await createMap(path, {
          api: params.api, token: params.token, slug: params.slug,
          mapSlug: m.slug, type: "note", mapName: m.name,
        });
        result.maps!.push(
          made.ok
            ? { slug: m.slug, action: "created" }
            : { slug: m.slug, action: "failed", message: made.message ?? made.code },
        );
      }
    }
  }

  // 5) Snippet — returned for the command layer; appending is its explicit opt-in step.
  if (manifest.snippet) {
    result.snippet = readFileSync(join(dir, manifest.snippet), "utf8");
    const claudeMd = join(root, "CLAUDE.md");
    result.snippetInstalled = existsSync(claudeMd) && readFileSync(claudeMd, "utf8").includes(SNIPPET_MARKER);
  }
  return result;
}

/** Append the snippet to the repo's CLAUDE.md (created if missing). The command layer's opt-in step. */
export function appendClaudeSnippet(path: string, snippet: string): { file: string; created: boolean } {
  const root = resolve(path || ".");
  const file = join(root, "CLAUDE.md");
  const created = !existsSync(file);
  if (created) writeFileSync(file, `${snippet.trimEnd()}\n`);
  else appendFileSync(file, `\n${snippet.trimEnd()}\n`);
  return { file, created };
}
