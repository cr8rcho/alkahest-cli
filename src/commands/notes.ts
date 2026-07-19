import { createNote, editPropDefs, getNote, linkNotes, mapNote, pullNotes, updateNote, type PropDefInput } from "../core/notes.js";
import { importNotes } from "../core/notesImport.js";

/**
 * CLI surface of the hosted Note Map (cloud ADR-017 canvas + ADR-027 documents). `notes add`
 * creates a note, `notes list`/`show` read the map (notes-pull), and `notes update` edits one in
 * place (notes-update) — nothing is stored locally. Bodies are plain markdown documents
 * (ADR-028): connections are drawn on the canvas, never parsed from text.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined, action: string): string => {
  const known: Record<string, string> = {
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
    forbidden: "✗ Only the project owner or a collaborator can do this.",
    not_found: `✗ ${message ?? "Not found."}`,
    no_slug: message ?? "No published map for this project yet.",
    slug_taken: `✗ ${message ?? "That note slug is already taken in this map."}`,
    ambiguous_map: `✗ ${message ?? "This project has several note maps."}\n  See them with 'alkahest maps list', or make a new one with 'alkahest maps create <slug> --type note'.`,
    reason_required: `✗ ${message ?? "Deleting requires a one-line reason."}\n  Pass --reason \"<why>\" — it shows in the Trash and the activity journal.`,
    note_deleted: `✗ ${message ?? "This note is in the Trash."}\n  Restore it first with 'alkahest notes restore <note>'.`,
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

/**
 * Parse a `--props` JSON string into a property-VALUES object (same semantics as the MCP
 * `props` param: shallow-merged, a null value deletes that key). Returns { props } on success
 * or { error } with a caller-ready message — object only, arrays/scalars are rejected.
 */
function parseProps(raw: string): { props: Record<string, unknown> } | { error: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return { error: `--props must be a JSON object, e.g. --props '{"status": "done", "topic": null}' (couldn't parse it).` }; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: `--props must be a JSON object (key→value), not ${Array.isArray(parsed) ? "an array" : parsed === null ? "null" : typeof parsed}.` };
  }
  return { props: parsed as Record<string, unknown> };
}

export interface NotesAddOptions {
  api?: string; slug?: string; path?: string; map?: string;
  body?: string; noteSlug?: string; folder?: string; props?: string;
}

export async function notesAdd(title: string, options: NotesAddOptions): Promise<void> {
  let props: Record<string, unknown> | undefined;
  if (options.props !== undefined) {
    const p = parseProps(options.props);
    if ("error" in p) return die(p.error);
    props = p.props;
  }
  const res = await createNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    title, body: options.body, note_slug: options.noteSlug, folder: options.folder, props,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes add"));
  console.log(`[alkahest] created note "${res.note.title}" — slug ${res.note.slug} (id ${res.note.id})`);
}

export interface NotesUpdateOptions {
  api?: string; slug?: string; path?: string; map?: string;
  title?: string; body?: string; clearBody?: boolean; rename?: string;
  folder?: string; unfile?: boolean; props?: string;
}

export async function notesUpdate(note: string, options: NotesUpdateOptions): Promise<void> {
  if (!options.title && options.body === undefined && !options.clearBody && !options.rename && options.folder === undefined && !options.unfile && options.props === undefined) {
    return die("Nothing to update — pass --title, --body (or --clear-body), --folder (or --unfile), --props, and/or --rename.");
  }
  // --props is a JSON object of property VALUES, shallow-merged onto the note (a null value
  // deletes that key) — same semantics as the MCP update_note `props` param.
  let props: Record<string, unknown> | undefined;
  if (options.props !== undefined) {
    const p = parseProps(options.props);
    if ("error" in p) return die(p.error);
    props = p.props;
  }
  const res = await updateNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    note,
    title: options.title,
    body: options.clearBody ? null : options.body,
    new_slug: options.rename,
    folder: options.unfile ? null : options.folder,
    props,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes update"));
  console.log(`[alkahest] updated note "${res.note.title}" — slug ${res.note.slug}`);
}

export interface NotesDeleteOptions {
  api?: string; slug?: string; path?: string; map?: string;
  reason: string;
}

/** Soft-delete a note to the project Trash (cloud ADR-048) — restorable for 30 days. */
export async function notesDelete(note: string, options: NotesDeleteOptions): Promise<void> {
  const res = await updateNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    note, delete: true, reason: options.reason,
  });
  if (!res.ok || !res.deleted) return die(failMessage(res.code, res.message, "notes delete"));
  if (res.unchanged) return console.log(`[alkahest] note ${res.noteSlug ?? note} is already in the Trash — nothing to do.`);
  console.log(`[alkahest] deleted note ${res.noteSlug ?? note} — "${options.reason.trim()}"`);
  console.log(`[alkahest] it's in the project Trash, restorable for 30 days ('alkahest notes restore ${res.noteSlug ?? note}' or the web Trash view).`);
}

export interface NotesRestoreOptions {
  api?: string; slug?: string; path?: string; map?: string;
}

/** Bring a note back from the Trash (undoes a soft delete). */
export async function notesRestore(note: string, options: NotesRestoreOptions): Promise<void> {
  const res = await updateNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    note, restore: true,
  });
  if (!res.ok || !res.restored) return die(failMessage(res.code, res.message, "notes restore"));
  console.log(`[alkahest] restored note "${res.note?.title ?? note}" — slug ${res.note?.slug ?? note} (back from the Trash)`);
}

export interface NotesListOptions {
  api?: string; slug?: string; path?: string; map?: string; q?: string;
}

export async function notesList(options: NotesListOptions): Promise<void> {
  // The list prints slug/title/link counts only — skip the bodies server-side.
  const res = await pullNotes(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map, q: options.q, bodies: "none",
  });
  if (!res.ok || !res.maps) return die(failMessage(res.code, res.message, "notes list"));
  if (!res.maps.length) return console.log("[alkahest] no note maps in this project.");
  for (const m of res.maps) {
    console.log(`[alkahest] ${res.project?.slug}/${m.slug} — ${m.notes.length} note(s), ${m.edges.length} edge(s)`);
    for (const n of m.notes) {
      const links = m.edges.filter((e) => e.from_note === n.id).length;
      const backlinks = m.edges.filter((e) => e.to_note === n.id).length;
      const counts = links || backlinks ? `  (→${links} ←${backlinks})` : "";
      console.log(`  ${n.slug}  ${n.title}${counts}`);
    }
  }
}

export interface NotesShowOptions {
  api?: string; slug?: string; path?: string; map?: string;
}

export async function notesShow(note: string, options: NotesShowOptions): Promise<void> {
  const res = await getNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map, note,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes show"));
  const n = res.note;
  const where = res.maps?.length ? res.maps.map((m) => m.slug).join(", ") : "no map";
  console.log(`[alkahest] ${res.project?.slug}/${n.slug} — ${n.title}  [${where}]`);
  if (n.body) console.log(`\n${n.body}\n`);
  const name = (x: { slug?: string; title?: string; id: string }) => x.slug ?? x.title ?? x.id;
  for (const e of res.outgoing ?? []) console.log(`  → ${name(e.note)} (${e.kind})`);
  for (const e of res.incoming ?? []) console.log(`  ← ${name(e.note)} (${e.kind})`);
  for (const k of res.code_links ?? []) console.log(`  code → ${k}`);
  for (const i of res.issues ?? []) console.log(`  issue → ${i.title ?? i.id}${i.status ? ` [${i.status}]` : ""}`);
}

export interface NotesMapOptions {
  api?: string; slug?: string; path?: string; map?: string;
}

/** MOVE a note to a note map (cloud ADR-043 single-home — a note lives on exactly one map). */
export async function notesMap(note: string, options: NotesMapOptions): Promise<void> {
  const res = await mapNote(options.path || ".", {
    api: options.api, slug: options.slug, noteRef: note, mapSlug: options.map,
  });
  if (!res.ok) return die(failMessage(res.code, res.message, "notes map"));
  console.log(`[alkahest] moved ${res.note?.slug ?? note} to map ${res.map?.slug ?? ""}`);
}

export interface NotesImportOptions {
  api?: string; slug?: string; path?: string; map?: string;
  exclude?: string[]; dryRun?: boolean;
}

/** Import a folder of Obsidian-style .md files — one note per file; [[wikilinks]] stay in the text and render at read time. */
export async function notesImport(dir: string, options: NotesImportOptions): Promise<void> {
  const res = await importNotes(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    dir, exclude: options.exclude, dryRun: options.dryRun,
  });
  if (!res.ok) {
    if (res.code === "ambiguous_map" && res.maps?.length) {
      return die(`${res.message}\n  Pass --map with one of: ${res.maps.map((m) => m.slug).join(", ")}`);
    }
    return die(failMessage(res.code, res.message, "notes import"));
  }
  const label = options.dryRun ? "would import" : "imported";
  console.log(`[alkahest] ${label} ${res.files?.length ?? 0} file(s): ${res.created} new, ${res.updated} updated — ${res.linked} [[ref]](s) resolve (drawn from the text at read time)`);
  if (res.withProps) {
    const schema = options.dryRun
      ? "schema will be registered on the map"
      : `schema registered: ${res.defsAdded ?? 0} definition(s) added${res.defsMerged ? `, ${res.defsMerged} option set(s) merged` : ""}`;
    console.log(`[alkahest] frontmatter properties harvested from ${res.withProps} file(s) — ${schema}`);
  }
  if (res.unresolved?.length) {
    console.log(`[alkahest] unresolved [[targets]] (no matching file or note): ${res.unresolved.join(", ")}`);
  }
  for (const f of res.failures ?? []) console.error(`[alkahest] ✗ ${f.file}: ${f.message}`);
  if (res.failures?.length) process.exitCode = 1;
}

const PROP_TYPES = new Set(["text", "select", "multi", "date", "number", "checkbox"]);

/**
 * Parse a `--define` spec `key:type[:opt1,opt2]` into a PropDefInput. `options` only apply to
 * select/multi. Returns { def } or { error } with a caller-ready message.
 */
function parseDefine(spec: string): { def: PropDefInput } | { error: string } {
  const [key, type, optsRaw] = spec.split(":");
  const k = (key ?? "").trim();
  const t = (type ?? "").trim();
  if (!k || !PROP_TYPES.has(t)) {
    return { error: `--define must be 'key:type[:opt1,opt2]' with type ∈ text|select|multi|date|number|checkbox (got '${spec}').` };
  }
  const options = optsRaw ? optsRaw.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
  return { def: { key: k, type: t as PropDefInput["type"], ...(options?.length ? { options } : {}) } };
}

export interface NotesPropsOptions {
  api?: string; slug?: string; path?: string; map?: string;
  define?: string[]; remove?: string[];
}

/**
 * Edit a note map's property SCHEMA (cloud ADR-044 §5): --define registers/merges definitions,
 * --remove unregisters them. Remove is non-destructive — note values survive as "unregistered".
 */
export async function notesProps(options: NotesPropsOptions): Promise<void> {
  const remove = (options.remove ?? []).map((k) => k.trim()).filter(Boolean);
  const defs: PropDefInput[] = [];
  for (const spec of options.define ?? []) {
    const p = parseDefine(spec);
    if ("error" in p) return die(p.error);
    defs.push(p.def);
  }
  if (!defs.length && !remove.length) {
    return die("Nothing to do — pass --define <key:type> to register or --remove <key...> to unregister property definitions.");
  }
  const res = await editPropDefs(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map, defs, remove,
  });
  if (!res.ok) {
    if (res.code === "ambiguous_map" && res.maps?.length) {
      return die(`${res.message}\n  Pass --map with one of: ${res.maps.map((m) => m.slug).join(", ")}`);
    }
    return die(failMessage(res.code, res.message, "notes props"));
  }
  const parts: string[] = [];
  if (res.added) parts.push(`${res.added} registered`);
  if (res.merged) parts.push(`${res.merged} option set(s) merged`);
  if (res.removed) parts.push(`${res.removed} unregistered`);
  if (res.skipped) parts.push(`${res.skipped} skipped (unknown, reserved, or type-mismatch)`);
  console.log(`[alkahest] property schema updated: ${parts.join(", ") || "no change"} — removed defs keep their note values (shown "unregistered").`);
}

export interface NotesLinkOptions {
  api?: string; slug?: string; path?: string;
  remove?: boolean;
}

export async function notesLink(from: string, to: string, options: NotesLinkOptions): Promise<void> {
  const res = await linkNotes(options.path || ".", {
    api: options.api, slug: options.slug, from, to, remove: options.remove,
  });
  if (!res.ok) return die(failMessage(res.code, res.message, options.remove ? "notes unlink" : "notes link"));
  console.log(options.remove
    ? `[alkahest] unlinked ${from} → ${to}`
    : `[alkahest] linked ${from} → ${to}`);
}
