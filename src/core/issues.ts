import { loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { resolveProject } from "./project.js";

/**
 * Client for the hosted Issue Map (alkahest ADR-004): a human/agent-authored
 * graph of work items per published project — issues as nodes, blocks/contains/relates
 * edges, optional links into the code map. Issues live only in the cloud (the web
 * viewer edits them via RLS); the CLI/MCP read and write through the issues-pull /
 * issues-post / issues-update edge functions with an alk_ token.
 *
 * Like publish.ts/comments.ts, everything returns a structured result and never
 * writes to stdout/stderr.
 */

export interface IssueConfig {
  nodeTypes: { id: string; label?: string; shape?: string }[];
  statuses: { id: string; label?: string; terminal?: boolean }[];
}

export interface Issue {
  id: string;
  type: string;
  status: string;
  title: string;
  body: string | null;
  /** Fixed enum: none | low | medium | high | urgent (cloud migration 0020). */
  priority: string;
  /** Due date as YYYY-MM-DD, or null. */
  due_on: string | null;
  /** Assigned user id (a project member), or null. Names resolve on the hosted viewer. */
  assignee_id: string | null;
  /** 'node' (existing map node) | 'route'/'resource' (prospective — awaits convergence). */
  target_kind: "node" | "route" | "resource" | null;
  target_key: string | null;
  shipped_map_version_id: string | null;
  /** Unresolved decision questions on this issue (ADR-020). >0 ⇒ awaiting a human answer. */
  open_questions?: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A node on the per-issue discussion thread (ADR-020 decision channel). */
export interface IssueComment {
  id: string;
  issue_id: string;
  parent_id: string | null;
  /** note | question | answer | result. */
  kind: string;
  body: string;
  resolved: boolean;
  author_id: string;
  author_name: string | null;
  /** Mentioned member user ids (ADR-020 §9) — who the decision is routed to. */
  mentions: string[];
  created_at: string;
  updated_at: string;
}

/** A project member (for @mention targets). */
export interface IssueMember {
  id: string;
  name: string | null;
}

export interface IssueEdge {
  from_issue: string;
  to_issue: string;
  kind: "blocks" | "contains" | "relates";
}

export interface IssueMapLink {
  issue_id: string;
  node_key: string; // 's:…' | 'r:…'
  kind: "navigate" | "call";
}

export interface IssueGraph {
  slug: string;
  name: string | null;
  issue_config: IssueConfig;
  /** Project members — @mention targets for routing a decision (ADR-020 §9). */
  members: IssueMember[];
  issues: Issue[];
  edges: IssueEdge[];
  links: IssueMapLink[];
}

export interface IssuesResult {
  ok: boolean;
  graph?: IssueGraph;
  /** Resolved project root (nearest ancestor with .alkahest/). */
  root?: string;
  /** no_api | no_token | no_slug | not_found | ambiguous_map | invalid_token | network | <server error>. */
  code?: string;
  message?: string;
  /** Present on ambiguous_map / unknown-slug: the project's issue maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
}

interface AuthContext {
  apiUrl: string;
  token: string;
  root: string;
  slug?: string;
}

/** Resolve api/token/slug once; shared by every call below. */
function authContext(
  path: string,
  params: { api?: string; token?: string; slug?: string },
  needSlug: boolean,
): AuthContext | { code: string; message: string; root: string } {
  const creds = loadCredentials();
  const { root, slug } = resolveProject(path, params.slug);
  const apiUrl = resolveApiUrl(params.api, creds);
  if (!apiUrl) {
    return { root, code: "no_api", message: "Missing API URL. Set ALKAHEST_API_URL (or run 'alkahest login --api <url>')." };
  }
  const token = resolveToken(params.token, creds);
  if (!token) {
    return { root, code: "no_token", message: "Not authenticated. Set ALKAHEST_TOKEN (or run 'alkahest login --token alk_…')." };
  }
  if (needSlug && !slug) {
    return { root, code: "no_slug", message: "No published map for this project yet — run 'alkahest publish', or pass --slug <slug>." };
  }
  return { apiUrl, token, root, slug };
}

async function request(
  url: string,
  token: string,
  body?: unknown,
): Promise<{ ok: boolean; status: string; body: any }> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined
      ? { headers: { authorization: `Bearer ${token}` } }
      : { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
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

const fail = (res: { status: string; body: any }, what: string) => ({
  ok: false as const,
  code: res.body?.error ?? "http",
  message: res.body?.message ?? res.body?.error ?? `${what} failed (${res.status})`,
  // `ambiguous_map` / unknown-slug errors carry a structured map list so callers can guide
  // ("pick one of …, or create one") without parsing the message string.
  ...(Array.isArray(res.body?.maps) ? { maps: res.body.maps as { slug: string; name: string | null }[] } : {}),
});

export interface PullIssuesParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Restrict to one issue map within the project (a project can hold several). */
  mapSlug?: string;
}

/** Fetch the project's issue graph (issues + edges + map links + effective config). */
export async function pullIssues(path: string, params: PullIssuesParams = {}): Promise<IssuesResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, ...ctx };

  const mapQ = params.mapSlug ? `&map=${encodeURIComponent(params.mapSlug)}` : "";
  const res = await request(`${ctx.apiUrl}/issues-pull?slug=${encodeURIComponent(ctx.slug!)}${mapQ}`, ctx.token);
  if (!res.ok) return fail(res, "pull");
  const proj = (res.body?.projects ?? []).find((p: any) => p.slug === ctx.slug) ?? res.body?.projects?.[0];
  return {
    ok: true,
    root: ctx.root,
    graph: {
      slug: ctx.slug!,
      name: proj?.name ?? null,
      issue_config: proj?.issue_config ?? { nodeTypes: [], statuses: [] },
      members: proj?.members ?? [],
      issues: proj?.issues ?? [],
      edges: proj?.edges ?? [],
      links: proj?.links ?? [],
    },
  };
}

export interface CreateIssueParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Which issue map to add to (a project can hold several). Omit → the sole one (else error). */
  mapSlug?: string;
  title: string;
  type?: string;
  status?: string;
  body?: string;
  /** none | low | medium | high | urgent (default none). */
  priority?: string;
  /** Due date YYYY-MM-DD. */
  due_on?: string | null;
  /** Assignee user id (must be a project member; the server validates). */
  assignee_id?: string | null;
  target_kind?: "node" | "route" | "resource";
  target_key?: string;
  /** Existing issue id — creates a contains edge parent→new (epic→task). */
  parent_id?: string;
  links?: { node_key: string; kind: "navigate" | "call" }[];
}

export interface IssueWriteResult {
  ok: boolean;
  issue?: Issue;
  deleted?: boolean;
  code?: string;
  message?: string;
  /** Present on ambiguous_map / unknown-slug: the project's issue maps (slug + name). */
  maps?: { slug: string; name: string | null }[];
}

export async function createIssue(path: string, params: CreateIssueParams): Promise<IssueWriteResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.title?.trim()) return { ok: false, code: "no_title", message: "Issue title is required." };

  const res = await request(`${ctx.apiUrl}/issues-post`, ctx.token, {
    slug: ctx.slug,
    mapSlug: params.mapSlug,
    title: params.title.trim(),
    type: params.type,
    status: params.status,
    body: params.body,
    priority: params.priority,
    due_on: params.due_on ?? null,
    assignee_id: params.assignee_id ?? null,
    target_kind: params.target_kind ?? null,
    target_key: params.target_key ?? null,
    parent_id: params.parent_id,
    links: params.links,
  });
  if (!res.ok) return fail(res, "create");
  return { ok: true, issue: res.body?.issue };
}

export interface UpdateIssueParams {
  api?: string;
  token?: string;
  id: string;
  set?: {
    title?: string;
    body?: string | null;
    type?: string;
    status?: string;
    priority?: string;
    due_on?: string | null;
    assignee_id?: string | null;
    target_kind?: "node" | "route" | "resource" | null;
    target_key?: string | null;
  };
  /** Edge specs name the OTHER endpoint; the issue `id` fills the omitted side. */
  add_edges?: { from?: string; to?: string; kind: IssueEdge["kind"] }[];
  remove_edges?: { from?: string; to?: string; kind: IssueEdge["kind"] }[];
  add_links?: { node_key: string; kind: IssueMapLink["kind"] }[];
  remove_links?: string[];
  delete?: boolean;
}

export async function updateIssue(path: string, params: UpdateIssueParams): Promise<IssueWriteResult> {
  const ctx = authContext(path, params, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.id) return { ok: false, code: "no_id", message: "Issue id is required." };

  const { api: _a, token: _t, ...body } = params;
  const res = await request(`${ctx.apiUrl}/issues-update`, ctx.token, body);
  if (!res.ok) return fail(res, "update");
  return res.body?.deleted ? { ok: true, deleted: true } : { ok: true, issue: res.body?.issue };
}

// ── Issue discussion thread (ADR-020 decision channel) ─────────────────────────────────
// The per-issue Q&A loop: an agent posts a `question` to ask the user a decision while
// working, a member replies (the decision), resolving the question closes it, and a
// `result` records what shipped. Reads/writes go through the issue-comments-{pull,post,
// resolve} edge functions with the same alk_ token — mirroring comments.ts.

export interface IssueCommentsResult {
  ok: boolean;
  comments?: IssueComment[];
  root?: string;
  code?: string;
  message?: string;
}

export interface PullIssueCommentsParams {
  api?: string;
  token?: string;
  slug?: string;
  /** Restrict to one issue's thread. */
  issue?: string;
  /** Only unresolved comments (the decision-pending signal). */
  open?: boolean;
}

/** Fetch issue discussion threads (optionally one issue's, optionally only unresolved). */
export async function pullIssueComments(path: string, params: PullIssueCommentsParams = {}): Promise<IssueCommentsResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, ...ctx };

  const q = new URLSearchParams({ slug: ctx.slug! });
  if (params.issue) q.set("issue", params.issue);
  if (params.open) q.set("open", "1");
  const res = await request(`${ctx.apiUrl}/issue-comments-pull?${q.toString()}`, ctx.token);
  if (!res.ok) return fail(res, "pull comments");
  const proj = (res.body?.projects ?? []).find((p: any) => p.slug === ctx.slug) ?? res.body?.projects?.[0];
  return { ok: true, root: ctx.root, comments: proj?.comments ?? [] };
}

export interface PostIssueCommentParams {
  api?: string;
  token?: string;
  /** Target issue (new comment). Omit when replying — `parent` carries the thread. */
  issue_id?: string;
  /** Reply under this comment id (inherits the issue). */
  parent?: string;
  body: string;
  /** note | question | answer | result. Defaults: 'answer' for a reply, else 'note'. */
  kind?: string;
  /** @mention targets (ADR-020 §9): member ids OR display-name handles. The server keeps only
   *  project members. Tag who should decide so it surfaces as "waiting on you" for them. */
  mention?: string | string[];
}

export interface IssueCommentResult {
  ok: boolean;
  comment?: IssueComment;
  code?: string;
  message?: string;
}

/** Post a comment on an issue, or a reply (`parent`). kind 'question' asks for a decision. */
export async function postIssueComment(path: string, params: PostIssueCommentParams): Promise<IssueCommentResult> {
  const ctx = authContext(path, params, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.body?.trim()) return { ok: false, code: "no_body", message: "Comment body is required." };
  if (!params.issue_id && !params.parent) return { ok: false, code: "no_target", message: "issue_id (or parent for a reply) is required." };

  const mentions = params.mention === undefined ? undefined : (Array.isArray(params.mention) ? params.mention : [params.mention]);
  const res = await request(`${ctx.apiUrl}/issue-comments-post`, ctx.token, {
    issue_id: params.issue_id,
    parent_id: params.parent,
    body: params.body.trim(),
    kind: params.kind,
    mentions,
  });
  if (!res.ok) return fail(res, "post comment");
  return { ok: true, comment: res.body?.comment };
}

/** Resolve (or reopen) an issue comment — the "decision closed" signal for a question. */
export async function resolveIssueComment(
  path: string,
  params: { api?: string; token?: string; id: string; resolved?: boolean },
): Promise<{ ok: boolean; id?: string; resolved?: boolean; code?: string; message?: string }> {
  const ctx = authContext(path, params, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.id) return { ok: false, code: "no_id", message: "Comment id is required." };

  const res = await request(`${ctx.apiUrl}/issue-comments-resolve`, ctx.token, {
    id: params.id,
    resolved: params.resolved ?? true,
  });
  if (!res.ok) return fail(res, "resolve comment");
  return { ok: true, id: res.body?.id, resolved: res.body?.resolved };
}

/** Status ids marked terminal in the config (= "this work is finished"). */
export function terminalStatuses(config: IssueConfig): Set<string> {
  return new Set((config.statuses ?? []).filter((s) => s.terminal).map((s) => s.id));
}

/**
 * Derive what the graph itself can't store: which issues are DONE (terminal status)
 * and which are ACTIONABLE — not done, every incoming `blocks` edge comes from a done
 * issue, AND no open decision question is awaiting a human answer (ADR-020). An issue
 * blocked on a decision is no more workable than one blocked by a dependency, so it
 * drops out of "what can I start right now" until the question is resolved.
 */
export function deriveIssueStates(
  graph: IssueGraph,
): Map<string, { done: boolean; actionable: boolean; blockedBy: string[]; awaitingDecision: boolean }> {
  const terminal = terminalStatuses(graph.issue_config);
  const byId = new Map(graph.issues.map((i) => [i.id, i]));
  const out = new Map<string, { done: boolean; actionable: boolean; blockedBy: string[]; awaitingDecision: boolean }>();
  for (const issue of graph.issues) {
    const done = terminal.has(issue.status);
    const blockedBy = graph.edges
      .filter((e) => e.kind === "blocks" && e.to_issue === issue.id)
      .map((e) => e.from_issue)
      .filter((from) => !terminal.has(byId.get(from)?.status ?? ""));
    const awaitingDecision = (issue.open_questions ?? 0) > 0;
    out.set(issue.id, {
      done,
      actionable: !done && blockedBy.length === 0 && !awaitingDecision,
      blockedBy,
      awaitingDecision,
    });
  }
  return out;
}
