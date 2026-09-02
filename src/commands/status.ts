import { authStatus, checkoutStatus, type AuthStatus, type CheckoutStatus } from "../core/status.js";
import { relTime } from "../core/time.js";

/**
 * `alkahest status` — sign-in state + what this checkout is bound to.
 *
 * Deliberately NOT `whoami`: an alk_ token carries no username (it resolves to a user_id and a
 * set of workspaces), and the question people actually ask here is multi-axis — is the token
 * live, which API, which scope, and which project/map does this folder publish to. `gh auth
 * status` / `gcloud auth list` answer the same shape; `npm whoami` prints a name because npm
 * HAS one. Reads through src/core/status.ts; nothing is stored or changed.
 */

export interface StatusOptions {
  path?: string;
  api?: string;
  json?: boolean;
}

const HINT_LOGIN = "Run 'alkahest login --token alk_…' — create one at alkahest.app → Account.";

/** The headline + the lines that explain a non-authenticated state. */
function authLines(auth: AuthStatus): { head: string; notes: string[] } {
  switch (auth.state) {
    case "authenticated":
      return { head: "✓ signed in", notes: [] };
    case "scoped":
      return {
        head: "✓ token live, but scoped",
        notes: [
          "This is a limited token (a widget/capture scope), not a personal one — it can reach",
          "only the verbs its scope names, and cannot list your workspaces.",
        ],
      };
    case "anonymous":
      return { head: "✗ not signed in", notes: [HINT_LOGIN] };
    case "invalid":
      return { head: "✗ token invalid or revoked", notes: [HINT_LOGIN] };
    case "expired":
      return { head: "✗ token expired", notes: [HINT_LOGIN] };
    case "unreachable":
      return {
        head: "? could not reach the API",
        notes: [auth.message ?? "network error", "The token itself was not checked."],
      };
  }
}

/**
 * Print the shared status block. Returns false when the state is a failure (for exit codes).
 * `hint: false` drops the trailing "run login" note for callers that follow with their own
 * instructions — bare `alkahest login` would otherwise say it twice.
 */
export function printStatus(auth: AuthStatus, checkout: CheckoutStatus, opts: { hint?: boolean } = {}): boolean {
  const { head, notes } = authLines(auth);
  const tail = opts.hint === false ? notes.filter((n) => n !== HINT_LOGIN) : notes;
  console.log(`[alkahest] ${head}`);

  if (auth.token) console.log(`  token       ${auth.token.masked}  (from ${auth.token.source === "env" ? "ALKAHEST_TOKEN" : "~/.alkahest/credentials.json"})`);
  console.log(`  api         ${auth.apiUrl}${auth.hosted ? "  (hosted)" : "  (self-hosted)"}`);

  if (auth.workspaces?.length) {
    const names = auth.workspaces.map((w) => w.name || w.slug);
    const n = auth.projects?.length ?? 0;
    console.log(`  workspaces  ${names.join(", ")}`);
    console.log(`  projects    ${n} reachable${n ? "  —  'alkahest projects' lists them" : ""}`);
  } else if (auth.state === "authenticated") {
    console.log("  workspaces  none yet — 'alkahest publish' creates your first project");
  }

  console.log(`\n  this checkout  ${checkout.root}`);
  if (!checkout.slug) {
    console.log("    not linked to a project yet — 'alkahest publish' links it.");
  } else if (checkout.project) {
    const p = checkout.project;
    const named = p.name && p.name !== p.slug ? `  — ${p.name}` : "";
    const ws = p.workspace ? `  (${p.workspace.name || p.workspace.slug})` : "";
    console.log(`    project  ${p.slug}${named}${ws}`);
    const m = checkout.map;
    if (m) {
      const when = m.lastPublishedAt ? `last publish ${relTime(m.lastPublishedAt)}` : "never published";
      console.log(`    map      ${m.mapSlug}  ·  ${when}`);
    } else if (checkout.mapSlug) {
      console.log(`    map      ${checkout.mapSlug}  ·  no longer on the project (renamed or deleted?)`);
    }
  } else if (checkout.unreachable) {
    console.log(`    project  ${checkout.slug}  ·  not visible to this account (moved, deleted, or a different account)`);
  } else {
    // Linked, but we have no server list to check it against (not signed in / unreachable).
    console.log(`    project  ${checkout.slug}${checkout.mapSlug ? ` / ${checkout.mapSlug}` : ""}  ·  unverified`);
  }

  if (tail.length) console.log(`\n  ${tail.join("\n  ")}`);
  return auth.ok;
}

export async function status(options: StatusOptions = {}): Promise<void> {
  const auth = await authStatus({ api: options.api });
  const checkout = checkoutStatus(options.path ?? ".", auth);

  if (options.json) {
    console.log(JSON.stringify({
      auth: {
        state: auth.state, ok: auth.ok, apiUrl: auth.apiUrl, hosted: auth.hosted,
        token: auth.token ?? null,
        workspaces: auth.workspaces ?? null,
        projectCount: auth.projects?.length ?? null,
        message: auth.message ?? null,
      },
      checkout: {
        root: checkout.root,
        slug: checkout.slug ?? null,
        mapSlug: checkout.map?.mapSlug ?? checkout.mapSlug ?? null,
        projectName: checkout.project?.name ?? null,
        workspace: checkout.project?.workspace?.slug ?? null,
        lastPublishedAt: checkout.map?.lastPublishedAt ?? null,
        unreachable: checkout.unreachable,
      },
    }, null, 2));
    if (!auth.ok) process.exitCode = 1;
    return;
  }

  if (!printStatus(auth, checkout)) process.exitCode = 1;
}
