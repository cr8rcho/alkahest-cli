#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { scan } from "./commands/scan.js";
import { view } from "./commands/view.js";
import { prd } from "./commands/prd.js";
import { mcp } from "./commands/mcp.js";
import { hook } from "./commands/hook.js";

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
  .option("--summarize", "화면별 LLM 요약 생성 (ANTHROPIC_API_KEY 필요)", false)
  .action((path: string, opts: { full: boolean; open: boolean; summarize: boolean }) => scan(path, opts));

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

program
  .command("mcp")
  .description("MCP 서버를 stdio로 실행 (에이전트가 제품 지도를 질의, 키 불필요)")
  .action(() => mcp());

program
  .command("hook")
  .description("git hook 설치/제거 — 커밋·머지 시 scan 자동 실행 (diff 자동 갱신)")
  .argument("<action>", "install | uninstall")
  .action((action: string) => hook(action));

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
