import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { loadCredentials, saveCredentials } from "./credentials.js";
import { OUTPUT_DIR } from "./emit.js";
import type { ProjectInfo } from "./listProjects.js";
import { findProjectRoot, localMapSlug, localSlug } from "./project.js";

/**
 * Bind a folder to a project WITHOUT publishing — the piece `publish` used to be the only
 * writer of (`.alkahest/project.json`). Backs `alkahest link` / `alkahest setup`.
 *
 * Why it exists: a repo with no code map (or one not published yet) had no way to remember its
 * project, so people copied `.mcp.json` between repos and hand-edited `ALKAHEST_PROJECT` into its
 * env. With the binding in the checkout, one user-scope MCP registration (`claude mcp add -s user`)
 * serves every repo: the server resolves the project from its cwd (`resolveProject`).
 *
 * Like the other core modules this never writes to stdout/stderr.
 */

/**
 * The folder a link belongs to: an existing project root (walk-up for `.alkahest/`), else the git
 * top-level (walk-up for `.git`), else the path itself. Linking from a subdirectory of a fresh repo
 * should bind the repo, not the subdirectory.
 */
export function linkRoot(path: string): string {
  const start = resolve(path || ".");
  const projectRoot = findProjectRoot(start);
  // Same markers as project.ts — a bare `.alkahest/` may be the HOME config dir, not a project.
  if (["map.json", "project.json", "comments.json"].some((f) => existsSync(join(projectRoot, OUTPUT_DIR, f)))) {
    return projectRoot;
  }
  // Stop at $HOME: a dotfiles repo there must not swallow every non-git folder under it.
  const home = homedir();
  let dir = start;
  for (;;) {
    if (dir === home) return start;
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

// ── matching what the user typed to a reachable project ─────────────────────────────────────────

const slugify = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const stripDna = (slug: string) => slug.replace(/-[0-9a-f]{6}$/i, "");

export interface ProjectMatch {
  /** The one project the input names, when it names exactly one. */
  project?: ProjectInfo;
  /** True when the input was the exact slug (not a name/base match). */
  exact: boolean;
  /** Several projects share the name/base — the caller must ask. */
  candidates: ProjectInfo[];
}

/**
 * Exact slug first; otherwise a project whose name or dna-less slug equals the input
 * ("hooves" → hooves-bd129a), but only when exactly one does.
 */
export function matchProject(input: string, projects: ProjectInfo[]): ProjectMatch {
  const want = input.trim();
  const exact = projects.find((p) => p.slug === want);
  if (exact) return { project: exact, exact: true, candidates: [] };
  const base = slugify(want);
  if (!base) return { exact: false, candidates: [] };
  const hits = projects.filter((p) => stripDna(p.slug) === base || slugify(p.name ?? "") === base);
  if (hits.length === 1) return { project: hits[0], exact: false, candidates: [] };
  return { exact: false, candidates: hits };
}

// ── the binding itself ──────────────────────────────────────────────────────────────────────────

export interface WriteLinkResult {
  /** Slug the folder was bound to before this call (from `.alkahest/project.json`). */
  previous?: string;
  /** False when the folder was already bound to this slug. */
  changed: boolean;
  file: string;
}

/**
 * Write `.alkahest/project.json` (and the path-keyed creds entry, as publish does). A re-link to
 * the same project keeps the remembered code map; a link to a different project drops it — that
 * map belongs to the old project.
 */
export function writeLink(root: string, slug: string): WriteLinkResult {
  const file = join(root, OUTPUT_DIR, "project.json");
  const previous = localSlug(root);
  const mapSlug = previous === slug ? localMapSlug(root) : undefined;
  const entry = { slug, ...(mapSlug ? { mapSlug } : {}) };
  const changed = previous !== slug;
  if (changed || !existsSync(file)) {
    mkdirSync(join(root, OUTPUT_DIR), { recursive: true });
    writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
  }
  const creds = loadCredentials();
  const prior = creds.projects?.[root];
  if (!prior || prior.slug !== entry.slug || prior.mapSlug !== entry.mapSlug) {
    creds.projects = { ...(creds.projects ?? {}), [root]: entry };
    saveCredentials(creds);
  }
  return { previous, changed, file };
}

// ── the repo's .mcp.json (the copied-around config this replaces) ───────────────────────────────

export interface McpJsonEntry {
  file: string;
  /** The `alkahest` server's env, as written. */
  env: Record<string, string>;
}

/** The `alkahest` entry of `<root>/.mcp.json`, if there is one. */
export function readMcpJson(root: string): McpJsonEntry | null {
  const file = join(root, ".mcp.json");
  try {
    const json = JSON.parse(readFileSync(file, "utf8"));
    const entry = json?.mcpServers?.alkahest;
    if (!entry) return null;
    const env = entry.env && typeof entry.env === "object" ? entry.env : {};
    return { file, env };
  } catch {
    return null;
  }
}

/**
 * Env keys in that entry that no longer do anything:
 * - ALKAHEST_TOKEN when a login is saved (resolveToken: saved login wins over the env);
 * - ALKAHEST_PROJECT when the folder has its own binding (resolveProject: project.json wins).
 */
export function shadowedMcpEnv(root: string): string[] {
  const entry = readMcpJson(root);
  if (!entry) return [];
  const out: string[] = [];
  if (entry.env.ALKAHEST_TOKEN && loadCredentials().token) out.push("ALKAHEST_TOKEN");
  if (entry.env.ALKAHEST_PROJECT && localSlug(root)) out.push("ALKAHEST_PROJECT");
  return out;
}

/** Remove `keys` from the alkahest entry's env (drops an emptied env). Rewrites the file as 2-space JSON. */
export function removeMcpEnv(root: string, keys: string[]): string[] {
  const file = join(root, ".mcp.json");
  const json = JSON.parse(readFileSync(file, "utf8"));
  const entry = json?.mcpServers?.alkahest;
  if (!entry?.env) return [];
  const removed = keys.filter((k) => k in entry.env);
  for (const k of removed) delete entry.env[k];
  if (Object.keys(entry.env).length === 0) delete entry.env;
  if (removed.length) writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  return removed;
}

// ── Claude Code user-scope registration ─────────────────────────────────────────────────────────

/** Is an executable named `cmd` on PATH? (No spawn — `alkahest --version` would recurse into us.) */
export function onPath(cmd: string): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        accessSync(join(dir, cmd + ext), constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

export type UserMcpState =
  /** `alkahest` is registered at Claude Code's user scope. */
  | "registered"
  /** Claude Code is installed, no user-scope `alkahest`. */
  | "absent"
  /** No `claude` on PATH. */
  | "no_claude";

/**
 * Ask Claude Code itself. Run from the temp dir so a project-scope `.mcp.json` in the caller's
 * folder can't answer for the user scope — that one only covers this repo, not the next.
 */
export function userMcpState(): UserMcpState {
  if (!onPath("claude")) return "no_claude";
  const res = spawnSync("claude", ["mcp", "get", "alkahest"], { cwd: tmpdir(), encoding: "utf8", timeout: 20_000 });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return /Scope:\s*User/i.test(out) ? "registered" : "absent";
}

/** `claude mcp add -s user alkahest -- alkahest mcp` — no token, no project: both resolve per folder. */
export function registerUserMcp(): { ok: boolean; message: string } {
  const res = spawnSync("claude", ["mcp", "add", "-s", "user", "alkahest", "--", "alkahest", "mcp"], {
    cwd: tmpdir(), encoding: "utf8", timeout: 20_000,
  });
  const message = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, message };
}
