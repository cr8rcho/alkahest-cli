import { resolve } from "node:path";

/**
 * `.alkahest/` 대시보드를 로컬 서버로 띄워 화면-플로우 그래프를 탐색 (ALKAHEST.md §5).
 */
export async function view(path: string): Promise<void> {
  const projectRoot = resolve(path);
  console.log(`[alkahest] view: ${projectRoot}/.alkahest`);
  // TODO(Phase 2): map.json 로드 → 자기완결 index.html 서빙
  console.log("  └─ Phase 0 scaffold: 대시보드는 Phase 2에서 구현됩니다.");
}
