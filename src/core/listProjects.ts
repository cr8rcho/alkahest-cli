import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";

/**
 * Account discovery for the hosted service (alkahest ADR-022). The `alk_` token is account-wide,
 * but until the `list-projects` edge function there was NO way to enumerate the workspaces/projects
 * it can reach — so a lost local slug (e.g. after a workspace move) left a silently-duplicated
 * project unrecoverable. `listProjects` fetches that list (backs the `projects` CLI command + the
 * `list_projects` MCP tool), and `rankPublishCandidates` reuses it to spot "this is already
 * published as X" before slug-less publish creates a new project.
 *
 * Like the other core clients (publish.ts/maps.ts) this returns a structured result and never
 * writes to stdout/stderr — the MCP server reserves stdout for JSON-RPC.
 */

export interface MapStats {
  screens?: number;
  resources?: number;
  transitions?: number;
  calls?: number;
}
export interface CodeMapFingerprint {
  mapSlug: string;
  name: string | null;
  /** map_versions.stats of the latest published version (null if never published). */
  stats: MapStats | null;
  lastPublishedAt: string | null;
}
export interface ProjectInfo {
  slug: string;
  name: string | null;
  isPublic: boolean;
  /** True when the caller owns the project — the only projects /publish lets you overwrite. */
  isOwner: boolean;
  capability: "editor" | "commenter" | "viewer";
  workspace: { id: string; slug: string; name: string | null } | null;
  updatedAt: string | null;
  createdAt: string | null;
  codeMaps: CodeMapFingerprint[];
}
export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string | null;
}
export interface ListProjectsResult {
  ok: boolean;
  workspaces?: WorkspaceInfo[];
  projects?: ProjectInfo[];
  /** no_api | no_token | invalid_token | network | <server error>. */
  code?: string;
  message?: string;
}

export interface ListProjectsParams {
  api?: string;
  token?: string;
}

/** List every workspace + project the authenticated account can reach (GET /list-projects). */
export async function listProjects(params: ListProjectsParams = {}): Promise<ListProjectsResult> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) {
    return { ok: false, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  }
  const token = resolveToken(params.token, creds);
  if (!token) {
    return { ok: false, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/list-projects`, { headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "network", message: `could not reach ${apiUrl}/list-projects (${msg})` };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    return { ok: false, code: body?.error ?? "http", message: body?.message ?? body?.error ?? `list projects failed (${res.status})` };
  }
  return { ok: true, workspaces: body?.workspaces ?? [], projects: body?.projects ?? [] };
}

// ── slug-less publish candidate matching ────────────────────────────────────────────────────────

export interface PublishCandidate {
  slug: string;
  projectName: string | null;
  /** Workspace name/slug for display. */
  workspace: string | null;
  /** The best-matching code map in the candidate, to re-publish onto. */
  mapSlug?: string;
  /** 0..1 similarity. */
  score: number;
  /** A near-certain match (exact slug-base/name) — safe to default the prompt to "yes". */
  strong: boolean;
}

const slugify = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// /publish mints `${slugify(name)}-${randomId(3)}` → a 6-hex suffix. Strip it to recover the base.
const stripSuffix = (slug: string) => slug.replace(/-[0-9a-f]{4,8}$/i, "");

/** The same top-level counts /publish stores as map_versions.stats — the local fingerprint. */
export function localMapCounts(map: any): MapStats {
  return {
    screens: map?.screens?.length ?? 0,
    resources: map?.resources?.length ?? 0,
    transitions: map?.transitions?.length ?? 0,
    calls: map?.calls?.length ?? 0,
  };
}

function countCloseness(a: MapStats, b: MapStats): number {
  const keys: (keyof MapStats)[] = ["screens", "resources", "transitions", "calls"];
  let diff = 0, total = 0;
  for (const k of keys) { const x = a[k] ?? 0, y = b[k] ?? 0; diff += Math.abs(x - y); total += x + y; }
  if (total === 0) return 0;
  return Math.max(0, 1 - diff / total);
}

/**
 * Rank OWNED projects that look like the same project as this checkout. The strongest signal is the
 * slug base: a re-publish from the same folder after losing the local slug would have produced a
 * slug whose base === slugify(folder). Counts (map_versions.stats vs the local map) refine it.
 * Only owned projects are considered — /publish refuses to overwrite a project you don't own.
 */
export function rankPublishCandidates(
  localName: string,
  localCounts: MapStats,
  projects: ProjectInfo[],
): PublishCandidate[] {
  const base = slugify(localName);
  const out: PublishCandidate[] = [];
  for (const p of projects) {
    if (!p.isOwner) continue;
    const projBase = stripSuffix(p.slug);
    const nameBase = slugify(p.name ?? "");
    let nameScore = 0;
    if (base && (projBase === base || nameBase === base)) nameScore = 1;
    else if (base && (projBase.includes(base) || base.includes(projBase) || nameBase.includes(base))) nameScore = 0.4;

    let bestClose = 0, bestMap: string | undefined;
    for (const cm of p.codeMaps) {
      if (!cm.stats) continue;
      const c = countCloseness(localCounts, cm.stats);
      if (c >= bestClose) { bestClose = c; bestMap = cm.mapSlug; }
    }
    if (!bestMap && p.codeMaps.length) bestMap = p.codeMaps[0].mapSlug; // fall back to first code map

    const score = 0.7 * nameScore + 0.3 * bestClose;
    if (score < 0.3) continue;
    out.push({
      slug: p.slug,
      projectName: p.name,
      workspace: p.workspace?.name ?? p.workspace?.slug ?? null,
      mapSlug: bestMap,
      score,
      strong: nameScore === 1 && score >= 0.6,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
