import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { selectAdapter, type FrameworkAdapter, type ScreenFile, type RawScreen } from "./adapters/index.js";
import {
  buildMap,
  screenFromRaw,
  resolveTransitions,
  resolveContains,
  resolveCalls,
  assembleMap,
  isExternalUrl,
} from "./resolve.js";
import { emitMap, emitDashboard, OUTPUT_DIR } from "./emit.js";
import { hashContent } from "./hash.js";
import type { ProductMap, Screen, Resource, Transition, Call } from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export interface ScanOptions {
  /** Ignore the baseline (map.json) and do a full rescan (ALKAHEST.md §10) */
  full?: boolean;
}

export interface ScanResult {
  map: ProductMap;
  outFile: string;
  stats: { reused: number; reparsed: number; total: number; incremental: boolean };
}

/**
 * Core pipeline detect→discover→parse→resolve→emit (no console output).
 * Framework is auto-selected via adapters (ALKAHEST.md §8). Incremental by default (§10).
 * Null if no screens are found. Shared by the CLI (scan) and the MCP server.
 */
export function runScan(projectRoot: string, options: ScanOptions = {}): ScanResult | null {
  const adapter = selectAdapter(projectRoot);
  if (!adapter) return null;
  const files = adapter.discover(projectRoot);
  if (!files.length) return null;

  const hashes = new Map<string, string>();
  for (const file of files) hashes.set(file.relPath, hashContent(readFileSync(file.absPath, "utf8")));

  const prev = options.full ? null : loadMap(projectRoot);
  const result = prev
    ? incrementalBuild(adapter, files, hashes, prev, projectRoot)
    : fullBuild(adapter, files, hashes, projectRoot);

  const outFile = emitMap(projectRoot, result.map);
  emitDashboard(projectRoot, result.map);
  return { ...result, outFile };
}

function fullBuild(
  adapter: FrameworkAdapter,
  files: ScreenFile[],
  hashes: Map<string, string>,
  projectRoot: string,
): Omit<ScanResult, "outFile"> {
  const parsed = new Map<string, RawScreen>();
  for (const file of files) parsed.set(file.relPath, adapter.parse(file));
  const map = buildMap({
    files,
    parsed,
    hashes,
    framework: adapter.id,
    router: adapter.router,
    projectRoot,
    scannedAt: new Date().toISOString(),
    alkahestVersion: pkg.version,
  });
  return { map, stats: { reused: 0, reparsed: map.screens.length, total: map.screens.length, incremental: false } };
}

function incrementalBuild(
  adapter: FrameworkAdapter,
  files: ScreenFile[],
  hashes: Map<string, string>,
  prev: ProductMap,
  projectRoot: string,
): Omit<ScanResult, "outFile"> {
  const screenIds = new Set(files.map((f) => f.id));
  const prevScreenByFile = new Map(prev.screens.map((s) => [s.sourceFile, s]));
  const prevResById = new Map(prev.resources.map((r) => [r.id, r]));

  const screens: Screen[] = [];
  const transitions: Transition[] = [];
  const calls: Call[] = [];
  const resources = new Map<string, Resource>();
  let reused = 0;
  let reparsed = 0;

  for (const file of files) {
    const prevScreen = prevScreenByFile.get(file.relPath);
    const unchanged = prevScreen && prev.meta.fileHashes[file.relPath] === hashes.get(file.relPath);

    if (unchanged) {
      reused++;
      screens.push(prevScreen); // preserve as-is, including summary
      transitions.push(...prev.transitions.filter((t) => t.loc.file === file.relPath));
      for (const c of prev.calls.filter((c) => c.loc.file === file.relPath)) {
        calls.push(c);
        if (c.to) {
          const r = prevResById.get(c.to);
          if (r && !resources.has(r.id)) resources.set(r.id, r);
        }
      }
    } else {
      reparsed++;
      const raw = adapter.parse(file);
      screens.push(screenFromRaw(file, hashes.get(file.relPath) ?? "", raw));
      const navTrans = resolveTransitions(file.id, raw.navs, screenIds, file.relPath);
      transitions.push(...navTrans);
      transitions.push(...resolveContains(file.id, raw.contains, screenIds, navTrans, file.relPath));
      calls.push(...resolveCalls(file.id, raw.calls, file.relPath, resources));
    }
  }

  // Re-resolve reused edges against the new screen set: internal transitions pointing to a vanished screen become unresolved.
  for (const t of transitions) {
    if (t.to && !isExternalUrl(t.to) && !screenIds.has(t.to)) {
      t.rawTarget = t.rawTarget ?? t.to;
      t.to = null;
    }
  }

  const map = assembleMap({
    screens,
    transitions,
    calls,
    resources: [...resources.values()],
    hashes,
    framework: adapter.id,
    router: adapter.router,
    projectRoot,
    scannedAt: new Date().toISOString(),
    alkahestVersion: pkg.version,
  });
  return { map, stats: { reused, reparsed, total: screens.length, incremental: true } };
}

/** Reads an existing `.alkahest/map.json` (null if absent). */
export function loadMap(projectRoot: string): ProductMap | null {
  const file = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProductMap;
  } catch {
    return null;
  }
}

/** Reads map.json if present, otherwise scans on the fly. Null if both fail. */
export function loadOrScan(projectRoot: string): ProductMap | null {
  return loadMap(projectRoot) ?? runScan(projectRoot)?.map ?? null;
}
