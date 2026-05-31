import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import { loadCredentials, resolveApiUrl, saveCredentials } from "../core/credentials.js";

/**
 * Upload `<projectRoot>/.alkahest/map.json` to the hosted viewer so non-developers
 * can open the product map at a shareable link — no install, no login to view.
 * Only map.json is uploaded; source code never leaves the machine.
 *
 * Auth is a personal token from `alkahest login` (tied to your GitHub account).
 * First publish of a project auto-creates it under your account; the returned slug
 * is remembered per project path so later publishes update the same link.
 */
export interface PublishOptions {
  /** API base URL (or env ALKAHEST_API_URL). */
  api?: string;
  /** Project name shown in the URL/dashboard (first publish only; defaults to folder name). */
  name?: string;
}

async function postJson(
  url: string,
  body: unknown,
  token?: string,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
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

export async function publish(path: string, options: PublishOptions): Promise<void> {
  const projectRoot = resolve(path);
  const mapFile = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapFile)) {
    console.error(`[alkahest] no ${OUTPUT_DIR}/map.json found — run 'alkahest scan' first.`);
    process.exitCode = 1;
    return;
  }
  const map = JSON.parse(readFileSync(mapFile, "utf8"));

  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(options.api, creds);
  if (!apiUrl) {
    console.error(
      "[alkahest] missing API URL. Pass --api <url> or set ALKAHEST_API_URL\n" +
        "  e.g. https://<ref>.supabase.co/functions/v1",
    );
    process.exitCode = 1;
    return;
  }
  if (!creds.token) {
    console.error("[alkahest] not logged in. Run 'alkahest login --token alk_…' first.");
    process.exitCode = 1;
    return;
  }

  // Known project → send its slug (update). New project → omit slug (server creates it).
  const known = creds.projects?.[projectRoot];
  const reqBody: Record<string, unknown> = { map };
  if (known) reqBody.slug = known.slug;
  else reqBody.name = options.name || basename(projectRoot);

  const pub = await postJson(`${apiUrl}/publish`, reqBody, creds.token);
  if (!pub.ok) {
    const err = pub.body?.error;
    const msg = pub.body?.message ?? pub.body?.error ?? "unknown error";
    if (err === "plan_limit") {
      console.error(`[alkahest] ✗ Publish blocked — ${msg}`);
      console.error("  Upgrade to Pro, or 'alkahest view' still works locally for free.");
    } else if (err === "invalid_token") {
      console.error("[alkahest] ✗ Token invalid or revoked. Run 'alkahest login' again.");
    } else if (err === "forbidden") {
      console.error(`[alkahest] ✗ ${msg}`);
    } else {
      console.error(`[alkahest] publish failed (${pub.status}): ${msg}`);
    }
    process.exitCode = 1;
    return;
  }

  // Remember the slug for this project path so future publishes update the same link.
  if (!known && pub.body.slug) {
    creds.projects = creds.projects ?? {};
    creds.projects[projectRoot] = { slug: pub.body.slug };
    saveCredentials(creds);
  }

  console.log(`[alkahest] published ${pub.body.slug}`);
  console.log(`  → ${pub.body.viewerUrl ?? pub.body.mapUrl}`);
}
