import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { createNote, linkNotes, mapNote, pullNotes, updateNote } from "./notes.js";

/**
 * Obsidian-vault importer: walk a folder of .md files and mirror it into the hosted note
 * pool — one note per file, then the files' [[wikilinks]] materialized as EXPLICIT note
 * edges (one-time, at import; cloud ADR-028 keeps bodies plain and never live-parses them,
 * so this is the sanctioned bridge for vaults that already speak [[…]]).
 *
 * Obsidian semantics honored:
 *  - the FILENAME is the page's canonical name (title = frontmatter `title:` > basename);
 *  - [[Target]], [[Target|alias]], [[Target#heading]], [[dir/Target]] all resolve to the
 *    target's basename, case-insensitively;
 *  - YAML frontmatter is stripped from the stored body (Obsidian hides it too).
 *
 * Idempotent by title: a file whose title matches an existing note (case-insensitive)
 * updates that note's body instead of creating a duplicate, so re-running an import
 * refreshes the map. Edges upsert server-side (notes-link), so links never duplicate.
 *
 * Like notes.ts, everything returns a structured result and never writes to stdout.
 */

export interface ImportFilePlan {
  /** Absolute path of the .md file. */
  file: string;
  /** Resolved note title (frontmatter `title:` > filename). */
  title: string;
  /** Obsidian canonical name = basename without extension (link-resolution key). */
  name: string;
  /** Body with the YAML frontmatter stripped. */
  body: string;
  /** Tree path = the file's subdirectory relative to the import root ('' at the root). */
  folder: string;
  /** Normalized [[wikilink]] targets found in the body (deduped, self-links dropped). */
  links: string[];
  /** What the import will do with it: create | update. */
  action: "create" | "update";
}

export interface NotesImportParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Folder of .md files (walked recursively; dot-dirs like .obsidian are skipped). */
  dir: string;
  /** Which note map the imported notes land on. Omit → the sole one (else `ambiguous_map`). */
  mapSlug?: string;
  /** Basenames to skip (matched with and without .md), e.g. index.md, log.md. */
  exclude?: string[];
  /** Plan only — scan, match, resolve links, but write nothing. */
  dryRun?: boolean;
}

export interface NotesImportResult {
  ok: boolean;
  /** The per-file plan (also filled on dry runs). */
  files?: ImportFilePlan[];
  created?: number;
  updated?: number;
  linked?: number;
  /** [[targets]] that matched no imported file and no existing note. */
  unresolved?: string[];
  /** Files that failed to write, with the server's message. */
  failures?: { file: string; message: string }[];
  code?: string;
  message?: string;
  maps?: { slug: string; name: string | null }[];
}

/** All .md files under root, skipping dot-dirs (.obsidian, .alkahest, .git, …). */
function walkMarkdown(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) visit(p);
      else if (st.isFile() && extname(name).toLowerCase() === ".md") out.push(p);
    }
  };
  visit(root);
  return out;
}

/** Split a leading YAML frontmatter block off the body; return { title?, rest }. */
function stripFrontmatter(raw: string): { title?: string; rest: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { rest: raw };
  const titleLine = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return { title: titleLine?.[1]?.trim() || undefined, rest: raw.slice(m[0].length) };
}

/** Normalize one [[…]] target: drop |alias and #heading, keep the basename segment. */
function normalizeTarget(inner: string): string {
  const noAlias = inner.split("|")[0];
  const noHeading = noAlias.split("#")[0];
  const segs = noHeading.split("/");
  return segs[segs.length - 1].trim();
}

/** Every distinct normalized [[wikilink]] target in a body (embeds `![[…]]` included). */
function extractLinks(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\[\]]+)\]\]/g)) {
    const t = normalizeTarget(m[1]);
    if (t) found.add(t);
  }
  return [...found];
}

export async function importNotes(path: string, params: NotesImportParams): Promise<NotesImportResult> {
  let files: string[];
  try {
    if (!statSync(params.dir).isDirectory()) return { ok: false, code: "bad_dir", message: `${params.dir} is not a directory.` };
    files = walkMarkdown(params.dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "bad_dir", message: `Could not read ${params.dir} (${msg}).` };
  }
  const excluded = new Set((params.exclude ?? []).map((e) => e.toLowerCase().replace(/\.md$/, "")));
  files = files.filter((f) => !excluded.has(basename(f, ".md").toLowerCase()));
  if (!files.length) return { ok: false, code: "no_files", message: `No .md files under ${params.dir}.` };

  // Existing pool notes (every readable map), for dedupe-by-title and cross-links into
  // pages that already live on the hosted wiki.
  const pull = await pullNotes(path, { api: params.api, token: params.token, slug: params.slug, bodies: "none" });
  if (!pull.ok) return { ok: false, code: pull.code, message: pull.message, maps: pull.mapList };
  const existingByTitle = new Map<string, { id: string; slug: string }>();
  for (const m of pull.maps ?? []) {
    for (const n of m.notes) existingByTitle.set(n.title.trim().toLowerCase(), { id: n.id, slug: n.slug });
  }

  const plans: ImportFilePlan[] = files.map((file) => {
    const { title: fmTitle, rest } = stripFrontmatter(readFileSync(file, "utf8"));
    const name = basename(file, ".md").trim();
    const title = fmTitle || name;
    const body = rest.trim();
    const links = extractLinks(body).filter((t) => t.toLowerCase() !== name.toLowerCase());
    const action = existingByTitle.has(title.trim().toLowerCase()) ? "update" as const : "create" as const;
    // The vault's directory structure becomes the note's tree path (cloud ADR-035).
    const rel = relative(params.dir, dirname(file));
    const folder = rel && rel !== "." ? rel.split(sep).join("/") : "";
    return { file, title, name, body, links, action, folder };
  });

  // Link-resolution index: an imported file's basename, or an existing note's title.
  const idByName = new Map<string, string>();
  const wantsResolution = new Set(plans.flatMap((p) => p.links.map((t) => t.toLowerCase())));

  if (params.dryRun) {
    const resolvable = new Set(plans.map((p) => p.name.toLowerCase()));
    for (const t of existingByTitle.keys()) resolvable.add(t);
    const unresolved = [...wantsResolution].filter((t) => !resolvable.has(t));
    return {
      ok: true, files: plans,
      created: plans.filter((p) => p.action === "create").length,
      updated: plans.filter((p) => p.action === "update").length,
      linked: plans.reduce((n, p) => n + p.links.filter((t) => resolvable.has(t.toLowerCase())).length, 0),
      unresolved,
    };
  }

  // Write pass 1 — the notes.
  const failures: { file: string; message: string }[] = [];
  let created = 0, updated = 0;
  for (const p of plans) {
    const shared = { api: params.api, token: params.token, slug: params.slug };
    const existing = existingByTitle.get(p.title.trim().toLowerCase());
    if (existing) {
      const res = await updateNote(path, { ...shared, note: existing.id, body: p.body, folder: p.folder || null });
      if (!res.ok || !res.note) { failures.push({ file: p.file, message: res.message ?? res.code ?? "update failed" }); continue; }
      // The note may live on other maps only — make sure it sits on the target map too.
      const mem = await mapNote(path, { ...shared, noteRef: existing.id, mapSlug: params.mapSlug });
      if (!mem.ok) { failures.push({ file: p.file, message: mem.message ?? mem.code ?? "map failed" }); continue; }
      idByName.set(p.name.toLowerCase(), existing.id);
      updated++;
    } else {
      const res = await createNote(path, { ...shared, mapSlug: params.mapSlug, title: p.title, body: p.body, folder: p.folder || undefined });
      if (!res.ok || !res.note) { failures.push({ file: p.file, message: res.message ?? res.code ?? "create failed" }); continue; }
      idByName.set(p.name.toLowerCase(), res.note.id);
      existingByTitle.set(p.title.trim().toLowerCase(), { id: res.note.id, slug: res.note.slug });
      created++;
    }
  }
  // Targets that aren't imported files can still hit pre-existing pool notes by title.
  for (const [title, n] of existingByTitle) if (!idByName.has(title)) idByName.set(title, n.id);

  // Write pass 2 — the [[wikilinks]], as explicit arrow edges (upserted server-side).
  let linked = 0;
  const unresolvedSet = new Set<string>();
  const seenPairs = new Set<string>();
  for (const p of plans) {
    const fromId = idByName.get(p.name.toLowerCase());
    if (!fromId) continue; // its write failed — already in failures
    for (const t of p.links) {
      const toId = idByName.get(t.toLowerCase());
      if (!toId) { unresolvedSet.add(t); continue; }
      if (toId === fromId) continue;
      const pair = `${fromId}→${toId}`;
      if (seenPairs.has(pair)) continue;
      seenPairs.add(pair);
      const res = await linkNotes(path, { api: params.api, token: params.token, slug: params.slug, from: fromId, to: toId, kind: "link" });
      if (!res.ok) failures.push({ file: p.file, message: `link → ${t}: ${res.message ?? res.code}` });
      else linked++;
    }
  }

  return { ok: true, files: plans, created, updated, linked, unresolved: [...unresolvedSet], failures };
}
