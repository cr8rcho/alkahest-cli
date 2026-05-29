#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { scan } from "./commands/scan.js";
import { view } from "./commands/view.js";
import { prd } from "./commands/prd.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("alkahest")
  .description("코드에서 제품을 역복원하는 화면-그래프 CLI (React/Next 정적 분석 → 제품 지도)")
  .version(pkg.version);

program
  .command("scan")
  .description("프로젝트를 분석해 .alkahest/map.json + index.html 생성 (기본: 증분)")
  .argument("[path]", "분석할 프로젝트 경로", ".")
  .option("--full", "기준선 무시하고 전체 재스캔", false)
  .option("--open", "scan 후 바로 대시보드 오픈", false)
  .action((path: string, opts: { full: boolean; open: boolean }) => scan(path, opts));

program
  .command("view")
  .description(".alkahest/ 대시보드를 로컬 서버로 오픈")
  .argument("[path]", "프로젝트 경로", ".")
  .action((path: string) => view(path));

program
  .command("prd")
  .description("선택한 화면(들)의 PRD/요구사항 마크다운 생성")
  .argument("<screens...>", "PRD를 생성할 화면 id 또는 route")
  .action((screens: string[]) => prd(screens));

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
