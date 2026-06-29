import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * A code map's publish history (alkahest ADR-023). Every publish appends a map_versions row
 * (created_at + stats + a node-level change summary), so this answers "when did it publish and what
 * changed" — the timeline that publish itself never surfaced. Talks to the `map-versions` edge
 * function with an alk_ token. Like the other core clients it returns a structured result and never
 * writes to stdout/stderr.
 */

export interface HistoryStats {
  screens: number;
  resources: number;
  transitions: number;
  calls: number;
}
export interface HistoryDiff {
  screens: { added: { id: string; label: string }[]; removed: { id: string; label: string }[]; more?: { added: number; removed: number } };
  resources: { added: { id: string; label: string }[]; removed: { id: string; label: string }[]; more?: { added: number; removed: number } };
}
export interface MapVersion {
  createdAt: string;
  stats: HistoryStats | null;
  /** Node-level change vs the previous publish; null for versions published before ADR-023 / first publish. */
  diff: HistoryDiff | null;
}
export interface HistoryResult {
  ok: boolean;
  slug?: string;
  mapSlug?: string;
  versions?: MapVersion[];
  /** no_api | no_token | no_slug | not_found | forbidden | network | <server error>. */
  code?: string;
  message?: string;
}

export interface HistoryParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Which code map (omit → the project's sole/oldest code map). */
  map?: string;
  /** Max versions (default 50, server caps at 200). */
  limit?: number;
}

/** Fetch a code map's publish timeline (newest first). */
export async function listHistory(path: string, params: HistoryParams = {}): Promise<HistoryResult> {
  const creds = loadCredentials();
  const { slug } = resolveProject(path, params.slug);
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) return { ok: false, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  const token = resolveToken(params.token, creds);
  if (!token) return { ok: false, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };
  if (!slug) return { ok: false, code: "no_slug", message: "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>." };

  const q = new URLSearchParams({ slug });
  if (params.map) q.set("map", params.map);
  if (params.limit) q.set("limit", String(params.limit));

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/map-versions?${q.toString()}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "network", message: `could not reach ${apiUrl}/map-versions (${msg})` };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) return { ok: false, code: body?.error ?? "http", message: body?.message ?? body?.error ?? `history failed (${res.status})` };
  return { ok: true, slug: body?.slug, mapSlug: body?.mapSlug, versions: body?.versions ?? [] };
}
