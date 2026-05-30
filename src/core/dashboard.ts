import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ProductMap } from "./types.js";

/** 자기완결 대시보드 템플릿(에셋). 빌드 시 dist/assets 로 복사됨(scripts/copy-assets.mjs). */
const TEMPLATE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "dashboard.html"), "utf8");

const PLACEHOLDER = "/*__ALKAHEST_MAP__*/";

/** ProductMap 을 인라인한 자기완결 HTML 문자열. 외부 의존성/네트워크 없음. */
export function renderDashboard(map: ProductMap): string {
  const json = JSON.stringify(map).replace(/</g, "\\u003c"); // </script> 주입 방지
  return TEMPLATE.replace(PLACEHOLDER, () => json);
}
