import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

/**
 * Single source of truth for "is a newer alkahest out?" — the repo's latest GitHub Release.
 * Used by `alkahest update`, the ambient post-command notice, and the MCP check_version tool,
 * so every surface reports the same thing. All checks fail soft (offline / rate-limited /
 * no releases → behind:false), and the ambient path is cached so we hit GitHub at most once
 * per TTL per machine.
 */
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; repository?: { url?: string } };

const FALLBACK_REPO = "cr8rcho/alkahest";
const CACHE_FILE = join(homedir(), ".alkahest", "update-check.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface UpdateStatus {
  current: string;
  /** Latest release version (no leading "v"), or null if unknown. */
  latest: string | null;
  behind: boolean;
}

export function currentVersion(): string {
  return pkg.version;
}

/** "owner/repo" from package.json repository.url (fallback to the known repo). */
export function repoSlug(): string {
  const m = pkg.repository?.url?.match(/github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?(?:$|[/#?])/i);
  return m ? m[1] : FALLBACK_REPO;
}

/** Compare dotted versions: -1 if a<b, 0 if equal, 1 if a>b (major.minor.patch). */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Latest release tag (without a leading "v"), or null if none / unreachable. */
export async function fetchLatestRelease(timeoutMs = 2500): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.github.com/repos/${repoSlug()}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "alkahest-cli" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null; // 404 = no releases yet
    const body = (await res.json()) as { tag_name?: string };
    return body.tag_name ? body.tag_name.replace(/^v/i, "").trim() : null;
  } catch {
    return null; // offline / aborted / rate-limited — fail soft
  } finally {
    clearTimeout(timer);
  }
}

function status(latest: string | null): UpdateStatus {
  return { current: pkg.version, latest, behind: !!latest && cmpVersion(pkg.version, latest) < 0 };
}

/** Fresh network check — for explicit commands (`alkahest update`, check_version). */
export async function checkForUpdate(): Promise<UpdateStatus> {
  return status(await fetchLatestRelease());
}

/** Throttled, cached check — for ambient notices that run on common commands. */
export async function cachedUpdateStatus(ttlMs = TTL_MS): Promise<UpdateStatus> {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as { checkedAt?: number; latest?: string | null };
    if (raw.checkedAt && Date.now() - raw.checkedAt < ttlMs) return status(raw.latest ?? null);
  } catch {
    /* no / stale / invalid cache — fall through to a fresh check */
  }
  const latest = await fetchLatestRelease();
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ checkedAt: Date.now(), latest }) + "\n");
  } catch {
    /* cache is best-effort */
  }
  return status(latest);
}

/**
 * Print a one-line "update available" nudge to stderr after a command, using the cached
 * check. Never throws and never blocks meaningfully (stdout stays clean for piping / MCP).
 * Opt out with ALKAHEST_NO_UPDATE_NOTIFIER.
 */
export async function maybeNotifyUpdate(): Promise<void> {
  if (process.env.ALKAHEST_NO_UPDATE_NOTIFIER) return;
  try {
    const s = await cachedUpdateStatus();
    if (s.behind) {
      console.error(`[alkahest] ⬆ update available: ${s.current} → ${s.latest} — run 'alkahest update'`);
    }
  } catch {
    /* a version check must never break the command */
  }
}
