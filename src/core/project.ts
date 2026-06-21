import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { OUTPUT_DIR } from "./emit.js";
import { loadCredentials } from "./credentials.js";

/**
 * Resolve a project's root + published slug from any path inside it.
 *
 * The slug↔project binding used to live ONLY in ~/.alkahest/credentials.json keyed by the
 * absolute path where `publish` ran — so it missed whenever the caller's cwd differed (an
 * MCP server's cwd, a subdirectory, a symlink, another machine). Now the slug also lives
 * WITH the checkout (`.alkahest/project.json`, written by publish; `.alkahest/comments.json`
 * left by pull), and we walk UP from the given path to find `.alkahest/`, so resolution is
 * cwd-independent.
 */

// A project's .alkahest/ is identified by one of these files. We do NOT match a bare
// `.alkahest/` dir, because the HOME config dir (~/.alkahest, holding credentials.json) would
// otherwise be picked up by walk-up and mistaken for a project root.
const PROJECT_MARKERS = ["map.json", "project.json", "comments.json"];

function isProjectDir(dir: string): boolean {
  return PROJECT_MARKERS.some((f) => existsSync(join(dir, OUTPUT_DIR, f)));
}

/** Nearest ancestor of `start` whose `.alkahest/` holds a project marker (else `resolve(start)`). */
export function findProjectRoot(start: string): string {
  const from = resolve(start || ".");
  let dir = from;
  for (;;) {
    if (isProjectDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from; // hit filesystem root with no project .alkahest/
    dir = parent;
  }
}

/** Slug stored with the checkout: .alkahest/project.json (publish) → .alkahest/comments.json (pull). */
export function localSlug(root: string): string | undefined {
  for (const file of ["project.json", "comments.json"]) {
    try {
      const j = JSON.parse(readFileSync(join(root, OUTPUT_DIR, file), "utf8"));
      if (j?.slug) return String(j.slug);
    } catch { /* missing or unparsable — try the next */ }
  }
  return undefined;
}

/** Code map this checkout publishes to, stored alongside the slug in .alkahest/project.json. */
export function localMapSlug(root: string): string | undefined {
  try {
    const j = JSON.parse(readFileSync(join(root, OUTPUT_DIR, "project.json"), "utf8"));
    if (j?.mapSlug) return String(j.mapSlug);
  } catch { /* missing or unparsable */ }
  return undefined;
}

/** Resolve { root, slug, mapSlug } from any path: explicit → local file → saved creds (by root/path). */
export function resolveProject(
  path: string,
  explicitSlug?: string,
): { root: string; slug?: string; mapSlug?: string } {
  const root = findProjectRoot(path);
  const creds = loadCredentials();
  const slug =
    explicitSlug ||
    localSlug(root) ||
    creds.projects?.[root]?.slug ||
    creds.projects?.[resolve(path || ".")]?.slug;
  const mapSlug =
    localMapSlug(root) ||
    creds.projects?.[root]?.mapSlug ||
    creds.projects?.[resolve(path || ".")]?.mapSlug;
  return { root, slug, mapSlug };
}
