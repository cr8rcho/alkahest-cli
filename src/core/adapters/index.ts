import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { nextPagesAdapter } from "./next-pages.js";
import { swiftUiAdapter } from "./swiftui.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Registered adapters (in detection priority order). Add new platforms here.
 * next-app before next-pages: a hybrid project (both `app/` and `pages/`) maps as app-router.
 */
export const ADAPTERS: FrameworkAdapter[] = [nextAppAdapter, nextPagesAdapter, swiftUiAdapter];

/** First adapter that matches the project. Null if none. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
