import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { discover } from "../core/discover.js";
import { createProject, parseScreen, type RawScreen } from "../core/parse.js";
import { buildMap } from "../core/resolve.js";
import { emitMap } from "../core/emit.js";
import { hashContent } from "../core/hash.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export interface ScanOptions {
  /** 기준선 무시하고 전체 재스캔 (ALKAHEST.md §9) */
  full: boolean;
  /** scan 후 바로 대시보드 오픈 */
  open: boolean;
}

/**
 * 분석 → `.alkahest/map.json`.
 * 파이프라인: discover → parse → resolve → emit (ALKAHEST.md §4).
 */
export async function scan(path: string, options: ScanOptions): Promise<void> {
  const projectRoot = resolve(path);
  const discovery = discover(projectRoot);

  if (!discovery.screenFiles.length) {
    console.log(`[alkahest] ${projectRoot}: 화면을 찾지 못했습니다.`);
    console.log("  └─ Phase 1은 Next app-router(app/ 또는 src/app/의 page.*)만 지원합니다.");
    return;
  }

  console.log(`[alkahest] scan: ${projectRoot}`);
  console.log(`  framework=${discovery.framework} router=${discovery.router} screens=${discovery.screenFiles.length}`);
  if (options.full) console.log("  (--full: 전체 재스캔)");

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

  const unresolvedNav = map.transitions.filter((t) => t.to === null).length;
  const unresolvedCall = map.calls.filter((c) => c.to === null).length;
  console.log(`  → ${relative(projectRoot, outFile) || outFile}`);
  console.log(
    `  screens=${map.screens.length} resources=${map.resources.length} ` +
      `transitions=${map.transitions.length}(미해결 ${unresolvedNav}) ` +
      `calls=${map.calls.length}(미해결 ${unresolvedCall})`,
  );

  // TODO(Phase 1.x): 증분 — 기준선 fileHashes 비교로 변경 파일만 재처리 (현재는 항상 전체 스캔)
  if (options.open) console.log("  └─ --open: Phase 2(view) 구현 후 동작합니다.");
}
