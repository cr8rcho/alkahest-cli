import { DEFAULT_API_URL, loadCredentials, resolveApiUrl, resolveToken } from "./credentials.js";
import { listProjects, type CodeMapFingerprint, type ProjectInfo, type WorkspaceInfo } from "./listProjects.js";
import { resolveProject } from "./project.js";

/**
 * "Where am I signed in, and where does this folder publish?" — the state behind
 * `alkahest status` and behind a bare `alkahest login`.
 *
 * There is no /whoami endpoint and nothing to be a "who": a token resolves to a user_id and a
 * set of workspaces, never a username (see supabase `_shared/auth.ts` / `list-projects`). So the
 * question this answers is the STATE one — is the token live, what can it reach, and which
 * project/map this checkout is bound to. `list-projects` doubles as the validity probe: it is the
 * cheapest authenticated GET, and its rejection codes distinguish revoked from expired from scoped.
 *
 * Like the other core clients this returns a structured result and never writes to stdout/stderr —
 * the MCP server reserves stdout for JSON-RPC.
 */

export type AuthState =
  /** No token anywhere (credentials file, ALKAHEST_TOKEN). */
  | "anonymous"
  /** Token accepted — full access. */
  | "authenticated"
  /** Token is live but SCOPED (widget/capture); it cannot reach the account-wide verbs. */
  | "scoped"
  /** Token unknown or revoked. */
  | "invalid"
  /** Token past its expires_at. */
  | "expired"
  /** The API could not be reached — says nothing about the token. */
  | "unreachable";

export interface AuthStatus {
  state: AuthState;
  /** True for every state where the token is known-good (authenticated | scoped). */
  ok: boolean;
  apiUrl: string;
  /** The API is the hosted alkahest.app backend (not a self-hosted override). */
  hosted: boolean;
  /** Present whenever a token was found locally, valid or not. */
  token?: { masked: string; source: "credentials" | "env" };
  /** Only on `authenticated` — a scoped token never gets to enumerate. */
  workspaces?: WorkspaceInfo[];
  projects?: ProjectInfo[];
  /** Server or transport message, for the failure states. */
  message?: string;
}

/** alk_1234…cdef — enough to tell two tokens apart, not enough to use. */
function mask(token: string): string {
  return token.length <= 12 ? "alk_…" : `${token.slice(0, 8)}…${token.slice(-4)}`;
}

const STATE_BY_CODE: Record<string, AuthState> = {
  no_token: "anonymous",
  "missing token": "anonymous",
  invalid_token: "invalid",
  token_expired: "expired",
  insufficient_scope: "scoped",
  network: "unreachable",
  no_api: "unreachable",
};

/** Resolve the local token, then probe it against the API. One round trip, no writes. */
export async function authStatus(params: { api?: string; token?: string } = {}): Promise<AuthStatus> {
  const creds = loadCredentials();
  const apiUrl = resolveApiUrl(params.api, creds);
  const hosted = apiUrl === DEFAULT_API_URL;
  const token = resolveToken(params.token, creds);
  if (!token) return { state: "anonymous", ok: false, apiUrl, hosted };

  const source: "credentials" | "env" = params.token || creds.token ? "credentials" : "env";
  const found = { masked: mask(token), source };

  const res = await listProjects({ api: params.api, token });
  if (res.ok) {
    return {
      state: "authenticated", ok: true, apiUrl, hosted, token: found,
      workspaces: res.workspaces ?? [], projects: res.projects ?? [],
    };
  }
  const state = STATE_BY_CODE[res.code ?? ""] ?? "invalid";
  return { state, ok: state === "scoped", apiUrl, hosted, token: found, message: res.message };
}

export interface CheckoutStatus {
  /** Nearest ancestor holding a `.alkahest/` — the folder this status describes. */
  root: string;
  /** The project this checkout publishes to, if it has ever been linked. */
  slug?: string;
  mapSlug?: string;
  /** Server-side detail for `slug`, when the account can see it. */
  project?: ProjectInfo;
  /** The `mapSlug` entry of `project.codeMaps` (or the sole code map when unset). */
  map?: CodeMapFingerprint;
  /** Linked locally, but the account cannot see that project — moved, deleted, or another account's. */
  unreachable: boolean;
}

/** Join the local link (`.alkahest/project.json`) to what the account can actually see. */
export function checkoutStatus(path: string, auth: AuthStatus): CheckoutStatus {
  const { root, slug, mapSlug } = resolveProject(path);
  if (!slug) return { root, unreachable: false };

  const project = auth.projects?.find((p) => p.slug === slug);
  const map = project
    ? project.codeMaps.find((m) => m.mapSlug === mapSlug) ??
      (mapSlug ? undefined : project.codeMaps[0])
    : undefined;
  // Only call it unreachable when we actually had a list to miss in.
  return { root, slug, mapSlug, project, map, unreachable: Boolean(auth.projects && !project) };
}
