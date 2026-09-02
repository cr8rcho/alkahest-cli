import { DEFAULT_API_URL, loadCredentials, saveCredentials } from "../core/credentials.js";

/**
 * `alkahest logout` — forget the saved token.
 *
 * Deliberately narrow: it clears `credentials.token` and NOTHING else. The other two keys are not
 * credentials — `apiUrl` is a destination setting (a self-hoster logging out and back in expects
 * their server to survive) and `projects` is a path→slug cache that `.alkahest/project.json`
 * already outranks in `resolveProject`. Bundling them behind a `--all` would mix "sign me out"
 * with "forget my config"; `gh auth logout` / `npm logout` / `docker logout` all clear the
 * credential alone, and so does this.
 *
 * This is LOCAL only — there is no revoke endpoint, so the token keeps working for anyone else who
 * holds it. Say so rather than let "signed out" imply more safety than it bought.
 */
export interface LogoutOptions {
  /** Reserved for symmetry with the other commands; logout never talks to the API. */
  api?: string;
}

export async function logout(_options: LogoutOptions = {}): Promise<void> {
  const creds = loadCredentials();
  const hadToken = Boolean(creds.token);
  const envToken = Boolean(process.env.ALKAHEST_TOKEN);

  if (!hadToken) {
    console.log("[alkahest] no saved token — nothing to sign out of.");
  } else {
    delete creds.token;
    saveCredentials(creds);
    console.log("[alkahest] signed out. Token removed from ~/.alkahest/credentials.json");
  }

  const notes: string[] = [];
  if (hadToken) {
    notes.push("The token still works on the server — revoke it at alkahest.app → Account to cut it off for good.");
  }
  // A live ALKAHEST_TOKEN would silently re-authenticate the very next command, which looks like
  // the logout failed. Name it instead of leaving the user to discover it.
  if (envToken) {
    notes.push("ALKAHEST_TOKEN is set in this environment and still authenticates — unset it too.");
  }
  if (creds.apiUrl && creds.apiUrl !== DEFAULT_API_URL) {
    notes.push(`Still pointed at ${creds.apiUrl} — 'alkahest login --api <url>' changes it.`);
  }
  if (notes.length) console.log(`\n  ${notes.join("\n  ")}`);
}
