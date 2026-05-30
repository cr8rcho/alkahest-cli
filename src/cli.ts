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
  .description("Screen-graph CLI that reverse-engineers a product from code (static analysis → product map)")
  .version(pkg.version);

program
  .command("scan")
  .description("Analyze a project → .alkahest/map.json + index.html (incremental by default)")
  .argument("[path]", "project path to analyze", ".")
  .option("--full", "ignore the baseline and rescan everything", false)
  .option("--open", "open the dashboard right after scanning", false)
  .option("--summarize", "generate per-screen LLM summaries (requires ANTHROPIC_API_KEY)", false)
  .action((path: string, opts: { full: boolean; open: boolean; summarize: boolean }) => scan(path, opts));

program
  .command("view")
  .description("open the .alkahest/ dashboard via a local server")
  .argument("[path]", "project path", ".")
  .action((path: string) => view(path));

program
  .command("prd")
  .description("generate PRD/requirements markdown for the given screen(s)")
  .argument("<screens...>", "screen id or route to generate a PRD for")
  .action((screens: string[]) => prd(screens));

program
  .command("mcp")
  .description("run the MCP server over stdio (agents query the product map; no key)")
  .action(() => mcp());

program
  .command("hook")
  .description("install/remove git hooks — run scan on commit/merge (diff-driven refresh)")
  .argument("<action>", "install | uninstall")
  .action((action: string) => hook(action));

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
