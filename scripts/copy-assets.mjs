// 비-TS 에셋(대시보드 템플릿)을 dist/ 로 복사. tsc 는 .html 을 복사하지 않으므로 빌드 후 실행.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "assets");
const dest = join(root, "dist", "assets");

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-assets] ${src} → ${dest}`);
}
