import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { swiftUiAdapter } from "./swiftui.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/** Registered adapters (in detection priority order). Add new platforms here. */
export const ADAPTERS: FrameworkAdapter[] = [nextAppAdapter, swiftUiAdapter];

/** First adapter that matches the project. Null if none. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
