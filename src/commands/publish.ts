import { createInterface } from "node:readline/promises";
import { publishMap } from "../core/publish.js";
import type { PublishCandidate } from "../core/listProjects.js";

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
 * command only maps the result to console output and an exit code. When the slug is lost
 * (e.g. after a workspace move) and an existing project looks like this one, we confirm
 * before overwriting rather than silently creating a duplicate (ADR-022 B) — interactively
 * here, via the `confirm` hook; non-TTY runs fall through to the `ambiguous_project` guidance.
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

/** Prompt (on stderr, keeping stdout clean) to overwrite a matched project instead of duplicating. */
async function confirmOverwrite(candidates: PublishCandidate[]): Promise<{ slug: string; mapSlug?: string } | null> {
  const top = candidates[0];
  const named = top.projectName && top.projectName !== top.slug ? ` "${top.projectName}"` : "";
  const where = top.workspace ? ` in ${top.workspace}` : "";
  console.error("[alkahest] This checkout isn't linked to a published map, but an existing project looks like it:");
  console.error(`  → ${top.slug}${named}${where}${top.mapSlug ? ` (map: ${top.mapSlug})` : ""}`);
  if (candidates.length > 1) {
    console.error(`  (${candidates.length - 1} other near-match${candidates.length - 1 === 1 ? "" : "es"} — pass --slug to pick a different one)`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const def = top.strong ? "Y/n" : "y/N";
    const ans = (await rl.question(`  Update this existing project instead of creating a new one? [${def}] `)).trim().toLowerCase();
    const yes = ans === "" ? top.strong : ans === "y" || ans === "yes";
    return yes ? { slug: top.slug, mapSlug: top.mapSlug } : null;
  } finally {
    rl.close();
  }
}

export async function publish(path: string, options: PublishOptions): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY);
  const res = await publishMap(path, {
    ...options,
    mapSlug: options.map,
    source: "cli",
    // Only offer the interactive overwrite prompt on a TTY. In CI (no TTY) we never auto-overwrite —
    // publishMap returns `ambiguous_project` and we print guidance, so a lost slug can't duplicate.
    ...(interactive ? { confirm: confirmOverwrite } : {}),
  });
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
    } else if (res.code === "ambiguous_project") {
      console.error(`[alkahest] ✗ ${res.message}`);
      for (const c of res.candidates ?? []) {
        const named = c.projectName && c.projectName !== c.slug ? ` — ${c.projectName}` : "";
        const where = c.workspace ? `  (${c.workspace})` : "";
        console.error(`    ${c.slug}${named}${where}`);
      }
      console.error("  e.g. 'alkahest publish --slug <slug>', or 'alkahest projects' to see them all.");
    } else {
      console.error(`[alkahest] publish failed: ${res.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`[alkahest] published ${res.slug}${res.mapSlug ? ` (map: ${res.mapSlug})` : ""}`);
  console.log(`  → ${res.viewerUrl ?? res.mapUrl}`);

  // The address changed server-side (project/map slug rename, ADR-037) — the local config is
  // already rewritten to the new one; say so, since links the user hands out should use it.
  if (res.renamedFrom) {
    console.log(`  ↪ project slug renamed: ${res.renamedFrom} → ${res.slug} (local config updated)`);
  }
  if (res.mapRenamedFrom) {
    console.log(`  ↪ map slug renamed: ${res.mapRenamedFrom} → ${res.mapSlug} (local config updated)`);
  }

  // Needs tail (cloud ADR-032): the server counts what's waiting on you in this project —
  // pull the human back to the web at the moment they're already looking at the terminal.
  const n = res.needs;
  const waiting = (n?.decisions ?? 0) + (n?.assigned ?? 0);
  if (n && waiting > 0) {
    const parts = [
      n.decisions > 0 ? `${n.decisions} decision${n.decisions === 1 ? "" : "s"}` : null,
      n.assigned > 0 ? `${n.assigned} assigned issue${n.assigned === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    console.log(`  ⏳ waiting on you: ${parts.join(" · ")}${n.url ? ` → ${n.url}` : ""}`);
  }
}
