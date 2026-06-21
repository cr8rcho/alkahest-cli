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
  /** Per-project state, keyed by absolute project path. `mapSlug` = the code map this checkout
   *  publishes to (maps are equal in the cloud; a project can hold several code maps). */
  projects?: Record<string, { slug: string; mapSlug?: string }>;
}

const CRED_DIR = join(homedir(), ".alkahest");
const CRED_FILE = join(CRED_DIR, "credentials.json");

/**
 * The hosted service (alkahest.app). Used as the final fallback so that pointing
 * the CLI / MCP at the public instance needs no config — the URL is not a secret
 * (it ships in every served page). Self-hosters override via --api, `alkahest login
 * --api <url>`, or ALKAHEST_API_URL.
 */
const DEFAULT_API_URL = "https://ytcmzkrvtomtcrcyqqcb.supabase.co/functions/v1";

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

/** API base URL resolved from flag → saved creds → env → hosted default. */
export function resolveApiUrl(flag: string | undefined, creds: Credentials): string {
  return (flag || creds.apiUrl || process.env.ALKAHEST_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

/**
 * Publish token resolved from arg → saved creds → env.
 * The env fallback (ALKAHEST_TOKEN) lets the MCP server authenticate from its config
 * without a prior `alkahest login`, mirroring resolveApiUrl's ALKAHEST_API_URL fallback.
 */
export function resolveToken(arg: string | undefined, creds: Credentials): string {
  return (arg || creds.token || process.env.ALKAHEST_TOKEN || "").trim();
}
