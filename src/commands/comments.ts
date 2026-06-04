import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import { pullComments, type PulledComment } from "../core/comments.js";

export interface CommentsPullOptions {
  api?: string;
  slug?: string;
  open?: boolean;
  toIssues?: boolean;
}

const firstLine = (s: string, max = 72): string => {
  const line = String(s).split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

export async function commentsPull(path: string, options: CommentsPullOptions): Promise<void> {
  const res = await pullComments(path, options);
  if (!res.ok) {
    if (res.code === "no_slug") {
      console.error(`[alkahest] ${res.message}`);
    } else if (res.code === "invalid_token") {
      console.error("[alkahest] ✗ Token invalid or revoked. Run 'alkahest login' again.");
    } else if (res.code === "not_found") {
      console.error(`[alkahest] ✗ ${res.message}`);
    } else {
      console.error(`[alkahest] comments pull failed: ${res.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const projectRoot = resolve(path);
  const comments = res.comments ?? [];
  const roots = comments.filter((c) => !c.parent_id);
  const open = roots.filter((c) => !c.resolved);

  // Write next to the map so the comments travel with the project checkout.
  const dir = join(projectRoot, OUTPUT_DIR);
  mkdirSync(dir, { recursive: true });
  const outFile = join(dir, "comments.json");
  writeFileSync(
    outFile,
    JSON.stringify({ slug: res.slug, name: res.name ?? null, pulledAt: new Date().toISOString(), open: Boolean(options.open), comments }, null, 2) + "\n",
  );

  console.log(`[alkahest] pulled ${comments.length} comment${comments.length === 1 ? "" : "s"} on ${res.slug}` +
    ` (${open.length} open) → ${OUTPUT_DIR}/comments.json`);
  // A compact per-node digest so you can see where discussion is happening.
  const byNode = new Map<string, { label: string; open: number; total: number }>();
  for (const c of roots) {
    const k = c.node_key;
    const e = byNode.get(k) ?? { label: c.anchor_label || k, open: 0, total: 0 };
    e.total++;
    if (!c.resolved) e.open++;
    byNode.set(k, e);
  }
  for (const [k, e] of byNode) console.log(`  ${k}  ${e.label}  —  ${e.open} open / ${e.total}`);

  if (options.toIssues) createIssues(projectRoot, res.slug!, comments);
}

/**
 * Open each unresolved root comment as a GitHub issue via the `gh` CLI (run in the
 * project's git repo). A local cache (.alkahest/comments-issues.json) maps comment id →
 * issue URL so re-running doesn't create duplicates.
 */
function createIssues(projectRoot: string, slug: string, comments: PulledComment[]): void {
  const cacheFile = join(projectRoot, OUTPUT_DIR, "comments-issues.json");
  let cache: Record<string, string> = {};
  if (existsSync(cacheFile)) {
    try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* ignore */ }
  }

  const roots = comments.filter((c) => !c.parent_id && !c.resolved && !cache[c.id]);
  if (!roots.length) {
    console.log("[alkahest] --to-issues: no new open comments to file.");
    return;
  }

  for (const c of roots) {
    const replies = comments.filter((r) => r.parent_id === c.id);
    const where = c.anchor_label ? `\`${c.node_key}\` (${c.anchor_label})` : `\`${c.node_key}\``;
    const body =
      `From an Alkahest map comment on **${slug}**.\n\n` +
      `- Node: ${where}\n- Author: ${c.author_name || c.author_id}\n- Posted: ${c.created_at}\n\n` +
      `${c.body}\n` +
      (replies.length
        ? `\n---\n` + replies.map((r) => `**${r.author_name || r.author_id}**: ${r.body}`).join("\n\n")
        : "");
    const title = `[map] ${c.anchor_label || c.node_key}: ${firstLine(c.body)}`;
    try {
      const url = execFileSync("gh", ["issue", "create", "--title", title, "--body", body], {
        cwd: projectRoot,
        encoding: "utf8",
      }).trim();
      cache[c.id] = url;
      console.log(`  + ${url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[alkahest] --to-issues: gh failed (${msg.split("\n")[0]}). Is the GitHub CLI installed and authenticated?`);
      process.exitCode = 1;
      break;
    }
  }
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n");
}
