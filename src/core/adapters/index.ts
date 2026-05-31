import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { nextPagesAdapter } from "./next-pages.js";
import { reactRouterAdapter } from "./react-router.js";
import { expoRouterAdapter } from "./expo-router.js";
import { reactNavigationAdapter } from "./react-navigation.js";
import { swiftUiAdapter } from "./swiftui.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Registered adapters (in detection priority order). Add new platforms here.
 * - Next.js (app/ or pages/ dir) before react-router (dep check) so a Next app — which also
 *   depends on React — isn't misread as a plain SPA. The Next adapters also bow out for
 *   react-native projects (Expo Router shares the `app/` dir convention).
 * - expo-router (file-based, needs `expo-router` dep) before react-navigation (config-based),
 *   since an Expo app pulls in @react-navigation transitively.
 */
export const ADAPTERS: FrameworkAdapter[] = [
  nextAppAdapter,
  nextPagesAdapter,
  reactRouterAdapter,
  expoRouterAdapter,
  reactNavigationAdapter,
  swiftUiAdapter,
];

/** First adapter that matches the project. Null if none. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
