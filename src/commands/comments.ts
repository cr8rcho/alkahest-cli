import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import { loadMap } from "../core/pipeline.js";
import { findProjectRoot } from "../core/project.js";
import { pullComments, enrichComments, postComment, resolveNode, fileCommentsIssue } from "../core/comments.js";

export interface CommentsPullOptions {
  api?: string;
  slug?: string;
  map?: string;
  open?: boolean;
}

export async function commentsPull(path: string, options: CommentsPullOptions): Promise<void> {
  const res = await pullComments(path, { ...options, mapSlug: options.map });
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

  const projectRoot = res.root ?? resolve(path);
  // Join each comment to its node's source location (from the local map) so the file is
  // immediately actionable — comment → which file/route to edit.
  const map = loadMap(projectRoot);
  const comments = map ? enrichComments(res.comments ?? [], map) : (res.comments ?? []);
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
}

export interface CommentsIssueOptions { path?: string; slug?: string; api?: string; title?: string; repo?: string; force?: boolean; }

/**
 * File the selected comments as ONE GitHub issue (via `gh`, in the project's git repo) and
 * link it back onto each. Ids come from `comments pull`; the heavy lifting is in the core
 * `fileCommentsIssue` (shared with the MCP `comment_to_issue` tool).
 */
export async function commentsIssue(ids: string[], options: CommentsIssueOptions): Promise<void> {
  const list = (ids ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  if (!list.length) { console.error("[alkahest] provide one or more comment ids (from 'comments pull')."); process.exitCode = 1; return; }
  const projectRoot = findProjectRoot(options.path || ".");
  const res = await fileCommentsIssue(projectRoot, list, {
    slug: options.slug, api: options.api, title: options.title, repo: options.repo, force: options.force,
  });
  if (!res.ok) {
    const msg: Record<string, string> = {
      already_tracked: `[alkahest] ✗ ${res.message} Use --force to file a new issue anyway.`,
      gh_failed: `[alkahest] ✗ ${res.message}`,
      forbidden: "[alkahest] ✗ Only the project owner or a collaborator can file issues.",
      no_slug: "[alkahest] ✗ No published map for this project — run 'alkahest publish' first.",
      not_found: `[alkahest] ✗ ${res.message}`,
    };
    console.error(msg[res.code ?? ""] ?? `[alkahest] file issue failed: ${res.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[alkahest] filed ${res.ids!.length} comment${res.ids!.length === 1 ? "" : "s"} as ${res.issue_url}`);
}

export interface CommentsAddOptions { body?: string; slug?: string; map?: string; api?: string; path?: string; }

export async function commentsAdd(node: string, options: CommentsAddOptions): Promise<void> {
  const body = (options.body || "").trim();
  if (!body) { console.error("[alkahest] --body is required."); process.exitCode = 1; return; }
  const projectRoot = findProjectRoot(options.path || ".");
  const map = loadMap(projectRoot);
  if (!map) { console.error(`[alkahest] no ${OUTPUT_DIR}/map.json — run 'alkahest scan' first.`); process.exitCode = 1; return; }
  const n = resolveNode(map, node);
  if (!n) { console.error(`[alkahest] no node matches '${node}'. Try a screen route/title or resource path.`); process.exitCode = 1; return; }
  const res = await postComment(projectRoot, { node_key: n.node_key, anchor_kind: n.anchor_kind, anchor_label: n.anchor_label, body, slug: options.slug, mapSlug: options.map, api: options.api });
  if (!res.ok) {
    console.error(res.code === "forbidden"
      ? "[alkahest] ✗ Only the project owner or a collaborator can comment."
      : `[alkahest] comment failed: ${res.message}`);
    process.exitCode = 1; return;
  }
  console.log(`[alkahest] commented on ${n.node_key} (${n.anchor_label ?? n.node_key}) — id ${res.comment?.id}`);
}

export interface CommentsReplyOptions { body?: string; api?: string; path?: string; }

export async function commentsReply(id: string, options: CommentsReplyOptions): Promise<void> {
  const body = (options.body || "").trim();
  if (!body) { console.error("[alkahest] --body is required."); process.exitCode = 1; return; }
  const res = await postComment(resolve(options.path || "."), { parent_id: id, body, api: options.api });
  if (!res.ok) {
    console.error(res.code === "not_found"
      ? "[alkahest] ✗ Parent comment not found."
      : res.code === "forbidden"
        ? "[alkahest] ✗ Only the project owner or a collaborator can comment."
        : `[alkahest] reply failed: ${res.message}`);
    process.exitCode = 1; return;
  }
  console.log(`[alkahest] replied to ${id} — id ${res.comment?.id}`);
}
