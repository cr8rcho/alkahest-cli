/**
 * Tasks — the lightweight sibling of an issue (ADR-049): a flat checklist item (title + done,
 * optional due/assignee), NOT a graph node. The web reads/writes via RLS; the CLI/MCP go through
 * the tasks-pull / tasks-post edge functions with an alk_ token (same split as issues.ts). Agent
 * writes land with origin='agent', so they chip as the agent in the hosted activity feed.
 */
import { authContext, request, fail } from "./issues.js";

// deno-lint-ignore-file
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Task {
  id: string;
  title: string;
  body: string | null;
  done_at: string | null;
  due_on: string | null;
  assignee_id: string | null;
  origin: string;
  created_at: string;
}

export interface TasksResult {
  ok: boolean;
  root?: string;
  slug?: string;
  name?: string | null;
  tasks?: Task[];
  code?: string;
  message?: string;
}

export interface PullTasksParams {
  api?: string;
  token?: string;
  slug?: string;
  /** open (default) = not done; all = include done. Promoted tasks (now issues) are always excluded. */
  status?: "open" | "all";
}

/** List the project's tasks (open by default). */
export async function pullTasks(path: string, params: PullTasksParams = {}): Promise<TasksResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, ...ctx };
  const statusQ = params.status === "all" ? "&status=all" : "";
  const res = await request(`${ctx.apiUrl}/tasks-pull?slug=${encodeURIComponent(ctx.slug!)}${statusQ}`, ctx.token);
  if (!res.ok) return fail(res, "pull");
  const proj = (res.body?.projects ?? []).find((p: any) => p.slug === ctx.slug) ?? res.body?.projects?.[0];
  return { ok: true, root: ctx.root, slug: ctx.slug!, name: proj?.name ?? null, tasks: proj?.tasks ?? [] };
}

export interface CreateTaskParams {
  api?: string;
  token?: string;
  slug?: string;
  title: string;
  body?: string;
  /** Due date YYYY-MM-DD. */
  due_on?: string | null;
  /** Assignee user id (must be a project member). */
  assignee_id?: string | null;
  /** Agent idempotency: re-posting the same (project, dedup_key) updates the live task instead of duplicating. */
  dedup_key?: string;
}

export interface TaskWriteResult {
  ok: boolean;
  task?: Task;
  code?: string;
  message?: string;
}

/** Create a task in the project (origin='agent' on the server). */
export async function createTask(path: string, params: CreateTaskParams): Promise<TaskWriteResult> {
  const ctx = authContext(path, params, true);
  if ("code" in ctx) return { ok: false, code: ctx.code, message: ctx.message };
  if (!params.title?.trim()) return { ok: false, code: "no_title", message: "Task title is required." };

  const res = await request(`${ctx.apiUrl}/tasks-post`, ctx.token, {
    slug: ctx.slug,
    title: params.title.trim(),
    body: params.body,
    due_on: params.due_on ?? null,
    assignee_id: params.assignee_id ?? null,
    dedup_key: params.dedup_key,
  });
  if (!res.ok) return fail(res, "create");
  return { ok: true, task: res.body?.task };
}
