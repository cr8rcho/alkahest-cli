import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * Client for the hosted Note Map (alkahest ADR-017): a mindmap-style free graph of notes per
 * published project — notes as nodes, free note→note edges. Notes live only in the cloud (the web
 * viewer edits them on an interactive canvas via RLS); the CLI/MCP author them through the
 * notes-post edge function with an alk_ token. There is no pull/update endpoint yet — creation
 * only (the canvas is where you read/arrange them).
 *
 * Like publish.ts/issues.ts, everything returns a structured result and never writes to
 * stdout/stderr.
 */

export interface Note {
  id: string;
  title: string;
  body: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteWriteResult {
  ok: boolean;
  note?: Note;
  /** no_api | no_token | no_slug | no_title | not_found | ambiguous_map | invalid_token | forbidden | network | <server error>. */
  code?: string;
  message?: string;
  /** Present on ambiguous_map / unknown-slug: the project's note maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
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
  /** Existing note id — creates a 'child' edge parent→new. */
  parent_id?: string;
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
    parent_id: params.parent_id,
  });
  if (!res.ok) return fail(res, "create");
  return { ok: true, note: res.body?.note };
}
