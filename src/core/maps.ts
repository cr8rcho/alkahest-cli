import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * Client for a project's maps (alkahest ADR-011): a project is a container of many
 * maps — code maps (published from `scan`) and issue maps — each addressed by a per-project
 * slug. Maps are equal (no privileged default), so when a project holds several of a type the
 * `publish` / `issues-post` functions can't guess which one and return `ambiguous_map`. These
 * two calls are the discovery + creation primitives that resolve that: `listMaps` enumerates a
 * project's maps and `createMap` adds one, both through the `maps` edge function with an alk_
 * token. Like publish.ts/issues.ts, everything returns a structured result and never writes to
 * stdout/stderr.
 */

export type MapType = "code" | "issue" | "note";

export interface MapInfo {
  id: string;
  slug: string;
  name: string | null;
  type: MapType;
  archived_at?: string | null;
  created_at?: string;
}

export interface MapsResult {
  ok: boolean;
  maps?: MapInfo[];
  map?: MapInfo;
  /** Resolved project root (nearest ancestor with .alkahest/). */
  root?: string;
  slug?: string;
  /** no_api | no_token | no_slug | not_found | forbidden | slug_taken | network | <server error>. */
  code?: string;
  message?: string;
}

interface AuthContext {
  apiUrl: string;
  token: string;
  root: string;
  slug?: string;
}

/** Resolve api/token/slug once; shared by both calls below (mirrors issues.ts/publish.ts). */
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
});

export interface ListMapsParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Restrict to one type (code | issue). Omit → all. */
  type?: MapType;
}

/** List the maps in a project (optionally filtered to one type). */
export async function listMaps(path: string, params: ListMapsParams = {}): Promise<MapsResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, ...ctx };

  const typeQ = params.type ? `&type=${encodeURIComponent(params.type)}` : "";
  const res = await request(`${ctx.apiUrl}/maps?slug=${encodeURIComponent(ctx.slug!)}${typeQ}`, ctx.token);
  if (!res.ok) return fail(res, "list maps");
  return { ok: true, root: ctx.root, slug: ctx.slug, maps: res.body?.maps ?? [] };
}

export interface CreateMapParams {
  api?: string;
  token?: string;
  slug?: string;
  /** The new map's slug (server slugifies: lowercase letters, numbers, dashes). */
  mapSlug: string;
  /** code | issue (default issue). */
  type?: MapType;
  /** Optional display name. */
  mapName?: string;
}

/** Create a new map in a project. Returns `slug_taken` (409) if the slug is already used. */
export async function createMap(path: string, params: CreateMapParams): Promise<MapsResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, ...ctx };
  if (!params.mapSlug?.trim()) return { ok: false, code: "no_slug", message: "A map slug is required." };

  const res = await request(`${ctx.apiUrl}/maps`, ctx.token, {
    slug: ctx.slug,
    mapSlug: params.mapSlug.trim(),
    type: params.type ?? "issue",
    mapName: params.mapName,
  });
  if (!res.ok) return fail(res, "create map");
  return { ok: true, root: ctx.root, slug: ctx.slug, map: res.body?.map };
}
