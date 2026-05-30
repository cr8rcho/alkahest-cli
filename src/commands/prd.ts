import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import { generatePrd, hasApiKey } from "../core/llm.js";
import type { ProductMap, Screen } from "../core/types.js";

/**
 * 선택한 화면(들)의 PRD/요구사항 마크다운을 `.alkahest/prd/<slug>.md` 로 생성 (ALKAHEST.md §5).
 * map.json 의 구조를 근거로 Claude 가 작성. ANTHROPIC_API_KEY 필요.
 */
export async function prd(screenArgs: string[]): Promise<void> {
  const projectRoot = resolve(".");
  const mapPath = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapPath)) {
    console.log(`[alkahest] ${mapPath} 가 없습니다 — 먼저 'alkahest scan' 을 실행하세요.`);
    return;
  }
  if (!hasApiKey()) {
    console.log("[alkahest] ANTHROPIC_API_KEY 가 필요합니다. 예: export ANTHROPIC_API_KEY=sk-ant-…");
    return;
  }

  const map = JSON.parse(readFileSync(mapPath, "utf8")) as ProductMap;
  const prdDir = join(projectRoot, OUTPUT_DIR, "prd");
  mkdirSync(prdDir, { recursive: true });

  for (const arg of screenArgs) {
    const screen = matchScreen(map, arg);
    if (!screen) {
      console.log(`  ⚠ 화면을 찾지 못함: ${arg}`);
      continue;
    }
    process.stdout.write(`  PRD 생성: ${screen.route} … `);
    const markdown = await generatePrd(map, screen);
    const outFile = join(prdDir, `${slug(screen.route)}.md`);
    writeFileSync(outFile, markdown + "\n");
    console.log(`→ ${join(OUTPUT_DIR, "prd", `${slug(screen.route)}.md`)}`);
  }
}

/** id/route 를 유연하게 매칭 (대소문자·앞 슬래시 무시). */
function matchScreen(map: ProductMap, arg: string): Screen | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^\/+|\/+$/g, "");
  const target = norm(arg);
  return map.screens.find((s) => norm(s.id) === target || norm(s.route) === target || norm(s.title) === target);
}

/** route → 파일명 slug. "/" → home, "/a/b" → a_b */
function slug(route: string): string {
  const s = route.replace(/^\/+|\/+$/g, "").replace(/[^\w[\]-]+/g, "_");
  return s || "home";
}
