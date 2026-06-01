import type { FrameworkAdapter } from "./types.js";
import { nextAppAdapter } from "./next-app.js";
import { nextPagesAdapter } from "./next-pages.js";
import { remixAdapter } from "./remix.js";
import { reactRouterAdapter } from "./react-router.js";
import { expoRouterAdapter } from "./expo-router.js";
import { reactNavigationAdapter } from "./react-navigation.js";
import { nuxtAdapter } from "./nuxt.js";
import { vueRouterAdapter } from "./vue-router.js";
import { svelteKitAdapter } from "./sveltekit.js";
import { astroAdapter } from "./astro.js";
import { angularAdapter } from "./angular.js";
import { swiftUiAdapter } from "./swiftui.js";
import { uikitAdapter } from "./uikit.js";
import { composeAdapter } from "./compose.js";
import { flutterAdapter } from "./flutter.js";
import { djangoAdapter } from "./django.js";
import { flaskAdapter } from "./flask.js";
import { railsAdapter } from "./rails.js";
import { staticHtmlAdapter } from "./static-html.js";

export type { FrameworkAdapter, ScreenFile, RawScreen, RawNav, RawCall, RawFeature } from "./types.js";

/**
 * Registered adapters (in detection priority order). Add new platforms here.
 * - Next.js (app/ or pages/ dir) before react-router (dep check) so a Next app — which also
 *   depends on React — isn't misread as a plain SPA. The Next adapters also bow out for
 *   react-native projects (Expo Router shares the `app/` dir convention).
 * - expo-router (file-based, needs `expo-router` dep) before react-navigation (config-based),
 *   since an Expo app pulls in @react-navigation transitively.
 * - remix before react-router: RR7 framework mode shares the `react-router` dependency, so the
 *   plain-SPA adapter would otherwise claim a Remix app.
 * - swiftui before uikit: a SwiftUI app may import UIKit, so it's claimed by swiftui first;
 *   only pure-UIKit apps fall to the uikit adapter.
 * - static-html is the LAST fallback: by the time it runs the project matched no framework, so
 *   "a folder of .html files" still yields a map.
 */
export const ADAPTERS: FrameworkAdapter[] = [
  nextAppAdapter,
  nextPagesAdapter,
  remixAdapter,
  reactRouterAdapter,
  expoRouterAdapter,
  reactNavigationAdapter,
  nuxtAdapter,
  vueRouterAdapter,
  svelteKitAdapter,
  astroAdapter,
  angularAdapter,
  swiftUiAdapter,
  uikitAdapter,
  composeAdapter,
  flutterAdapter,
  djangoAdapter,
  flaskAdapter,
  railsAdapter,
  staticHtmlAdapter,
];

/** First adapter that matches the project. Null if none. */
export function selectAdapter(projectRoot: string): FrameworkAdapter | null {
  return ADAPTERS.find((a) => a.detect(projectRoot)) ?? null;
}
