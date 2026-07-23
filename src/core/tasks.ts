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
}

/** List the token user's personal tasks (open by default). */
export async function pullTasks(path: string, params: PullTasksParams = {}): Promise<TasksResult> {
  const ctx = authContext(path, { api: params.api, token: params.token }, false);
  if ("code" in ctx) return { ok: false, ...ctx };
  const qs: string[] = [];
  if (params.status === "all") qs.push("status=all");
  if (params.project) qs.push(`slug=${encodeURIComponent(params.project)}`);
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
  });
  if (!res.ok) {
    const r = fail(res, "create") as TaskWriteResult;
    if (Array.isArray(res.body?.workspaces)) r.workspaces = res.body.workspaces;
    return r;
  }
  return { ok: true, task: res.body?.task };
}
