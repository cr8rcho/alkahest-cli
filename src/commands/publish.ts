import { publishMap } from "../core/publish.js";

/**
 * Upload `<projectRoot>/.alkahest/map.json` to the hosted viewer so non-developers
 * can open the product map at a shareable link — no install, no login to view.
 * Only map.json is uploaded; source code never leaves the machine.
 *
 * Auth is a personal token from `alkahest login` (or the ALKAHEST_TOKEN env).
 * First publish of a project auto-creates it under your account; the returned slug
 * is remembered per project path so later publishes update the same link.
 *
 * The actual work lives in core/publish.ts (shared with the MCP `publish` tool); this
 * command only maps the result to console output and an exit code.
 */
export interface PublishOptions {
  /** API base URL (or env ALKAHEST_API_URL). */
  api?: string;
  /** Project name shown in the URL/dashboard (first publish only; defaults to folder name). */
  name?: string;
  /** Force-update an existing project by slug (else resolved from the checkout/creds). */
  slug?: string;
  /** Which code map to publish to (a project can hold several). Default: the remembered one. */
  map?: string;
}

export async function publish(path: string, options: PublishOptions): Promise<void> {
  const res = await publishMap(path, { ...options, mapSlug: options.map, source: "cli" });
  if (!res.ok) {
    if (res.code === "no_map") {
      console.error(`[alkahest] no .alkahest/map.json found — run 'alkahest scan' first.`);
    } else if (res.code === "plan_limit") {
      console.error(`[alkahest] ✗ Publish blocked — ${res.message}`);
      console.error("  Upgrade to Pro, or 'alkahest view' still works locally for free.");
    } else if (res.code === "invalid_token") {
      console.error("[alkahest] ✗ Token invalid or revoked. Run 'alkahest login' again.");
    } else if (res.code === "client_too_old") {
      console.error(`[alkahest] ✗ ${res.message}`);
    } else if (res.code === "ambiguous_map") {
      console.error(`[alkahest] ✗ ${res.message}`);
      console.error("  See them with 'alkahest maps list', or publish to a new one with 'alkahest publish --map <slug>'.");
    } else {
      console.error(`[alkahest] publish failed: ${res.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[alkahest] published ${res.slug}${res.mapSlug ? ` (map: ${res.mapSlug})` : ""}`);
  console.log(`  → ${res.viewerUrl ?? res.mapUrl}`);
}
