import { relative, resolve } from "node:path";
import { runScan } from "../core/pipeline.js";
import { emitMap, emitDashboard } from "../core/emit.js";
import { serveDashboard } from "../core/serve.js";
import { hasApiKey, summarizeScreens } from "../core/llm.js";

export interface ScanOptions {
  /** Ignore the baseline and rescan everything (ALKAHEST.md §10) */
  full: boolean;
  /** Open the dashboard right after scanning */
  open: boolean;
  /** Generate per-screen LLM summaries (Phase 3) — requires ANTHROPIC_API_KEY */
  summarize: boolean;
}

/**
 * Analyze → `.alkahest/map.json` + `index.html` (ALKAHEST.md §4).
 * The core pipeline lives in runScan; this only adds logging, summaries, and open.
 */
export async function scan(path: string, options: ScanOptions): Promise<void> {
  const projectRoot = resolve(path);
  const result = runScan(projectRoot, { full: options.full });

  if (!result) {
    console.log(`[alkahest] ${projectRoot}: no screens found.`);
    console.log("  └─ Phase 1 supports only Next app-router (page.* under app/ or src/app/).");
    return;
  }

  const { map, outFile, stats } = result;
  console.log(`[alkahest] scan: ${projectRoot}`);
  const mode = stats.incremental ? `incremental (reused ${stats.reused} / reparsed ${stats.reparsed})` : "full";
  console.log(`  framework=${map.meta.framework} router=${map.meta.router} screens=${map.screens.length} · ${mode}`);

  if (options.summarize) {
    if (!hasApiKey()) {
      console.log("  ⚠ --summarize: ANTHROPIC_API_KEY not set, skipping summaries.");
    } else {
      const need = map.screens.filter((s) => !s.summary); // incremental: only changed screens (empty summary)
      if (!need.length) {
        console.log("  summaries: no changes — all preserved");
      } else {
        process.stdout.write(`  summarizing (LLM, ${need.length})… `);
        const summaries = await summarizeScreens(map, need);
        for (const s of map.screens) {
          const v = summaries.get(s.id);
          if (v) s.summary = v;
        }
        emitMap(projectRoot, map); // re-emit with summaries
        emitDashboard(projectRoot, map);
        console.log("done");
      }
    }
  }

  const unresolvedNav = map.transitions.filter((t) => t.to === null).length;
  const unresolvedCall = map.calls.filter((c) => c.to === null).length;
  console.log(`  → ${relative(projectRoot, outFile) || outFile} (+ index.html)`);
  console.log(
    `  screens=${map.screens.length} resources=${map.resources.length} ` +
      `transitions=${map.transitions.length}(unresolved ${unresolvedNav}) ` +
      `calls=${map.calls.length}(unresolved ${unresolvedCall})`,
  );

  if (options.open) await serveDashboard(projectRoot);
}
