// Copy non-TS assets (the dashboard template) into dist/. tsc doesn't copy .html, so run this after the build.
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
