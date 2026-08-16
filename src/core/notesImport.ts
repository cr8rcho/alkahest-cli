import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { createNote, mapNote, pullNotes, registerPropDefs, updateNote, type PropDefInput } from "./notes.js";

/**
 * Obsidian-vault importer: walk a folder of .md files and mirror it into the hosted note
 * pool — one note per file. The files' [[wikilinks]] need no materialization: the hosted
 * viewer AND notes-pull derive them from the bodies at read time (cloud ADR-034), so the
 * text stays the sole owner of the links; import only reports how many resolve.
 *
 * Obsidian semantics honored:
 *  - the FILENAME is the page's canonical name (title = frontmatter `title:` > basename);
 *  - [[Target]], [[Target|alias]], [[Target#heading]], [[dir/Target]] all resolve to the
 *    target's basename, case-insensitively;
 *  - YAML frontmatter is stripped from the stored body (Obsidian hides it too) — but its
 *    PROPERTIES are harvested (cloud ADR-044): `tags:` and the other scalar/list keys become
 *    the note's props, and the inferred schema (key + type + observed options) is registered
 *    on the target note map so the web shows typed rows. `title`/`created`/`updated`/cssclass
 *    keys are skipped (title feeds the note title; timestamps collide with real columns).
 *
 * Idempotent by SOURCE, then by title: every imported note is stamped with a `source_path`
 * prop (frontmatter `source_path:` override > the file's path relative to the import root),
 * and a file whose source matches an existing note updates that note IN PLACE — including a
 * title change, so retitling a document no longer mints a duplicate and orphans the old note.
 * Files without a source match fall back to the original case-insensitive title match (which
 * is also the upgrade path: the first re-import after this change matches by title and stamps
 * the source). Staged/transformed trees whose on-disk layout is derived (e.g. a docs mirror
 * whose filenames follow titles) should write the ORIGINAL repo path into `source_path:`
 * frontmatter so the identity survives the transform.
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
  /** Frontmatter properties harvested for notes.props (cloud ADR-044); {} when none. */
  props: Record<string, unknown>;
  /** Tree path = the file's subdirectory relative to the import root ('' at the root). */
  folder: string;
  /** Rename-safe identity stamped into props.source_path (frontmatter override > relpath). */
  source: string;
  /** Normalized [[wikilink]] targets found in the body (deduped, self-links dropped). */
  links: string[];
  /** What the import will do with it: create | update. */
  action: "create" | "update";
  /** For updates: which key found the existing note. */
  matched_by?: "source" | "title";
  /** For source-matched updates whose title changed: the note is retitled in place. */
  retitle?: boolean;
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
  /** Of the updates: notes retitled in place via a source_path match (no duplicate minted). */
  renamed?: number;
  linked?: number;
  /** Files whose frontmatter yielded properties. */
  withProps?: number;
  /** Schema registration on the target map (cloud ADR-044): definitions added / options merged. */
  defsAdded?: number;
  defsMerged?: number;
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

/** Frontmatter keys that never become props: title feeds the note title, timestamps collide
 *  with the hosted real columns, css/position are Obsidian display internals. */
const SKIPPED_KEYS = new Set(["title", "created", "updated", "cssclass", "cssclasses", "position"]);

/** Reserved provenance prop: the import's rename-safe identity key. Harvested from frontmatter
 *  as an override, else derived from the file's path relative to the import root; stamped into
 *  props on every write; matched BEFORE title so retitled documents update in place. Never
 *  registered as a notebook prop def (like `tags`). */
const SOURCE_KEY = "source_path";

/** One scalar: strip quotes, coerce booleans/numbers, keep everything else a string. */
function scalar(v: string): unknown {
  const t = v.trim().replace(/^["']|["']$/g, "");
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

/**
 * Split a leading YAML frontmatter block off the body and HARVEST its properties
 * (cloud ADR-044). Minimal YAML subset — the shapes Obsidian's Properties UI writes:
 * `key: value`, `key: [a, b]`, and block lists (`key:` + `  - item` lines). Nested
 * mappings are skipped. `tags: a, b` (legacy comma style) splits into a list.
 */
function parseFrontmatter(raw: string): { title?: string; props: Record<string, unknown>; rest: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { props: {}, rest: raw };
  const lines = m[1].split(/\r?\n/);
  let title: string | undefined;
  const props: Record<string, unknown> = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_가-힣][\w가-힣 .-]*):\s*(.*)$/);
    if (!kv) continue; // continuation / nested / malformed — skip
    const key = kv[1].trim();
    let value = kv[2].trim();
    // block list: `key:` followed by `  - item` lines
    if (!value) {
      const items: string[] = [];
      while (i + 1 < lines.length) {
        const li = lines[i + 1].match(/^\s+-\s+(.*)$/);
        if (!li) break;
        items.push(String(scalar(li[1])));
        i++;
      }
      if (!items.length) { // `key:` with a nested mapping (or empty) — skip its block
        while (i + 1 < lines.length && /^\s/.test(lines[i + 1])) i++;
        continue;
      }
      value = ""; // handled below via items
      if (key.toLowerCase() === "title") { title = items[0]; continue; }
      if (SKIPPED_KEYS.has(key.toLowerCase())) continue;
      props[key] = items;
      continue;
    }
    if (key.toLowerCase() === "title") { title = String(scalar(value)); continue; }
    if (SKIPPED_KEYS.has(key.toLowerCase())) continue;
    if (/^\[.*\]$/.test(value)) { // inline array
      props[key] = value.slice(1, -1).split(",").map((x) => String(scalar(x))).filter(Boolean);
    } else if (key.toLowerCase() === "tags") { // legacy comma/space tag string
      props[key] = value.split(/[,\s]+/).map((x) => String(scalar(x)).replace(/^#/, "")).filter(Boolean);
    } else {
      props[key] = scalar(value);
    }
  }
  // tags always normalizes to a de-duped string array without '#' prefixes.
  if (props.tags !== undefined) {
    const arr = Array.isArray(props.tags) ? props.tags : [props.tags];
    props.tags = [...new Set(arr.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean))];
    if (!(props.tags as string[]).length) delete props.tags;
  }
  return { title, props, rest: raw.slice(m[0].length) };
}

/** Infer the notebook schema (cloud ADR-044) from every file's harvested props: arrays → multi
 *  (options = observed values), booleans → checkbox, numbers → number, ISO dates → date, else
 *  text; mixed types settle on text. `tags` is the reserved virtual def — never registered. */
function inferDefs(plans: { props: Record<string, unknown> }[]): PropDefInput[] {
  const acc = new Map<string, { types: Set<string>; options: Set<string> }>();
  for (const p of plans) {
    for (const [key, v] of Object.entries(p.props)) {
      if (key.toLowerCase() === "tags") continue;
      let e = acc.get(key);
      if (!e) { e = { types: new Set(), options: new Set() }; acc.set(key, e); }
      if (Array.isArray(v)) { e.types.add("multi"); for (const o of v) e.options.add(String(o)); }
      else if (typeof v === "boolean") e.types.add("checkbox");
      else if (typeof v === "number") e.types.add("number");
      else if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) e.types.add("date");
      else e.types.add("text");
    }
  }
  return [...acc.entries()].map(([key, e]) => {
    const type = e.types.size === 1 ? ([...e.types][0] as PropDefInput["type"]) : "text";
    return { key, type, ...(type === "multi" ? { options: [...e.options] } : {}) };
  });
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
  const existingByTitle = new Map<string, { id: string; slug: string; title: string }>();
  const existingBySource = new Map<string, { id: string; slug: string; title: string }>();
  for (const m of pull.maps ?? []) {
    for (const n of m.notes) {
      existingByTitle.set(n.title.trim().toLowerCase(), { id: n.id, slug: n.slug, title: n.title });
      const src = n.props?.[SOURCE_KEY];
      if (typeof src === "string" && src.trim()) existingBySource.set(src.trim(), { id: n.id, slug: n.slug, title: n.title });
    }
  }
  /** Source first (rename-safe identity), title as the fallback/upgrade path. */
  const findExisting = (source: string, titleKey: string) =>
    existingBySource.has(source)
      ? { note: existingBySource.get(source)!, matched_by: "source" as const }
      : existingByTitle.has(titleKey)
        ? { note: existingByTitle.get(titleKey)!, matched_by: "title" as const }
        : null;

  const plans: ImportFilePlan[] = files.map((file) => {
    const { title: fmTitle, props, rest } = parseFrontmatter(readFileSync(file, "utf8"));
    // The provenance override rides in as a prop — pull it out so it never double-registers.
    const fmSource = typeof props[SOURCE_KEY] === "string" ? String(props[SOURCE_KEY]).trim() : "";
    delete props[SOURCE_KEY];
    const name = basename(file, ".md").trim();
    const title = fmTitle || name;
    const body = rest.trim();
    const links = extractLinks(body).filter((t) => t.toLowerCase() !== name.toLowerCase());
    const source = fmSource || relative(params.dir, file).split(sep).join("/");
    const hit = findExisting(source, title.trim().toLowerCase());
    // The vault's directory structure becomes the note's tree path (cloud ADR-035).
    const rel = relative(params.dir, dirname(file));
    const folder = rel && rel !== "." ? rel.split(sep).join("/") : "";
    return {
      file, title, name, body, props, links, folder, source,
      action: hit ? "update" as const : "create" as const,
      ...(hit ? { matched_by: hit.matched_by } : {}),
      ...(hit && hit.matched_by === "source" && hit.note.title.trim().toLowerCase() !== title.trim().toLowerCase()
        ? { retitle: true } : {}),
    };
  });

  if (params.dryRun) {
    const resolvable = new Set(plans.map((p) => p.name.toLowerCase()));
    for (const t of existingByTitle.keys()) resolvable.add(t);
    const wants = new Set(plans.flatMap((p) => p.links.map((t) => t.toLowerCase())));
    const unresolved = [...wants].filter((t) => !resolvable.has(t));
    return {
      ok: true, files: plans,
      created: plans.filter((p) => p.action === "create").length,
      updated: plans.filter((p) => p.action === "update").length,
      renamed: plans.filter((p) => p.retitle).length,
      linked: plans.reduce((n, p) => n + p.links.filter((t) => resolvable.has(t.toLowerCase())).length, 0),
      withProps: plans.filter((p) => Object.keys(p.props).length > 0).length,
      unresolved,
    };
  }

  // Write pass 1 — the notes. Every write stamps the source_path prop (shallow-merged), so a
  // pre-source pool upgrades itself: the first re-import matches by title and stamps identity.
  const failures: { file: string; message: string }[] = [];
  let created = 0, updated = 0, renamed = 0;
  for (const p of plans) {
    const shared = { api: params.api, token: params.token, slug: params.slug };
    const hit = findExisting(p.source, p.title.trim().toLowerCase());
    if (hit) {
      const retitle = hit.matched_by === "source" && hit.note.title.trim().toLowerCase() !== p.title.trim().toLowerCase();
      const res = await updateNote(path, {
        ...shared, note: hit.note.id, body: p.body, folder: p.folder || null,
        ...(retitle ? { title: p.title } : {}), // source identity survives a retitle — update in place
        props: { ...p.props, [SOURCE_KEY]: p.source }, // shallow-merge server-side
      });
      if (!res.ok || !res.note) { failures.push({ file: p.file, message: res.message ?? res.code ?? "update failed" }); continue; }
      // The note may live on other maps only — make sure it sits on the target map too.
      const mem = await mapNote(path, { ...shared, noteRef: hit.note.id, mapSlug: params.mapSlug });
      if (!mem.ok) { failures.push({ file: p.file, message: mem.message ?? mem.code ?? "map failed" }); continue; }
      existingBySource.set(p.source, { id: hit.note.id, slug: hit.note.slug, title: p.title });
      updated++;
      if (retitle) renamed++;
    } else {
      const res = await createNote(path, {
        ...shared, mapSlug: params.mapSlug, title: p.title, body: p.body, folder: p.folder || undefined,
        props: { ...p.props, [SOURCE_KEY]: p.source },
      });
      if (!res.ok || !res.note) { failures.push({ file: p.file, message: res.message ?? res.code ?? "create failed" }); continue; }
      existingByTitle.set(p.title.trim().toLowerCase(), { id: res.note.id, slug: res.note.slug, title: res.note.title });
      existingBySource.set(p.source, { id: res.note.id, slug: res.note.slug, title: res.note.title });
      created++;
    }
  }
  // [[refs]] are NOT written as edges — the hosted side derives them from the bodies at read
  // time (web canvas + notes-pull kind:'wikilink'). Just report what resolves.
  const resolvable = new Set(plans.map((p) => p.name.toLowerCase()));
  for (const t of existingByTitle.keys()) resolvable.add(t);
  let linked = 0;
  const unresolvedSet = new Set<string>();
  for (const p of plans) {
    for (const t of p.links) {
      if (resolvable.has(t.toLowerCase())) linked++;
      else unresolvedSet.add(t);
    }
  }

  // Register the harvested schema on the target map (cloud ADR-044) — non-destructive merge,
  // so a re-run only unions new options. Failures here don't fail the import (values landed;
  // the web shows unregistered keys as promotable "미등록" rows).
  let defsAdded = 0, defsMerged = 0;
  const defs = inferDefs(plans);
  if (defs.length) {
    const reg = await registerPropDefs(path, {
      api: params.api, token: params.token, slug: params.slug, mapSlug: params.mapSlug, defs,
    });
    if (reg.ok) { defsAdded = reg.added ?? 0; defsMerged = reg.merged ?? 0; }
  }

  return {
    ok: true, files: plans, created, updated, renamed, linked,
    withProps: plans.filter((p) => Object.keys(p.props).length > 0).length,
    defsAdded, defsMerged,
    unresolved: [...unresolvedSet], failures,
  };
}
