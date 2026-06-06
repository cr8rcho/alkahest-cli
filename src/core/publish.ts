import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { OUTPUT_DIR } from "./emit.js";
import { loadCredentials, resolveApiUrl, resolveToken, saveCredentials } from "./credentials.js";

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
}

export interface PublishResult {
  ok: boolean;
  slug?: string;
  viewerUrl?: string | null;
  mapUrl?: string;
  /** Whether this was the project's first publish (a new slug was created). */
  created?: boolean;
  /** Machine-readable failure code: no_map | no_api | no_token | network | <server error>. */
  code?: string;
  /** Human-readable failure message. */
  message?: string;
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
  const projectRoot = resolve(path);
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

  // Known project → send its slug (update). New project → omit slug (server creates it).
  const known = creds.projects?.[projectRoot];
  const reqBody: Record<string, unknown> = {
    map,
    client: { source: params.source ?? "cli", version: pkg.version },
  };
  if (known) reqBody.slug = known.slug;
  else reqBody.name = params.name || basename(projectRoot);

  const pub = await postJson(`${apiUrl}/publish`, reqBody, token);
  if (!pub.ok) {
    return {
      ok: false,
      code: pub.body?.error ?? "http",
      message: pub.body?.message ?? pub.body?.error ?? `publish failed (${pub.status})`,
    };
  }

  // Remember the slug for this project path so future publishes update the same link.
  const created = !known && Boolean(pub.body.slug);
  if (created) {
    creds.projects = creds.projects ?? {};
    creds.projects[projectRoot] = { slug: pub.body.slug };
    saveCredentials(creds);
  }
  // Also persist the slug WITH the checkout, so comments pull/add/MCP can resolve it
  // regardless of cwd / machine (not just from the homedir path-keyed creds map).
  if (pub.body.slug) {
    try {
      mkdirSync(join(projectRoot, OUTPUT_DIR), { recursive: true });
      writeFileSync(join(projectRoot, OUTPUT_DIR, "project.json"), JSON.stringify({ slug: pub.body.slug }, null, 2) + "\n");
    } catch { /* non-fatal — creds + --slug still work */ }
  }

  return {
    ok: true,
    slug: pub.body.slug,
    viewerUrl: pub.body.viewerUrl ?? null,
    mapUrl: pub.body.mapUrl,
    created,
  };
}
