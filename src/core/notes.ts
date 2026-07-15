import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * Client for the hosted Note Map (alkahest ADR-017 canvas + ADR-027 documents): notes are
 * addressable markdown documents (per-map `slug`) arranged on a canvas. The CLI/MCP talk to
 * the notes-post / notes-update / notes-pull edge functions with an alk_ token.
 *
 * The body is PLAIN markdown (ADR-028): it is never parsed for links. Connections are the
 * canvas's hand-drawn edges (or, in the future, explicit link calls).
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
  /** no_api | no_token | no_slug | no_title | not_found | ambiguous_map | slug_taken | invalid_token | forbidden | network | <server error>. */
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
  /** Existing note id — creates a 'child' edge parent→new. */
  parent_id?: string;
  /** Tree-sidebar path like 'raw/articles' (cloud ADR-035). Omit = unfiled. */
  folder?: string;
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
    note_slug: params.note_slug,
    parent_id: params.parent_id,
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
}

export async function updateNote(path: string, params: UpdateNoteParams): Promise<NoteWriteResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.note?.trim()) return { ok: false, code: "no_note", message: "A note slug (or id) is required." };

  const res = await request(`${ctx.apiUrl}/notes-update`, ctx.token, {
    slug: ctx.slug,
    mapSlug: params.mapSlug,
    note: params.note.trim(),
    title: params.title,
    body: params.body,
    folder: params.folder,
    new_slug: params.new_slug,
  });
  if (!res.ok) return fail(res, "update");
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
  /** A note address, or a cross target (ADR-030): 'issue:<uuid>' | 'code:s:…' / 'code:r:…'. */
  to: string;
  /** Note↔note only: 'link' (arrow, default) | 'child' (dotted) | 'relates' (dashed). */
  kind?: "link" | "child" | "relates";
  /** true → delete the link instead (note↔note: all kinds when kind omitted). */
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
 * Place a pool note on a note map, or take it off (cloud ADR-029 membership). Note maps are
 * lenses over the project's note pool — a note can sit on several maps at once, and removing
 * it from one never deletes the note. Add is an idempotent upsert (x/y update the layout).
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

export async function linkNotes(path: string, params: LinkNotesParams): Promise<NoteWriteResult & { removed?: boolean }> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.from?.trim() || !params.to?.trim()) return { ok: false, code: "bad_request", message: "from and to notes are required." };

  const res = await request(`${ctx.apiUrl}/notes-link`, ctx.token, {
    slug: ctx.slug,
    from: params.from.trim(),
    to: params.to.trim(),
    kind: params.kind,
    remove: params.remove === true,
  });
  if (!res.ok) return fail(res, params.remove ? "unlink" : "link");
  return { ok: true, removed: !!res.body?.removed };
}
