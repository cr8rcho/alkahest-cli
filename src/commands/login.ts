import { loadCredentials, saveCredentials } from "../core/credentials.js";

/**
 * Save a personal publish token so `alkahest publish` can authenticate as you.
 * Get the token from the web app (Account → Create token) after signing in with GitHub.
 */
export interface LoginOptions {
  /** The alk_… token from the web app. If omitted, we print instructions. */
  token?: string;
  /** API base URL (or env ALKAHEST_API_URL). */
  api?: string;
}

export async function login(options: LoginOptions): Promise<void> {
  const creds = loadCredentials();

  if (!options.token) {
    console.log("[alkahest] login — paste a token from the web app:");
    console.log("  1. Open the Alkahest web app and sign in with GitHub");
    console.log("  2. Account → Create token, copy the alk_… value");
    console.log("  3. Run: alkahest login --token alk_xxxxx");
    process.exitCode = 1;
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
}
