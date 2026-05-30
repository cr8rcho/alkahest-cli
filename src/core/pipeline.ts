import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { discover } from "./discover.js";
import { createProject, parseScreen, type RawScreen } from "./parse.js";
import { buildMap } from "./resolve.js";
import { emitMap, emitDashboard, OUTPUT_DIR } from "./emit.js";
import { hashContent } from "./hash.js";
import type { ProductMap } from "./types.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export interface ScanResult {
  map: ProductMap;
  outFile: string;
}

/**
 * 코어 파이프라인 discover→parse→resolve→emit (콘솔 출력 없음).
 * 화면을 못 찾으면 null. CLI(scan)와 MCP 서버가 공유한다.
 */
export function runScan(projectRoot: string): ScanResult | null {
  const discovery = discover(projectRoot);
  if (!discovery.screenFiles.length) return null;

  const project = createProject();
  const parsed = new Map<string, RawScreen>();
  const hashes = new Map<string, string>();
  for (const file of discovery.screenFiles) {
    hashes.set(file.relPath, hashContent(readFileSync(file.absPath, "utf8")));
    parsed.set(file.relPath, parseScreen(project.addSourceFileAtPath(file.absPath)));
  }

  const map = buildMap({
    discovery,
    parsed,
    hashes,
    projectRoot,
    scannedAt: new Date().toISOString(),
    alkahestVersion: pkg.version,
  });

  const outFile = emitMap(projectRoot, map);
  emitDashboard(projectRoot, map);
  return { map, outFile };
}

/** 기존 `.alkahest/map.json` 을 읽는다(없으면 null). */
export function loadMap(projectRoot: string): ProductMap | null {
  const file = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as ProductMap;
}

/** map.json 이 있으면 읽고, 없으면 즉석 스캔. 둘 다 실패하면 null. */
export function loadOrScan(projectRoot: string): ProductMap | null {
  return loadMap(projectRoot) ?? runScan(projectRoot)?.map ?? null;
}
