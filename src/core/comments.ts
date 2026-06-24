import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";
import type { ProductMap } from "./types.js";

/**
 * Shared logic for `alkahest comments pull`. Reads the comments left on this project's
 * PUBLISHED map (hosted viewer) via the `comments-pull` edge function, so they can be
 * used during development. Comments live only in the cloud — there is no local
 * authoring; this is the read side of that loop (see alkahest ADR-001).
 *
 * Like publish.ts, this returns a structured result and never writes to stdout/stderr.
 */
export interface PullParams {
  /** API base URL (else env ALKAHEST_API_URL / saved creds). */
  api?: string;
  /** Project slug (else the saved slug for this project path). */
  slug?: string;
  /** Which CODE map's comments (a project can hold several); else the checkout's remembered map. */
  mapSlug?: string;
  /** Only unresolved comments. */
  open?: boolean;
  /** Publish token (else env ALKAHEST_TOKEN / saved creds). */
  token?: string;
}

export interface PulledComment {
  id: string;
  map_version_id: string | null;
  anchor_kind: string; // 'screen' | 'resource' | 'transition' | 'map'
  node_key: string; // 's:123' | 'r:45' | 'map'
  anchor_label: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  body: string;
  resolved: boolean;
  /** True if the anchored node is gone from the current map (route renamed/removed). */
  orphaned?: boolean;
  /** GitHub issue this comment was filed into (set via `comments issue` / the comment_to_issue tool). */
  issue_url?: string | null;
  created_at: string;
  updated_at: string;
}

/** Where to act on a comment, joined from the local map. */
export interface CommentSource {
  // screen (node_key s:*) — the comment is on a page → one source file
  file?: string;
  route?: string;
  title?: string;
  /** UI elements on the screen, each with its line — in-file landmarks for the comment. */
  features?: { label: string; kind: string; line?: number }[];
  // resource (node_key r:*) — an API endpoint, not a single file
  path?: string;
  label?: string;
  kind?: string;
  /** Screens that call this endpoint (+ their file/line) — where to actually edit it. */
  callers?: { screen: string; file?: string; line?: number; trigger?: string }[];
}

/** A comment with the anchored node's source location joined in (from the local map). */
export interface EnrichedComment extends PulledComment {
  /** Where to go in the code to act on this comment — null if the node is orphaned. */
  source: CommentSource | null;
}

export interface PullResult {
  ok: boolean;
  slug?: string;
  name?: string | null;
  comments?: PulledComment[];
  /** Resolved project root (nearest ancestor with .alkahest/) — where to write comments.json. */
  root?: string;
  /** no_api | no_token | no_slug | not_found | invalid_token | network | <server error>. */
  code?: string;
  message?: string;
}

async function getJson(
  url: string,
  token: string,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
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

export async function pullComments(path: string, params: PullParams = {}): Promise<PullResult> {
  const creds = loadCredentials();
  const { root, slug, mapSlug: knownMap } = resolveProject(path, params.slug);

  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) {
    return {
      ok: false,
      root,
      code: "no_api",
      message: "Missing API URL. Set ALKAHEST_API_URL (or pass --api / run 'alkahest login --api <url>').",
    };
  }
  const token = resolveToken(params.token, creds);
  if (!token) {
    return {
      ok: false,
      root,
      code: "no_token",
      message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…').",
    };
  }
  if (!slug) {
    return {
      ok: false,
      root,
      code: "no_slug",
      message: "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>.",
    };
  }

  const qs = new URLSearchParams({ slug });
  const mapSlug = params.mapSlug ?? knownMap;
  if (mapSlug) qs.set("map", mapSlug); // scope to one code map (else all the project's comments)
  if (params.open) qs.set("open", "1");
  const res = await getJson(`${apiUrl}/comments-pull?${qs.toString()}`, token);
  if (!res.ok) {
    return {
      ok: false,
      code: res.body?.error ?? "http",
      message: res.body?.message ?? res.body?.error ?? `pull failed (${res.status})`,
    };
  }

  const proj = (res.body?.projects ?? []).find((p: any) => p.slug === slug) ?? res.body?.projects?.[0];
  return {
    ok: true,
    slug,
    root,
    name: proj?.name ?? null,
    comments: (proj?.comments ?? []) as PulledComment[],
  };
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

/**
 * Join each comment's anchored node (node_key `s:{id}` / `r:{id}`) to its source location
 * in the local map, so a developer/agent can jump straight from a comment to the code.
 * `source` is null for the whole-map anchor or an orphaned node (no longer in the map).
 */
export function enrichComments(comments: PulledComment[], map: ProductMap): EnrichedComment[] {
  const screenById = new Map((map.screens ?? []).map((s) => [s.id, s]));
  const resById = new Map((map.resources ?? []).map((r) => [r.id, r]));
  const calls = map.calls ?? [];
  return comments.map((c) => {
    let source: CommentSource | null = null;
    if (c.node_key.startsWith("s:")) {
      // Screen comment → its source file + the UI elements on it (with line numbers),
      // so the comment body can be matched to a specific spot in the file.
      const s = screenById.get(c.node_key.slice(2));
      if (s) {
        source = {
          file: s.sourceFile, route: s.route, title: s.title,
          features: (s.features ?? []).map((f) => ({ label: f.label, kind: f.kind, line: f.loc?.line })),
        };
      }
    } else if (c.node_key.startsWith("r:")) {
      // Resource comment → the endpoint, plus the screens that call it (an endpoint has no
      // single source file, so the callers are where you actually edit it).
      const r = resById.get(c.node_key.slice(2));
      if (r) {
        source = {
          path: r.path, label: r.label, kind: r.kind,
          callers: calls
            .filter((x) => x.to === r.id)
            .map((x) => {
              const s = screenById.get(x.from);
              return { screen: s?.title || x.from, file: s?.sourceFile, line: x.loc?.line, trigger: x.trigger };
            }),
        };
      }
    }
    return { ...c, source };
  });
}

export interface ResolveResult {
  ok: boolean;
  id?: string;
  resolved?: boolean;
  code?: string;
  message?: string;
}

/** Mark a comment resolved/reopened via the `comments-resolve` edge function (owner/author only). */
export async function resolveComment(
  path: string,
  id: string,
  resolved: boolean,
  params: { api?: string; token?: string } = {},
): Promise<ResolveResult> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) return { ok: false, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  const token = resolveToken(params.token, creds);
  if (!token) return { ok: false, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };

  const res = await postJson(`${apiUrl}/comments-resolve`, { id, resolved }, token);
  if (!res.ok) {
    return { ok: false, code: res.body?.error ?? "http", message: res.body?.message ?? res.body?.error ?? `resolve failed (${res.status})` };
  }
  return { ok: true, id, resolved };
}

/** Resolve a free-form node reference (id / route / title / path / label, or "map") to a
 *  node_key + anchor info, using the local map — so a user/agent can say "Checkout" or
 *  "/admin/users" instead of "s:/admin/users". */
export function resolveNode(map: ProductMap, query: string): { node_key: string; anchor_kind: string; anchor_label: string | null } | null {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  if (q === "map") return { node_key: "map", anchor_kind: "map", anchor_label: null };
  const screens = map.screens ?? [];
  const s =
    screens.find((x) => x.id.toLowerCase() === q || (x.route ?? "").toLowerCase() === q || (x.title ?? "").toLowerCase() === q) ||
    screens.find((x) => (x.title ?? "").toLowerCase().includes(q) || (x.route ?? "").toLowerCase().includes(q));
  if (s) return { node_key: "s:" + s.id, anchor_kind: "screen", anchor_label: s.title || s.route };
  const resources = map.resources ?? [];
  const r =
    resources.find((x) => x.id.toLowerCase() === q || (x.path ?? "").toLowerCase() === q || x.label.toLowerCase() === q) ||
    resources.find((x) => x.label.toLowerCase().includes(q) || (x.path ?? "").toLowerCase().includes(q));
  if (r) return { node_key: "r:" + r.id, anchor_kind: "resource", anchor_label: r.label };
  return null;
}

export interface PostParams {
  api?: string;
  token?: string;
  /** New comment: project slug (else the saved slug for this path). */
  slug?: string;
  /** New comment: which CODE map it's on; else the checkout's remembered map. */
  mapSlug?: string;
  node_key?: string;
  anchor_kind?: string;
  anchor_label?: string | null;
  /** Reply: parent comment id (project/node/anchor are inherited from it). */
  parent_id?: string;
  body: string;
}

export interface PostResult {
  ok: boolean;
  comment?: PulledComment;
  code?: string;
  message?: string;
}

/** Create a comment (slug + node_key) or a reply (parent_id) via the `comments-post` function. */
export async function postComment(path: string, params: PostParams): Promise<PostResult> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) return { ok: false, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  const token = resolveToken(params.token, creds);
  if (!token) return { ok: false, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };
  if (!params.body || !params.body.trim()) return { ok: false, code: "no_body", message: "Comment body is required." };

  let reqBody: Record<string, unknown>;
  if (params.parent_id) {
    reqBody = { parent_id: params.parent_id, body: params.body };
  } else {
    const { slug, mapSlug: knownMap } = resolveProject(path, params.slug);
    if (!slug) return { ok: false, code: "no_slug", message: "No published map for this project — run 'alkahest publish', or pass --slug." };
    if (!params.node_key) return { ok: false, code: "no_node", message: "node_key is required for a new comment." };
    reqBody = { slug, mapSlug: params.mapSlug ?? knownMap, node_key: params.node_key, anchor_kind: params.anchor_kind, anchor_label: params.anchor_label, body: params.body };
  }

  const res = await postJson(`${apiUrl}/comments-post`, reqBody, token);
  if (!res.ok) {
    return { ok: false, code: res.body?.error ?? "http", message: res.body?.message ?? res.body?.error ?? `post failed (${res.status})` };
  }
  return { ok: true, comment: res.body?.comment };
}

const firstLine = (s: string, max = 72): string => {
  const line = String(s).split("\n")[0].trim();
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

/** Title for the issue: a single comment names its node + first line; a group names the count. */
function issueTitle(selected: PulledComment[], slug: string): string {
  if (selected.length === 1) {
    const c = selected[0];
    return `[map] ${c.anchor_label || c.node_key}: ${firstLine(c.body)}`;
  }
  return `[map] ${slug}: ${selected.length} comments`;
}

/** One issue body aggregating the selected comments (each with its node, author, and replies). */
function issueBody(selected: PulledComment[], all: PulledComment[], slug: string): string {
  const section = (c: PulledComment) => {
    const replies = all.filter((r) => r.parent_id === c.id);
    const where = c.anchor_label ? `\`${c.node_key}\` (${c.anchor_label})` : `\`${c.node_key}\``;
    return `### ${c.anchor_label || c.node_key}\n` +
      `- Node: ${where}\n- Author: ${c.author_name || c.author_id}\n- Posted: ${c.created_at}\n\n` +
      `${c.body}\n` +
      (replies.length ? `\n` + replies.map((r) => `**${r.author_name || r.author_id}**: ${r.body}`).join("\n\n") + "\n" : "");
  };
  return `Filed from Alkahest map comment${selected.length === 1 ? "" : "s"} on **${slug}**.\n\n` +
    selected.map(section).join("\n---\n\n");
}

export interface FileIssueParams {
  api?: string;
  token?: string;
  /** Project slug (else the saved slug for this path). */
  slug?: string;
  /** Issue title override (else derived from the comments). */
  title?: string;
  /** Target GitHub repo `owner/repo` (else `gh`'s default for the cwd). */
  repo?: string;
  /** File even if some selected comments already carry an issue_url (would create a new issue). */
  force?: boolean;
}

export interface FileIssueResult {
  ok: boolean;
  issue_url?: string;
  ids?: string[];
  title?: string;
  /** no_api | no_token | no_slug | not_found | already_tracked | gh_failed | <server error>. */
  code?: string;
  message?: string;
}

/**
 * File a GROUP of selected map comments as ONE GitHub issue and link it back onto each.
 *
 * Issue CREATION is client-side: this runs `gh issue create` in the project's git repo
 * (the dev already has `gh` authenticated — they deploy that repo). The cloud never talks
 * to GitHub; once the URL exists we POST it to the `comments-issue` edge function, which
 * records it on each comment so the hosted viewer shows a "tracked" badge. Backs the CLI
 * `comments issue` command and the MCP `comment_to_issue` tool (see alkahest TODO §1).
 *
 * Re-filing comments that are ALREADY tracked would create a duplicate GitHub issue, so
 * that's refused unless `force` is set. Like the rest of this module, returns a structured
 * result and never writes to stdout/stderr.
 */
export async function fileCommentsIssue(path: string, ids: string[], params: FileIssueParams = {}): Promise<FileIssueResult> {
  const list = (ids ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return { ok: false, code: "bad_request", message: "At least one comment id is required." };

  // Pull current comments to build the body (and see which are already tracked).
  const pull = await pullComments(path, { api: params.api, slug: params.slug, token: params.token });
  if (!pull.ok) return { ok: false, code: pull.code, message: pull.message };
  const all = pull.comments ?? [];
  const byId = new Map(all.map((c) => [c.id, c]));
  const missing = list.filter((id) => !byId.has(id));
  if (missing.length) return { ok: false, code: "not_found", message: `Unknown comment id(s): ${missing.join(", ")}` };
  const selected = list.map((id) => byId.get(id)!) as PulledComment[];

  if (!params.force) {
    const tracked = selected.filter((c) => c.issue_url);
    if (tracked.length) {
      return { ok: false, code: "already_tracked", message: `Already linked to an issue: ${tracked.map((c) => c.id).join(", ")}.` };
    }
  }

  const title = params.title?.trim() || issueTitle(selected, pull.slug!);
  const body = issueBody(selected, all, pull.slug!);
  const cwd = pull.root ?? resolve(path);

  let url: string;
  try {
    const args = ["issue", "create", "--title", title, "--body", body];
    if (params.repo) args.push("--repo", params.repo);
    url = execFileSync("gh", args, { cwd, encoding: "utf8" }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "gh_failed", message: `gh failed (${msg.split("\n")[0]}). Is the GitHub CLI installed and authenticated?` };
  }

  // Record the URL on each selected comment (the cloud only stores it — see above).
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  const token = resolveToken(params.token, creds);
  const res = await postJson(`${apiUrl}/comments-issue`, { ids: list, issue_url: url }, token);
  if (!res.ok) {
    // The issue exists on GitHub but linking failed — surface the URL so it isn't lost.
    return { ok: false, issue_url: url, ids: list, code: res.body?.error ?? "http", message: `Issue created (${url}) but linking failed: ${res.body?.message ?? res.body?.error ?? res.status}` };
  }
  return { ok: true, issue_url: url, ids: list, title };
}
