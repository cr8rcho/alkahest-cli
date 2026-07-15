import { createNote, getNote, linkNotes, mapNote, pullNotes, updateNote } from "../core/notes.js";
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
  };
  return known[code ?? ""] ?? `${action} failed: ${message}`;
};

export interface NotesAddOptions {
  api?: string; slug?: string; path?: string; map?: string;
  body?: string; parent?: string; noteSlug?: string; folder?: string;
}

export async function notesAdd(title: string, options: NotesAddOptions): Promise<void> {
  const res = await createNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    title, body: options.body, parent_id: options.parent, note_slug: options.noteSlug, folder: options.folder,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes add"));
  console.log(`[alkahest] created note "${res.note.title}" — slug ${res.note.slug} (id ${res.note.id})`);
}

export interface NotesUpdateOptions {
  api?: string; slug?: string; path?: string; map?: string;
  title?: string; body?: string; clearBody?: boolean; rename?: string;
  folder?: string; unfile?: boolean;
}

export async function notesUpdate(note: string, options: NotesUpdateOptions): Promise<void> {
  if (!options.title && options.body === undefined && !options.clearBody && !options.rename && options.folder === undefined && !options.unfile) {
    return die("Nothing to update — pass --title, --body (or --clear-body), --folder (or --unfile), and/or --rename.");
  }
  const res = await updateNote(options.path || ".", {
    api: options.api, slug: options.slug, mapSlug: options.map,
    note,
    title: options.title,
    body: options.clearBody ? null : options.body,
    new_slug: options.rename,
    folder: options.unfile ? null : options.folder,
  });
  if (!res.ok || !res.note) return die(failMessage(res.code, res.message, "notes update"));
  console.log(`[alkahest] updated note "${res.note.title}" — slug ${res.note.slug}`);
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
  api?: string; slug?: string; path?: string; map?: string; remove?: boolean;
}

/** Place a pool note on a note map (or take it off) — maps are lenses; the note is never deleted. */
export async function notesMap(note: string, options: NotesMapOptions): Promise<void> {
  const res = await mapNote(options.path || ".", {
    api: options.api, slug: options.slug, noteRef: note, mapSlug: options.map, remove: options.remove,
  });
  if (!res.ok) return die(failMessage(res.code, res.message, options.remove ? "notes unmap" : "notes map"));
  console.log(options.remove
    ? `[alkahest] removed ${res.note?.slug ?? note} from map ${res.map?.slug ?? ""} (the note stays in the project pool)`
    : `[alkahest] placed ${res.note?.slug ?? note} on map ${res.map?.slug ?? ""}`);
}

export interface NotesImportOptions {
  api?: string; slug?: string; path?: string; map?: string;
  exclude?: string[]; dryRun?: boolean;
}

/** Import a folder of Obsidian-style .md files: one note per file, [[wikilinks]] → explicit edges. */
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
  console.log(`[alkahest] ${label} ${res.files?.length ?? 0} file(s): ${res.created} new, ${res.updated} updated, ${res.linked} link(s)`);
  if (res.unresolved?.length) {
    console.log(`[alkahest] unresolved [[targets]] (no matching file or note): ${res.unresolved.join(", ")}`);
  }
  for (const f of res.failures ?? []) console.error(`[alkahest] ✗ ${f.file}: ${f.message}`);
  if (res.failures?.length) process.exitCode = 1;
}

export interface NotesLinkOptions {
  api?: string; slug?: string; path?: string;
  style?: string; remove?: boolean;
}

const STYLE_TO_KIND: Record<string, "link" | "child" | "relates"> = { arrow: "link", dotted: "child", dashed: "relates" };

export async function notesLink(from: string, to: string, options: NotesLinkOptions): Promise<void> {
  const kind = options.style ? STYLE_TO_KIND[options.style] : undefined;
  if (options.style && !kind) return die("--style must be arrow | dotted | dashed.");
  const res = await linkNotes(options.path || ".", {
    api: options.api, slug: options.slug, from, to, kind, remove: options.remove,
  });
  if (!res.ok) return die(failMessage(res.code, res.message, options.remove ? "notes unlink" : "notes link"));
  console.log(options.remove
    ? `[alkahest] unlinked ${from} → ${to}`
    : `[alkahest] linked ${from} → ${to}${options.style ? ` (${options.style})` : ""}`);
}
