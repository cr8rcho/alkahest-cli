import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

/**
 * Single source of truth for "is a newer alkahest out?" — the npm registry's `latest`
 * dist-tag for this package. npm is what `alkahest update` actually installs from, so it is
 * the honest signal (a GitHub release whose npm publish failed must not count as "newer").
 * Used by `alkahest update`, the ambient post-command notice, and the MCP check_version tool,
 * so every surface reports the same thing. All checks fail soft (offline / proxy / timeout →
 * behind:false, reachable:false), and the ambient path is cached so we hit the registry at
 * most once per TTL per machine.
 */
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string; name: string };

const CACHE_FILE = join(homedir(), ".alkahest", "update-check.json");
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface UpdateStatus {
  current: string;
  /** Latest published version on npm, or null if unknown. */
  latest: string | null;
  behind: boolean;
  /** false = the registry couldn't be reached (offline/proxy/timeout) — latest is unknown,
   * not absent. Lets callers say "couldn't check" instead of "nothing published". */
  reachable: boolean;
}

export function currentVersion(): string {
  return pkg.version;
}

/** The registry URL for this package's `latest` dist-tag (scoped names need the `/` encoded). */
export function latestUrl(): string {
  return `https://registry.npmjs.org/${pkg.name.replace("/", "%2f")}/latest`;
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

interface LatestProbe {
  version: string | null;
  reachable: boolean;
}

/** The npm registry's `latest` version for this package. reachable:false = couldn't ask
 * (offline / proxy / timeout — incl. Node <18 without global fetch); version:null with
 * reachable:true = the registry answered but had nothing usable (never published / yanked). */
export async function fetchLatestVersion(timeoutMs = 2500): Promise<LatestProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(latestUrl(), {
      headers: { accept: "application/json", "user-agent": "alkahest-cli" },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { version: null, reachable: true }; // never published
    if (!res.ok) return { version: null, reachable: false }; // 5xx / blocked — treat as "couldn't check"
    const body = (await res.json()) as { version?: string };
    return { version: body.version?.trim() || null, reachable: true };
  } catch {
    return { version: null, reachable: false }; // offline / aborted / no fetch — fail soft
  } finally {
    clearTimeout(timer);
  }
}

function status(probe: LatestProbe): UpdateStatus {
  const latest = probe.version;
  return { current: pkg.version, latest, behind: !!latest && cmpVersion(pkg.version, latest) < 0, reachable: probe.reachable };
}

/** Fresh network check — for explicit commands (`alkahest update`, check_version). */
export async function checkForUpdate(): Promise<UpdateStatus> {
  return status(await fetchLatestVersion());
}

/** Throttled, cached check — for ambient notices that run on common commands. */
export async function cachedUpdateStatus(ttlMs = TTL_MS): Promise<UpdateStatus> {
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as { checkedAt?: number; latest?: string | null; reachable?: boolean };
    if (raw.checkedAt && Date.now() - raw.checkedAt < ttlMs) {
      return status({ version: raw.latest ?? null, reachable: raw.reachable ?? true });
    }
  } catch {
    /* no / stale / invalid cache — fall through to a fresh check */
  }
  const probe = await fetchLatestVersion();
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ checkedAt: Date.now(), latest: probe.version, reachable: probe.reachable }) + "\n");
  } catch {
    /* cache is best-effort */
  }
  return status(probe);
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
