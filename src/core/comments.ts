import { resolve } from "node:path";
import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";

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
  created_at: string;
  updated_at: string;
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
