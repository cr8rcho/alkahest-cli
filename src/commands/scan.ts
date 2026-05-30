import { relative, resolve } from "node:path";
import { runScan } from "../core/pipeline.js";
import { emitMap, emitDashboard } from "../core/emit.js";
import { serveDashboard } from "../core/serve.js";
import { hasApiKey, summarizeScreens } from "../core/llm.js";

export interface ScanOptions {
  /** 기준선 무시하고 전체 재스캔 (ALKAHEST.md §10) */
  full: boolean;
  /** scan 후 바로 대시보드 오픈 */
  open: boolean;
  /** 화면별 LLM 요약 생성 (Phase 3) — ANTHROPIC_API_KEY 필요 */
  summarize: boolean;
}

/**
 * 분석 → `.alkahest/map.json` + `index.html` (ALKAHEST.md §4).
 * 코어 파이프라인은 runScan 에 있고, 여기선 로깅·요약·오픈만 얹는다.
 */
export async function scan(path: string, options: ScanOptions): Promise<void> {
  const projectRoot = resolve(path);
  const result = runScan(projectRoot, { full: options.full });

  if (!result) {
    console.log(`[alkahest] ${projectRoot}: 화면을 찾지 못했습니다.`);
    console.log("  └─ Phase 1은 Next app-router(app/ 또는 src/app/의 page.*)만 지원합니다.");
    return;
  }

  const { map, outFile, stats } = result;
  console.log(`[alkahest] scan: ${projectRoot}`);
  const mode = stats.incremental ? `증분 (재사용 ${stats.reused} / 재파싱 ${stats.reparsed})` : "전체";
  console.log(`  framework=${map.meta.framework} router=${map.meta.router} screens=${map.screens.length} · ${mode}`);

  if (options.summarize) {
    if (!hasApiKey()) {
      console.log("  ⚠ --summarize: ANTHROPIC_API_KEY 가 없어 요약을 건너뜁니다.");
    } else {
      const need = map.screens.filter((s) => !s.summary); // 증분: 변경된 화면만(요약 비어있음)
      if (!need.length) {
        console.log("  요약: 변경 없음 — 전부 보존");
      } else {
        process.stdout.write(`  요약 생성 중(LLM, ${need.length}개)… `);
        const summaries = await summarizeScreens(map, need);
        for (const s of map.screens) {
          const v = summaries.get(s.id);
          if (v) s.summary = v;
        }
        emitMap(projectRoot, map); // 요약 반영해 재기록
        emitDashboard(projectRoot, map);
        console.log("완료");
      }
    }
  }

  const unresolvedNav = map.transitions.filter((t) => t.to === null).length;
  const unresolvedCall = map.calls.filter((c) => c.to === null).length;
  console.log(`  → ${relative(projectRoot, outFile) || outFile} (+ index.html)`);
  console.log(
    `  screens=${map.screens.length} resources=${map.resources.length} ` +
      `transitions=${map.transitions.length}(미해결 ${unresolvedNav}) ` +
      `calls=${map.calls.length}(미해결 ${unresolvedCall})`,
  );

  // TODO(Phase 1.x): 증분 — 기준선 fileHashes 비교로 변경 파일만 재처리 (현재는 항상 전체 스캔)
  if (options.open) await serveDashboard(projectRoot);
}
