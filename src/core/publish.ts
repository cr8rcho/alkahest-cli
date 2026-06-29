import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { OUTPUT_DIR } from "./emit.js";
import { loadCredentials, resolveApiUrl, resolveToken, saveCredentials } from "./credentials.js";
import { resolveProject } from "./project.js";
import { listProjects, rankPublishCandidates, localMapCounts, type PublishCandidate } from "./listProjects.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/**
 * Shared publish logic used by both the `alkahest publish` CLI command and the MCP
 * `publish` tool. Uploads `<projectRoot>/.alkahest/map.json` to the hosted viewer.
 * Only map.json is sent; source code never leaves the machine.
 *
 * This returns a structured result and never writes to stdout/stderr — the MCP server
 * reserves stdout for JSON-RPC, so callers (CLI) own all user-facing output.
 */
export interface PublishParams {
  /** API base URL (else env ALKAHEST_API_URL / saved creds). */
  api?: string;
  /** Project name shown in the URL/dashboard (first publish only; defaults to folder name). */
  name?: string;
  /** Publish token (else env ALKAHEST_TOKEN / saved creds). */
  token?: string;
  /** Which surface initiated this — sent to the server for version/compat handling. */
  source?: "cli" | "mcp";
  /** Force-target an existing project by slug (else resolved from the checkout/creds). */
  slug?: string;
  /** Which CODE map to publish to (a project can hold several). Omit → the checkout's remembered
   *  map, else the project's sole code map (the server returns `ambiguous_map` if there are >1). */
  mapSlug?: string;
  /**
   * Slug-less publish only (ADR-022 B): when no slug is resolved AND existing owned projects look
   * like this one, the caller is asked to confirm overwriting one instead of silently creating a
   * duplicate. The callback receives the ranked candidates and returns the chosen target (slug +
   * optional code map) to UPDATE, or null to create a new project. When omitted (e.g. the MCP
   * server / non-interactive), publishMap does NOT auto-overwrite — it returns `ambiguous_project`
   * with the candidates so the caller can re-publish with an explicit slug.
   */
  confirm?: (candidates: PublishCandidate[]) => Promise<{ slug: string; mapSlug?: string } | null>;
}

export interface PublishResult {
  ok: boolean;
  slug?: string;
  /** The code map the publish landed on (a project can hold several). */
  mapSlug?: string;
  viewerUrl?: string | null;
  mapUrl?: string;
  /** Whether this was the project's first publish (a new slug was created). */
  created?: boolean;
  /** Machine-readable failure code: no_map | no_api | no_token | ambiguous_map | network | <server error>. */
  code?: string;
  /** Human-readable failure message. */
  message?: string;
  /** Present on ambiguous_map: the project's code maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
  /** Present on ambiguous_project (slug-less publish, no confirm): owned projects that look like
   *  this one — re-publish with one of their slugs to update, or --name to force a new project. */
  candidates?: PublishCandidate[];
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

export async function publishMap(path: string, params: PublishParams = {}): Promise<PublishResult> {
  // Resolve the project root + its slug robustly (local .alkahest/project.json, walk-up,
  // then saved creds) so a re-publish UPDATES the existing project instead of trying to
  // create a new one — even when the cwd isn't the exact dir it was first published from.
  const { root: projectRoot, slug: knownSlug, mapSlug: knownMap } = resolveProject(path, params.slug);
  // Target code map: explicit --map, else the one this checkout last published to.
  const mapSlug = params.mapSlug || knownMap;
  const mapFile = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapFile)) {
    return { ok: false, code: "no_map", message: `No ${OUTPUT_DIR}/map.json found — run scan first.` };
  }
  const map = JSON.parse(readFileSync(mapFile, "utf8"));

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

  // Resolve the target. Known slug → update it. Slug-less → before blindly creating a new project
  // (the old behaviour that duplicated projects when the local slug was lost), check whether an
  // owned project already looks like this one (ADR-022 B). If so: ask `confirm` to overwrite, or —
  // when there's no confirm (MCP/non-interactive) — refuse to auto-create and surface the candidates.
  let targetSlug = knownSlug;
  let targetMap = mapSlug;
  if (!targetSlug) {
    const list = await listProjects({ api: params.api, token: params.token });
    if (list.ok && list.projects?.length) {
      const localName = params.name || basename(projectRoot);
      const candidates = rankPublishCandidates(localName, localMapCounts(map), list.projects);
      if (candidates.length) {
        if (params.confirm) {
          const chosen = await params.confirm(candidates);
          if (chosen) { targetSlug = chosen.slug; if (chosen.mapSlug) targetMap = chosen.mapSlug; }
        } else {
          return {
            ok: false,
            code: "ambiguous_project",
            message:
              "This looks like an already-published project. Re-publish with --slug <slug> to update it, " +
              "or --name <name> to force a new project.",
            candidates,
          };
        }
      }
    }
    // list failures (network/auth) are non-fatal here — fall through to the normal create path.
  }

  // Target slug → update that project. None → omit slug (server creates a new one).
  const reqBody: Record<string, unknown> = {
    map,
    client: { source: params.source ?? "cli", version: pkg.version },
  };
  if (targetSlug) reqBody.slug = targetSlug;
  else reqBody.name = params.name || basename(projectRoot);
  if (targetMap) reqBody.mapSlug = targetMap;

  const pub = await postJson(`${apiUrl}/publish`, reqBody, token);
  if (!pub.ok) {
    return {
      ok: false,
      code: pub.body?.error ?? "http",
      message: pub.body?.message ?? pub.body?.error ?? `publish failed (${pub.status})`,
      // `ambiguous_map` carries the project's code maps so callers can guide the choice.
      ...(Array.isArray(pub.body?.maps) ? { maps: pub.body.maps as { slug: string; name: string | null }[] } : {}),
    };
  }

  const created = !targetSlug && Boolean(pub.body.slug);
  // Persist the slug both in creds (path-keyed) and WITH the checkout (.alkahest/project.json),
  // every publish — so future publishes AND comments (pull/add/MCP) resolve it from any cwd.
  if (pub.body.slug) {
    // Remember the code map the server resolved (pub.body.mapSlug) so re-publishes target it
    // even once the project has several code maps.
    const entry = { slug: pub.body.slug, ...(pub.body.mapSlug ? { mapSlug: pub.body.mapSlug } : {}) };
    creds.projects = creds.projects ?? {};
    creds.projects[projectRoot] = entry;
    saveCredentials(creds);
    try {
      mkdirSync(join(projectRoot, OUTPUT_DIR), { recursive: true });
      writeFileSync(join(projectRoot, OUTPUT_DIR, "project.json"), JSON.stringify(entry, null, 2) + "\n");
    } catch { /* non-fatal — creds + --slug still work */ }
  }

  return {
    ok: true,
    slug: pub.body.slug,
    mapSlug: pub.body.mapSlug,
    viewerUrl: pub.body.viewerUrl ?? null,
    mapUrl: pub.body.mapUrl,
    created,
  };
}
