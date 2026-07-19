import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * Client for the hosted Note Map (alkahest ADR-017 canvas + ADR-027 documents): notes are
 * addressable markdown documents (per-map `slug`) arranged on a canvas. The CLI/MCP talk to
 * the notes-post / notes-update / notes-pull edge functions with an alk_ token.
 *
 * The body is PLAIN markdown (ADR-028) — and since cloud ADR-036 it's the sole OWNER of
 * note↔note links: [[refs]] derive the graph at read time (edges come back with kind
 * 'wikilink'); explicit links exist only for cross targets (issue:/code:).
 *
 * Like publish.ts/issues.ts, everything returns a structured result and never writes to
 * stdout/stderr.
 */

export interface Note {
  id: string;
  slug: string;
  title: string;
  /** Omitted when listing with bodies:'none'; truncated (body_more=true) with 'excerpt'. */
  body?: string | null;
  /** Present (true) when an 'excerpt' listing truncated this body — get the note for the rest. */
  body_more?: boolean;
  /** Tree-sidebar path like 'raw/articles' (cloud ADR-035); null = unfiled. */
  folder?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteWriteResult {
  ok: boolean;
  note?: Note;
  /** Present after delete:true — the note was soft-deleted to the project Trash (ADR-048). */
  deleted?: boolean;
  /** Present after restore:true — the note came back from the Trash (`note` carries the row). */
  restored?: boolean;
  /** With `deleted`: the note was already in the Trash (idempotent no-op). */
  unchanged?: boolean;
  /** Echoed on delete (the full note row is not returned): the note's id + project slug. */
  id?: string;
  noteSlug?: string | null;
  /** no_api | no_token | no_slug | no_title | reason_required | note_deleted | not_found | ambiguous_map | slug_taken | invalid_token | forbidden | network | <server error>. */
  code?: string;
  message?: string;
  /** Present on ambiguous_map / unknown-slug: the project's note maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
}

export interface NoteEdge {
  from_note: string;
  to_note: string;
  kind: string;
}

export interface NoteMapGraph {
  slug: string;
  name: string | null;
  /** x/y = this map's layout for the note (membership row, cloud ADR-029). */
  notes: (Note & { x: number | null; y: number | null })[];
  edges: NoteEdge[];
  code_links: { note_id: string; node_key: string }[];
  issue_links: { note_id: string; issue: { id: string; title?: string; status?: string } }[];
}

export interface NotesPullResult {
  ok: boolean;
  project?: { slug: string; name: string | null };
  maps?: NoteMapGraph[];
  code?: string;
  message?: string;
  mapList?: { slug: string; name: string | null }[];
}

export interface NoteDetailResult {
  ok: boolean;
  project?: { slug: string; name: string | null };
  /** Which note maps the note sits on (pool model, cloud ADR-029 — can be several or none). */
  maps?: { slug: string; name: string | null }[];
  note?: Note;
  outgoing?: { kind: string; note: { id: string; slug?: string; title?: string } }[];
  incoming?: { kind: string; note: { id: string; slug?: string; title?: string } }[];
  code_links?: string[];
  issues?: { id: string; title?: string; status?: string }[];
  code?: string;
  message?: string;
  mapList?: { slug: string; name: string | null }[];
}

interface AuthContext {
  apiUrl: string;
  token: string;
  root: string;
  slug?: string;
}

/** Resolve api/token/slug once (mirrors issues.ts/maps.ts). */
function authContext(
  path: string,
  params: { api?: string; token?: string; slug?: string },
  needSlug: boolean,
): AuthContext | { code: string; message: string; root: string } {
  const creds = loadCredentials();
  const { root, slug } = resolveProject(path, params.slug);
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) {
    return { root, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  }
  const token = resolveToken(params.token, creds);
  if (!token) {
    return { root, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };
  }
  if (needSlug && !slug) {
    return { root, code: "no_slug", message: "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>." };
  }
  return { apiUrl, token, root, slug };
}

async function request(
  url: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined
      ? { headers: { authorization: `Bearer ${token}` } }
      : { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: "network", body: { error: `could not reach ${url} (${msg})` } };
  }
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: String(res.status), body: parsed };
}

const fail = (res: { status: string; body: any }, what: string) => ({
  ok: false as const,
  code: res.body?.error ?? "http",
  message: res.body?.message ?? res.body?.error ?? `${what} failed (${res.status})`,
  // `ambiguous_map` / unknown-slug errors carry a structured map list so callers can guide
  // ("pick one of …, or create one") without parsing the message string.
  ...(Array.isArray(res.body?.maps) ? { maps: res.body.maps as { slug: string; name: string | null }[] } : {}),
});

export interface CreateNoteParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Which note map to add to (a project can hold several). Omit → the sole one (else error). */
  mapSlug?: string;
  title: string;
  body?: string;
  /** Explicit wiki address (omit → derived from the title server-side). */
  note_slug?: string;
  /** Tree-sidebar path like 'raw/articles' (cloud ADR-035). Omit = unfiled. */
  folder?: string;
  /** Notebook properties (cloud ADR-044): flat key→value object; reserved key `tags` = string array. */
  props?: Record<string, unknown>;
}

export async function createNote(path: string, params: CreateNoteParams): Promise<NoteWriteResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.title?.trim()) return { ok: false, code: "no_title", message: "Note title is required." };

  const res = await request(`${ctx.apiUrl}/notes-post`, ctx.token, {
    slug: ctx.slug,
    mapSlug: params.mapSlug,
    title: params.title.trim(),
    body: params.body,
    folder: params.folder,
    props: params.props,
    note_slug: params.note_slug,
  });
  if (!res.ok) return fail(res, "create");
  return { ok: true, note: res.body?.note };
}

export interface UpdateNoteParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Which note map the note lives in. Omit → the sole one (else error). */
  mapSlug?: string;
  /** The note's wiki address (its slug), or a uuid. */
  note: string;
  title?: string;
  /** New body (replaces; null clears). */
  body?: string | null;
  /** Rename the note's wiki address. */
  new_slug?: string;
  /** Tree path (cloud ADR-035): string to set, null to unfile, undefined = untouched. */
  folder?: string | null;
  /** Notebook properties (cloud ADR-044): SHALLOW-MERGED onto the note's values; a null value deletes that key. */
  props?: Record<string, unknown>;
  /** true → SOFT-delete the note to the project Trash (ADR-048; restorable for 30 days). Requires `reason`. */
  delete?: boolean;
  /** One-line reason (≤200 chars), REQUIRED with delete — shown to the user in the Trash + activity journal. */
  reason?: string;
  /** true → restore a trashed note (undoes a soft delete). */
  restore?: boolean;
}

export async function updateNote(path: string, params: UpdateNoteParams): Promise<NoteWriteResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.note?.trim()) return { ok: false, code: "no_note", message: "A note slug (or id) is required." };
  if (params.delete && !params.reason?.trim()) {
    return { ok: false, code: "reason_required", message: "Deleting requires a one-line reason (≤200 chars) — it shows in the Trash and the activity journal." };
  }

  const res = await request(`${ctx.apiUrl}/notes-update`, ctx.token, {
    slug: ctx.slug,
    mapSlug: params.mapSlug,
    note: params.note.trim(),
    title: params.title,
    body: params.body,
    folder: params.folder,
    props: params.props,
    new_slug: params.new_slug,
    delete: params.delete === true ? true : undefined,
    reason: params.reason?.trim(),
    restore: params.restore === true ? true : undefined,
  });
  if (!res.ok) return fail(res, params.delete ? "delete" : params.restore ? "restore" : "update");
  if (res.body?.deleted) {
    return { ok: true, deleted: true, unchanged: !!res.body?.unchanged, id: res.body?.id, noteSlug: res.body?.slug ?? null };
  }
  if (res.body?.restored) return { ok: true, restored: true, note: res.body?.note };
  return { ok: true, note: res.body?.note };
}

export interface PullNotesParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Restrict to one note map (omit → every readable one). */
  mapSlug?: string;
  /** Filter notes by title/slug/body substring. */
  q?: string;
  /** List payload size (server-side, cloud ADR-033 scale follow-up): omit → full bodies;
   *  'excerpt' → first 240 chars + body_more flag; 'none' → body omitted. Search (`q`)
   *  always matches the full body regardless. */
  bodies?: "excerpt" | "none";
}

export async function pullNotes(path: string, params: PullNotesParams = {}): Promise<NotesPullResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };

  const qs = new URLSearchParams({ slug: ctx.slug! });
  if (params.mapSlug) qs.set("map", params.mapSlug);
  if (params.q) qs.set("q", params.q);
  if (params.bodies) qs.set("bodies", params.bodies);
  const res = await request(`${ctx.apiUrl}/notes-pull?${qs}`, ctx.token);
  if (!res.ok) {
    const f = fail(res, "pull");
    return { ok: false, code: f.code, message: f.message, mapList: f.maps };
  }
  return { ok: true, project: res.body?.project, maps: res.body?.maps ?? [] };
}

export interface GetNoteParams extends PullNotesParams {
  /** The note's wiki address (its slug), or a uuid. */
  note: string;
}

export async function getNote(path: string, params: GetNoteParams): Promise<NoteDetailResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.note?.trim()) return { ok: false, code: "no_note", message: "A note slug (or id) is required." };

  const qs = new URLSearchParams({ slug: ctx.slug!, note: params.note.trim() });
  if (params.mapSlug) qs.set("map", params.mapSlug);
  const res = await request(`${ctx.apiUrl}/notes-pull?${qs}`, ctx.token);
  if (!res.ok) {
    const f = fail(res, "get");
    return { ok: false, code: f.code, message: f.message, mapList: f.maps };
  }
  const b = res.body ?? {};
  return {
    ok: true,
    project: b.project,
    maps: b.maps ?? [],
    note: b.note,
    outgoing: b.outgoing ?? [],
    incoming: b.incoming ?? [],
    code_links: b.code_links ?? [],
    issues: b.issues ?? [],
  };
}

export interface LinkNotesParams {
  api?: string;
  token?: string;
  slug?: string;
  /** The note's address (project-unique slug, or uuid). */
  from: string;
  /** A cross target (ADR-030): 'issue:<uuid>' | 'code:s:…' / 'code:r:…'. Note↔note links live
   *  in the BODY as [[refs]] (cloud ADR-036) — the server rejects a plain note target. */
  to: string;
  /** true → delete the link instead. */
  remove?: boolean;
}

export interface MapNoteParams {
  api?: string;
  token?: string;
  slug?: string;
  /** The note's address (project-unique slug, or uuid). */
  noteRef: string;
  /** Which note map to place it on. Omit → the sole one (else `ambiguous_map`). */
  mapSlug?: string;
  /** true → take the note OFF the map instead. The note itself is never deleted. */
  remove?: boolean;
  /** Canvas position on that map (add only; omit → the server picks). */
  x?: number;
  y?: number;
}

export interface NoteMembershipResult {
  ok: boolean;
  /** The note row (id, project-unique slug, title) echoed by the server. */
  note?: { id: string; slug: string | null; title: string };
  /** The resolved note map (id + slug). */
  map?: { id: string; slug: string };
  /** Whether the note sits on the map after the call. */
  member?: boolean;
  code?: string;
  message?: string;
  /** Present on ambiguous_map / unknown-slug: the project's note maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
}

/**
 * MOVE a note to a note map (cloud ADR-043 single-home: a note lives on exactly ONE map —
 * this re-points its membership row; layout carries unless x/y pin it). The lens-era
 * `remove` is gone server-side: passing remove:true now returns 400 `single_home`.
 */
export async function mapNote(path: string, params: MapNoteParams): Promise<NoteMembershipResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.noteRef?.trim()) return { ok: false, code: "no_note", message: "A note slug (or id) is required." };

  const res = await request(`${ctx.apiUrl}/notes-map`, ctx.token, {
    slug: ctx.slug,
    note: params.noteRef.trim(),
    map: params.mapSlug,
    remove: params.remove === true,
    x: params.x,
    y: params.y,
  });
  if (!res.ok) return fail(res, params.remove ? "unmap" : "map");
  return { ok: true, note: res.body?.note, map: res.body?.map, member: !!res.body?.member };
}

export interface PropDefInput {
  key: string;
  type: "text" | "select" | "multi" | "date" | "number" | "checkbox";
  /** select/multi: shared option vocabulary. */
  options?: string[];
}

export interface RegisterPropDefsResult {
  ok: boolean;
  added?: number;
  merged?: number;
  skipped?: number;
  code?: string;
  message?: string;
  maps?: { slug: string; name: string | null }[];
}

/**
 * Register property DEFINITIONS on a note map (cloud ADR-044: defs = the notebook's schema,
 * values ride notes.props). Merge semantics server-side: unknown keys insert, same-type keys
 * union their options, type mismatches are skipped — never destructive. `tags` is reserved.
 */
export async function registerPropDefs(
  path: string,
  params: { api?: string; token?: string; slug?: string; mapSlug?: string; defs: PropDefInput[] },
): Promise<RegisterPropDefsResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.defs.length) return { ok: true, added: 0, merged: 0, skipped: 0 };

  const res = await request(`${ctx.apiUrl}/notes-props`, ctx.token, {
    slug: ctx.slug,
    map: params.mapSlug,
    defs: params.defs,
  });
  if (!res.ok) return fail(res, "props");
  return { ok: true, added: res.body?.added ?? 0, merged: res.body?.merged ?? 0, skipped: res.body?.skipped ?? 0 };
}

export async function linkNotes(path: string, params: LinkNotesParams): Promise<NoteWriteResult & { removed?: boolean }> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.from?.trim() || !params.to?.trim()) return { ok: false, code: "bad_request", message: "from and to notes are required." };

  const res = await request(`${ctx.apiUrl}/notes-link`, ctx.token, {
    slug: ctx.slug,
    from: params.from.trim(),
    to: params.to.trim(),
    remove: params.remove === true,
  });
  if (!res.ok) return fail(res, params.remove ? "unlink" : "link");
  return { ok: true, removed: !!res.body?.removed };
}
