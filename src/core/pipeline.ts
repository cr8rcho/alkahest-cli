import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { selectAdapter, type FrameworkAdapter, type ScreenFile, type RawScreen } from "./adapters/index.js";
import {
  buildMap,
  screenFromRaw,
  resolveTransitions,
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
  /** 기준선(map.json) 무시하고 전체 재스캔 (ALKAHEST.md §10) */
  full?: boolean;
}

export interface ScanResult {
  map: ProductMap;
  outFile: string;
  stats: { reused: number; reparsed: number; total: number; incremental: boolean };
}

/**
 * 코어 파이프라인 detect→discover→parse→resolve→emit (콘솔 출력 없음).
 * 프레임워크는 어댑터로 자동 선택(ALKAHEST.md §8). 기본 증분(§10).
 * 화면을 못 찾으면 null. CLI(scan)와 MCP 서버가 공유한다.
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
      screens.push(prevScreen); // summary 포함 그대로 보존
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
      transitions.push(...resolveTransitions(file.id, raw.navs, screenIds, file.relPath));
      calls.push(...resolveCalls(file.id, raw.calls, file.relPath, resources));
    }
  }

  // 재사용 엣지를 새 화면 집합에 맞춰 재해석: 사라진 화면을 가리키는 내부 이동은 미해결로.
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

/** 기존 `.alkahest/map.json` 을 읽는다(없으면 null). */
export function loadMap(projectRoot: string): ProductMap | null {
  const file = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProductMap;
  } catch {
    return null;
  }
}

/** map.json 이 있으면 읽고, 없으면 즉석 스캔. 둘 다 실패하면 null. */
export function loadOrScan(projectRoot: string): ProductMap | null {
  return loadMap(projectRoot) ?? runScan(projectRoot)?.map ?? null;
}
