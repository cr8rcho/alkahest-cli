import { listProjects, type ProjectInfo } from "../core/listProjects.js";

/**
 * CLI surface of account discovery (alkahest ADR-022 A). `alkahest projects` lists every workspace
 * and project the token can reach — the missing primitive for recovering a project's slug after the
 * local link is lost (e.g. a workspace move). Talks to the `list-projects` edge function through
 * src/core/listProjects.ts; nothing is stored locally. `--json` prints the raw payload for scripts.
 */

const die = (msg: string): void => {
  console.error(`[alkahest] ${msg}`);
  process.exitCode = 1;
};

const failMessage = (code: string | undefined, message: string | undefined): string => {
  const known: Record<string, string> = {
    no_api: message ?? "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>').",
    no_token: "✗ Not authenticated. Run 'alkahest login --token alk_…' (get a token at alkahest.app → Account).",
    invalid_token: "✗ Token invalid or revoked. Run 'alkahest login' again.",
  };
  return known[code ?? ""] ?? `projects failed: ${message}`;
};

const mapsSummary = (p: ProjectInfo): string => {
  if (!p.codeMaps.length) return "no code maps";
  return p.codeMaps
    .map((m) => {
      const s = m.stats;
      const counts = s ? ` (${s.screens ?? 0}s/${s.resources ?? 0}r)` : " (unpublished)";
      return `${m.mapSlug}${counts}`;
    })
    .join(", ");
};

export interface ProjectsOptions { api?: string; json?: boolean; }

export async function projects(options: ProjectsOptions): Promise<void> {
  const res = await listProjects({ api: options.api });
  if (!res.ok || !res.projects) return die(failMessage(res.code, res.message));

  if (options.json) {
    console.log(JSON.stringify({ workspaces: res.workspaces ?? [], projects: res.projects }, null, 2));
    return;
  }

  if (res.projects.length === 0) {
    console.log("[alkahest] no projects on your account yet — 'alkahest publish' creates one.");
    return;
  }

  // Group projects under their workspace; keep workspaces even when empty so moves are discoverable.
  const byWs = new Map<string, ProjectInfo[]>();
  const wsLabel = new Map<string, string>();
  for (const w of res.workspaces ?? []) wsLabel.set(w.id, w.name || w.slug);
  for (const p of res.projects) {
    const key = p.workspace?.id ?? "—";
    if (!wsLabel.has(key)) wsLabel.set(key, p.workspace?.name || p.workspace?.slug || "(no workspace)");
    if (!byWs.has(key)) byWs.set(key, []);
    byWs.get(key)!.push(p);
  }

  const total = res.projects.length;
  console.log(`[alkahest] ${total} project${total === 1 ? "" : "s"} across ${byWs.size} workspace${byWs.size === 1 ? "" : "s"}:`);
  for (const [wsId, list] of byWs) {
    console.log(`\n  ${wsLabel.get(wsId)}`);
    for (const p of list) {
      const owner = p.isOwner ? "" : `  [${p.capability}]`;
      const vis = p.isPublic ? "" : "  (private)";
      const named = p.name && p.name !== p.slug ? `  — ${p.name}` : "";
      console.log(`    ${p.slug}${named}${vis}${owner}`);
      console.log(`        ${mapsSummary(p)}`);
    }
  }
  console.log("\n  Re-link a checkout with 'alkahest publish --slug <slug>'.");
}
