import type { ProductMap } from "./types.js";
import { resolveApiUrl } from "./credentials.js";

/**
 * Fetch a project's PUBLISHED code map through the `map` edge function (remote MCP, ADR-095
 * in the hosted repo): GET {api}/map/{project}[/{mapSlug}]/map.json with the alk_ token as
 * bearer. The gate applies the same visibility rules as the viewer; a full-access token reads
 * what its user can read. Returns null when unreadable (no project passed, private, unknown
 * slug, network failure) — callers answer with a "pass `project`" style hint.
 */
export async function fetchPublishedMap(opts: {
  api?: string;
  token: string;
  project?: string;
  mapSlug?: string;
}): Promise<ProductMap | null> {
  if (!opts.project) return null;
  const base = resolveApiUrl(opts.api, {});
  const url = `${base}/map/${encodeURIComponent(opts.project)}${opts.mapSlug ? `/${encodeURIComponent(opts.mapSlug)}` : ""}/map.json`;
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${opts.token}` } });
    if (!res.ok) return null;
    return (await res.json()) as ProductMap;
  } catch {
    return null;
  }
}
