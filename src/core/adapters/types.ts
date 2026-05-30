import type { Feature, Framework, Router } from "../types.js";

/**
 * Framework adapter layer (ALKAHEST.md §8 adapters).
 * Only discover+parse differ per framework; resolve/emit/dashboard/MCP are shared.
 * Supporting a new platform = adding one adapter. The parsing approach (AST/regex/tree-sitter) is up to the adapter.
 */

/** One discovered screen file. id/route/title are filled in by the adapter. */
export interface ScreenFile {
  /** Absolute path */
  absPath: string;
  /** Path relative to projectRoot (posix) */
  relPath: string;
  /** Stable screen identifier. Next=route("/x"), SwiftUI=View name */
  id: string;
  /** Route notation (same as id if none) */
  route: string;
  /** Human-readable name */
  title: string;
  /** Whether this is the app entry point (root launched by @main/App, or the "/" route). */
  isEntry?: boolean;
}

// ---- raw signals from the parse stage (resolve converts them into the graph model) ----

export interface RawNav {
  /** Statically resolved target screen identifier/URL, null if unresolved */
  target: string | null;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawCall {
  /** Statically resolved endpoint URL, null if unresolved */
  url: string | null;
  method?: string;
  raw: string;
  trigger: string;
  line: number;
}
export interface RawFeature {
  kind: Feature["kind"];
  label: string;
  detail: string;
  line: number;
}
export interface RawScreen {
  navs: RawNav[];
  calls: RawCall[];
  features: RawFeature[];
  components: string[];
  /**
   * Candidate other screens this screen directly instantiates (capitalized constructor calls).
   * resolve turns only the intersection with screenIds into "contains" (structural containment) edges.
   * Example: SwiftUI TabView's Recents()/Assets(), child Views embedded by a parent.
   */
  contains: string[];
}

/** Framework adapter. */
export interface FrameworkAdapter {
  id: Framework;
  router: Router;
  /** Is this project a target for this adapter? (lightweight check) */
  detect(projectRoot: string): boolean;
  /** Enumerate screen files (fills id/route/title). */
  discover(projectRoot: string): ScreenFile[];
  /** Parse one screen file to extract raw signals. */
  parse(file: ScreenFile): RawScreen;
}
