import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Local credentials for the hosted service (never committed — lives in $HOME).
 * One user token covers all projects; each project remembers only its slug.
 */
export interface Credentials {
  /** API base URL, e.g. https://<ref>.supabase.co/functions/v1 */
  apiUrl?: string;
  /** Personal publish token (alk_...) from `alkahest login`. */
  token?: string;
  /** Per-project state, keyed by absolute project path. */
  projects?: Record<string, { slug: string }>;
}

const CRED_DIR = join(homedir(), ".alkahest");
const CRED_FILE = join(CRED_DIR, "credentials.json");

export function loadCredentials(): Credentials {
  try {
    return JSON.parse(readFileSync(CRED_FILE, "utf8")) as Credentials;
  } catch {
    return {};
  }
}

export function saveCredentials(creds: Credentials): void {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(creds, null, 2) + "\n");
}

/** API base URL resolved from flag → saved creds → env. */
export function resolveApiUrl(flag: string | undefined, creds: Credentials): string {
  return (flag || creds.apiUrl || process.env.ALKAHEST_API_URL || "").replace(/\/+$/, "");
}
