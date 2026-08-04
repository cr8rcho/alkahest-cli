/**
 * Tasks — the PERSONAL lightweight sibling of an issue (ADR-050 §8): a private checklist item
 * (title + done + optional due / project tag / free tags). Only its creator sees it. The web
 * reads/writes via RLS; the CLI/MCP go through tasks-pull / tasks-post with an alk_ token. Agent
 * writes land with origin='agent', for the token user's own list. No published project is required —
 * omit the project and it's a personal Inbox task in the token user's workspace.
 */
import { authContext, request, fail } from "./issues.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Task {
  id: string;
  title: string;
  body: string | null;
  done: boolean;
  due_on: string | null;
  tags: string[];
  origin: string;
  /** Note-ification intent (ADR-067): keep = merge content as-is into a note, enrich = research
   * first, null = plain task. The processing loop scans open tasks that carry a mode. */
  note_mode: "keep" | "enrich" | null;
  /** Target note slug (project-unique), null = the agent picks the destination. */
  note: string | null;
  /** Unresolved thread notes waiting to be folded into the body (ADR-062). */
  pending_notes: number;
  /** Open questions on the thread awaiting an answer (ADR-062). */
  open_questions: number;
  project: { slug: string; name: string | null } | null;
}

export interface TasksResult {
  ok: boolean;
  root?: string;
  tasks?: Task[];
  code?: string;
  message?: string;
  /** Present on ambiguous_workspace: the user's workspaces to disambiguate. */
  workspaces?: { slug: string; name: string | null }[];
}

export interface PullTasksParams {
  api?: string;
  token?: string;
  /** Restrict to tasks tagged to this project (slug). Default: all my tasks. */
  project?: string;
  /** open (default) = not done; all = include done. Promoted tasks excluded. */
  status?: "open" | "all";
  /** Server-side text filter: title/body substring. */
  q?: string;
}

/** List the token user's personal tasks (open by default). */
export async function pullTasks(path: string, params: PullTasksParams = {}): Promise<TasksResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, ...ctx };
  const qs: string[] = [];
  if (params.status === "all") qs.push("status=all");
  if (params.project) qs.push(`slug=${encodeURIComponent(params.project)}`);
  if (params.q) qs.push(`q=${encodeURIComponent(params.q)}`);
  const res = await request(`${ctx.apiUrl}/tasks-pull${qs.length ? `?${qs.join("&")}` : ""}`, ctx.token);
  if (!res.ok) return fail(res, "pull");
  return { ok: true, root: ctx.root, tasks: (res.body?.tasks ?? []) as Task[] };
}

export interface CreateTaskParams {
  api?: string;
  token?: string;
  /** Optional PROJECT tag (slug). Omit for a personal Inbox task. Overrides the local checkout's link. */
  slug?: string;
  /** Which workspace the Inbox task lives in (slug/id) — only needed when no project and you're in several. */
  workspace?: string;
  title: string;
  body?: string;
  /** Due date YYYY-MM-DD. */
  due_on?: string | null;
  /** Free tags (personal labels). */
  tags?: string[];
  /** Per-user idempotency: re-posting the same dedup_key updates the live task instead of duplicating. */
  dedup_key?: string;
  /** Note-ification intent (ADR-067): keep = merge as-is, enrich = research first. */
  note_mode?: "keep" | "enrich";
  /** Target note slug. Setting a target without note_mode implies 'keep'. */
  note?: string;
}

export interface TaskWriteResult {
  ok: boolean;
  task?: any;
  code?: string;
  message?: string;
  workspaces?: { slug: string; name: string | null }[];
}

export interface CompleteTaskParams {
  api?: string;
  token?: string;
  /** Task id (from list_tasks / add_task). */
  id: string;
  /** true → reopen a done task instead of completing it. */
  reopen?: boolean;
}

/** Complete (or reopen) one of the token user's personal tasks. A promoted task is refused by
 * the backend (409 `promoted`) — its live copy is the issue, so completion belongs there. */
export async function completeTask(path: string, params: CompleteTaskParams): Promise<TaskWriteResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.id?.trim()) return { ok: false, code: "no_id", message: "Task id is required." };
  const res = await request(`${ctx.apiUrl}/tasks-update`, ctx.token, {
    id: params.id.trim(),
    done: !params.reopen,
  });
  if (!res.ok) return fail(res, "update") as TaskWriteResult;
  return { ok: true, task: res.body?.task };
}

export interface UpdateTaskParams {
  api?: string;
  token?: string;
  /** Task id (from list_tasks / add_task). */
  id: string;
  title?: string;
  /** New body; null clears it. */
  body?: string | null;
  /** New due date (YYYY-MM-DD); null clears it. */
  due_on?: string | null;
  /** REPLACES the whole tag set. */
  tags?: string[];
  /** Note-ification intent (ADR-067); null switches it off (and clears the target). */
  note_mode?: "keep" | "enrich" | null;
  /** Target note slug; null clears the target (keeps the mode). Implies note_mode 'keep' when unset. */
  note?: string | null;
}

/** Edit one of the token user's personal tasks — only the passed keys change. Promoted tasks
 * are refused by the backend (409 `promoted` — act on the issue instead). */
export async function updateTask(path: string, params: UpdateTaskParams): Promise<TaskWriteResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.id?.trim()) return { ok: false, code: "no_id", message: "Task id is required." };
  const payload: Record<string, unknown> = { id: params.id.trim() };
  if (params.title !== undefined) payload.title = params.title;
  if (params.body !== undefined) payload.body = params.body;
  if (params.due_on !== undefined) payload.due_on = params.due_on;
  if (params.tags !== undefined) payload.tags = params.tags;
  if (params.note_mode !== undefined) payload.note_mode = params.note_mode;
  if (params.note !== undefined) payload.note = params.note;
  if (Object.keys(payload).length === 1) return { ok: false, code: "no_fields", message: "Pass at least one field to change (title, body, due_on, tags, note_mode, note)." };
  const res = await request(`${ctx.apiUrl}/tasks-update`, ctx.token, payload);
  if (!res.ok) return fail(res, "update") as TaskWriteResult;
  return { ok: true, task: res.body?.task };
}

/** Create a personal task (origin='agent'). No published project required — the project is an
 * optional tag; without one the task lands in the token user's workspace Inbox. */
export async function createTask(path: string, params: CreateTaskParams): Promise<TaskWriteResult> {
  // needSlug=false: a task doesn't require a project. ctx.slug is the local checkout's link (if any),
  // or params.slug when passed — sent only when present so an unlinked cwd still makes an Inbox task.
  const ctx = authContext(path, { api: params.api, token: params.token, slug: params.slug }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.title?.trim()) return { ok: false, code: "no_title", message: "Task title is required." };

  const res = await request(`${ctx.apiUrl}/tasks-post`, ctx.token, {
    slug: ctx.slug ?? undefined,
    workspace: params.workspace,
    title: params.title.trim(),
    body: params.body,
    due_on: params.due_on ?? null,
    // No assignee: a task is PERSONAL (0073 — RLS reads gate on created_by), so pointing one at
    // someone else only hides it from them. The shared unit of work is an issue.
    tags: params.tags,
    dedup_key: params.dedup_key,
    note_mode: params.note_mode,
    note: params.note,
  });
  if (!res.ok) {
    const r = fail(res, "create") as TaskWriteResult;
    if (Array.isArray(res.body?.workspaces)) r.workspaces = res.body.workspaces;
    return r;
  }
  return { ok: true, task: res.body?.task };
}

// ---- task thread (ADR-062) — the issue decision channel's grammar on a personal task ----
// kind note|question|answer|result + parent replies + resolved, with one delta: notes resolve
// too (resolved note = "integrated into the task body"). Backed by the task-comments-{pull,post,
// resolve} edge functions; agent writes land with origin='agent'.

export interface TaskComment {
  id: string;
  task_id: string;
  parent_id: string | null;
  kind: string;
  body: string;
  resolved: boolean;
  origin: string;
  created_at: string;
  updated_at: string;
}

export interface TaskCommentsResult {
  ok: boolean;
  comments?: TaskComment[];
  code?: string;
  message?: string;
}

/** Read one task's thread (`task`), or every unresolved note/question across the user's tasks
 * (`open`) — the "what's waiting to be integrated" sweep. One of the two is required. */
export async function pullTaskComments(
  path: string,
  params: { api?: string; token?: string; task?: string; open?: boolean } = {},
): Promise<TaskCommentsResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  const qs: string[] = [];
  if (params.task) qs.push(`task=${encodeURIComponent(params.task)}`);
  if (params.open) qs.push("open=1");
  if (!qs.length) return { ok: false, code: "bad_request", message: "Pass a task id or open:true." };
  const res = await request(`${ctx.apiUrl}/task-comments-pull?${qs.join("&")}`, ctx.token);
  if (!res.ok) return fail(res, "pull") as TaskCommentsResult;
  return { ok: true, comments: (res.body?.comments ?? []) as TaskComment[] };
}

export interface PostTaskCommentParams {
  api?: string;
  token?: string;
  /** Task id for a top-level comment (omit when replying). */
  task_id?: string;
  /** Comment id to reply under (inherits the task). */
  parent?: string;
  body: string;
  /** Default: 'answer' for a reply, 'note' otherwise. */
  kind?: "note" | "question" | "answer" | "result";
}

export interface TaskCommentResult {
  ok: boolean;
  comment?: TaskComment;
  code?: string;
  message?: string;
}

/** Post a comment (or reply) on one of the token user's tasks — origin='agent'. A promoted
 * task is refused by the backend (409 `promoted` — its thread lives on the issue). */
export async function postTaskComment(path: string, params: PostTaskCommentParams): Promise<TaskCommentResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.body?.trim()) return { ok: false, code: "no_body", message: "Comment body is required." };
  if (!params.task_id?.trim() && !params.parent?.trim()) {
    return { ok: false, code: "no_target", message: "Pass a task id (top-level) or a parent comment id (reply)." };
  }
  const res = await request(`${ctx.apiUrl}/task-comments-post`, ctx.token, {
    task_id: params.task_id?.trim() || undefined,
    parent_id: params.parent?.trim() || undefined,
    body: params.body,
    kind: params.kind,
  });
  if (!res.ok) return fail(res, "post") as TaskCommentResult;
  return { ok: true, comment: res.body?.comment as TaskComment };
}

/** Stamp a task comment resolved (note = integrated into the body, question = decided) or
 * reopen it with resolved=false. Only notes and questions are resolvable. */
export async function resolveTaskComment(
  path: string,
  params: { api?: string; token?: string; id: string; resolved?: boolean },
): Promise<{ ok: boolean; id?: string; resolved?: boolean; code?: string; message?: string }> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.id?.trim()) return { ok: false, code: "no_id", message: "Comment id is required." };
  const res = await request(`${ctx.apiUrl}/task-comments-resolve`, ctx.token, {
    id: params.id.trim(),
    resolved: params.resolved,
  });
  if (!res.ok) return fail(res, "resolve") as { ok: boolean; code?: string; message?: string };
  return { ok: true, id: res.body?.id, resolved: res.body?.resolved };
}
