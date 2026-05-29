/**
 * 선택한 화면(들)의 PRD/요구사항 마크다운을 `.alkahest/prd/<screen>.md` 로 생성 (ALKAHEST.md §5).
 * map.json 의 화면 요약/기능을 근거로 LLM(Claude)이 작성.
 */
export async function prd(screens: string[]): Promise<void> {
  console.log(`[alkahest] prd: ${screens.join(", ") || "(대상 화면 미지정)"}`);
  // TODO(Phase 3): map.json 로드 → 화면별 LLM PRD 생성
  console.log("  └─ Phase 0 scaffold: PRD 생성은 Phase 3에서 구현됩니다.");
}
