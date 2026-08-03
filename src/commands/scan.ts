import { relative, resolve } from "node:path";
import { runScan } from "../core/pipeline.js";

export interface ScanOptions {
  /** Ignore the baseline and rescan everything (ALKAHEST.md §10) */
  full: boolean;
}

/**
 * Analyze → `.alkahest/map.json` (ALKAHEST.md §4). The core pipeline lives in
 * runScan; this only adds logging. Viewing the map happens on the hosted viewer:
 * run `alkahest publish` (token from the web app) for a shareable link.
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

  const unresolvedNav = map.transitions.filter((t) => t.to === null).length;
  const unresolvedCall = map.calls.filter((c) => c.to === null).length;
  console.log(`  → ${relative(projectRoot, outFile) || outFile}`);
  console.log(
    `  screens=${map.screens.length} resources=${map.resources.length} ` +
      `transitions=${map.transitions.length}(unresolved ${unresolvedNav}) ` +
      `calls=${map.calls.length}(unresolved ${unresolvedCall})`,
  );
  console.log(`  view it on the hosted viewer: alkahest publish  (token: alkahest.app → Account)`);
}
