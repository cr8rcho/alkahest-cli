import { resolve } from "node:path";
import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import type { ProductMap } from "./types.js";

/**
 * Shared logic for `alkahest comments pull`. Reads the comments left on this project's
 * PUBLISHED map (hosted viewer) via the `comments-pull` edge function, so they can be
 * used during development. Comments live only in the cloud — there is no local
 * authoring; this is the read side of that loop (see alkahest-cloud ADR-001).
 *
 * Like publish.ts, this returns a structured result and never writes to stdout/stderr.
 */
export interface PullParams {
  /** API base URL (else env ALKAHEST_API_URL / saved creds). */
  api?: string;
  /** Project slug (else the saved slug for this project path). */
  slug?: string;
  /** Only unresolved comments. */
  open?: boolean;
  /** Publish token (else env ALKAHEST_TOKEN / saved creds). */
  token?: string;
}

export interface PulledComment {
  id: string;
  map_version_id: string | null;
  anchor_kind: string; // 'screen' | 'resource' | 'transition' | 'map'
  node_key: string; // 's:123' | 'r:45' | 'map'
  anchor_label: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  body: string;
  resolved: boolean;
  /** True if the anchored node is gone from the current map (route renamed/removed). */
  orphaned?: boolean;
  created_at: string;
  updated_at: string;
}

/** Where to act on a comment, joined from the local map. */
export interface CommentSource {
  // screen (node_key s:*) — the comment is on a page → one source file
  file?: string;
  route?: string;
  title?: string;
  /** UI elements on the screen, each with its line — in-file landmarks for the comment. */
  features?: { label: string; kind: string; line?: number }[];
  // resource (node_key r:*) — an API endpoint, not a single file
  path?: string;
  label?: string;
  kind?: string;
  /** Screens that call this endpoint (+ their file/line) — where to actually edit it. */
  callers?: { screen: string; file?: string; line?: number; trigger?: string }[];
}

/** A comment with the anchored node's source location joined in (from the local map). */
export interface EnrichedComment extends PulledComment {
  /** Where to go in the code to act on this comment — null if the node is orphaned. */
  source: CommentSource | null;
}

export interface PullResult {
  ok: boolean;
  slug?: string;
  name?: string | null;
  comments?: PulledComment[];
  /** no_api | no_token | no_slug | not_found | invalid_token | network | <server error>. */
  code?: string;
  message?: string;
}

async function getJson(
  url: string,
  token: string,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
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

export async function pullComments(path: string, params: PullParams = {}): Promise<PullResult> {
  const projectRoot = resolve(path);
  const creds = loadCredentials();

  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) {
    return {
      ok: false,
      code: "no_api",
      message: "Missing API URL. Set ALKAHEST_API_URL (or pass --api / run 'alkahest login --api <url>').",
    };
  }
  const token = resolveToken(params.token, creds);
  if (!token) {
    return {
      ok: false,
      code: "no_token",
      message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…').",
    };
  }
  const slug = params.slug || creds.projects?.[projectRoot]?.slug;
  if (!slug) {
    return {
      ok: false,
      code: "no_slug",
      message: "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>.",
    };
  }

  const qs = new URLSearchParams({ slug });
  if (params.open) qs.set("open", "1");
  const res = await getJson(`${apiUrl}/comments-pull?${qs.toString()}`, token);
  if (!res.ok) {
    return {
      ok: false,
      code: res.body?.error ?? "http",
      message: res.body?.message ?? res.body?.error ?? `pull failed (${res.status})`,
    };
  }

  const proj = (res.body?.projects ?? []).find((p: any) => p.slug === slug) ?? res.body?.projects?.[0];
  return {
    ok: true,
    slug,
    name: proj?.name ?? null,
    comments: (proj?.comments ?? []) as PulledComment[],
  };
}

async function postJson(
  url: string,
  body: unknown,
  token: string,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
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

/**
 * Join each comment's anchored node (node_key `s:{id}` / `r:{id}`) to its source location
 * in the local map, so a developer/agent can jump straight from a comment to the code.
 * `source` is null for the whole-map anchor or an orphaned node (no longer in the map).
 */
export function enrichComments(comments: PulledComment[], map: ProductMap): EnrichedComment[] {
  const screenById = new Map((map.screens ?? []).map((s) => [s.id, s]));
  const resById = new Map((map.resources ?? []).map((r) => [r.id, r]));
  const calls = map.calls ?? [];
  return comments.map((c) => {
    let source: CommentSource | null = null;
    if (c.node_key.startsWith("s:")) {
      // Screen comment → its source file + the UI elements on it (with line numbers),
      // so the comment body can be matched to a specific spot in the file.
      const s = screenById.get(c.node_key.slice(2));
      if (s) {
        source = {
          file: s.sourceFile, route: s.route, title: s.title,
          features: (s.features ?? []).map((f) => ({ label: f.label, kind: f.kind, line: f.loc?.line })),
        };
      }
    } else if (c.node_key.startsWith("r:")) {
      // Resource comment → the endpoint, plus the screens that call it (an endpoint has no
      // single source file, so the callers are where you actually edit it).
      const r = resById.get(c.node_key.slice(2));
      if (r) {
        source = {
          path: r.path, label: r.label, kind: r.kind,
          callers: calls
            .filter((x) => x.to === r.id)
            .map((x) => {
              const s = screenById.get(x.from);
              return { screen: s?.title || x.from, file: s?.sourceFile, line: x.loc?.line, trigger: x.trigger };
            }),
        };
      }
    }
    return { ...c, source };
  });
}

export interface ResolveResult {
  ok: boolean;
  id?: string;
  resolved?: boolean;
  code?: string;
  message?: string;
}

/** Mark a comment resolved/reopened via the `comments-resolve` edge function (owner/author only). */
export async function resolveComment(
  path: string,
  id: string,
  resolved: boolean,
  params: { api?: string; token?: string } = {},
): Promise<ResolveResult> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) return { ok: false, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  const token = resolveToken(params.token, creds);
  if (!token) return { ok: false, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };

  const res = await postJson(`${apiUrl}/comments-resolve`, { id, resolved }, token);
  if (!res.ok) {
    return { ok: false, code: res.body?.error ?? "http", message: res.body?.message ?? res.body?.error ?? `resolve failed (${res.status})` };
  }
  return { ok: true, id, resolved };
}
