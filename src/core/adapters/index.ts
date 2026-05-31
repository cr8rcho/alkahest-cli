import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { nextPagesAdapter } from "./next-pages.js";
import { reactRouterAdapter } from "./react-router.js";
import { swiftUiAdapter } from "./swiftui.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Registered adapters (in detection priority order). Add new platforms here.
 * Next.js detection (app/ or pages/ dir) precedes react-router (a dependency check)
 * so a Next app — which also depends on React — isn't misclassified as a plain SPA.
 */
export const ADAPTERS: FrameworkAdapter[] = [nextAppAdapter, nextPagesAdapter, reactRouterAdapter, swiftUiAdapter];

/** First adapter that matches the project. Null if none. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
