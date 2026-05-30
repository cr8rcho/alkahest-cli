import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OUTPUT_DIR } from "../core/emit.js";
import { generatePrd, hasApiKey } from "../core/llm.js";
import type { ProductMap, Screen } from "../core/types.js";

/**
 * Generate PRD/requirements markdown for the given screen(s) at `.alkahest/prd/<slug>.md`
 * (ALKAHEST.md §5). Written by Claude from the map.json structure. Requires ANTHROPIC_API_KEY.
 */
export async function prd(screenArgs: string[]): Promise<void> {
  const projectRoot = resolve(".");
  const mapPath = join(projectRoot, OUTPUT_DIR, "map.json");
  if (!existsSync(mapPath)) {
    console.log(`[alkahest] ${mapPath} not found — run 'alkahest scan' first.`);
    return;
  }
  if (!hasApiKey()) {
    console.log("[alkahest] ANTHROPIC_API_KEY is required. e.g. export ANTHROPIC_API_KEY=sk-ant-…");
    return;
  }

  const map = JSON.parse(readFileSync(mapPath, "utf8")) as ProductMap;
  const prdDir = join(projectRoot, OUTPUT_DIR, "prd");
  mkdirSync(prdDir, { recursive: true });

  for (const arg of screenArgs) {
    const screen = matchScreen(map, arg);
    if (!screen) {
      console.log(`  ⚠ screen not found: ${arg}`);
      continue;
    }
    process.stdout.write(`  generating PRD: ${screen.route} … `);
    const markdown = await generatePrd(map, screen);
    const outFile = join(prdDir, `${slug(screen.route)}.md`);
    writeFileSync(outFile, markdown + "\n");
    console.log(`→ ${join(OUTPUT_DIR, "prd", `${slug(screen.route)}.md`)}`);
  }
}

/** Match by id/route/title loosely (case- and leading-slash-insensitive). */
function matchScreen(map: ProductMap, arg: string): Screen | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/^\/+|\/+$/g, "");
  const target = norm(arg);
  return map.screens.find((s) => norm(s.id) === target || norm(s.route) === target || norm(s.title) === target);
}

/** route → filename slug. "/" → home, "/a/b" → a_b */
function slug(route: string): string {
  const s = route.replace(/^\/+|\/+$/g, "").replace(/[^\w[\]-]+/g, "_");
  return s || "home";
}
