import { loadCredentials, saveCredentials } from "../core/credentials.js";
import { authStatus, checkoutStatus } from "../core/status.js";
import { printStatus } from "./status.js";

/**
 * Save a personal API token so the CLI/MCP can authenticate as you (publish, tasks, notes, issues, skills).
 * Get the token from the web app (Account → Create token) after signing in with GitHub.
 *
 * Run BARE, this reports the current state instead of assuming you have none — a bare auth command
 * is where people look first for "am I signed in?", and answering with a canned "paste a token"
 * (as this used to) is a lie to anyone who already is. Same block as `alkahest status`.
 */
export interface LoginOptions {
  /** The alk_… token from the web app. If omitted, we report the current state. */
  token?: string;
  /** API base URL (or env ALKAHEST_API_URL). */
  api?: string;
}

const HOW_TO = [
  "To sign in:",
  "  1. Open alkahest.app and sign in",
  "  2. Account → Create token, copy the alk_… value",
  "  3. Run: alkahest login --token alk_xxxxx",
];

export async function login(options: LoginOptions): Promise<void> {
  const creds = loadCredentials();

  if (!options.token) {
    const auth = await authStatus({ api: options.api });
    const ok = printStatus(auth, checkoutStatus(".", auth), { hint: false });
    console.log(ok
      ? "\n  Already signed in — pass --token alk_… to switch to a different token."
      : `\n  ${HOW_TO.join("\n  ")}`);
    if (!ok) process.exitCode = 1;
    return;
  }
  if (!options.token.startsWith("alk_")) {
    console.error("[alkahest] that doesn't look like a token (expected alk_…).");
    process.exitCode = 1;
    return;
  }

  creds.token = options.token;
  // Persist the API URL only when the user explicitly chose one; the hosted default
  // (resolveApiUrl's fallback) is left implicit so a future default change is picked up.
  const explicitApi = options.api || process.env.ALKAHEST_API_URL;
  if (explicitApi) creds.apiUrl = explicitApi.replace(/\/+$/, "");
  saveCredentials(creds);
  console.log("[alkahest] logged in. Token saved to ~/.alkahest/credentials.json");

  // Verify rather than assume: a typo'd or already-revoked token would otherwise only surface
  // at the next publish, far from the command that accepted it.
  const auth = await authStatus({ api: options.api });
  if (!auth.ok) {
    console.log("");
    printStatus(auth, checkoutStatus(".", auth));
    process.exitCode = 1;
    return;
  }
  const ws = (auth.workspaces ?? []).map((w) => w.name || w.slug);
  console.log(ws.length
    ? `[alkahest] verified — ${auth.projects?.length ?? 0} project(s) across ${ws.join(", ")}.`
    : "[alkahest] verified — no projects yet; 'alkahest publish' creates your first.");
}
